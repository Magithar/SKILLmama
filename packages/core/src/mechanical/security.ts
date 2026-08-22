import type {
  AdvisorySeverity,
  OsvAdvisory,
  PublisherHandoff,
  SecurityEvidence,
} from "../contracts/security.js";

/**
 * Phase 3.5 Stage 1 — EVIDENCE gathering, implemented.
 *
 * The two live-data checks SKILL.md runs are plain HTTP APIs, so the work
 * is genuinely mechanical: query OSV.dev for advisories at a specific
 * version, pull the npm packument for publisher continuity, and normalize
 * both responses into SecurityEvidence records. The normalization traps
 * SKILL.md documents live here, not with the caller: advisories are
 * deduped on aliases with severity read off the GHSA twin, the version
 * queried is the one the caller intends to recommend, and bot/unknown
 * publishers are dropped before handoff detection.
 *
 * Honesty boundary (per contracts/security.ts): transport failure degrades
 * to `status: "unverified"` — SKILL.md: "Never let an unverified candidate
 * read as having passed" — but structurally invalid data throws loudly,
 * same policy as analyzeProject() with a malformed manifest. What this
 * module deliberately does NOT do is judgment: turning evidence into a
 * GateVerdict is verifyCandidate()'s job (stage 2, LLM reasoning).
 */

/** Ecosystems SKILL.md's OSV query names, spelled exactly as OSV expects
 *  them in the request body ("PyPI", not "pypi"; "crates.io", not "cargo"). */
export type OsvEcosystem = "npm" | "PyPI" | "Go" | "crates.io";

/**
 * The package whose security evidence is being gathered. `version` is the
 * version the caller intends to RECOMMEND — SKILL.md's second OSV trap:
 * "Query the version you intend to recommend, not the latest." This module
 * never resolves "latest" itself; that decision stays with the caller.
 */
export interface SecurityTarget {
  name: string;
  ecosystem: OsvEcosystem;
  version: string;
}

export interface GatherSecurityEvidenceOptions {
  /** Injectable transport — tests substitute a stub keyed by URL.
   *  Defaults to global fetch (Node >= 18). */
  fetchImpl?: typeof fetch;
  /** ISO date (YYYY-MM-DD) anchoring the 12-month handoff recency window.
   *  An explicit input rather than hidden clock state, so results stay
   *  reproducible; defaults to the local date, matching the reference
   *  implementation's datetime.date.today(). */
  today?: string;
}

/** Literal bot/automation publisher list from SKILL.md Check 2. Kept exact
 *  on purpose: a regex generalization was measured against it across 98
 *  packages and scored identically, so it is complexity with no benefit. */
export const NPM_BOT_PUBLISHERS: ReadonlySet<string> = new Set([
  "GitHub Actions",
  "semantic-release-bot",
  "npm",
  "types",
  "oss-bot",
  "npm-cli-ops",
  "react-bot",
  "renovate-bot",
]);

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";
const NPM_REGISTRY_BASE = "https://registry.npmjs.org";

const OSV_ECOSYSTEMS: readonly OsvEcosystem[] = ["npm", "PyPI", "Go", "crates.io"];

function assertValidTarget(target: SecurityTarget): void {
  if (!target || typeof target !== "object") {
    throw new Error("gatherSecurityEvidence: target must be an object");
  }
  if (typeof target.name !== "string" || target.name === "") {
    throw new Error("gatherSecurityEvidence: target.name must be a non-empty string");
  }
  if (!OSV_ECOSYSTEMS.includes(target.ecosystem)) {
    throw new Error(
      `gatherSecurityEvidence: target.ecosystem must be one of ${OSV_ECOSYSTEMS.join(", ")}, got ${JSON.stringify(target.ecosystem)}`
    );
  }
  if (typeof target.version !== "string" || target.version === "") {
    throw new Error("gatherSecurityEvidence: target.version must be a non-empty string");
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  doFetch: typeof fetch
): Promise<unknown> {
  try {
    const response = await doFetch(url, init);
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * OSV.dev query response -> deduplicated OsvAdvisory[]. Pure.
 *
 * Severity is `vulns[].database_specific.severity`, case-normalized, with
 * anything missing or unrecognized mapped to UNKNOWN (never guessed).
 * `hasFix` is true iff any affected[].ranges[].events[] carries a `fixed`
 * event. Malformed individual vuln records are skipped; the envelope shape
 * itself (no vulns array) yields [] — an empty result from a reachable API
 * genuinely means "no advisories".
 *
 * Dedupe (SKILL.md's PyPI trap): PyPI returns PYSEC-* records with
 * `severity: UNKNOWN` duplicating the GHSA-* record for the same flaw, so
 * records sharing any id/alias are clustered (transitively — A~B, B~C is
 * one flaw) and collapsed to a single advisory. The representative carries
 * the cluster's rescued severity: prefer members that know their severity,
 * preferring the GHSA twin among them, tie-broken lexicographically by id
 * so the choice is deterministic. Cluster aliases merge every member's ids
 * and aliases; hasFix is the disjunction.
 */
interface ParsedOsvVuln {
  id: string;
  aliases: string[];
  severity: AdvisorySeverity;
  hasFix: boolean;
  summary?: string;
}

export function normalizeOsvQueryResponse(payload: unknown): OsvAdvisory[] {
  const vulns =
    payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).vulns)
      ? ((payload as Record<string, unknown>).vulns as unknown[])
      : [];

  const parsed: ParsedOsvVuln[] = [];
  for (const vuln of vulns) {
    if (!vuln || typeof vuln !== "object") continue;
    const v = vuln as Record<string, unknown>;
    if (typeof v.id !== "string" || v.id === "") continue;
    parsed.push({
      id: v.id,
      aliases: Array.isArray(v.aliases)
        ? v.aliases.filter((alias): alias is string => typeof alias === "string")
        : [],
      severity: normalizeSeverity(
        v.database_specific && typeof v.database_specific === "object"
          ? (v.database_specific as Record<string, unknown>).severity
          : undefined
      ),
      hasFix: vulnHasFix(v),
      ...(typeof v.summary === "string" && v.summary !== "" ? { summary: v.summary } : {}),
    });
  }

  // Union-find over {id} ∪ aliases: shared identifiers mean same flaw.
  const parent = parsed.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const owner = new Map<string, number>();
  for (const [i, item] of parsed.entries()) {
    for (const key of [item.id, ...item.aliases]) {
      const prev = owner.get(key);
      if (prev === undefined) owner.set(key, i);
      else union(prev, i);
    }
  }

  const clusters = new Map<number, ParsedOsvVuln[]>();
  for (const [i, item] of parsed.entries()) {
    const root = find(i);
    const cluster = clusters.get(root);
    if (cluster) cluster.push(item);
    else clusters.set(root, [item]);
  }

  const merged: OsvAdvisory[] = [];
  for (const members of clusters.values()) {
    merged.push(mergeCluster(members));
  }
  return merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function normalizeSeverity(raw: unknown): AdvisorySeverity {
  const upper = typeof raw === "string" ? raw.toUpperCase() : "";
  return upper === "CRITICAL" ||
    upper === "HIGH" ||
    upper === "MODERATE" ||
    upper === "LOW"
    ? upper
    : "UNKNOWN";
}

function vulnHasFix(vuln: Record<string, unknown>): boolean {
  const affected = vuln.affected;
  if (!Array.isArray(affected)) return false;
  for (const entry of affected) {
    const ranges =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).ranges
        : undefined;
    if (!Array.isArray(ranges)) continue;
    for (const range of ranges) {
      const events =
        range && typeof range === "object"
          ? (range as Record<string, unknown>).events
          : undefined;
      if (!Array.isArray(events)) continue;
      if (
        events.some(
          (event) =>
            event !== null && typeof event === "object" && "fixed" in event
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function mergeCluster(members: ParsedOsvVuln[]): OsvAdvisory {
  const byId = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const informed = byId.filter((m) => m.severity !== "UNKNOWN");
  const pool = informed.length > 0 ? informed : byId;
  const representative =
    pool.find((m) => m.id.startsWith("GHSA-")) ?? pool[0];

  const keys = new Set<string>();
  for (const member of byId) {
    keys.add(member.id);
    for (const alias of member.aliases) keys.add(alias);
  }
  keys.delete(representative.id);

  const summary =
    representative.summary ?? byId.find((m) => m.summary)?.summary;

  return {
    id: representative.id,
    aliases: [...keys].sort(),
    severity: representative.severity,
    hasFix: byId.some((m) => m.hasFix),
    ...(summary ? { summary } : {}),
  };
}

type ParsedPublishHistoryEntry = {
  version: string;
  publisher: string;
  date: string;
  publishedAt: number;
};

/**
 * npm packument -> recent human-to-human publisher handoff, or null. Pure.
 * Faithful port of SKILL.md Check 2's reference script, whose four rules
 * make this a signal instead of noise:
 *
 *  - Versions sort by publish TIME, never packument key order — backport
 *    releases (4.x published after 5.x) break key order.
 *  - Bot and unknown publishers are dropped BEFORE detection (versions
 *    with no `_npmUser.name` are dropped, not treated as a publisher);
 *    a move to `GitHub Actions` is a CI migration, not a handoff.
 *  - A handoff requires the old guard to NEVER publish again once the
 *    newcomer arrives — any human-to-human change fires on express,
 *    lodash, and chalk, which rotate releases among an active team.
 *  - Only the most recent qualifying handoff survives, and only under
 *    12 months old (measured 51% of npm carries a stale handoff; 7% with
 *    the filter) — stale ones return null, never a record.
 *
 * Structurally invalid input throws loudly instead of reading as clean —
 * same policy as analyzeProject() with a malformed manifest: the registry
 * answered, so "unreachable" would be a lie and silence a false PASS.
 */
export function detectPublisherHandoff(
  packument: unknown,
  today: string
): PublisherHandoff | null {
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
      !Number.isFinite(Date.parse(today))) {
    throw new Error(
      `detectPublisherHandoff: today must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(today)}`
    );
  }
  if (!packument || typeof packument !== "object") {
    throw new Error("detectPublisherHandoff: packument must be an object");
  }
  const doc = packument as Record<string, unknown>;
  const versionsRecord = doc.versions as Record<string, unknown>;
  const timeMap = doc.time as Record<string, unknown>;
  if (!versionsRecord || typeof versionsRecord !== "object" || Array.isArray(versionsRecord) ||
      !timeMap || typeof timeMap !== "object" || Array.isArray(timeMap)) {
    throw new Error(
      "detectPublisherHandoff: packument is missing usable versions/time maps — is this actually an npm packument?"
    );
  }

  const history: ParsedPublishHistoryEntry[] = [];
  for (const [version, manifest] of Object.entries(versionsRecord)) {
    const publishedAt = timeMap[version];
    if (typeof publishedAt !== "string" || !Number.isFinite(Date.parse(publishedAt))) {
      continue; // SKILL.md filters to versions present in the time map
    }
    const publisher =
      manifest && typeof manifest === "object"
        ? (manifest as Record<string, unknown>)._npmUser
        : undefined;
    const name =
      publisher && typeof publisher === "object"
        ? (publisher as Record<string, unknown>).name
        : undefined;
    history.push({
      version,
      publisher: typeof name === "string" ? name : "",
      date: publishedAt.slice(0, 10),
      publishedAt: Date.parse(publishedAt),
    });
  }
  history.sort((a, b) => a.publishedAt - b.publishedAt);

  const humans = history.filter(
    (entry) => entry.publisher !== "" && !NPM_BOT_PUBLISHERS.has(entry.publisher)
  );

  const seen = new Set<string>();
  let lastHandoff: { prev: ParsedPublishHistoryEntry; newcomer: ParsedPublishHistoryEntry } | undefined;
  for (const [i, entry] of humans.entries()) {
    const oldGuardReturns = humans
      .slice(i)
      .some((later) => seen.has(later.publisher));
    if (seen.size > 0 && !seen.has(entry.publisher) && !oldGuardReturns) {
      lastHandoff = { prev: humans[i - 1], newcomer: entry };
    }
    seen.add(entry.publisher);
  }
  if (!lastHandoff) return null;

  const days =
    (Date.parse(today) - Date.parse(lastHandoff.newcomer.date)) / 86_400_000;
  const months = days / 30.44;
  if (!(months < 12)) return null; // stale handoffs are never reported

  return {
    from: lastHandoff.prev.publisher,
    to: lastHandoff.newcomer.publisher,
    version: lastHandoff.newcomer.version,
    date: lastHandoff.newcomer.date,
  };
}

function isoLocalDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Both Stage 1 checks for one package, as SecurityEvidence[] in canonical
 * order: [osv, publisher-continuity]. Transport-level failure (network
 * error, non-2xx, unparseable body) degrades that check to
 * `{ status: "unverified", reason: "unreachable" }` per SKILL.md — the
 * consumer must surface unverified records, never drop them. Publisher
 * continuity is npm-only; every other ecosystem yields
 * `reason: "unsupported-ecosystem"` so a Python candidate can never imply
 * it was checked.
 */
export async function gatherSecurityEvidence(
  target: SecurityTarget,
  options: GatherSecurityEvidenceOptions = {}
): Promise<SecurityEvidence[]> {
  assertValidTarget(target);
  const doFetch = options.fetchImpl ?? fetch;
  const today = options.today ?? isoLocalDate();

  const [osvEvidence, continuityEvidence] = await Promise.all([
    (async (): Promise<SecurityEvidence> => {
      const payload = await fetchJson(
        OSV_QUERY_URL,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            package: { name: target.name, ecosystem: target.ecosystem },
            version: target.version,
          }),
        },
        doFetch
      );
      if (payload === null) {
        return { source: "osv", status: "unverified", reason: "unreachable" };
      }
      return {
        source: "osv",
        status: "ok",
        queriedVersion: target.version,
        advisories: normalizeOsvQueryResponse(payload),
      };
    })(),
    (async (): Promise<SecurityEvidence> => {
      if (target.ecosystem !== "npm") {
        return {
          source: "publisher-continuity",
          status: "unverified",
          reason: "unsupported-ecosystem",
        };
      }
      const payload = await fetchJson(
        `${NPM_REGISTRY_BASE}/${encodeURIComponent(target.name)}`,
        { headers: { accept: "application/json" } },
        doFetch
      );
      if (payload === null) {
        return {
          source: "publisher-continuity",
          status: "unverified",
          reason: "unreachable",
        };
      }
      return {
        source: "publisher-continuity",
        status: "ok",
        handoff: detectPublisherHandoff(payload, today),
      };
    })(),
  ]);

  return [osvEvidence, continuityEvidence];
}
