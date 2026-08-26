import { test } from "node:test";
import assert from "node:assert/strict";
import { renderProfileJson, renderProfileText } from "../dist/cli/render.js";

/**
 * @param {Partial<import('skillmama').StackProfile>} overrides
 * @returns {import('skillmama').StackProfile}
 */
function profile(overrides = {}) {
  return {
    languages: [],
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
    matchedDependencies: {},
    ...overrides,
  };
}

test("renders non-empty categories with display labels, in contract order", () => {
  const text = renderProfileText(
    profile({
      languages: ["go", "nodejs"],
      frameworks: ["express"],
      testing: ["vitest"],
    })
  );
  const lines = text.split("\n");
  assert.equal(lines[0], "Languages     go, nodejs");
  assert.equal(lines[1], "Frameworks    express");
  assert.equal(lines[2], "Testing       vitest");
});

test("omits empty categories entirely", () => {
  const text = renderProfileText(profile({ databases: ["postgresql"] }));
  assert.match(text, /^Databases/);
  assert.doesNotMatch(text, /Languages|Frameworks|Payments/);
});

test("deployment target renders canonical value with provenance source", () => {
  const text = renderProfileText(
    profile({ deploymentTarget: { value: "flyio", source: "fly.toml" } })
  );
  assert.match(text, /Deployment +flyio \(fly\.toml\)/);
});

test("dependency evidence section lists canonical IDs with raw names", () => {
  const text = renderProfileText(
    profile({
      databases: ["postgresql"],
      matchedDependencies: { postgresql: ["pg", "postgres"] },
    })
  );
  assert.match(text, /Dependency evidence:\n  postgresql: pg, postgres/);
});

test("fully empty profile says nothing was detected", () => {
  const text = renderProfileText(profile());
  assert.equal(text, "No known technologies detected.");
});

test("empty categories but deployment present still renders the target", () => {
  const text = renderProfileText(
    profile({ deploymentTarget: { value: "vercel", source: "vercel.json" } })
  );
  assert.equal(text, "Deployment    vercel (vercel.json)");
});

test("json rendering round-trips the exact profile object", () => {
  const input = profile({
    languages: ["python"],
    matchedDependencies: { pytest: ["pytest"] },
    deploymentTarget: { value: "render", source: "render.yaml" },
  });
  assert.deepEqual(JSON.parse(renderProfileJson(input)), input);
});
