import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchHits } from "../dist/mechanical/search.js";

const hit = (url, title) => ({ url, ...(title !== undefined ? { title } : {}) });
const tier = (tierName, queries, hits) => ({
  tier: tierName,
  queriesRun: queries,
  hits,
});

// ---------------------------------------------------------------------------
// 1. Name derivation from registry/repo URL patterns.
// ---------------------------------------------------------------------------

test("GitHub deep links resolve to owner/repo regardless of extra path", () => {
  const cases = [
    ["https://github.com/qdrant/qdrant", "qdrant"],
    ["https://github.com/qdrant/qdrant/", "qdrant"],
    ["https://github.com/qdrant/qdrant/tree/master/client", "qdrant"],
    ["https://github.com/qdrant/qdrant.git", "qdrant"],
    ["https://www.github.com/qdrant/qdrant/issues/12", "qdrant"],
  ];
  for (const [url, expected] of cases) {
    const [candidate] = normalizeSearchHits([
      tier("github", ["site:github.com x stars:>500"], [hit(url)]),
    ]);
    assert.equal(candidate.name, expected, url);
    assert.equal(candidate.url, "https://github.com/qdrant/qdrant", url);
    assert.equal(candidate.tier, "github");
  }
});

test("npm package URLs keep scopes; non-package npm paths are not packages", () => {
  const candidates = normalizeSearchHits([
    tier(
      "package-registry",
      ["site:npmjs.com vector db"],
      [
        hit("https://www.npmjs.com/package/@qdrant/js-client-rest"),
        hit("https://npmjs.com/package/zod/v/3.22.0"),
        hit("https://www.npmjs.com/package/lodash/-/lodash-4.17.21.tgz"),
      ]
    ),
  ]);
  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    ["@qdrant/js-client-rest", "zod", "lodash"]
  );
});

test("PyPI project URLs extract the distribution name", () => {
  const [candidate] = normalizeSearchHits([
    tier("package-registry", ["site:pypi.org vector db"], [
      hit("https://pypi.org/project/qdrant-client/1.9.0/"),
    ]),
  ]);
  assert.equal(candidate.name, "qdrant-client");
  assert.equal(candidate.url, "https://pypi.org/project/qdrant-client/");
});

test("unknown hosts fall back to the hit's own title, verbatim URL", () => {
  const [candidate] = normalizeSearchHits([
    tier("mcp", ["MCP server vector search"], [
      hit("https://mcp.so/server/qdrant-mcp", "qdrant-mcp — MCP server for Qdrant"),
    ]),
  ]);
  assert.equal(candidate.name, "qdrant-mcp — MCP server for Qdrant");
  assert.equal(candidate.url, "https://mcp.so/server/qdrant-mcp");
  assert.equal(candidate.tier, "mcp");
});

test("a hit with neither a known pattern nor a usable title is dropped, never guessed", () => {
  const candidates = normalizeSearchHits([
    tier("curated-template", ["awesome vector db"], [
      hit("https://github.com/topics/vector-database"), // single-segment: not a repo
      { url: "https://example.org/list" }, // no title at all
      hit("https://example.org/list", "   "), // whitespace-only title
    ]),
  ]);
  assert.deepEqual(candidates, []);
});

// ---------------------------------------------------------------------------
// 2. Ordering — canonical tier rank beats caller input order.
// ---------------------------------------------------------------------------

test("output is ordered by tier rank (github < mcp < package-registry < curated-template)", () => {
  const candidates = normalizeSearchHits([
    tier("curated-template", ["starter template"], [hit("https://example.org/tpl", "tpl")]),
    tier("package-registry", ["npm"], [hit("https://www.npmjs.com/package/pkg-a")]),
    tier("mcp", ["MCP"], [hit("https://mcp.so/server-a", "server-a")]),
    tier("github", ["gh"], [hit("https://github.com/o/repo-a")]),
  ]);
  assert.deepEqual(
    candidates.map((candidate) => candidate.tier),
    ["github", "mcp", "package-registry", "curated-template"]
  );
});

// ---------------------------------------------------------------------------
// 3. Dedupe across tiers by URL and by name.
// ---------------------------------------------------------------------------

test("cross-tier duplicate keeps the earlier tier's occurrence and provenance", () => {
  const candidates = normalizeSearchHits([
    tier("package-registry", ["npm qdrant"], [hit("https://www.npmjs.com/package/qdrant")]),
    tier("github", ["gh"], [hit("https://github.com/qdrant/qdrant")]), // same name, later tier... 
  ]);
  // github outranks package-registry, so the GitHub occurrence is processed
  // first and survives even though it appeared second in the input.
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].tier, "github");
  assert.equal(candidates[0].url, "https://github.com/qdrant/qdrant");
});

test("URL spelling variants of the same page collapse to one candidate", () => {
  const candidates = normalizeSearchHits([
    tier("github", ["q1"], [
      hit("https://github.com/ollama/ollama"),
      hit("http://www.github.com/ollama/ollama/"),
      hit("https://github.com/ollama/ollama?tab=readme"),
    ]),
  ]);
  assert.equal(candidates.length, 1);
});

test("name collisions drop later occurrences even when URLs differ", () => {
  const candidates = normalizeSearchHits([
    tier("github", ["q"], [hit("https://github.com/vercel/ai")]),
    tier("package-registry", ["q"], [hit("https://www.npmjs.com/package/AI")]),
    tier("package-registry", ["q"], [hit("https://www.npmjs.com/package/other")]),
  ]);
  assert.deepEqual(
    candidates.map((candidate) => `${candidate.tier}:${candidate.name}`),
    ["github:ai", "package-registry:other"]
  );
});

// ---------------------------------------------------------------------------
// 4. Loud failures on structurally invalid input.
// ---------------------------------------------------------------------------

test("structurally invalid input throws loudly instead of degrading silently", () => {
  assert.throws(() => normalizeSearchHits("nope"), /must be an array/);
  assert.throws(() => normalizeSearchHits([{ tier: "blog", queriesRun: [], hits: [] }]), /tier must be one of/);
  assert.throws(() => normalizeSearchHits([tier("github", [], "not-an-array")]), /hits must be an array/);
  assert.throws(() => normalizeSearchHits([tier("github", [], [{ url: "" }])]), /non-empty string/);
  assert.throws(() => normalizeSearchHits([tier("github", [], [{ title: "no url" }])]), /non-empty string/);
});
