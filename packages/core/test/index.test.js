import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../dist/index.js";

// 1. Package boundary — the intended PUBLIC API, and nothing more. This is
// the narrowed surface: pipeline entry points, the per-phase functions an
// adapter needs to compose, and the one runtime value from contracts/.
// Internals (detector/parser registries, query builders, hit normalizers,
// HTTP payload normalizers) are deliberately absent — they stay reachable
// by relative import inside the package, and package.json's "exports"
// maps "." only, so no consumer can deep-import past dist/index.js.
// Update this list deliberately when the contract changes; do not let it
// silently drift.
const expectedExports = [
  "NotImplementedError",
  // Phase 2
  "analyzeProject",
  // Phase 3 — orchestrations; the tier recipes behind them are internal
  "findCandidates",
  "findCompanionSkills",
  "discoverCapabilities",
  // Phase 3.5 — evidence (Stage 1) and verdict (Stage 2)
  "gatherSecurityEvidence",
  "resolveSecurityVerdict",
  "verifyCandidate",
  // Phase 4 — weights, factor evidence, band lookup
  "scoreCandidate",
  "gatherFactorEvidence",
  "mapPopularityBand",
  "mapMaintenanceBand",
  // companion-skill provenance registry
  "companionSkillSources",
];

// Named individually so a re-widening of the barrel fails loudly here
// rather than quietly re-publishing an internal.
const expectedInternal = [
  "dependencyDetectors",
  "fileDetectors",
  "stackCategories",
  "manifestParsers",
  "parsePackageJson",
  "searchTiers",
  "buildTierQueries",
  "normalizeSearchHits",
  "urlDedupeKey",
  "assertValidTierResults",
  "assertValidCapabilityRequest",
  "buildCompanionQueries",
  "extractCompanionRating",
  "normalizeCompanionHits",
  "resolveCompanionGate",
  "NPM_BOT_PUBLISHERS",
  "detectPublisherHandoff",
  "normalizeOsvQueryResponse",
  "normalizeGithubRepoResponse",
  "normalizeNpmDownloadsResponse",
];

test("public API exposes exactly the intended contract", () => {
  for (const name of expectedExports) {
    assert.ok(
      name in core,
      `expected skillmama to export "${name}"`
    );
  }
  const actual = Object.keys(core).sort();
  assert.deepEqual(
    actual,
    [...expectedExports].sort(),
    "public export list changed — update expectedExports deliberately if intended"
  );
});

test("internals are not part of the published surface", () => {
  for (const name of expectedInternal) {
    assert.ok(
      !(name in core),
      `"${name}" is internal — it must not be re-exported from src/index.ts`
    );
  }
});

// 2. Tool-backed orchestration contract — findCandidates() and
// findCompanionSkills() are implemented but REQUIRE injected tooling
// (reasoning + web search). Calling them without it fails loudly instead
// of silently searching nothing. Implemented behavior is pinned by
// fixtures.test.js, parsers.test.js, scoring.test.js, search.test.js,
// security.test.js, and pipeline.test.js.
test("tool-backed phases refuse to run without injected tooling", async () => {
  await assert.rejects(
    () => core.findCandidates({ capability: "x" }, undefined),
    /tooling with plan\(\) and executeTier\(\) is required/
  );
  await assert.rejects(
    () => core.findCompanionSkills({ name: "pkg" }, undefined),
    /tooling with search\(\) and evaluate\(\) is required/
  );
});

// 3. Companion-skill provenance registry — every source SKILL.md Phase 3.6
// searches must be covered by the contract, with no extras.
test("companionSkillSources covers exactly the Phase 3.6 sources", () => {
  assert.deepEqual([...core.companionSkillSources].sort(), [
    "github-skill-md",
    "skills-sh",
    "skillsmp",
    "terminalskills-io",
  ]);
});
