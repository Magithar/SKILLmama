import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NPM_BOT_PUBLISHERS,
  buildCompanionQueries,
  buildTierQueries,
  companionSkillSources,
  mapMaintenanceBand,
  mapPopularityBand,
  scoreCandidate,
  searchTiers,
} from "../dist/index.js";

/**
 * SKILL.md <-> packages/core conformance.
 *
 * check-skill-untouched.sh guards SKILL.md against copy drift. Nothing
 * guarded SKILL.md's prose against the code that reimplements the same
 * phase, so the two could drift silently and the suite would stay green.
 * This file closes that: it PARSES skillmama/SKILL.md at test time and
 * asserts the package agrees with what it actually says.
 *
 * The parsing is deliberately strict. If a heading is reworded or a band
 * line is reformatted, the extractor throws rather than quietly matching
 * nothing and passing — a conformance test that can't find its input must
 * fail, not shrug.
 *
 * SKILL.md stays the source of truth. When one of these fails, the
 * question is "what changed in SKILL.md and does the code still match",
 * never "how do I make the test pass".
 */

const SKILL_PATH = fileURLToPath(
  new URL("../../../skillmama/SKILL.md", import.meta.url)
);
const SKILL = readFileSync(SKILL_PATH, "utf8");

/** Text between a heading/marker and the next one. Throws if absent. */
function section(startPattern, endPattern) {
  const start = SKILL.search(startPattern);
  assert.notEqual(
    start,
    -1,
    `SKILL.md conformance: could not locate ${startPattern} — has the heading been reworded? Update this extractor deliberately.`
  );
  const rest = SKILL.slice(start);
  const end = rest.slice(1).search(endPattern);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

/** "10k" -> 10000, "1M" -> 1000000, "500" -> 500. */
function parseMagnitude(raw) {
  const match = /^([\d.]+)\s*([kM]?)$/.exec(raw.trim());
  assert.ok(match, `SKILL.md conformance: unparseable magnitude ${JSON.stringify(raw)}`);
  const scale = match[2] === "k" ? 1_000 : match[2] === "M" ? 1_000_000 : 1;
  return Number(match[1]) * scale;
}

/** "10" -> {low:10,high:10}; "7–9" (en dash) or "7-9" -> {low:7,high:9}. */
function parseBandLabel(raw) {
  const match = /^(\d+)(?:[–-](\d+))?$/.exec(raw.trim());
  assert.ok(match, `SKILL.md conformance: unparseable band label ${JSON.stringify(raw)}`);
  return {
    low: Number(match[1]),
    high: match[2] === undefined ? Number(match[1]) : Number(match[2]),
  };
}

// ---------------------------------------------------------------------------
// 1. The weighting formula.
// ---------------------------------------------------------------------------

test("scoreCandidate uses exactly the weights SKILL.md states", () => {
  const line = /Total Score = \(Compatibility × ([\d.]+)\) \+ \(Popularity × ([\d.]+)\) \+ \(Maintenance × ([\d.]+)\) \+ \(Simplicity × ([\d.]+)\)/.exec(
    SKILL
  );
  assert.ok(line, "SKILL.md conformance: the Total Score formula line was not found");
  const [compatibility, popularity, maintenance, simplicity] = line
    .slice(1, 5)
    .map(Number);
  assert.equal(
    compatibility + popularity + maintenance + simplicity,
    1,
    "SKILL.md's four weights must sum to 1"
  );

  // Verified functionally rather than by reading the constant: several
  // distinct factor tuples must reproduce the parsed weighting exactly.
  const tuples = [
    [10, 10, 10, 10],
    [8, 4, 9, 2],
    [1, 10, 1, 10],
    [7, 7, 3, 5],
  ];
  for (const [c, p, m, s] of tuples) {
    const expected =
      Math.round(
        (c * compatibility + p * popularity + m * maintenance + s * simplicity) * 10
      ) / 10;
    const actual = scoreCandidate(
      { name: "x", tier: "github", url: "https://example.com" },
      { compatibility: c, popularity: p, maintenance: m, simplicity: s }
    ).totalScore;
    assert.equal(actual, expected, `weights disagree for factors ${[c, p, m, s]}`);
  }
});

// ---------------------------------------------------------------------------
// 2. The Popularity band table.
// ---------------------------------------------------------------------------

test("mapPopularityBand reproduces SKILL.md's Popularity table", () => {
  const block = section(/\*\*Popularity \(30%\)\*\*/, /\n\*\*Maintenance/);
  const rows = [
    ...block.matchAll(
      /^- (\d+(?:[–-]\d+)?): (?:>([\d.]+[kM]?)|<([\d.]+[kM]?)|([\d.]+[kM]?)[–-]([\d.]+[kM]?)) stars OR (?:>([\d.]+[kM]?)|<([\d.]+[kM]?)|([\d.]+[kM]?)[–-]([\d.]+[kM]?)) (?:weekly )?downloads$/gm
    ),
  ];
  assert.equal(
    rows.length,
    4,
    "SKILL.md conformance: expected 4 Popularity band lines, the extractor found " + rows.length
  );

  const stars = (n) => [
    { source: "github-stars", status: "ok", stars: n },
    { source: "npm-downloads", status: "unverified", reason: "no-npm-package" },
  ];
  const downloads = (n) => [
    { source: "github-stars", status: "unverified", reason: "no-repo" },
    { source: "npm-downloads", status: "ok", weeklyDownloads: n },
  ];

  for (const row of rows) {
    const band = parseBandLabel(row[1]);

    // Probe BOTH sides of every stated edge. Testing only "well inside the
    // band" is what let a moved threshold (>10k -> >50k) pass unnoticed:
    // 100k stars is band 10 either way. The edge itself is the assertion.
    const edges = (above, below, low, high) => {
      if (above !== undefined) {
        const x = parseMagnitude(above);
        return { inside: x + 1, outside: x };
      }
      if (below !== undefined) {
        const x = parseMagnitude(below);
        return { inside: Math.max(0, x - 1), outside: x };
      }
      // A range. SKILL.md's edges overlap (1k is in both "100-1k" and
      // "1k-10k"), resolved upward, so the low edge belongs to THIS band
      // and one below it does not.
      const lo = parseMagnitude(low);
      return { inside: lo, outside: Math.max(0, lo - 1) };
    };

    const check = (axis, build, edge) => {
      assert.deepEqual(
        mapPopularityBand(build(edge.inside)).band,
        band,
        `${edge.inside} ${axis} should map to band ${row[1]} per SKILL.md`
      );
      if (edge.outside === edge.inside) return;
      const outsideBand = mapPopularityBand(build(edge.outside)).band;
      assert.notDeepEqual(
        outsideBand,
        band,
        `${edge.outside} ${axis} must fall OUTSIDE band ${row[1]}; SKILL.md's edge and the code's disagree`
      );
    };

    check("stars", stars, edges(row[2], row[3], row[4], row[5]));
    check("weekly downloads", downloads, edges(row[6], row[7], row[8], row[9]));
  }
});

// ---------------------------------------------------------------------------
// 3. The Maintenance band table — including the gap in it.
// ---------------------------------------------------------------------------

const TODAY = "2026-08-24";
const pushedDaysAgo = (n, archived = false) => [
  {
    source: "github-last-commit",
    status: "ok",
    lastCommitDate: new Date(Date.parse(TODAY) - n * 86_400_000)
      .toISOString()
      .slice(0, 10),
    archived,
  },
];

function maintenanceRows() {
  const block = section(/\*\*Maintenance \(15%\)\*\*/, /\n\*\*Simplicity/);
  const rows = [
    ...block.matchAll(/^- (\d+(?:[–-]\d+)?): (≤|>)(\d+) days(.*)$/gm),
  ];
  assert.equal(
    rows.length,
    4,
    "SKILL.md conformance: expected 4 Maintenance band lines, the extractor found " + rows.length
  );
  return rows.map((row) => ({
    band: parseBandLabel(row[1]),
    operator: row[2],
    days: Number(row[3]),
    tail: row[4],
  }));
}

test("mapMaintenanceBand reproduces SKILL.md's Maintenance table", () => {
  for (const row of maintenanceRows()) {
    // Both sides of the stated edge, same reasoning as the Popularity table.
    const inside = row.operator === "≤" ? row.days : row.days + 1;
    const outside = row.operator === "≤" ? row.days + 1 : row.days;
    assert.deepEqual(
      mapMaintenanceBand(pushedDaysAgo(inside), TODAY).band,
      row.band,
      `${inside} days should map to band ${row.band.low}-${row.band.high} per SKILL.md`
    );
    const beyond = mapMaintenanceBand(pushedDaysAgo(outside), TODAY);
    assert.ok(
      beyond.status === "unbanded" ||
        beyond.band.low !== row.band.low ||
        beyond.band.high !== row.band.high,
      `${outside} days must fall OUTSIDE band ${row.band.low}-${row.band.high}; SKILL.md's edge and the code's disagree`
    );
  }
});

test("the archived clause is read off SKILL.md, not assumed", () => {
  const rows = maintenanceRows();
  const archivedRow = rows.find((row) => /archived/i.test(row.tail));
  assert.ok(
    archivedRow,
    "SKILL.md conformance: no Maintenance band mentions 'archived' any more — mapMaintenanceBand still special-cases it"
  );
  assert.deepEqual(
    mapMaintenanceBand(pushedDaysAgo(1, true), TODAY).band,
    archivedRow.band,
    "an archived repo must map to whichever band SKILL.md's archived clause sits in"
  );
});

test("the 181-365 day gap is SKILL.md's, and the code reports it rather than guessing", () => {
  const rows = maintenanceRows();
  const covered = Math.max(
    ...rows.filter((row) => row.operator === "≤").map((row) => row.days)
  );
  const resumes = Math.min(
    ...rows.filter((row) => row.operator === ">").map((row) => row.days)
  );

  // This assertion is the alarm: when SKILL.md's table is made contiguous
  // (roadmap task 8), it fails, and mapMaintenanceBand must be updated in
  // the same change instead of silently keeping a dead branch.
  assert.ok(
    resumes > covered,
    `SKILL.md's Maintenance table now covers ${covered + 1}-${resumes} days. The gap is closed, so mapMaintenanceBand's "outside-defined-bands" branch is stale — implement the new band and delete it.`
  );

  for (const days of [covered + 1, Math.floor((covered + resumes) / 2), resumes]) {
    const outcome = mapMaintenanceBand(pushedDaysAgo(days), TODAY);
    assert.equal(
      outcome.status,
      "unbanded",
      `${days} days falls in SKILL.md's uncovered range and must not be given a band`
    );
    assert.equal(outcome.reason, "outside-defined-bands");
  }
});

// ---------------------------------------------------------------------------
// 4. The npm bot-publisher list (Phase 3.5 Check 2's reference script).
// ---------------------------------------------------------------------------

test("NPM_BOT_PUBLISHERS is exactly SKILL.md's BOTS set", () => {
  const match = /^BOTS=\{(.+)\}$/m.exec(SKILL);
  assert.ok(match, "SKILL.md conformance: the BOTS={...} line was not found");
  const fromSkill = [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(fromSkill.length > 0, "SKILL.md conformance: BOTS parsed as empty");
  assert.deepEqual(
    [...NPM_BOT_PUBLISHERS].sort(),
    [...fromSkill].sort(),
    "SKILL.md keeps this list literal on purpose; the code must match it exactly"
  );
});

// ---------------------------------------------------------------------------
// 5. The search tiers and their query recipes.
// ---------------------------------------------------------------------------

function skillTierRecipes() {
  const headings = [...SKILL.matchAll(/^### Tier (\d+) — (.+)$/gm)];
  assert.ok(headings.length > 0, "SKILL.md conformance: no '### Tier N — Name' headings found");
  return headings.map((heading, i) => {
    const start = heading.index;
    const end = i + 1 < headings.length ? headings[i + 1].index : SKILL.indexOf("\n---", start);
    const body = SKILL.slice(start, end);
    return {
      number: Number(heading[1]),
      name: heading[2].trim(),
      queries: [...body.matchAll(/^\s*(?:\w+: )?WebSearch: (.+)$/gm)].map((m) => m[1].trim()),
    };
  });
}

test("searchTiers matches SKILL.md's tier headings, in order", () => {
  const recipes = skillTierRecipes();
  assert.equal(
    recipes.length,
    searchTiers.length,
    `SKILL.md declares ${recipes.length} numbered tiers; searchTiers has ${searchTiers.length}`
  );
  assert.deepEqual(
    recipes.map((r) => r.number),
    recipes.map((_, i) => i + 1),
    "SKILL.md's tiers must be numbered 1..N with no gaps"
  );
  // The tier ids are the package's own vocabulary, but each must be
  // recognizable in the heading it corresponds to.
  const expectedWords = {
    github: "github",
    mcp: "mcp",
    "package-registry": "registr",
    "curated-template": "template",
  };
  for (const [i, tier] of searchTiers.entries()) {
    const word = expectedWords[tier];
    assert.ok(word, `no heading word registered for tier ${tier} — update this test deliberately`);
    assert.ok(
      recipes[i].name.toLowerCase().includes(word),
      `tier ${i + 1} is "${recipes[i].name}" in SKILL.md but "${tier}" in searchTiers`
    );
  }
});

test("buildTierQueries generates SKILL.md's recipes and nothing else", () => {
  const plan = {
    capability: "vector search",
    searchTerms: ["vector db", "embedding store", "semantic search"],
  };
  const stack = {
    languages: ["typescript"],
    frameworks: ["next.js"],
    databases: [],
    infrastructure: [],
    matchedDependencies: {},
  };
  const generated = buildTierQueries(plan, stack);
  const recipes = skillTierRecipes();

  // Every value a placeholder is allowed to take, given the plan above.
  // Enumerating fills and comparing EXACT strings is the whole point: an
  // earlier version turned [placeholder] into a regex wildcard, and a
  // wildcard happily swallowed a dropped literal word ("awesome [capability]
  // github list" -> "awesome [capability] list" passed). Nothing here can
  // absorb a changed literal.
  const fills = {
    "[search_term]": plan.searchTerms,
    "[capability]": [plan.capability],
    "[language]": stack.languages,
    "[framework]": stack.frameworks,
    "[stack]": [stack.languages[0]],
  };

  function expand(recipe) {
    let out = [recipe];
    for (const [token, values] of Object.entries(fills)) {
      if (!out[0].includes(token)) continue;
      out = out.flatMap((form) => values.map((value) => form.split(token).join(value)));
    }
    const leftover = out[0].match(/\[[a-z_]+\]/);
    assert.equal(
      leftover,
      null,
      `SKILL.md conformance: recipe "${recipe}" uses placeholder ${leftover?.[0]}, which this test has no fill for — add it deliberately`
    );
    return out;
  }

  for (const [i, tier] of searchTiers.entries()) {
    const mine = generated[tier];
    assert.ok(mine.length > 0, `buildTierQueries produced no queries for tier ${tier}`);

    const allowed = new Map();
    for (const recipe of recipes[i].queries) {
      for (const form of expand(recipe)) allowed.set(form, recipe);
    }

    for (const recipe of recipes[i].queries) {
      const forms = expand(recipe);
      assert.ok(
        forms.some((form) => mine.includes(form)),
        `SKILL.md tier ${i + 1} recipe "${recipe}" has no generated query. Expected one of ${JSON.stringify(forms)}, got ${JSON.stringify(mine)}`
      );
    }
    for (const query of mine) {
      assert.ok(
        allowed.has(query),
        `buildTierQueries produced "${query}" for tier ${tier}, which no recipe in SKILL.md can produce`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Phase 3.6's four companion searches — fixed, verbatim, in order.
// ---------------------------------------------------------------------------

test("buildCompanionQueries is byte-identical to SKILL.md's Phase 3.6 searches", () => {
  const block = section(/^## Phase 3\.6 — Companion Skills Search$/m, /\n## Phase 3\.7/);
  const recipes = [...block.matchAll(/^\s*WebSearch: (.+)$/gm)].map((m) => m[1].trim());
  assert.equal(
    recipes.length,
    companionSkillSources.length,
    `Phase 3.6 lists ${recipes.length} searches; companionSkillSources has ${companionSkillSources.length}`
  );

  const generated = buildCompanionQueries("pgvector");
  assert.deepEqual(
    generated.map((q) => q.source),
    companionSkillSources,
    "companion queries must run in the registry's canonical source order"
  );
  assert.deepEqual(
    generated.map((q) => q.query),
    recipes.map((recipe) => recipe.replace(/\[candidate_name\]/g, "pgvector")),
    'Phase 3.6\'s searches are fixed text — including the quotes in site:github.com "SKILL.md"'
  );
});
