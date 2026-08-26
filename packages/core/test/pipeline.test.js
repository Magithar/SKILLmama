import { test } from "node:test";
import assert from "node:assert/strict";
import { findCandidates, findCompanionSkills } from "../dist/index.js";
import { buildCompanionQueries, extractCompanionRating, normalizeCompanionHits, resolveCompanionGate } from "../dist/mechanical/companions.js";
import { buildTierQueries } from "../dist/mechanical/search.js";

// ---------------------------------------------------------------------------
// 1. buildTierQueries — SKILL.md recipes as template filling.
// ---------------------------------------------------------------------------

const plan = (terms = ["qdrant python", "pgvector fastapi", "chroma vector db"], extra = {}) => ({
  capability: "vector database",
  searchTerms: terms,
  ...extra,
});

test("recipes match SKILL.md verbatim, placeholders filled", () => {
  const queries = buildTierQueries(plan());
  assert.deepEqual(queries.github, [
    "site:github.com qdrant python stars:>500",
    "site:github.com pgvector fastapi stars:>500",
    "site:github.com chroma vector db stars:>500",
    "site:github.com vector database open source",
  ]);
  assert.deepEqual(queries.mcp, [
    "MCP server vector database",
    "model context protocol vector database tool",
    "site:github.com modelcontextprotocol vector database",
  ]);
  assert.deepEqual(queries["package-registry"], [
    "site:npmjs.com vector database",
    "site:pypi.org vector database",
  ]);
  assert.deepEqual(queries["curated-template"], [
    "vector database starter template",
    "awesome vector database github list",
  ]);
});

test("stack evidence fills language/framework/stack tokens deterministically", () => {
  const stack = {
    languages: ["TypeScript", "Python"],
    frameworks: ["fastapi"],
    databases: [], aiTools: [], authSystems: [], caching: [], queues: [],
    search: [], storage: [], email: [], payments: [], observability: [],
    testing: [],
    matchedDependencies: {},
  };
  const queries = buildTierQueries(plan(), stack);
  // sorted-first picks win: languages sorted -> Python before TypeScript
  assert.deepEqual(queries.github.slice(-1), ["site:github.com vector database Python open source"]);
  assert.deepEqual(queries["package-registry"][0], "site:npmjs.com vector database fastapi");
  assert.equal(queries["curated-template"][0], "vector database starter template Python");
});

test("plan validation is loud: capability required, exactly 3-5 terms", () => {
  assert.throws(() => buildTierQueries({ capability: "", searchTerms: ["a", "b", "c"] }), /capability must be a non-empty string/);
  assert.throws(() => buildTierQueries({ capability: "x", searchTerms: ["a"] }), /3-5 non-empty strings/);
  assert.throws(() => buildTierQueries({ capability: "x", searchTerms: ["a", "b", "", "d"] }), /3-5 non-empty strings/);
});

// ---------------------------------------------------------------------------
// 2. findCandidates — orchestration over injected tooling.
// ---------------------------------------------------------------------------

const hit = (url, title) => ({ url, ...(title ? { title } : {}) });

function recordingTooling(tierHits) {
  const calls = [];
  return {
    calls,
    plan: async (request) => ({
      capability: request.capability,
      searchTerms: ["term one", "term two", "term three"],
      // a real planner carries the user's constraints into its handoff
      ...(request.constraints ? { constraints: request.constraints } : {}),
    }),
    executeTier: async (tier, queries, state) => {
      calls.push({ tier, queries, state });
      return {
        tier,
        queriesRun: queries,
        hits: tierHits[tier] ?? [],
      };
    },
  };
}

test("all four tiers execute in canonical order with generated queries", async () => {
  const tooling = recordingTooling({});
  const candidates = await findCandidates(
    { capability: "queue library" },
    tooling
  );
  assert.deepEqual(tooling.calls.map((c) => c.tier), [
    "github", "mcp", "package-registry", "curated-template",
  ]);
  assert.ok(tooling.calls[0].queries[0].startsWith("site:github.com term one"));
  assert.deepEqual(candidates, []);
});

test("state.candidatesSoFar grows across tiers; constraints pass through", async () => {
  const tooling = recordingTooling({
    github: [hit("https://github.com/ollama/ollama")],
    mcp: [hit("https://mcp.so/server/x", "x-server")],
  });
  await findCandidates(
    { capability: "local llm", constraints: ["open-source only"] },
    tooling
  );
  assert.deepEqual(tooling.calls.map((c) => c.state.candidatesSoFar), [0, 1, 2, 2]);
  for (const call of tooling.calls) {
    assert.deepEqual(call.state.constraints, ["open-source only"]);
  }
});

test("cross-tier duplicates collapse through the Stage C path", async () => {
  const tooling = recordingTooling({
    github: [hit("https://github.com/qdrant/qdrant")],
    "package-registry": [hit("https://www.npmjs.com/package/Qdrant")],
  });
  const candidates = await findCandidates({ capability: "vectors" }, tooling);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].tier, "github"); // earlier tier wins
});

test("malformed stage output throws at its own tier, never reads as fewer results", async () => {
  const badPlan = recordingTooling({});
  badPlan.plan = async () => ({ capability: "x", searchTerms: ["only-one"] });
  await assert.rejects(
    () => findCandidates({ capability: "x" }, badPlan),
    /3-5 non-empty strings/
  );

  const broken = recordingTooling({});
  broken.executeTier = async (tier) =>
    tier === "mcp"
      ? { tier, queriesRun: [], hits: [{ url: "" }] }
      : { tier, queriesRun: [], hits: [] };
  await assert.rejects(
    () => findCandidates({ capability: "x" }, broken),
    /hits\[0\]\.url must be a non-empty string/
  );
});

// ---------------------------------------------------------------------------
// 3. Companion queries + normalization.
// ---------------------------------------------------------------------------

test("the four fixed companion searches are verbatim and ordered", () => {
  assert.deepEqual(buildCompanionQueries("ollama"), [
    { source: "skills-sh", query: "site:skills.sh ollama" },
    { source: "terminalskills-io", query: "site:terminalskills.io/skills ollama" },
    { source: "skillsmp", query: "site:skillsmp.com ollama" },
    { source: "github-skill-md", query: 'site:github.com "SKILL.md" ollama' },
  ]);
  assert.throws(() => buildCompanionQueries("  "), /non-empty string/);
});

test("rating extraction is worst-wins and case-insensitive", () => {
  assert.equal(extractCompanionRating("A SAFE skill"), "SAFE");
  assert.equal(extractCompanionRating("safe but listed as SUSPICIOUS"), "SUSPICIOUS");
  assert.equal(extractCompanionRating(undefined, "MALICIOUS rating pending, was safe"), "MALICIOUS");
  assert.equal(extractCompanionRating("no rating here"), undefined);
});

test("skill names derive per host: repo names, slugs, titles; else dropped", () => {
  const pairsWith = "ollama";
  const skills = normalizeCompanionHits("github-skill-md", [
    { url: "https://github.com/anthropics/skill-creator/tree/main" },
    { url: "https://github.com/topics/skills" },
    { url: "https://example.org/x" }, // no title
  ], pairsWith);
  assert.deepEqual(skills.map((s) => s.name), ["skill-creator"]);

  const slugged = normalizeCompanionHits("terminalskills-io", [
    { url: "https://terminalskills.io/skills/pdf-reader", title: "ignored when slug exists" },
  ], pairsWith);
  assert.deepEqual(slugs(slugged), ["pdf-reader"]);

  function slugs(list) { return list.map((s) => s.name); }

  const titled = normalizeCompanionHits("skills-sh", [
    { url: "https://example.org/weird", title: "weird-skill" },
  ], pairsWith);
  assert.deepEqual(titled.map((s) => s.name), ["weird-skill"]);
});

test("rating rides only on terminalskills-io hits that provide one", () => {
  const rated = normalizeCompanionHits("terminalskills-io", [
    { url: "https://terminalskills.io/skills/a", title: "A — SUSPICIOUS" },
    { url: "https://terminalskills.io/skills/b" },
  ], "pkg");
  assert.equal(rated[0].rating, "SUSPICIOUS");
  assert.equal(rated[1].rating, undefined);

  const skillsMp = normalizeCompanionHits("skillsmp", [
    { url: "https://skillsmp.com/c", title: "C — MALICIOUS" },
  ], "pkg");
  assert.equal(skillsMp[0].rating, undefined); // skillsmp explicitly has no ratings
});

// ---------------------------------------------------------------------------
// 4. resolveCompanionGate — the Phase 3.7 decision table.
// ---------------------------------------------------------------------------

const finding = (weight, rule, detail) => ({ weight, rule, detail });

test("SUSPICIOUS/MALICIOUS rating discards regardless of findings", () => {
  for (const rating of ["SUSPICIOUS", "MALICIOUS"]) {
    const gate = resolveCompanionGate(rating, []);
    assert.equal(gate.verdict, "BLOCKED", rating);
    assert.deepEqual(gate.notes, [`terminalskills.io rating: ${rating} — automatic discard`]);
  }
  assert.equal(resolveCompanionGate("SAFE", []).verdict, "PASS");
  assert.equal(resolveCompanionGate(undefined, []).verdict, "PASS");
});

test("DISCARD wins outright; WARN and FLAG are independent and both reportable", () => {
  const everything = resolveCompanionGate(undefined, [
    finding("FLAG", "SQP-1", "broad trigger"),
    finding("DISCARD", "guardrails", "tells agent to skip review"),
    finding("WARN", "no-description", "no description of behavior"),
    finding("FLAG", "SQP-2", "writes without warning"),
  ]);
  assert.equal(everything.verdict, "BLOCKED");
  assert.deepEqual(everything.sqpFlags, ["SQP-1", "SQP-2"]);
  assert.deepEqual(everything.notes, [
    "guardrails: tells agent to skip review",
    "no-description: no description of behavior",
    "SQP-1: broad trigger",
    "SQP-2: writes without warning",
  ]);

  const warnAndFlag = resolveCompanionGate(undefined, [
    finding("FLAG", "SQP-3", "hardcoded locale"),
    finding("WARN", "credentials", "reads env without explanation"),
  ]);
  assert.equal(warnAndFlag.verdict, "WARN");
  assert.deepEqual(warnAndFlag.sqpFlags, ["SQP-3"]);

  assert.throws(() => resolveCompanionGate("catastrophic", []), /rating must be/);
  assert.throws(() => resolveCompanionGate(undefined, [{ weight: "MEH", rule: "r", detail: "d" }]), /weight must be one of/);
});

// ---------------------------------------------------------------------------
// 5. findCompanionSkills — orchestration.
// ---------------------------------------------------------------------------

function companionTooling(hitsByQuery, findingsBySkillName) {
  const searched = [];
  const evaluated = [];
  return {
    searched,
    evaluated,
    search: async (query) => {
      searched.push(query);
      return hitsByQuery[query] ?? [];
    },
    evaluate: async (skill) => {
      evaluated.push(skill.name);
      return findingsBySkillName[skill.name] ?? [];
    },
  };
}

test("all four sources always run; empty results are legal, skipping is not", async () => {
  const tooling = companionTooling({}, {});
  const skills = await findCompanionSkills(
    { name: "ollama", tier: "github", url: "https://github.com/ollama/ollama" },
    tooling
  );
  assert.deepEqual(skills, []);
  assert.equal(tooling.searched.length, 4);
  assert.deepEqual(tooling.searched, buildCompanionQueries("ollama").map((q) => q.query));
});

test("BLOCKED skills never surface; survivors carry gate output only when it fired", async () => {
  const tooling = companionTooling(
    {
      'site:terminalskills.io/skills ollama': [
        { url: "https://terminalskills.io/skills/bad-one", title: "bad-one — MALICIOUS" },
        { url: "https://terminalskills.io/skills/warny", title: "warny" },
        { url: "https://terminalskills.io/skills/clean" },
      ],
    },
    {
      warny: [finding("WARN", "no-description", "no description"), finding("FLAG", "SQP-2", "network no warning")],
    }
  );
  const skills = await findCompanionSkills(
    { name: "ollama", tier: "github", url: "https://github.com/ollama/ollama" },
    tooling
  );
  assert.deepEqual(skills.map((s) => s.name).sort(), ["clean", "warny"]);
  const warny = skills.find((s) => s.name === "warny");
  assert.deepEqual(warny.notes, ["no-description: no description", "SQP-2: network no warning"]);
  assert.deepEqual(warny.sqpFlags, ["SQP-2"]);
  const clean = skills.find((s) => s.name === "clean");
  assert.equal(clean.notes, undefined);
  assert.equal(clean.sqpFlags, undefined);
  // every found skill was gated, including the one auto-discarded by rating
  assert.deepEqual(tooling.evaluated.sort(), ["bad-one", "clean", "warny"]);
});

test("cross-source duplicates keep the earlier recipe's provenance", async () => {
  const tooling = companionTooling(
    {
      'site:skillsmp.com ollama': [
        { url: "https://skillsmp.com/ollama-pdf", title: "ollama-pdf" },
      ],
      'site:github.com "SKILL.md" ollama': [
        { url: "https://github.com/o/OLLAMA-PDF" }, // same name, later source
      ],
    },
    {}
  );
  const skills = await findCompanionSkills(
    { name: "ollama", tier: "github", url: "https://github.com/ollama/ollama" },
    tooling
  );
  assert.equal(skills.length, 1);
  assert.equal(skills[0].source, "skillsmp");
});

test("candidate and tooling validation fail loudly", async () => {
  const tooling = companionTooling({}, {});
  await assert.rejects(
    () => findCompanionSkills({ name: "" }, tooling),
    /candidate\.name must be a non-empty string/
  );
  await assert.rejects(
    () => findCompanionSkills({ name: "x" }, { search: "nope", evaluate: () => [] }),
    /tooling with search\(\) and evaluate\(\) is required/
  );
});
