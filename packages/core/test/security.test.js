import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NPM_BOT_PUBLISHERS,
  detectPublisherHandoff,
  gatherSecurityEvidence,
  normalizeOsvQueryResponse,
} from "../dist/index.js";

const TODAY = "2026-08-21";

// ---------------------------------------------------------------------------
// 1. OSV normalization — severity extraction, hasFix, alias dedupe.
// ---------------------------------------------------------------------------

const vuln = (overrides = {}) => ({
  id: "GHSA-test-0001",
  aliases: [],
  database_specific: { severity: "HIGH" },
  affected: [
    {
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.2.3" }] }],
    },
  ],
  summary: "flaw summary",
  ...overrides,
});

test("empty or absent vulns yield [], never a fabricated advisory", () => {
  assert.deepEqual(normalizeOsvQueryResponse({}), []);
  assert.deepEqual(normalizeOsvQueryResponse({ vulns: [] }), []);
  assert.deepEqual(normalizeOsvQueryResponse(null), []);
  assert.deepEqual(normalizeOsvQueryResponse(undefined), []);
});

test("severity comes off database_specific, case-normalized; anything else is UNKNOWN", () => {
  const [advisory] = normalizeOsvQueryResponse({ vulns: [vuln()] });
  assert.equal(advisory.severity, "HIGH");
  assert.equal(
    normalizeOsvQueryResponse({ vulns: [vuln({ database_specific: { severity: "critical" } })] })[0]
      .severity,
    "CRITICAL"
  );
  assert.equal(
    normalizeOsvQueryResponse({ vulns: [vuln({ database_specific: {} })] })[0].severity,
    "UNKNOWN"
  );
  // The PYSEC trap shape: severity field simply absent.
  assert.equal(
    normalizeOsvQueryResponse({ vulns: [vuln({ id: "PYSEC-2020-1", database_specific: undefined })] })[0]
      .severity,
    "UNKNOWN"
  );
});

test("hasFix is true iff any affected range carries a fixed event", () => {
  const [fixed] = normalizeOsvQueryResponse({ vulns: [vuln()] });
  assert.equal(fixed.hasFix, true);

  const unfixed = vuln({
    affected: [{ ranges: [{ events: [{ introduced: "1.0.0" }] }] }],
  });
  assert.equal(normalizeOsvQueryResponse({ vulns: [unfixed] })[0].hasFix, false);

  const noAffected = vuln({ affected: undefined });
  assert.equal(normalizeOsvQueryResponse({ vulns: [noAffected] })[0].hasFix, false);
});

test("summary is carried through when present", () => {
  const [advisory] = normalizeOsvQueryResponse({
    vulns: [vuln({ summary: "pre-auth RCE in server mode" })],
  });
  assert.equal(advisory.summary, "pre-auth RCE in server mode");

  const [anonymous] = normalizeOsvQueryResponse({ vulns: [vuln({ summary: undefined })] });
  assert.equal(anonymous.summary, undefined);
});

test("malformed vuln records are skipped, valid siblings survive", () => {
  const advisories = normalizeOsvQueryResponse({
    vulns: [null, "garbage", { nope: true }, vuln()],
  });
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].id, "GHSA-test-0001");
});

// SKILL.md Check 1, trap 1: PYSEC-* duplicates a GHSA-* record for the same
// flaw with severity UNKNOWN. Dedupe on aliases, read severity off the twin.
test("PYSEC twin collapses into its GHSA record, inheriting the real severity", () => {
  const advisories = normalizeOsvQueryResponse({
    vulns: [
      vuln({ id: "PYSEC-2019-42", aliases: ["GHSA-real-0001"], database_specific: {} }),
      vuln({
        id: "GHSA-real-0001",
        aliases: ["CVE-2019-1234", "PYSEC-2019-42"],
        database_specific: { severity: "HIGH" },
      }),
    ],
  });
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].id, "GHSA-real-0001");
  assert.equal(advisories[0].severity, "HIGH");
  assert.deepEqual(advisories[0].aliases, ["CVE-2019-1234", "PYSEC-2019-42"]);
});

test("alias clusters merge transitively: A~B, B~C is one flaw", () => {
  const advisories = normalizeOsvQueryResponse({
    vulns: [
      vuln({ id: "GHSA-aaa", aliases: ["GHSA-bbb"], database_specific: {} }),
      vuln({ id: "GHSA-bbb", aliases: ["GHSA-ccc"], database_specific: {} }),
      vuln({ id: "GHSA-ccc", aliases: [], database_specific: { severity: "MODERATE" } }),
    ],
  });
  assert.equal(advisories.length, 1);
  // Only ccc carries a known severity; the merged record must rescue it
  // from across the transitive link instead of reporting UNKNOWN.
  assert.equal(advisories[0].id, "GHSA-ccc");
  assert.equal(advisories[0].severity, "MODERATE");
  assert.deepEqual(advisories[0].aliases, ["GHSA-aaa", "GHSA-bbb"]);
});

test("distinct flaws sharing no identifiers stay distinct", () => {
  const advisories = normalizeOsvQueryResponse({
    vulns: [vuln(), vuln({ id: "GHSA-other-999", summary: "different flaw" })],
  });
  assert.equal(advisories.length, 2);
});

test("output is sorted by id — deterministic across runs", () => {
  const advisories = normalizeOsvQueryResponse({
    vulns: [vuln({ id: "GHSA-zzz" }), vuln({ id: "GHSA-aaa", summary: "other" })],
  });
  assert.deepEqual(advisories.map((a) => a.id), ["GHSA-aaa", "GHSA-zzz"]);
});

// ---------------------------------------------------------------------------
// 2. Publisher continuity — faithful port of SKILL.md Check 2's script.
// ---------------------------------------------------------------------------

function packument(publishes) {
  const versions = {};
  const time = {};
  for (const p of publishes) {
    versions[p.version] =
      p.publisher === undefined ? {} : { _npmUser: { name: p.publisher } };
    time[p.version] = `${p.date}T12:00:00.000Z`;
  }
  return { versions, time };
}

const HANDOFF = { version: "5.0.0", publisher: "new-maintainer", date: "2026-02-01" };

test("solo maintainer: no handoff", () => {
  const doc = packument([
    { version: "1.0.0", publisher: "solo", date: "2024-01-01" },
    { version: "1.1.0", publisher: "solo", date: "2026-06-01" },
  ]);
  assert.equal(detectPublisherHandoff(doc, TODAY), null);
});

test("team rotation is not a handoff: the old guard must never publish again", () => {
  // Fires on express/lodash/chalk-shaped histories if implemented wrong.
  const doc = packument([
    { version: "1.0.0", publisher: "tj", date: "2026-05-01" },
    { version: "1.1.0", publisher: "wes", date: "2026-06-01" },
    { version: "1.2.0", publisher: "tj", date: "2026-07-01" },
  ]);
  assert.equal(detectPublisherHandoff(doc, TODAY), null);
});

test("genuine handoff under 12 months is reported with both publishers, version, date", () => {
  const doc = packument([
    { version: "4.17.19", publisher: "old-guard", date: "2026-01-01" },
    HANDOFF,
    { version: "5.1.0", publisher: "new-maintainer", date: "2026-07-01" },
  ]);
  assert.deepEqual(detectPublisherHandoff(doc, TODAY), {
    from: "old-guard",
    to: "new-maintainer",
    version: "5.0.0",
    date: "2026-02-01",
  });
});

test("stale handoffs (>= 12 months) are never reported", () => {
  const doc = packument([
    { version: "1.0.0", publisher: "original", date: "2018-09-05" },
    { version: "2.0.0", publisher: "successor", date: "2018-11-26" },
  ]);
  assert.equal(detectPublisherHandoff(doc, TODAY), null);
});

test("recency window boundary: ~11 months reports, ~13 does not", () => {
  const recent = packument([
    { version: "1.0.0", publisher: "a", date: "2025-09-20" },
    { version: "2.0.0", publisher: "b", date: "2025-09-25" },
  ]); // ~11 months before TODAY
  assert.notEqual(detectPublisherHandoff(recent, TODAY), null);

  const stale = packument([
    { version: "1.0.0", publisher: "a", date: "2025-06-01" },
    { version: "2.0.0", publisher: "b", date: "2025-06-05" },
  ]); // ~14.5 months before TODAY
  assert.equal(detectPublisherHandoff(stale, TODAY), null);
});

test("versions sort by publish TIME, not packument key order", () => {
  // Insertion order puts the newcomer first; time order must restore it.
  const doc = packument([
    { version: "1.9.9", publisher: "new-maintainer", date: "2026-04-01" },
    { version: "2.0.0", publisher: "old-guard", date: "2026-03-01" },
  ]);
  assert.deepEqual(detectPublisherHandoff(doc, TODAY), {
    from: "old-guard",
    to: "new-maintainer",
    version: "1.9.9",
    date: "2026-04-01",
  });
});

test("an old-guard backport after the newcomer means the old guard returned — no handoff", () => {
  // 4.x backport published AFTER 5.x: key order would read this as a clean
  // old→new handoff; time order reveals old-guard came back in May, so no
  // qualifying handoff exists.
  const doc = packument([
    { version: "4.17.20", publisher: "old-guard", date: "2026-05-01" },
    { version: "5.0.0", publisher: "new-maintainer", date: "2026-02-01" },
    { version: "5.1.0", publisher: "new-maintainer", date: "2026-07-01" },
  ]);
  assert.equal(detectPublisherHandoff(doc, TODAY), null);
});

test("bot publishers are dropped before detection — CI migration is not a handoff", () => {
  const ciMigration = packument([
    { version: "1.0.0", publisher: "human", date: "2026-01-01" },
    { version: "1.1.0", publisher: "GitHub Actions", date: "2026-02-01" },
  ]);
  assert.equal(detectPublisherHandoff(ciMigration, TODAY), null);

  const humanHandoffViaBotGap = packument([
    { version: "1.0.0", publisher: "human", date: "2026-01-01" },
    { version: "1.1.0", publisher: "semantic-release-bot", date: "2026-02-01" },
    { version: "2.0.0", publisher: "newcomer", date: "2026-03-01" },
  ]);
  assert.deepEqual(detectPublisherHandoff(humanHandoffViaBotGap, TODAY), {
    from: "human",
    to: "newcomer",
    version: "2.0.0",
    date: "2026-03-01",
  });
});

test("every bot in SKILL.md's literal list is recognized", () => {
  for (const bot of [
    "GitHub Actions",
    "semantic-release-bot",
    "npm",
    "types",
    "oss-bot",
    "npm-cli-ops",
    "react-bot",
    "renovate-bot",
  ]) {
    assert.ok(NPM_BOT_PUBLISHERS.has(bot), `expected ${bot} in the bot list`);
  }
});

test("versions with unknown publishers are dropped, not treated as a publisher", () => {
  const doc = packument([
    { version: "1.0.0", publisher: "human", date: "2026-01-01" },
    { version: "1.1.0", publisher: undefined, date: "2026-02-01" },
    { version: "2.0.0", publisher: "newcomer", date: "2026-03-01" },
  ]);
  assert.deepEqual(detectPublisherHandoff(doc, TODAY), {
    from: "human",
    to: "newcomer",
    version: "2.0.0",
    date: "2026-03-01",
  });
});

test("only the most recent qualifying handoff survives", () => {
  const doc = packument([
    { version: "1.0.0", publisher: "first", date: "2026-01-01" },
    { version: "2.0.0", publisher: "second", date: "2026-02-01" },
    { version: "3.0.0", publisher: "third", date: "2026-03-01" },
  ]);
  assert.deepEqual(detectPublisherHandoff(doc, TODAY), {
    from: "second",
    to: "third",
    version: "3.0.0",
    date: "2026-03-01",
  });
});

test("structurally invalid input throws instead of reading as clean", () => {
  assert.throws(() => detectPublisherHandoff(null, TODAY), /packument/);
  assert.throws(() => detectPublisherHandoff({}, TODAY), /packument/);
  assert.throws(() => detectPublisherHandoff("<html>", TODAY), /packument/);
  assert.throws(
    () => detectPublisherHandoff(packument([{ version: "1.0.0", publisher: "a", date: "2026-01-01" }]), "not-a-date"),
    /today/
  );
});

// ---------------------------------------------------------------------------
// 3. Orchestration — injected transport, canonical evidence order,
//    unverified-not-passed degradation.
// ---------------------------------------------------------------------------

function fetchStub(routes, log = []) {
  return async (url, init) => {
    log.push({ url, init });
    const route = routes[url];
    if (!route || route.networkError) throw new Error(`connection refused: ${url}`);
    if (route.httpStatus && route.httpStatus !== 200) {
      return { ok: false, status: route.httpStatus, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => route.body ?? {} };
  };
}

const CLEAN_OSV = { vulns: [] };
const SOLO_PACKUMENT = packument([
  { version: "1.0.0", publisher: "solo", date: "2026-01-01" },
]);

test("npm candidate yields both checks in canonical order [osv, publisher-continuity]", async () => {
  const evidence = await gatherSecurityEvidence(
    { name: "left-pad", ecosystem: "npm", version: "1.3.0" },
    {
      fetchImpl: fetchStub({
        "https://api.osv.dev/v1/query": { body: CLEAN_OSV },
        "https://registry.npmjs.org/left-pad": {
          body: packument([{ version: "1.3.0", publisher: "solo", date: "2026-01-01" }]),
        },
      }),
      today: TODAY,
    }
  );
  assert.deepEqual(evidence.map((e) => e.source), ["osv", "publisher-continuity"]);
  assert.deepEqual(evidence, [
    { source: "osv", status: "ok", queriedVersion: "1.3.0", advisories: [] },
    { source: "publisher-continuity", status: "ok", handoff: null },
  ]);
});

test("queries the version you intend to recommend, not the latest", async () => {
  const log = [];
  await gatherSecurityEvidence(
    { name: "lodash", ecosystem: "npm", version: "4.17.19" },
    {
      fetchImpl: fetchStub(
        {
          "https://api.osv.dev/v1/query": { body: CLEAN_OSV },
          "https://registry.npmjs.org/lodash": { body: SOLO_PACKUMENT },
        },
        log
      ),
      today: TODAY,
    }
  );
  const osvCall = log.find((c) => c.url === "https://api.osv.dev/v1/query");
  const body = JSON.parse(osvCall.init.body);
  assert.deepEqual(body, {
    package: { name: "lodash", ecosystem: "npm" },
    version: "4.17.19",
  });
});

test("scoped package names are percent-encoded against the npm registry", async () => {
  const log = [];
  await gatherSecurityEvidence(
    { name: "@scope/pkg", ecosystem: "npm", version: "1.0.0" },
    {
      fetchImpl: fetchStub(
        {
          "https://api.osv.dev/v1/query": { body: CLEAN_OSV },
          "https://registry.npmjs.org/%40scope%2Fpkg": { body: SOLO_PACKUMENT },
        },
        log
      ),
      today: TODAY,
    }
  );
  assert.ok(log.some((c) => c.url === "https://registry.npmjs.org/%40scope%2Fpkg"));
});

test("non-npm ecosystems report publisher continuity as unsupported, never checked", async () => {
  let registryHit = false;
  const evidence = await gatherSecurityEvidence(
    { name: "requests", ecosystem: "PyPI", version: "2.31.0" },
    {
      fetchImpl: async (url) => {
        if (url.includes("registry.npmjs.org")) registryHit = true;
        return { ok: true, status: 200, json: async () => ({}) };
      },
      today: TODAY,
    }
  );
  assert.equal(registryHit, false);
  assert.deepEqual(evidence[1], {
    source: "publisher-continuity",
    status: "unverified",
    reason: "unsupported-ecosystem",
  });
});

test("OSV unreachable degrades to unverified — and never reads as passed", async () => {
  const evidence = await gatherSecurityEvidence(
    { name: "pkg", ecosystem: "npm", version: "1.0.0" },
    {
      fetchImpl: fetchStub({
        "https://api.osv.dev/v1/query": { networkError: true },
        "https://registry.npmjs.org/pkg": { body: SOLO_PACKUMENT },
      }),
      today: TODAY,
    }
  );
  assert.deepEqual(evidence[0], {
    source: "osv",
    status: "unverified",
    reason: "unreachable",
  });
});

test("non-2xx responses degrade to unverified, same as network errors", async () => {
  const evidence = await gatherSecurityEvidence(
    { name: "pkg", ecosystem: "npm", version: "1.0.0" },
    {
      fetchImpl: fetchStub({
        "https://api.osv.dev/v1/query": { httpStatus: 503 },
        "https://registry.npmjs.org/pkg": { httpStatus: 404 },
      }),
      today: TODAY,
    }
  );
  assert.deepEqual(evidence, [
    { source: "osv", status: "unverified", reason: "unreachable" },
    { source: "publisher-continuity", status: "unverified", reason: "unreachable" },
  ]);
});

test("one check failing does not take the other down with it", async () => {
  const evidence = await gatherSecurityEvidence(
    { name: "pkg", ecosystem: "npm", version: "1.0.0" },
    {
      fetchImpl: fetchStub({
        "https://api.osv.dev/v1/query": { networkError: true },
        "https://registry.npmjs.org/pkg": {
          body: packument([
            { version: "1.0.0", publisher: "old", date: "2026-05-01" },
            { version: "2.0.0", publisher: "new", date: "2026-06-01" },
          ]),
        },
      }),
      today: TODAY,
    }
  );
  assert.equal(evidence[0].status, "unverified");
  assert.deepEqual(evidence[1], {
    source: "publisher-continuity",
    status: "ok",
    handoff: { from: "old", to: "new", version: "2.0.0", date: "2026-06-01" },
  });
});

test("a reachable registry returning garbage throws loudly instead of reading clean", async () => {
  await assert.rejects(
    gatherSecurityEvidence(
      { name: "pkg", ecosystem: "npm", version: "1.0.0" },
      {
        fetchImpl: fetchStub({
          "https://api.osv.dev/v1/query": { body: CLEAN_OSV },
          "https://registry.npmjs.org/pkg": { body: { sorry: "not a packument" } },
        }),
        today: TODAY,
      }
    ),
    /packument/
  );
});

test("the recency window anchors on the today option, deterministically", async () => {
  const routes = {
    "https://api.osv.dev/v1/query": { body: CLEAN_OSV },
    "https://registry.npmjs.org/pkg": {
      body: packument([
        { version: "1.0.0", publisher: "old", date: "2026-02-01" },
        { version: "2.0.0", publisher: "new", date: "2026-03-01" },
      ]),
    },
  };
  const fresh = await gatherSecurityEvidence(
    { name: "pkg", ecosystem: "npm", version: "2.0.0" },
    { fetchImpl: fetchStub(routes), today: "2026-08-21" }
  );
  assert.notEqual(fresh[1].handoff, null);

  const stale = await gatherSecurityEvidence(
    { name: "pkg", ecosystem: "npm", version: "2.0.0" },
    { fetchImpl: fetchStub(routes), today: "2027-08-21" }
  );
  assert.equal(stale[1].handoff, null);
});

test("same inputs, byte-identical evidence across runs", async () => {
  const routes = {
    "https://api.osv.dev/v1/query": {
      body: {
        vulns: [
          vuln({ id: "PYSEC-x", aliases: ["GHSA-y"], database_specific: {} }),
          vuln({ id: "GHSA-y", aliases: ["PYSEC-x"] }),
        ],
      },
    },
    "https://registry.npmjs.org/pkg": { body: packument([HANDOFF]) },
  };
  const options = { fetchImpl: fetchStub(routes), today: TODAY };
  const a = await gatherSecurityEvidence(
    { name: "pkg", ecosystem: "npm", version: "5.0.0" },
    options
  );
  const b = await gatherSecurityEvidence(
    { name: "pkg", ecosystem: "npm", version: "5.0.0" },
    options
  );
  assert.deepEqual(a, b);
});

test("invalid targets throw naming the offending field", async () => {
  const noopFetch = fetchStub({});
  await assert.rejects(
    gatherSecurityEvidence({ name: "", ecosystem: "npm", version: "1.0.0" }, { fetchImpl: noopFetch }),
    /name/
  );
  await assert.rejects(
    gatherSecurityEvidence({ name: "x", ecosystem: "pypi", version: "1.0.0" }, { fetchImpl: noopFetch }),
    /ecosystem/
  );
  await assert.rejects(
    gatherSecurityEvidence({ name: "x", ecosystem: "Go", version: "" }, { fetchImpl: noopFetch }),
    /version/
  );
});
