import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  stackCategories,
  dependencyDetectors,
} from "../dist/mechanical/detectors.js";
import { analyzeProject } from "../dist/index.js";

// Fixture-contract validator. These tests pin the expected.json files
// themselves: every fixture must be a structurally valid StackProfile
// that agrees with the detector registry. Behavioral tests at the bottom
// assert analyzeProject(fixtureDir) deep-equals expected.json.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const REQUIRED_FIXTURES = [
  "next-postgres",
  "multi-alias",
  "dev-dependencies-only",
  "python-project",
  "deployment-only",
  "empty",
];

const canonicalToCategory = new Map(
  Object.values(dependencyDetectors).map((e) => [e.canonical, e.category])
);

const isSortedUnique = (arr) => {
  for (let i = 1; i < arr.length; i++) {
    if (!(arr[i - 1] < arr[i])) return false;
  }
  return true;
};

test("all six agreed fixture scenarios exist", () => {
  const dirs = readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const name of REQUIRED_FIXTURES) {
    assert.ok(dirs.includes(name), `missing fixture directory "${name}"`);
  }
});

for (const name of REQUIRED_FIXTURES) {
  test(`fixture ${name}: expected.json is a valid StackProfile`, () => {
    const profile = JSON.parse(
      readFileSync(join(FIXTURES_DIR, name, "expected.json"), "utf8")
    );

    // Exact key set: 13 category arrays + matchedDependencies, plus at most
    // the optional deploymentTarget. Nothing else may leak in.
    const allowedKeys = new Set([...stackCategories, "matchedDependencies", "deploymentTarget"]);
    for (const key of Object.keys(profile)) {
      assert.ok(allowedKeys.has(key), `unexpected field "${key}"`);
    }
    for (const category of stackCategories) {
      const arr = profile[category];
      assert.ok(Array.isArray(arr), `${category} must be an array`);
      for (const entry of arr) {
        assert.equal(typeof entry, "string", `${category} entries must be strings`);
        assert.match(entry, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${category} entry "${entry}" must be a canonical ID`);
      }
      assert.ok(isSortedUnique(arr), `${category} must be sorted and deduplicated: ${JSON.stringify(arr)}`);
    }

    // matchedDependencies: canonical ID → raw manifest names.
    const md = profile.matchedDependencies;
    assert.equal(typeof md, "object");
    assert.ok(!Array.isArray(md));
    const mdKeys = Object.keys(md);
    assert.ok(isSortedUnique(mdKeys), `matchedDependencies keys must be sorted: ${JSON.stringify(mdKeys)}`);
    for (const [canonical, rawNames] of Object.entries(md)) {
      assert.ok(
        canonicalToCategory.has(canonical),
        `matchedDependencies key "${canonical}" is not a dependency-detector canonical`
      );
      const category = canonicalToCategory.get(canonical);
      assert.ok(
        profile[category].includes(canonical),
        `"${canonical}" has matched deps but is missing from ${category}`
      );
      assert.ok(Array.isArray(rawNames) && rawNames.length > 0, `matchedDependencies["${canonical}"] must be a non-empty array`);
      assert.ok(isSortedUnique(rawNames), `matchedDependencies["${canonical}"] must be sorted and deduplicated`);
      for (const raw of rawNames) {
        assert.equal(typeof raw, "string");
        assert.ok(dependencyDetectors[raw] !== undefined, `raw name "${raw}" must exist in the registry`);
        assert.equal(dependencyDetectors[raw].canonical, canonical, `raw name "${raw}" does not resolve to "${canonical}"`);
      }
    }

    // deploymentTarget: optional, but when present it needs provenance.
    if ("deploymentTarget" in profile) {
      const dt = profile.deploymentTarget;
      assert.deepEqual(Object.keys(dt).sort(), ["source", "value"]);
      assert.equal(typeof dt.value, "string");
      assert.equal(typeof dt.source, "string");
    }
  });
}

// Behavioral pin: the implementation must reproduce every expected.json
// exactly — categories, matchedDependencies, and deploymentTarget
// provenance included.
for (const name of REQUIRED_FIXTURES) {
  test(`fixture ${name}: analyzeProject() reproduces expected.json`, async () => {
    const expected = JSON.parse(
      readFileSync(join(FIXTURES_DIR, name, "expected.json"), "utf8")
    );
    const actual = await analyzeProject(join(FIXTURES_DIR, name));
    assert.deepEqual(actual, expected);
  });
}
