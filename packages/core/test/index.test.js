import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../dist/index.js";

// 1. Package boundary — the intended public API is present and nothing
// unexpected leaked in. Update this list deliberately when the contract
// changes; do not let it silently drift.
const expectedExports = [
  "NotImplementedError",
  "analyzeProject",
  "scoreCandidate",
  "gatherSecurityEvidence",
  "normalizeOsvQueryResponse",
  "detectPublisherHandoff",
  "resolveSecurityVerdict",
  "verifyCandidate",
  "normalizeSearchHits",
  "buildTierQueries",
  "assertValidCapabilityRequest",
  "assertValidTierResults",
  "searchTiers",
  "urlDedupeKey",
  "buildCompanionQueries",
  "extractCompanionRating",
  "normalizeCompanionHits",
  "resolveCompanionGate",
  "findCandidates",
  "findCompanionSkills",
  "discoverCapabilities",
  "NPM_BOT_PUBLISHERS",
  // Phase 4 scoring-factor evidence + band mapping
  "gatherFactorEvidence",
  "normalizeGithubRepoResponse",
  "normalizeNpmDownloadsResponse",
  "mapPopularityBand",
  "mapMaintenanceBand",
  // detector registry (data + types; types are erased at runtime)
  "dependencyDetectors",
  "fileDetectors",
  "stackCategories",
  // companion-skill provenance registry
  "companionSkillSources",
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
