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
  "NPM_BOT_PUBLISHERS",
  "findCandidates",
  "verifyCandidate",
  "findCompanionSkills",
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

// 2. Stub behavior — every still-unimplemented pipeline function throws
// NotImplementedError. This is the explicit "no fake implementation, no
// silent success" contract. analyzeProject(), scoreCandidate(), and
// gatherSecurityEvidence() are implemented; their behavior is pinned by
// fixtures.test.js, parsers.test.js, scoring.test.js, and security.test.js
// instead.
const stubCalls = [
  ["findCandidates", () => core.findCandidates({ capability: "x" })],
  ["verifyCandidate", () => core.verifyCandidate({})],
  ["findCompanionSkills", () => core.findCompanionSkills({})],
];

for (const [name, call] of stubCalls) {
  test(`${name} throws NotImplementedError, not a fake result`, () => {
    assert.throws(call, core.NotImplementedError);
  });
}

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
