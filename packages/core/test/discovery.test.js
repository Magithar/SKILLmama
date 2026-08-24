import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverCapabilities } from "../dist/index.js";

const TODAY = "2026-08-24";

// ---------------------------------------------------------------------------
// A minimal, fully-injected harness. Every stage returns fixed data, so the
// only thing under test is the composition: ordering, filtering, and the
// invariants discoverCapabilities() enforces on its injected judges.
// ---------------------------------------------------------------------------

const hit = (name, url) => ({ url, title: name });

function stubFetch({ advisories = [], stars = 5_000, pushed = "2026-08-20", downloads = null } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.osv.dev")) {
      return { ok: true, status: 200, json: async () => ({ vulns: advisories }) };
    }
    if (u.startsWith("https://registry.npmjs.org")) {
      return { ok: true, status: 200, json: async () => ({ versions: {}, time: {} }) };
    }
    if (u.startsWith("https://api.github.com")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ stargazers_count: stars, pushed_at: `${pushed}T00:00:00Z`, archived: false }),
      };
    }
    if (u.startsWith("https://api.npmjs.org")) {
      if (downloads === null) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ downloads }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

function harness(overrides = {}) {
  const calls = [];
  const tooling = {
    plan: async () => ({
      capability: "vector search",
      searchTerms: ["vector db", "embedding store", "semantic search"],
    }),
    executeTier: async (tier) => {
      calls.push(`tier:${tier}`);
      return tier === "github"
        ? { tier, queriesRun: ["q"], hits: [hit("pgvector", "https://github.com/pgvector/pgvector")] }
        : { tier, queriesRun: ["q"], hits: [] };
    },
    resolve: async () => ({
      security: { name: "pgvector", ecosystem: "npm", version: "0.5.1" },
      factors: { repo: "pgvector/pgvector", npmPackage: "pgvector" },
    }),
    inspect: async () => [],
    judgeFactors: async ({ popularityBand, maintenanceBand }) => ({
      compatibility: 9,
      simplicity: 8,
      popularity: popularityBand.status === "banded" ? popularityBand.band.low : "N/A",
      maintenance: maintenanceBand.status === "banded" ? maintenanceBand.band.low : "N/A",
    }),
    search: async () => [],
    evaluate: async () => [],
    ...overrides,
  };
  tooling.calls = calls;
  return tooling;
}

const request = { capability: "vector search" };
const opts = (extra = {}) => ({ fetchImpl: stubFetch(), today: TODAY, ...extra });

// ---------------------------------------------------------------------------
// 1. The happy path composes every phase.
// ---------------------------------------------------------------------------

test("a clean run ranks the candidate with its bands and security attached", async () => {
  const tooling = harness();
  const result = await discoverCapabilities(request, tooling, opts());

  assert.deepEqual(tooling.calls, [
    "tier:github",
    "tier:mcp",
    "tier:package-registry",
    "tier:curated-template",
  ]);
  assert.equal(result.ranked.length, 1);
  const entry = result.ranked[0];
  assert.equal(entry.candidate.name, "pgvector");
  // OSV clean and the packument parsed with no handoff, so the gate passes.
  // The npm downloads 404 is FACTOR evidence and must not touch the verdict.
  assert.equal(entry.security.verdict, "PASS");
  assert.equal(entry.popularityBand.status, "banded");
  assert.deepEqual(entry.popularityBand.band, { low: 7, high: 9 });
  assert.deepEqual(entry.maintenanceBand.band, { low: 10, high: 10 });
  assert.equal(entry.score.popularity, 7);
  assert.equal(entry.score.maintenance, 10);
  assert.equal(typeof entry.score.totalScore, "number");
  assert.deepEqual(entry.companionSkills, []);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.alreadyPresent, []);
});

// ---------------------------------------------------------------------------
// 2. The band invariant — the reason the deterministic factor work matters.
// ---------------------------------------------------------------------------

test("a judged factor outside its verified band throws instead of scoring", async () => {
  const tooling = harness({
    judgeFactors: async () => ({
      compatibility: 9,
      simplicity: 8,
      popularity: 10, // evidence says 7-9
      maintenance: 10,
    }),
  });
  await assert.rejects(
    () => discoverCapabilities(request, tooling, opts()),
    /judged popularity 10 is outside its verified band 7-9/
  );
});

test("a factor with no verified band must be N/A, not a number", async () => {
  const tooling = harness({
    resolve: async () => ({ factors: {} }), // no repo, no npm package
    judgeFactors: async () => ({
      compatibility: 9,
      simplicity: 8,
      popularity: 5,
      maintenance: "N/A",
    }),
  });
  await assert.rejects(
    () => discoverCapabilities(request, tooling, opts()),
    /popularity has no verified band \(no-verified-evidence\), so the judged factor must be "N\/A"/
  );
});

test("N/A where a band WAS verified is refused too — that direction is also a lie", async () => {
  const tooling = harness({
    judgeFactors: async () => ({
      compatibility: 9,
      simplicity: 8,
      popularity: "N/A",
      maintenance: 10,
    }),
  });
  await assert.rejects(
    () => discoverCapabilities(request, tooling, opts()),
    /popularity band 7-9 was verified, so the judged factor must be a number/
  );
});

test("an unverifiable candidate scores on the remaining factors, renormalized", async () => {
  const tooling = harness({
    resolve: async () => ({ factors: {} }),
    judgeFactors: async () => ({
      compatibility: 8,
      simplicity: 6,
      popularity: "N/A",
      maintenance: "N/A",
    }),
  });
  const result = await discoverCapabilities(request, tooling, opts());
  const entry = result.ranked[0];
  assert.equal(entry.popularityBand.status, "unbanded");
  // 8*0.40 + 6*0.15 over the surviving 0.55 of weight.
  assert.equal(entry.score.totalScore, 7.5);
  assert.ok(entry.score.notes.some((n) => n.includes("renormalized")));
});

// ---------------------------------------------------------------------------
// 3. Filtering rules SKILL.md states as prohibitions.
// ---------------------------------------------------------------------------

test("ALREADY PRESENT candidates are reported, never scored", async () => {
  const withStack = {
    capability: "vector search",
    stack: {
      languages: ["typescript"],
      frameworks: [],
      databases: [],
      aiTools: [],
      authSystems: [],
      caching: [],
      queues: [],
      search: [],
      storage: [],
      email: [],
      payments: [],
      observability: [],
      testing: [],
      matchedDependencies: { pgvector: ["pgvector"] },
    },
  };
  const result = await discoverCapabilities(withStack, harness(), opts());
  assert.equal(result.ranked.length, 0);
  assert.deepEqual(result.alreadyPresent.map((c) => c.name), ["pgvector"]);
  assert.ok(result.notes.some((n) => n.includes("ALREADY PRESENT")));
});

test("ALREADY PRESENT matching normalizes the way analyzeProject does", async () => {
  const stackWith = (deps) => ({
    capability: "vector search",
    stack: {
      languages: [], frameworks: [], databases: [], aiTools: [], authSystems: [],
      caching: [], queues: [], search: [], storage: [], email: [], payments: [],
      observability: [], testing: [], matchedDependencies: deps,
    },
  });
  const found = (name) =>
    harness({
      executeTier: async (tier) =>
        tier === "github"
          ? { tier, queriesRun: ["q"], hits: [hit(name, `https://example.com/${name}`)] }
          : { tier, queriesRun: ["q"], hits: [] },
    });

  // Separator and case differ from the canonical key; PEP 503 says same package.
  const viaKey = await discoverCapabilities(
    stackWith({ "psycopg2-binary": ["psycopg2_binary"] }),
    found("Psycopg2.Binary"),
    opts()
  );
  assert.deepEqual(viaKey.alreadyPresent.map((c) => c.name), ["Psycopg2.Binary"]);

  // Matching the raw manifest spelling counts too, not just the canonical key.
  const viaRaw = await discoverCapabilities(
    stackWith({ postgres: ["Django"] }),
    found("django"),
    opts()
  );
  assert.deepEqual(viaRaw.alreadyPresent.map((c) => c.name), ["django"]);

  // A genuinely different package name must NOT collapse into a match.
  const distinct = await discoverCapabilities(
    stackWith({ "pg-vector": ["pg-vector"] }),
    found("pgvector"),
    opts()
  );
  assert.deepEqual(distinct.alreadyPresent, []);
  assert.equal(distinct.ranked.length, 1);
});

test("BLOCKED candidates are returned but never scored or ranked", async () => {
  const tooling = harness({
    inspect: async () => [
      { weight: "DISCARD", rule: "SQP-1", detail: "undisclosed exfiltration" },
    ],
  });
  const result = await discoverCapabilities(request, tooling, opts());
  assert.equal(result.ranked.length, 0);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].verdict, "BLOCKED");
  assert.ok(result.notes.some((n) => n.includes("BLOCKED by the Phase 3.5 gate")));
});

test("an OSV critical with no fix blocks without any content finding", async () => {
  const tooling = harness();
  const result = await discoverCapabilities(
    request,
    tooling,
    opts({
      fetchImpl: stubFetch({
        advisories: [{ id: "GHSA-x", database_specific: { severity: "CRITICAL" }, affected: [] }],
      }),
    })
  );
  assert.equal(result.ranked.length, 0);
  assert.equal(result.blocked[0].verdict, "BLOCKED");
});

test("a WARN candidate still ranks — SKILL.md summarizes rather than discards", async () => {
  const result = await discoverCapabilities(
    request,
    harness(),
    opts({
      fetchImpl: stubFetch({
        advisories: [
          {
            id: "GHSA-y",
            database_specific: { severity: "MODERATE" },
            affected: [{ ranges: [{ events: [{ fixed: "1.0.0" }] }] }],
          },
        ],
      }),
    })
  );
  assert.equal(result.ranked.length, 1);
  assert.equal(result.ranked[0].security.verdict, "WARN");
  assert.ok(result.ranked[0].security.notes.some((n) => n.includes("MODERATE")));
});

// ---------------------------------------------------------------------------
// 4. Non-package candidates, companion phase, ranking.
// ---------------------------------------------------------------------------

test("a candidate with no package target is never reported as having passed", async () => {
  const tooling = harness({ resolve: async () => ({ factors: { repo: "a/b" } }) });
  const result = await discoverCapabilities(request, tooling, opts());
  const entry = result.ranked[0];
  assert.equal(entry.security.verdict, "WARN");
  assert.ok(
    result.notes.some((n) => n.includes("no OSV or publisher check ran")),
    "the omission must be recorded, not silent"
  );
});

test("the companion phase runs by default and its skipping is recorded", async () => {
  let searched = 0;
  const tooling = harness({
    search: async () => {
      searched += 1;
      return [];
    },
  });
  await discoverCapabilities(request, tooling, opts());
  assert.equal(searched, 4, "all four fixed companion sources must run");

  const skipped = await discoverCapabilities(request, harness(), opts({ skipCompanionSkills: true }));
  assert.ok(
    skipped.notes.some((n) => n.includes("NOT SEARCHED")),
    "an empty companionSkills list must never silently mean 'nothing found'"
  );
});

test("ranking is by score, then tier, then name — total and reproducible", async () => {
  const many = harness({
    executeTier: async (tier) =>
      tier === "github"
        ? {
            tier,
            queriesRun: ["q"],
            hits: [
              hit("alpha", "https://github.com/o/alpha"),
              hit("beta", "https://github.com/o/beta"),
            ],
          }
        : tier === "mcp"
          ? { tier, queriesRun: ["q"], hits: [hit("gamma", "https://github.com/o/gamma")] }
          : { tier, queriesRun: ["q"], hits: [] },
    resolve: async (candidate) => ({ factors: { repo: `o/${candidate.name}` } }),
    judgeFactors: async ({ candidate, popularityBand, maintenanceBand }) => ({
      // alpha and gamma tie; beta scores lower.
      compatibility: candidate.name === "beta" ? 2 : 9,
      simplicity: 8,
      popularity: popularityBand.status === "banded" ? popularityBand.band.low : "N/A",
      maintenance: maintenanceBand.status === "banded" ? maintenanceBand.band.low : "N/A",
    }),
  });
  const result = await discoverCapabilities(request, many, opts());
  assert.deepEqual(result.ranked.map((e) => e.candidate.name), ["alpha", "gamma", "beta"]);
});

// ---------------------------------------------------------------------------
// 5. Missing tooling fails loudly rather than silently doing less.
// ---------------------------------------------------------------------------

test("every injected stage is required, by name", async () => {
  for (const missing of ["plan", "executeTier", "resolve", "inspect", "judgeFactors"]) {
    const tooling = harness();
    delete tooling[missing];
    await assert.rejects(
      () => discoverCapabilities(request, tooling, opts()),
      new RegExp(`tooling\\.${missing}\\(\\) is required`),
      `${missing} should be required`
    );
  }
});

test("the required companion phase cannot be dropped by omitting its tooling", async () => {
  const tooling = harness();
  delete tooling.search;
  await assert.rejects(
    () => discoverCapabilities(request, tooling, opts()),
    /pass skipCompanionSkills: true to omit it deliberately/
  );
});

test("a resolver that returns nothing usable throws", async () => {
  const tooling = harness({ resolve: async () => ({}) });
  await assert.rejects(
    () => discoverCapabilities(request, tooling, opts()),
    /must return \{ factors, security\? \}/
  );
});
