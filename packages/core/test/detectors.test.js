import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dependencyDetectors,
  fileDetectors,
  stackCategories,
} from "../dist/mechanical/detectors.js";

// Registry invariants only — no scanning logic exists yet, so there is
// nothing behavioral to test. These tests pin the policies documented in
// src/mechanical/detectors.ts so the knowledge base cannot silently drift.

const CANONICAL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_TARGETS = new Set([...stackCategories, "deploymentTarget"]);

test("both registries are non-empty", () => {
  assert.ok(Object.keys(dependencyDetectors).length > 0);
  assert.ok(Object.keys(fileDetectors).length > 0);
});

test("every stack category is represented at runtime and matches StackProfile's array fields count", () => {
  // 13 categories per contracts/project.ts — if this drifts, either
  // StackProfile changed (update ALL_STACK_CATEGORIES + this test
  // deliberately) or the runtime mirror broke.
  assert.equal(stackCategories.length, 13);
});

test("dependency entries: valid shape, canonical format, sane keys", () => {
  for (const [key, entry] of Object.entries(dependencyDetectors)) {
    assert.equal(entry.kind, "dependency", `key ${key}`);
    assert.match(
      entry.canonical,
      CANONICAL_RE,
      `canonical "${entry.canonical}" must be lowercase kebab-case`
    );
    assert.ok(
      stackCategories.includes(entry.category),
      `key ${key}: unknown category "${entry.category}"`
    );
    assert.equal(key.trim(), key, `key "${key}" has surrounding whitespace`);
    assert.ok(key.length > 0);
    assert.doesNotMatch(key, /\s/, `key "${key}" contains whitespace`);
  }
});

test("file entries: valid shape, target is a known slot, canonical format", () => {
  for (const [key, entry] of Object.entries(fileDetectors)) {
    assert.equal(entry.kind, "file", `key ${key}`);
    assert.ok(
      VALID_TARGETS.has(entry.target),
      `key ${key}: unknown target "${entry.target}"`
    );
    assert.match(
      entry.canonical,
      CANONICAL_RE,
      `canonical "${entry.canonical}" must be lowercase kebab-case`
    );
    assert.doesNotMatch(key, /\s/, `key "${key}" contains whitespace`);
  }
});

test("policy 4: one canonical maps to exactly one category across both registries", () => {
  const canonicalToCategories = new Map();

  const record = (canonical, category) => {
    if (!canonicalToCategories.has(canonical)) {
      canonicalToCategories.set(canonical, new Set());
    }
    canonicalToCategories.get(canonical).add(category);
  };

  for (const entry of Object.values(dependencyDetectors)) {
    record(entry.canonical, entry.category);
  }
  for (const entry of Object.values(fileDetectors)) {
    // deploymentTarget is a separate slot, not a category — exempt.
    if (entry.target !== "deploymentTarget") record(entry.canonical, entry.target);
  }

  for (const [canonical, categories] of canonicalToCategories) {
    assert.equal(
      categories.size,
      1,
      `canonical "${canonical}" spans categories ${[...categories]} — split it or pick one`
    );
  }
});

test("every stack category has at least one detector", () => {
  const covered = new Set();
  for (const entry of Object.values(dependencyDetectors)) covered.add(entry.category);
  for (const entry of Object.values(fileDetectors)) {
    if (entry.target !== "deploymentTarget") covered.add(entry.target);
  }
  for (const category of stackCategories) {
    assert.ok(covered.has(category), `no detector fills "${category}"`);
  }
});

test("the four deployment platforms named by StackProfile are present with provenance keys", () => {
  const expected = [
    ["fly.toml", "flyio"],
    ["render.yaml", "render"],
    ["vercel.json", "vercel"],
    ["railway.toml", "railway"],
  ];
  for (const [filename, canonical] of expected) {
    const entry = fileDetectors[filename];
    assert.ok(entry, `missing file detector for ${filename}`);
    assert.equal(entry.target, "deploymentTarget");
    assert.equal(entry.canonical, canonical);
  }
});

test("spot checks: discussion examples are pinned exactly", () => {
  assert.deepEqual(dependencyDetectors.pg, {
    kind: "dependency",
    canonical: "postgresql",
    category: "databases",
  });
  assert.deepEqual(dependencyDetectors.ioredis, {
    kind: "dependency",
    canonical: "redis",
    category: "caching",
  });
  assert.deepEqual(dependencyDetectors["@stripe/stripe-js"], {
    kind: "dependency",
    canonical: "stripe",
    category: "payments",
  });
  // ODM folds into its database (policy 4)
  assert.equal(dependencyDetectors.mongoose.canonical, "mongodb");
  // file key doubles as provenance source (policy 3)
  assert.deepEqual(fileDetectors["fly.toml"], {
    kind: "file",
    canonical: "flyio",
    target: "deploymentTarget",
  });
});

// Provenance model (contract step 8.5): raw manifest deps resolve through
// the registry into StackProfile.matchedDependencies — canonical ID → the
// raw names that matched it. This dry-runs analyzeProject()'s planned
// resolution against real registry data; when the real implementation
// lands (step 10), it must reproduce exactly this mapping.
test("policy 5 + matchedDependencies: unknown deps dropped, known deps grouped by canonical", () => {
  const manifestDeps = ["pg", "postgres", "ioredis", "totally-unknown-pkg"];
  const matchedDependencies = {};

  for (const name of manifestDeps) {
    const hit = dependencyDetectors[name];
    if (!hit) continue; // policy 5: silently ignored
    (matchedDependencies[hit.canonical] ??= []).push(name);
  }

  assert.deepEqual(matchedDependencies, {
    postgresql: ["pg", "postgres"],
    redis: ["ioredis"],
  });
});
