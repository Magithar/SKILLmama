import type { CapabilityRequest } from "../contracts/project.js";
import type {
  Candidate,
  CompanionSkill,
  SearchTier,
} from "../contracts/candidate.js";
import type { ContentFinding } from "../contracts/security.js";
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
