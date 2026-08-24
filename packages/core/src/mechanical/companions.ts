import type {
  CompanionSkill,
  CompanionSkillRating,
  CompanionSkillSource,
} from "../contracts/candidate.js";
import type { ContentFinding } from "../contracts/security.js";
import type { RawHit } from "../contracts/search.js";
import { urlDedupeKey } from "./search.js";

/**
 * Phase 3.6 + 3.7 mechanical support — the four fixed companion-skill
 * searches, hit normalization, and the 3.7 decision table.
 *
 * SKILL.md 3.6 is unusual among the phases: its queries are FIXED per
 * candidate (no planner involved), so building them is pure template
 * filling. Normalization is string/set logic like normalizeSearchHits().
 * The 3.7 gate is a decision table over inputs that already exist — the
 * terminalskills.io rating and the evaluator's weighted findings — so the
 * only genuinely non-mechanical work left in the whole phase is READING a
 * skill's content to produce those findings, which stays injected.
 *
 * REQUIRED-phase honesty (SKILL.md 3.6): an empty result means "all four
 * sources were searched, nothing found" — never "skipped". The
 * orchestration in ../reasoning/index.ts structurally guarantees all four
 * searches run; this module's query builder pins what "all four" means.
 */

/** Canonical source order = the recipe order in SKILL.md 3.6, which the
 *  contract union mirrors. Cross-source duplicates resolve to whichever
 *  source comes first here — deterministic, same policy as tiers. */
const SOURCE_ORDER: readonly CompanionSkillSource[] = [
  "skills-sh",
  "terminalskills-io",
  "skillsmp",
  "github-skill-md",
];

/**
 * The four fixed searches for one candidate, in canonical order.
 * Pure. Verbatim from SKILL.md Phase 3.6 — including the quoted
 * "SKILL.md" phrase on the GitHub recipe, which is load-bearing: without
 * quotes it finds repos ABOUT skills, not repos CONTAINING one.
 */
export function buildCompanionQueries(
  candidateName: string
): Array<{ source: CompanionSkillSource; query: string }> {
  if (typeof candidateName !== "string" || candidateName.trim() === "") {
    throw new Error("buildCompanionQueries: candidateName must be a non-empty string");
  }
  const name = candidateName.trim();
  return [
    { source: "skills-sh", query: `site:skills.sh ${name}` },
    { source: "terminalskills-io", query: `site:terminalskills.io/skills ${name}` },
    { source: "skillsmp", query: `site:skillsmp.com ${name}` },
    { source: "github-skill-md", query: `site:github.com "SKILL.md" ${name}` },
  ];
}

function parseUrlPath(url: string): { host: string; segments: string[] } | null {
  let rest = url.trim();
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  rest = rest.split(/[?#]/, 1)[0];
  rest = rest.replace(/^www\./i, "").replace(/\/+$/, "");
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const host = rest.slice(0, slash).toLowerCase();
  if (host === "" || !host.includes(".")) return null;
  const segments = rest
    .slice(slash + 1)
    .split("/")
    .filter((segment) => segment !== "");
  return { host, segments };
}

/** Same GitHub namespace blocklist as search.ts — product pages are not
 *  skill homes either. Kept as a literal here rather than imported because
 *  search.ts's list guards candidate derivation; if they ever drift apart
 *  deliberately, each documents its own policy. */
const GITHUB_SITE_NAMESPACES = new Set([
  "topics",
  "features",
  "marketplace",
  "trending",
  "collections",
  "explore",
  "orgs",
  "sponsors",
  "security",
]);

/**
 * Derive the skill's display handle from where it was found. Pure.
 *  - github.com/{owner}/{repo} → repo name (the repo IS the skill home)
 *  - directory slugs → last meaningful path segment
 *    (terminalskills.io/skills/{slug}, skillsmp.com/{...}, skills.sh/{...})
 *  - anything else → the hit's own title; no title → drop, never guess.
 */
function deriveSkillName(source: CompanionSkillSource, hit: RawHit): string | null {
  const parsed = parseUrlPath(hit.url);
  if (parsed) {
    const { host, segments } = parsed;
    if (
      host === "github.com" &&
      segments.length >= 2 &&
      !GITHUB_SITE_NAMESPACES.has(segments[0])
    ) {
      const repo = segments[1].replace(/\.git$/, "");
      if (repo !== "") return repo;
      return null;
    }
    if (host.endsWith("terminalskills.io")) {
      const idx = segments.indexOf("skills");
      const slug = segments[idx + 1] ?? segments[segments.length - 1];
      if (slug) return decodeURIComponent(slug);
    }
    if (host.endsWith("skillsmp.com") || host.endsWith("skills.sh")) {
      const slug = segments[segments.length - 1];
      if (slug) return decodeURIComponent(slug);
    }
  }
  const title = typeof hit.title === "string" ? hit.title.trim() : "";
  return title !== "" ? title : null;
}

const RATING_WORDS: Array<{ word: CompanionSkillRating; rank: number }> = [
  { word: "SAFE", rank: 1 },
  { word: "SUSPICIOUS", rank: 2 },
  { word: "MALICIOUS", rank: 3 },
];

/**
 * Extract terminalskills.io's reliability rating from the hit text.
 * Pure. Only terminalskills-io provides ratings (contract: rating is
 * metadata a source MAY provide), so this runs for that source alone.
 * Worst-wins when several words appear — under-reporting danger reads as
 * safety, the opposite of this package's bias everywhere else.
 */
export function extractCompanionRating(
  title?: string,
  snippet?: string
): CompanionSkillRating | undefined {
  const haystack = `${title ?? ""} ${snippet ?? ""}`;
  let best: { word: CompanionSkillRating; rank: number } | undefined;
  for (const entry of RATING_WORDS) {
    if (new RegExp(`\\b${entry.word}\\b`, "i").test(haystack)) {
      if (!best || entry.rank > best.rank) best = entry;
    }
  }
  return best?.word;
}

function assertValidFindings(findings: ContentFinding[]): void {
  // Keep in sync with assertValidFindings in security.ts (same shape, same
  // loud-throw policy); left duplicated so security.ts need not widen its
  // public surface for this module.
  const WEIGHTS = ["DISCARD", "WARN", "FLAG"];
  if (!Array.isArray(findings)) {
    throw new Error("resolveCompanionGate: findings must be an array");
  }
  for (const [i, finding] of findings.entries()) {
    if (!finding || typeof finding !== "object") {
      throw new Error(`resolveCompanionGate: findings[${i}] must be an object`);
    }
    if (!WEIGHTS.includes(finding.weight)) {
      throw new Error(
        `resolveCompanionGate: findings[${i}].weight must be one of ${WEIGHTS.join(", ")}, got ${JSON.stringify(finding.weight)}`
      );
    }
    if (typeof finding.rule !== "string" || finding.rule === "") {
      throw new Error(`resolveCompanionGate: findings[${i}].rule must be a non-empty string`);
    }
    if (typeof finding.detail !== "string" || finding.detail === "") {
      throw new Error(`resolveCompanionGate: findings[${i}].detail must be a non-empty string`);
    }
  }
}

export interface CompanionGateMapping {
  /** PASS / WARN / BLOCKED — same vocabulary as the Phase 3.5 library
   *  gate; BLOCKED skills are filtered out by findCompanionSkills() and
   *  never surface in output ("discarded skills never surface"). */
  verdict: "PASS" | "WARN" | "BLOCKED";
  notes: string[];
  sqpFlags: string[];
}

/**
 * Phase 3.7 — the skill-gate decision table over already-produced inputs.
 * Pure. Rules, all verbatim in effect from SKILL.md 3.6 + 3.7:
 *
 *  - SUSPICIOUS or MALICIOUS terminalskills.io rating → automatic DISCARD,
 *    regardless of findings ("treat ... as an automatic Phase 3.7 DISCARD").
 *  - Any DISCARD-weight finding → DISCARD. DISCARD wins outright over WARN
 *    and FLAG — never softened because lesser rules also matched.
 *  - WARN-weight findings → WARN (independent of FLAG).
 *  - FLAG findings → sqpFlags, reported but never verdict-changing.
 *
 * Note order is fixed (rating, DISCARD, WARN, FLAG) so identical inputs
 * give byte-identical output.
 */
export function resolveCompanionGate(
  rating: CompanionSkillRating | undefined,
  findings: ContentFinding[]
): CompanionGateMapping {
  if (
    rating !== undefined &&
    rating !== "SAFE" &&
    rating !== "SUSPICIOUS" &&
    rating !== "MALICIOUS"
  ) {
    throw new Error(
      `resolveCompanionGate: rating must be SAFE, SUSPICIOUS, MALICIOUS, or undefined, got ${JSON.stringify(rating)}`
    );
  }
  assertValidFindings(findings);

  const discardFindings = findings.filter((f) => f.weight === "DISCARD");
  const warnFindings = findings.filter((f) => f.weight === "WARN");
  const flagFindings = findings.filter((f) => f.weight === "FLAG");

  const notes: string[] = [];
  if (rating === "SUSPICIOUS" || rating === "MALICIOUS") {
    notes.push(`terminalskills.io rating: ${rating} — automatic discard`);
  }
  for (const finding of discardFindings) notes.push(`${finding.rule}: ${finding.detail}`);
  for (const finding of warnFindings) notes.push(`${finding.rule}: ${finding.detail}`);
  for (const finding of flagFindings) notes.push(`${finding.rule}: ${finding.detail}`);

  const blocked =
    rating === "SUSPICIOUS" ||
    rating === "MALICIOUS" ||
    discardFindings.length > 0;

  return {
    verdict: blocked ? "BLOCKED" : warnFindings.length > 0 ? "WARN" : "PASS",
    notes,
    sqpFlags: [...new Set(flagFindings.map((f) => f.rule))],
  };
}

function assertValidHits(hits: RawHit[], label: string): void {
  if (!Array.isArray(hits)) {
    throw new Error(`${label}: hits must be an array`);
  }
  for (const [j, hit] of hits.entries()) {
    if (!hit || typeof hit !== "object" || typeof hit.url !== "string" || hit.url === "") {
      throw new Error(`${label}: hits[${j}].url must be a non-empty string`);
    }
  }
}

/**
 * One source's raw hits -> deduplicated-within-source CompanionSkill[].
 * Pure. pairsWith is always the searched candidate's name — provenance of
 * why this skill surfaced at all. Rating carried only for
 * terminalskills-io, extracted worst-wins from title/snippet; absence
 * never implies vetting either way (contract rule).
 */
export function normalizeCompanionHits(
  source: CompanionSkillSource,
  hits: RawHit[],
  pairsWith: string
): CompanionSkill[] {
  assertValidHits(hits, `normalizeCompanionHits(${source})`);
  if (typeof pairsWith !== "string" || pairsWith.trim() === "") {
    throw new Error("normalizeCompanionHits: pairsWith must be a non-empty string");
  }

  const seenNames = new Set<string>();
  const seenUrls = new Set<string>();
  const skills: CompanionSkill[] = [];

  for (const hit of hits) {
    const name = deriveSkillName(source, hit);
    if (!name) continue;
    const uKey = urlDedupeKey(hit.url);
    if (uKey && seenUrls.has(uKey)) continue;
    const nKey = name.toLowerCase();
    if (seenNames.has(nKey)) continue;

    if (uKey) seenUrls.add(uKey);
    seenNames.add(nKey);
    const rating =
      source === "terminalskills-io"
        ? extractCompanionRating(hit.title, hit.snippet)
        : undefined;
    skills.push({
      name,
      url: hit.url.trim(),
      pairsWith,
      source,
      ...(rating ? { rating } : {}),
    });
  }
  return skills;
}
