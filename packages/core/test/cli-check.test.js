import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNpmDefaults, runCheck } from "../dist/cli/check.js";
import { renderCheckJson, renderCheckText } from "../dist/cli/render.js";

const TODAY = "2026-08-24";

function stubFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [prefix, payload] of Object.entries(routes)) {
      if (u.startsWith(prefix)) {
        if (payload === null) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const clean = {
  "https://api.osv.dev": { vulns: [] },
  "https://registry.npmjs.org": { versions: {}, time: {} },
  "https://api.github.com": {
    stargazers_count: 4_200,
    pushed_at: "2026-08-20T00:00:00Z",
    archived: false,
  },
  "https://api.npmjs.org": { downloads: 55_000 },
};

const target = {
  name: "left-pad",
  ecosystem: "npm",
  version: "1.3.0",
  repo: "stevemao/left-pad",
  npmPackage: "left-pad",
};

test("a clean package passes and reports both bands", async () => {
  const result = await runCheck(target, { fetchImpl: stubFetch(clean), today: TODAY });
  assert.equal(result.security.verdict, "PASS");
  assert.deepEqual(result.popularity.band.band, { low: 7, high: 9 });
  assert.deepEqual(result.maintenance.band.band, { low: 10, high: 10 });
});

test("what did not run is always reported, on every result", async () => {
  const result = await runCheck(target, { fetchImpl: stubFetch(clean), today: TODAY });
  assert.ok(
    result.notRun.some((n) => n.includes("content inspection did not run")),
    "the missing half of Phase 3.5 must be stated even on a PASS"
  );
  // And it must reach the reader before the verdict does.
  const text = renderCheckText(result);
  assert.ok(
    text.indexOf("Not checked:") < text.indexOf("Verdict"),
    "a reader who stops early must not see a verdict without its caveat"
  );
});

test("a missing repo is reported as not checked, not silently omitted", async () => {
  const result = await runCheck(
    { name: "x", ecosystem: "npm", version: "1.0.0", npmPackage: "x" },
    { fetchImpl: stubFetch(clean), today: TODAY }
  );
  assert.ok(result.notRun.some((n) => n.includes("No GitHub repository was resolved")));
});

test("an unfixed critical advisory blocks", async () => {
  const result = await runCheck(target, {
    fetchImpl: stubFetch({
      ...clean,
      "https://api.osv.dev": {
        vulns: [
          {
            id: "GHSA-bad",
            database_specific: { severity: "CRITICAL" },
            affected: [{ ranges: [{ events: [{ introduced: "0" }] }] }],
            summary: "remote code execution",
          },
        ],
      },
    }),
    today: TODAY,
  });
  assert.equal(result.security.verdict, "BLOCKED");
  assert.ok(renderCheckText(result).includes("remote code execution"));
});

test("a non-npm ecosystem never implies publisher continuity was checked", async () => {
  const result = await runCheck(
    { name: "flask", ecosystem: "PyPI", version: "2.0.0", repo: "pallets/flask" },
    { fetchImpl: stubFetch(clean), today: TODAY }
  );
  assert.equal(result.security.verdict, "WARN");
  assert.ok(
    result.security.notes.some((n) => n.includes("unsupported-ecosystem")),
    "an unverified check must floor the verdict at WARN and say why"
  );
});

test("the 181-365 day gap surfaces as 'no band', not a number", async () => {
  const result = await runCheck(target, {
    fetchImpl: stubFetch({
      ...clean,
      "https://api.github.com": {
        stargazers_count: 500,
        pushed_at: "2026-01-01T00:00:00Z", // 235 days before TODAY
        archived: false,
      },
    }),
    today: TODAY,
  });
  assert.equal(result.maintenance.band.status, "unbanded");
  assert.equal(result.maintenance.band.reason, "outside-defined-bands");
  assert.match(renderCheckText(result), /Maintenance +no band/);
});

test("json output round-trips the whole result", async () => {
  const result = await runCheck(target, { fetchImpl: stubFetch(clean), today: TODAY });
  assert.deepEqual(JSON.parse(renderCheckJson(result)), JSON.parse(JSON.stringify(result)));
});

test("resolveNpmDefaults reports what it found and nothing more", async () => {
  const found = await resolveNpmDefaults(
    "express",
    stubFetch({
      "https://registry.npmjs.org": {
        "dist-tags": { latest: "5.2.1" },
        repository: { type: "git", url: "git+https://github.com/expressjs/express.git" },
      },
    })
  );
  assert.deepEqual(found, { version: "5.2.1", repo: "expressjs/express" });

  // No packument, no invention.
  assert.deepEqual(await resolveNpmDefaults("nope", stubFetch({})), {});
  // A non-GitHub repository field yields no repo rather than a bad one.
  assert.deepEqual(
    await resolveNpmDefaults(
      "x",
      stubFetch({ "https://registry.npmjs.org": { repository: "https://gitlab.com/a/b" } })
    ),
    {}
  );
});
