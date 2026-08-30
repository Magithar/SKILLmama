import { test } from "node:test";
import assert from "node:assert/strict";
import { gatherFactorEvidence, mapMaintenanceBand, mapPopularityBand } from "../dist/index.js";
import { normalizeGithubRepoResponse, normalizeNpmDownloadsResponse } from "../dist/mechanical/factors.js";

const TODAY = "2026-08-24";

// ---------------------------------------------------------------------------
// 1. Response normalization — the two payload shapes, and their absences.
// ---------------------------------------------------------------------------

test("github repo payload yields stars, last push date, archived flag", () => {
  const parsed = normalizeGithubRepoResponse({
    stargazers_count: 12345,
    pushed_at: "2026-08-01T09:14:22Z",
    archived: false,
  });
  assert.deepEqual(parsed, {
    stars: 12345,
    lastCommitDate: "2026-08-01",
    archived: false,
  });
});

test("missing github fields yield null, never a fabricated zero", () => {
  assert.deepEqual(normalizeGithubRepoResponse({}), {
    stars: null,
    lastCommitDate: null,
    archived: false,
  });
  assert.deepEqual(normalizeGithubRepoResponse(null), {
    stars: null,
    lastCommitDate: null,
    archived: false,
  });
  // A genuinely unstarred repo reports 0 explicitly, which must survive.
  assert.equal(
    normalizeGithubRepoResponse({ stargazers_count: 0, pushed_at: "2026-01-01T00:00:00Z" }).stars,
    0
  );
  assert.equal(
    normalizeGithubRepoResponse({ stargazers_count: 5, pushed_at: "not a date" }).lastCommitDate,
    null
  );
  assert.equal(normalizeGithubRepoResponse({ archived: true }).archived, true);
  assert.equal(normalizeGithubRepoResponse({ archived: "yes" }).archived, false);
});

test("npm downloads payload yields the weekly count, junk yields null", () => {
  assert.equal(normalizeNpmDownloadsResponse({ downloads: 250_000 }), 250_000);
  assert.equal(normalizeNpmDownloadsResponse({ downloads: 0 }), 0);
  assert.equal(normalizeNpmDownloadsResponse({}), null);
  assert.equal(normalizeNpmDownloadsResponse({ downloads: "many" }), null);
  assert.equal(normalizeNpmDownloadsResponse({ downloads: -1 }), null);
  assert.equal(normalizeNpmDownloadsResponse(null), null);
});

// ---------------------------------------------------------------------------
// 2. Evidence gathering — one GitHub call serves both factors.
// ---------------------------------------------------------------------------

function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    const handler = routes[String(url)];
    if (!handler) return { ok: false, status: 404, json: async () => ({}) };
    if (handler instanceof Error) throw handler;
    return { ok: true, status: 200, json: async () => handler };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const REPO_URL = "https://api.github.com/repos/vercel/next.js";
const DOWNLOADS_URL = "https://api.npmjs.org/downloads/point/last-week/next";

test("a repo plus an npm package costs exactly two requests", async () => {
  const fetchImpl = stubFetch({
    [REPO_URL]: { stargazers_count: 130_000, pushed_at: "2026-08-23T12:00:00Z", archived: false },
    [DOWNLOADS_URL]: { downloads: 7_000_000 },
  });
  const evidence = await gatherFactorEvidence(
    { repo: "vercel/next.js", npmPackage: "next" },
    { fetchImpl }
  );
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(evidence.popularity, [
    { source: "github-stars", status: "ok", stars: 130_000 },
    { source: "npm-downloads", status: "ok", weeklyDownloads: 7_000_000 },
  ]);
  assert.deepEqual(evidence.maintenance, [
    {
      source: "github-last-commit",
      status: "ok",
      lastCommitDate: "2026-08-23",
      archived: false,
    },
  ]);
});

test("an absent source is recorded as unverified, not skipped", async () => {
  const fetchImpl = stubFetch({});
  const evidence = await gatherFactorEvidence({}, { fetchImpl });
  assert.equal(fetchImpl.calls.length, 0);
  assert.deepEqual(evidence.popularity, [
    { source: "github-stars", status: "unverified", reason: "no-repo" },
    { source: "npm-downloads", status: "unverified", reason: "no-npm-package" },
  ]);
  assert.deepEqual(evidence.maintenance, [
    { source: "github-last-commit", status: "unverified", reason: "no-repo" },
  ]);
});

test("transport failure degrades to unverified, never to a number", async () => {
  const thrower = stubFetch({ [REPO_URL]: new Error("ECONNRESET") });
  const evidence = await gatherFactorEvidence(
    { repo: "vercel/next.js", npmPackage: "next" },
    { fetchImpl: thrower }
  );
  assert.deepEqual(evidence.popularity[0], {
    source: "github-stars",
    status: "unverified",
    reason: "unreachable",
  });
  // 404 on the downloads route (no handler registered) is equally unverified.
  assert.deepEqual(evidence.popularity[1], {
    source: "npm-downloads",
    status: "unverified",
    reason: "unreachable",
  });
  assert.deepEqual(evidence.maintenance[0], {
    source: "github-last-commit",
    status: "unverified",
    reason: "unreachable",
  });
});

test("a reachable repo missing pushed_at leaves maintenance unverified but keeps stars", async () => {
  const fetchImpl = stubFetch({ [REPO_URL]: { stargazers_count: 40 } });
  const evidence = await gatherFactorEvidence({ repo: "vercel/next.js" }, { fetchImpl });
  assert.deepEqual(evidence.popularity[0], { source: "github-stars", status: "ok", stars: 40 });
  assert.deepEqual(evidence.maintenance[0], {
    source: "github-last-commit",
    status: "unverified",
    reason: "unreachable",
  });
});

test("a github token is sent as a bearer header when supplied", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = init.headers;
    return { ok: true, status: 200, json: async () => ({ stargazers_count: 1, pushed_at: "2026-08-01T00:00:00Z" }) };
  };
  await gatherFactorEvidence({ repo: "a/b" }, { fetchImpl, githubToken: "ghp_x" });
  assert.equal(seen.authorization, "Bearer ghp_x");

  await gatherFactorEvidence({ repo: "a/b" }, { fetchImpl });
  assert.equal("authorization" in seen, false);
});

test("a malformed target throws instead of quietly searching nothing", async () => {
  await assert.rejects(() => gatherFactorEvidence(null), /target must be an object/);
  await assert.rejects(
    () => gatherFactorEvidence({ repo: "https://github.com/vercel/next.js" }),
    /must be "owner\/name"/
  );
  await assert.rejects(() => gatherFactorEvidence({ repo: "nextjs" }), /must be "owner\/name"/);
  await assert.rejects(
    () => gatherFactorEvidence({ npmPackage: "" }),
    /npmPackage must be a non-empty string/
  );
});

// ---------------------------------------------------------------------------
// 3. Popularity bands.
// ---------------------------------------------------------------------------

const stars = (n) => ({ source: "github-stars", status: "ok", stars: n });
const downloads = (n) => ({ source: "npm-downloads", status: "ok", weeklyDownloads: n });
const noStars = { source: "github-stars", status: "unverified", reason: "no-repo" };
const noDownloads = { source: "npm-downloads", status: "unverified", reason: "no-npm-package" };

test("star bands match SKILL.md's table", () => {
  const band = (n) => mapPopularityBand([stars(n), noDownloads]).band;
  assert.deepEqual(band(50_000), { low: 10, high: 10 });
  assert.deepEqual(band(10_001), { low: 10, high: 10 });
  assert.deepEqual(band(10_000), { low: 7, high: 9 }); // exact edge: higher band
  assert.deepEqual(band(1_000), { low: 7, high: 9 });
  assert.deepEqual(band(999), { low: 4, high: 6 });
  assert.deepEqual(band(100), { low: 4, high: 6 });
  assert.deepEqual(band(99), { low: 1, high: 3 });
  assert.deepEqual(band(0), { low: 1, high: 3 });
});

test("download bands match SKILL.md's table", () => {
  const band = (n) => mapPopularityBand([noStars, downloads(n)]).band;
  assert.deepEqual(band(5_000_000), { low: 10, high: 10 });
  assert.deepEqual(band(1_000_001), { low: 10, high: 10 });
  assert.deepEqual(band(1_000_000), { low: 7, high: 9 });
  assert.deepEqual(band(100_000), { low: 7, high: 9 });
  assert.deepEqual(band(99_999), { low: 4, high: 6 });
  assert.deepEqual(band(10_000), { low: 4, high: 6 });
  assert.deepEqual(band(9_999), { low: 1, high: 3 });
});

test("the bands are OR'd: the best available source wins", () => {
  // 40 stars alone is 1-3; 3M weekly downloads alone is 10. SKILL.md's OR
  // means the transitive workhorse scores 10.
  const outcome = mapPopularityBand([stars(40), downloads(3_000_000)]);
  assert.equal(outcome.status, "banded");
  assert.deepEqual(outcome.band, { low: 10, high: 10 });
  assert.ok(outcome.notes.some((n) => n.includes("40 stars")));
  assert.ok(outcome.notes.some((n) => n.includes("3,000,000 weekly")));
});

test("unverified sources are named in notes and never counted", () => {
  const outcome = mapPopularityBand([noStars, downloads(50_000)]);
  assert.deepEqual(outcome.band, { low: 4, high: 6 });
  assert.ok(outcome.notes.some((n) => n.includes("unverified — no-repo")));
});

test("no verified popularity source yields N/A, not a low band", () => {
  const outcome = mapPopularityBand([noStars, noDownloads]);
  assert.equal(outcome.status, "unbanded");
  assert.equal(outcome.reason, "no-verified-evidence");
  assert.ok(outcome.notes.some((n) => n.includes("N/A (unverified)")));
});

test("popularity mapping refuses empty or unknown evidence", () => {
  assert.throws(() => mapPopularityBand([]), /evidence is empty/);
  assert.throws(
    () => mapPopularityBand([{ source: "vibes", status: "ok" }]),
    /unknown evidence source/
  );
});

// ---------------------------------------------------------------------------
// 4. Maintenance bands.
// ---------------------------------------------------------------------------

const pushed = (date, archived = false) => ({
  source: "github-last-commit",
  status: "ok",
  lastCommitDate: date,
  archived,
});

function daysAgo(n) {
  const ms = Date.parse(TODAY) - n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

test("maintenance bands match SKILL.md's table", () => {
  const band = (n) => mapMaintenanceBand([pushed(daysAgo(n))], TODAY).band;
  assert.deepEqual(band(0), { low: 10, high: 10 });
  assert.deepEqual(band(30), { low: 10, high: 10 });
  assert.deepEqual(band(31), { low: 7, high: 9 });
  assert.deepEqual(band(90), { low: 7, high: 9 });
  assert.deepEqual(band(91), { low: 4, high: 6 });
  assert.deepEqual(band(180), { low: 4, high: 6 });
  assert.deepEqual(band(181), { low: 3, high: 5 });
  assert.deepEqual(band(365), { low: 3, high: 5 });
  assert.deepEqual(band(366), { low: 1, high: 3 });
  assert.deepEqual(band(3_000), { low: 1, high: 3 });
});

test("the 10 band carries the unverifiable \"active releases\" qualifier", () => {
  const outcome = mapMaintenanceBand([pushed(daysAgo(3))], TODAY);
  assert.ok(outcome.notes.some((n) => n.includes("active releases")));
});

test("181-365 days bands to 3-5, closing SKILL.md's former gap", () => {
  for (const age of [181, 200, 365]) {
    const outcome = mapMaintenanceBand([pushed(daysAgo(age))], TODAY);
    assert.equal(outcome.status, "banded", `age ${age}`);
    assert.deepEqual(outcome.band, { low: 3, high: 5 });
    assert.ok(outcome.notes.some((n) => n.includes(`${age} days before ${TODAY}`)));
  }
});

test("archived beats recency: SKILL.md's 1-3 band is \">365 days or archived\"", () => {
  const outcome = mapMaintenanceBand([pushed(daysAgo(1), true)], TODAY);
  assert.equal(outcome.status, "banded");
  assert.deepEqual(outcome.band, { low: 1, high: 3 });
  assert.ok(outcome.notes.some((n) => n.includes("archived")));
});

test("an unverified last commit yields N/A, per SKILL.md's explicit instruction", () => {
  const outcome = mapMaintenanceBand(
    [{ source: "github-last-commit", status: "unverified", reason: "unreachable" }],
    TODAY
  );
  assert.equal(outcome.status, "unbanded");
  assert.equal(outcome.reason, "no-verified-evidence");
  assert.ok(outcome.notes.some((n) => n.includes("N/A (unverified)")));
});

test("a push date later than today is noted, not turned into a negative age", () => {
  const outcome = mapMaintenanceBand([pushed("2026-09-01")], TODAY);
  assert.deepEqual(outcome.band, { low: 10, high: 10 });
  assert.ok(outcome.notes.some((n) => n.includes("later than today")));
});

test("maintenance mapping refuses a bad today, empty evidence, unknown sources", () => {
  assert.throws(() => mapMaintenanceBand([pushed(daysAgo(1))], "24/08/2026"), /ISO date/);
  assert.throws(() => mapMaintenanceBand([pushed(daysAgo(1))], "2026-13-99"), /ISO date/);
  assert.throws(() => mapMaintenanceBand([], TODAY), /evidence is empty/);
  assert.throws(
    () => mapMaintenanceBand([{ source: "gut-feel", status: "ok" }], TODAY),
    /unknown evidence source/
  );
});

// ---------------------------------------------------------------------------
// 5. End to end: gathered evidence feeds the mappers unchanged.
// ---------------------------------------------------------------------------

test("gathered evidence maps straight through to bands", async () => {
  const fetchImpl = stubFetch({
    [REPO_URL]: {
      stargazers_count: 2_400,
      pushed_at: `${daysAgo(45)}T10:00:00Z`,
      archived: false,
    },
    [DOWNLOADS_URL]: { downloads: 45_000 },
  });
  const evidence = await gatherFactorEvidence(
    { repo: "vercel/next.js", npmPackage: "next" },
    { fetchImpl }
  );
  // 2.4k stars -> 7-9, 45k downloads -> 4-6; the OR takes 7-9.
  assert.deepEqual(mapPopularityBand(evidence.popularity).band, { low: 7, high: 9 });
  assert.deepEqual(mapMaintenanceBand(evidence.maintenance, TODAY).band, { low: 7, high: 9 });
});
