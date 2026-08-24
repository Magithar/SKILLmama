import type { CapabilityRequest, StackProfile } from "../contracts/project.js";
import type {
  Candidate,
  CompanionSkill,
  SearchTier,
} from "../contracts/candidate.js";
import type {
  ContentFinding,
  SecurityCheckResult,
  SecurityEvidence,
} from "../contracts/security.js";
import type { ScoringFactors } from "../contracts/scoring.js";
import type { BandOutcome, FactorTarget } from "../contracts/factors.js";
import type {
  DiscoveryEntry,
  DiscoveryResult,
} from "../contracts/discovery.js";
import {
  gatherSecurityEvidence,
  verifyCandidate,
  type SecurityTarget,
} from "../mechanical/security.js";
import {
  gatherFactorEvidence,
  mapMaintenanceBand,
  mapPopularityBand,
} from "../mechanical/factors.js";
import { scoreCandidate } from "../mechanical/index.js";
import type { RawHit, SearchPlan, TierResult } from "../contracts/search.js";
import {
  assertValidCapabilityRequest,
  assertValidTierResults,
  buildTierQueries,
  normalizeSearchHits,
  searchTiers,
  urlDedupeKey,
} from "../mechanical/search.js";
import {
  buildCompanionQueries,
  normalizeCompanionHits,
  resolveCompanionGate,
} from "../mechanical/companions.js";

/**
 * Orchestration for the two tool-backed phases (Phase 2+3 and 3.6+3.7 in
 * skillmama/SKILL.md). These functions do not pretend to be deterministic
 * code — the reasoning (choosing search terms) and the tool work (running
 * web searches, judging which hits count, reading skill content) are
 * INJECTED by the caller. What this package owns instead are the
 * invariants an agent harness must never get wrong:
 *
 *   - every tier searched, in SKILL.md order, with mechanically generated
 *     queries (buildTierQueries) — silently skipping a tier is the named
 *     failure mode ("a different, wrong behavior");
 *   - Stage C normalization through the tested pure path
 *     (normalizeSearchHits / normalizeCompanionHits);
 *   - the Phase 3.7 gate applied to every companion skill, DISCARD
 *     winning outright, SUSPICIOUS/MALICIOUS ratings auto-discarding.
 */

/** The reasoning + tool layer findCandidates() needs from its caller. */
export interface FindCandidatesTooling {
  /** Stage A — plan: request → SearchPlan (3-5 terms combining capability
   *  + stack). Judgment; typically an LLM call. Validated on return:
   *  capability non-empty, exactly 3-5 non-empty terms. */
  plan(request: CapabilityRequest): SearchPlan | Promise<SearchPlan>;
  /** Stage B — execute: run one tier's queries with a web-search tool and
   *  judge which raw hits name real candidates. Receives `state` so the
   *  executor can honor SKILL.md's early-stop rule ("stop a tier early
   *  only if you already have 8+ strong candidates") — honoring it is the
   *  executor's judgment call; recording it is TierResult.stoppedEarly.
   *  `constraints` pass through verbatim; applying them is filtering
   *  judgment exercised here, not a field format. */
  executeTier(
    tier: SearchTier,
    queries: string[],
    state: { candidatesSoFar: number; constraints: string[] }
  ): TierResult | Promise<TierResult>;
}

/**
 * Phase 2 + 3 — search Tiers 1-4 for candidates matching a request.
 *
 * Orchestrates the three-stage pipeline defined in contracts/search.ts:
 *   A. Plan (injected reasoning): request → SearchPlan.
 *   B. Execute (injected tooling): each tier's queries run in canonical
 *      order via executeTier(); every tier executes — there is no
 *      orchestrator-level early stop across tiers, because SKILL.md's
 *      early-stop rule lives WITHIN a tier's query list.
 *   C. Normalize (implemented): all four TierResults → deduplicated
 *      Candidate[] via normalizeSearchHits().
 *
 * Throws loudly when the plan or any tier result violates its contract —
 * missing or malformed stage output must never read as "fewer results".
 */
export async function findCandidates(
  request: CapabilityRequest,
  tooling: FindCandidatesTooling
): Promise<Candidate[]> {
  assertValidCapabilityRequest(request);
  if (!tooling || typeof tooling !== "object" ||
      typeof tooling.plan !== "function" || typeof tooling.executeTier !== "function") {
    throw new Error("findCandidates: tooling with plan() and executeTier() is required");
  }

  const plan = await tooling.plan(request);
  if (!plan || typeof plan !== "object") {
    throw new Error("findCandidates: plan must be an object (SearchPlan)");
  }
  const constraints = Array.isArray(plan.constraints)
    ? plan.constraints.filter((c): c is string => typeof c === "string")
    : [];

  const queriesByTier = buildTierQueries(plan, request.stack);
  const tierResults: TierResult[] = [];
  let candidatesSoFar = 0;
  for (const tier of searchTiers) {
    const result = await tooling.executeTier(tier, queriesByTier[tier], {
      candidatesSoFar,
      constraints,
    });
    tierResults.push(result);
    // Cheap structural check per tier so a broken executor surfaces at its
    // own tier, not as a confusing aggregate error after the loop.
    assertValidTierResults([result]);
    candidatesSoFar = normalizeSearchHits(tierResults).length;
  }

  return normalizeSearchHits(tierResults);
}

/** The tool + judgment layer findCompanionSkills() needs from its caller. */
export interface CompanionSkillTooling {
  /** Execute one fixed WebSearch recipe. Whatever comes back counts as a
   *  hit — judged hit-selection happens upstream of this boundary. */
  search(query: string): RawHit[] | Promise<RawHit[]>;
  /** Phase 3.7 judgment: read a skill's actual content and produce
   *  weighted findings. Typically an LLM call. The decision table over
   *  these findings (plus the terminalskills.io rating) stays mechanical
   *  in resolveCompanionGate(). */
  evaluate(skill: CompanionSkill): ContentFinding[] | Promise<ContentFinding[]>;
}

/**
 * Phase 3.6 (+ 3.7) — companion skills for a candidate.
 *
 * A. Run the four FIXED searches (no planner exists in this phase):
 *    site:skills.sh, site:terminalskills.io/skills, site:skillsmp.com,
 *    site:github.com "SKILL.md" — built by buildCompanionQueries(),
 *    executed via tooling.search(), normalized per source by
 *    normalizeCompanionHits(), deduplicated across sources resolving to
 *    the earlier source (SKILL.md recipe order).
 * B. Gate EVERY found skill through resolveCompanionGate(): the
 *    evaluator's weighted findings plus the terminalskills.io rating.
 *    BLOCKED skills are dropped entirely — discarded skills never surface
 *    in output. Survivors carry notes/sqpFlags only when the gate fired.
 *
 * REQUIRED phase per SKILL.md — all four sources are always searched; an
 * empty return means "searched everything, nothing survived", never
 * "skipped". Silently omitting the phase is the named failure mode.
 */
export async function findCompanionSkills(
  candidate: Candidate,
  tooling: CompanionSkillTooling
): Promise<CompanionSkill[]> {
  if (!candidate || typeof candidate !== "object" ||
      typeof candidate.name !== "string" || candidate.name.trim() === "") {
    throw new Error("findCompanionSkills: candidate.name must be a non-empty string");
  }
  if (!tooling || typeof tooling !== "object" ||
      typeof tooling.search !== "function" || typeof tooling.evaluate !== "function") {
    throw new Error("findCompanionSkills: tooling with search() and evaluate() is required");
  }

  const queries = buildCompanionQueries(candidate.name);
  const found: CompanionSkill[] = [];
  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();
  for (const { source, query } of queries) {
    const hits = await tooling.search(query);
    for (const skill of normalizeCompanionHits(source, hits, candidate.name)) {
      // Cross-source dedupe: same policy as Stage C tiers — the canonical
      // recipe order decides which provenance survives.
      const uKey = urlDedupeKey(skill.url);
      if (uKey && seenUrls.has(uKey)) continue;
      const nKey = skill.name.toLowerCase();
      if (seenNames.has(nKey)) continue;
      if (uKey) seenUrls.add(uKey);
      seenNames.add(nKey);
      found.push(skill);
    }
  }

  const survivors: CompanionSkill[] = [];
  for (const skill of found) {
    const findings = await tooling.evaluate(skill);
    const gate = resolveCompanionGate(skill.rating, findings);
    if (gate.verdict === "BLOCKED") continue;
    survivors.push({
      ...skill,
      ...(gate.notes.length > 0 ? { notes: gate.notes } : {}),
      ...(gate.sqpFlags.length > 0 ? { sqpFlags: gate.sqpFlags } : {}),
    });
  }
  return survivors;
}

/**
 * The judgment discoverCapabilities() needs on top of the two phase-level
 * toolings. Each method is a place where SKILL.md asks for a reading of
 * something — docs, code, fit — that no HTTP call can supply.
 */
export interface DiscoveryTooling
  extends FindCandidatesTooling,
    CompanionSkillTooling {
  /**
   * Map a candidate onto the identifiers the deterministic checks need:
   * which package in which ecosystem at which version (Phase 3.5), and
   * which GitHub repo / npm package to read popularity and maintenance
   * off (Phase 4).
   *
   * `security` may be omitted for a candidate that is not a package at
   * all (a Tier 4 curated template). When it is, no OSV query runs and
   * the security verdict rests on content findings alone — which is
   * honest, and recorded as such rather than reported as a clean pass.
   *
   * SKILL.md's OSV trap lives here: `security.version` must be the
   * version you intend to RECOMMEND, not "latest". Resolving that is the
   * caller's call because the recommendation is.
   */
  resolve(candidate: Candidate): DiscoveryTargets | Promise<DiscoveryTargets>;
  /**
   * Phase 3.5 content findings for a library: read its docs and code and
   * report guardrail circumvention, undisclosed exfiltration, SQP rules.
   * Return [] when nothing was found — the decision table treats that as
   * "read it, found nothing", so returning [] without reading is the one
   * way to make this pipeline lie.
   */
  inspect(candidate: Candidate): ContentFinding[] | Promise<ContentFinding[]>;
  /**
   * Phase 4 scoring judgment. Compatibility and Simplicity are produced
   * from scratch here — SKILL.md's bands for them are written in terms
   * only a reader of the docs can assess. Popularity and Maintenance are
   * NOT: their bands are already fixed by verified evidence and handed to
   * you in `popularityBand`/`maintenanceBand`. Your job for those two is
   * only to pick a point inside the band.
   *
   * That restriction is enforced, not requested: a point outside its band
   * throws, and a factor whose band is `unbanded` must be "N/A".
   */
  judgeFactors(input: FactorJudgmentInput): ScoringFactors | Promise<ScoringFactors>;
}

export interface DiscoveryTargets {
  /** Omit when the candidate is not a published package. */
  security?: SecurityTarget;
  factors: FactorTarget;
}

export interface FactorJudgmentInput {
  candidate: Candidate;
  /** The stack the request was made against, for Compatibility. */
  stack?: StackProfile;
  /** Phase 3.5's outcome — a WARN here is context Compatibility should
   *  reflect (SKILL.md: recommend the fixed version, note the handoff). */
  security: SecurityCheckResult;
  popularityBand: BandOutcome;
  maintenanceBand: BandOutcome;
}

export interface DiscoverCapabilitiesOptions {
  /** Forwarded to gatherSecurityEvidence()/gatherFactorEvidence(). */
  fetchImpl?: typeof fetch;
  githubToken?: string;
  /** ISO date anchoring the publisher-handoff recency window and the
   *  maintenance age calculation. Explicit input rather than hidden clock
   *  state, so a run is reproducible. */
  today?: string;
  /** Skip Phase 3.6/3.7 entirely. Off by default: SKILL.md marks the
   *  companion search REQUIRED, and an empty list must mean "searched,
   *  found nothing". Set this only when the caller genuinely has no
   *  search tool, and the omission is recorded in `notes`. */
  skipCompanionSkills?: boolean;
}

/** PEP 503-ish key used only to compare a candidate name against the
 *  StackProfile's dependency evidence. Deliberately the same shape as
 *  analyzeProject()'s detector fallback: "psycopg2_binary" and
 *  "psycopg2-binary" are the same package to a reader, so they must be
 *  the same package to ALREADY PRESENT detection. */
function dependencyKey(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, "-");
}

function isAlreadyPresent(candidate: Candidate, stack?: StackProfile): boolean {
  if (!stack || !stack.matchedDependencies) return false;
  const key = dependencyKey(candidate.name);
  if (key === "") return false;
  for (const [canonical, rawNames] of Object.entries(stack.matchedDependencies)) {
    if (dependencyKey(canonical) === key) return true;
    for (const raw of rawNames) {
      if (dependencyKey(raw) === key) return true;
    }
  }
  return false;
}

/**
 * Enforce the one rule that makes the deterministic factor work worth
 * having: an injected judge may pick a point INSIDE a band, and nothing
 * else. Popularity 10 on a candidate whose verified evidence says 4-6 is
 * the exact failure this package exists to prevent, so it throws rather
 * than scoring.
 */
function assertFactorRespectsBand(
  factor: "popularity" | "maintenance",
  value: number | "N/A",
  outcome: BandOutcome,
  candidateName: string
): void {
  if (outcome.status === "unbanded") {
    if (value !== "N/A") {
      throw new Error(
        `discoverCapabilities: ${candidateName}: ${factor} has no verified band (${outcome.reason}), so the judged factor must be "N/A", got ${JSON.stringify(value)}`
      );
    }
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `discoverCapabilities: ${candidateName}: ${factor} band ${outcome.band.low}-${outcome.band.high} was verified, so the judged factor must be a number in that band, got ${JSON.stringify(value)}`
    );
  }
  if (value < outcome.band.low || value > outcome.band.high) {
    throw new Error(
      `discoverCapabilities: ${candidateName}: judged ${factor} ${value} is outside its verified band ${outcome.band.low}-${outcome.band.high}. The band comes from live evidence; only the point inside it is judgment.`
    );
  }
}

/**
 * Phases 2-5, composed.
 *
 * Every phase in this package was individually implemented and none of
 * them composed. This is the function that runs them in SKILL.md's order
 * and owns the sequencing rules a caller would otherwise have to
 * remember — which are precisely the ones SKILL.md states as
 * prohibitions, because they are the ones that get forgotten:
 *
 *   1. Search all four tiers (findCandidates, injected Stage A/B).
 *   2. Drop ALREADY PRESENT candidates BEFORE scoring, per Phase 4's
 *      preamble. They are reported, not scored — recommending something
 *      already installed is the failure being prevented.
 *   3. Gather security and factor evidence deterministically, in
 *      parallel per candidate.
 *   4. Apply the Phase 3.5 decision table. BLOCKED candidates never
 *      reach scoring and never rank, but they are RETURNED: the user
 *      should know something was found and rejected.
 *   5. Map the verified evidence onto SKILL.md's bands.
 *   6. Take judgment for the four factors, then verify the two banded
 *      ones were respected (see assertFactorRespectsBand) before any
 *      arithmetic runs.
 *   7. Score, run the required companion search, and rank with a total,
 *      reproducible order.
 *
 * Throws loudly at every boundary. A partially completed discovery that
 * reads as a complete one is the worst output this pipeline could
 * produce, so it is never produced.
 */
export async function discoverCapabilities(
  request: CapabilityRequest,
  tooling: DiscoveryTooling,
  options: DiscoverCapabilitiesOptions = {}
): Promise<DiscoveryResult> {
  assertValidCapabilityRequest(request);
  for (const method of ["plan", "executeTier", "resolve", "inspect", "judgeFactors"] as const) {
    if (!tooling || typeof tooling[method] !== "function") {
      throw new Error(
        `discoverCapabilities: tooling.${method}() is required — the pipeline never fakes an injected stage`
      );
    }
  }
  const wantCompanions = options.skipCompanionSkills !== true;
  if (wantCompanions &&
      (typeof tooling.search !== "function" || typeof tooling.evaluate !== "function")) {
    throw new Error(
      "discoverCapabilities: tooling.search() and tooling.evaluate() are required for the companion-skill phase (SKILL.md marks it REQUIRED); pass skipCompanionSkills: true to omit it deliberately"
    );
  }

  const notes: string[] = [];
  const candidates = await findCandidates(request, tooling);

  const alreadyPresent: Candidate[] = [];
  const inPlay: Candidate[] = [];
  for (const candidate of candidates) {
    if (isAlreadyPresent(candidate, request.stack)) alreadyPresent.push(candidate);
    else inPlay.push(candidate);
  }
  for (const candidate of alreadyPresent) {
    notes.push(`${candidate.name}: ALREADY PRESENT in the detected stack — not scored`);
  }

  const blocked: SecurityCheckResult[] = [];
  const entries: DiscoveryEntry[] = [];

  for (const candidate of inPlay) {
    const targets = await tooling.resolve(candidate);
    if (!targets || typeof targets !== "object" || !targets.factors) {
      throw new Error(
        `discoverCapabilities: tooling.resolve(${candidate.name}) must return { factors, security? }`
      );
    }

    const [securityEvidence, factorEvidence, findings] = await Promise.all([
      targets.security
        ? gatherSecurityEvidence(targets.security, {
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(options.today ? { today: options.today } : {}),
          })
        : Promise.resolve([
            { source: "osv", status: "unverified", reason: "unreachable" },
            {
              source: "publisher-continuity",
              status: "unverified",
              reason: "unsupported-ecosystem",
            },
          ] satisfies SecurityEvidence[]),
      gatherFactorEvidence(targets.factors, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.githubToken ? { githubToken: options.githubToken } : {}),
      }),
      tooling.inspect(candidate),
    ]);

    if (!targets.security) {
      notes.push(
        `${candidate.name}: not a published package — no OSV or publisher check ran, verdict rests on content findings`
      );
    }

    const security = verifyCandidate(candidate, securityEvidence, findings);
    if (security.verdict === "BLOCKED") {
      blocked.push(security);
      notes.push(`${candidate.name}: BLOCKED by the Phase 3.5 gate — not scored`);
      continue;
    }

    const popularityBand = mapPopularityBand(factorEvidence.popularity);
    const maintenanceBand = mapMaintenanceBand(
      factorEvidence.maintenance,
      options.today ?? isoToday()
    );

    const factors = await tooling.judgeFactors({
      candidate,
      ...(request.stack ? { stack: request.stack } : {}),
      security,
      popularityBand,
      maintenanceBand,
    });
    if (!factors || typeof factors !== "object") {
      throw new Error(
        `discoverCapabilities: tooling.judgeFactors(${candidate.name}) must return ScoringFactors`
      );
    }
    assertFactorRespectsBand("popularity", factors.popularity, popularityBand, candidate.name);
    assertFactorRespectsBand("maintenance", factors.maintenance, maintenanceBand, candidate.name);

    const companionSkills = wantCompanions
      ? await findCompanionSkills(candidate, tooling)
      : [];

    entries.push({
      candidate,
      score: scoreCandidate(candidate, factors),
      security,
      popularityBand,
      maintenanceBand,
      companionSkills,
    });
  }

  if (!wantCompanions) {
    notes.push(
      "Companion-skill search (Phase 3.6/3.7) was skipped by request — an empty companionSkills list here means NOT SEARCHED, not 'nothing found'"
    );
  }

  const tierRank = new Map(searchTiers.map((tier, i) => [tier, i]));
  entries.sort((a, b) => {
    const aTotal = a.score.totalScore === "N/A" ? -Infinity : a.score.totalScore;
    const bTotal = b.score.totalScore === "N/A" ? -Infinity : b.score.totalScore;
    if (aTotal !== bTotal) return bTotal - aTotal;
    const aTier = tierRank.get(a.candidate.tier) ?? Number.MAX_SAFE_INTEGER;
    const bTier = tierRank.get(b.candidate.tier) ?? Number.MAX_SAFE_INTEGER;
    if (aTier !== bTier) return aTier - bTier;
    return a.candidate.name < b.candidate.name ? -1 : a.candidate.name > b.candidate.name ? 1 : 0;
  });

  return { ranked: entries, blocked, alreadyPresent, notes };
}

function isoToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
