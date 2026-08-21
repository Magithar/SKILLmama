import type { SearchTier } from "./candidate.js";

/**
 * Search pipeline contracts (Phase 2 + Phase 3 in skillmama/SKILL.md).
 *
 * The pipeline has three stages with three different honesty profiles:
 *
 *   Stage A — PLAN (reasoning): CapabilityRequest → SearchPlan. Deriving
 *   3-5 search terms that combine capability + stack is judgment; this
 *   type is only its structured handoff.
 *
 *   Stage B — EXECUTE (tool-backed): run each tier's WebSearch recipes.
 *   SKILL.md's recipes are data ("site:github.com [search_term]
 *   stars:>500"), but executing them needs a web-search tool, and judging
 *   which raw hits name real candidates is reasoning. TierResult pins what
 *   this stage must report regardless of who executes it.
 *
 *   Stage C — NORMALIZE (mechanical): hits → Candidate[] with tier
 *   provenance, deduplicated across tiers by URL/name. Genuinely
 *   deterministic once Stage B has judged which hits count.
 */

/**
 * Phase 2 output — the reasoning layer's structured handoff to search.
 * Constraints ride along verbatim: applying them (e.g. "open-source only")
 * is filtering judgment exercised during Stage B/C, not a field format.
 */
export interface SearchPlan {
  capability: string;
  /** 3-5 terms combining capability + stack, e.g.
   *  ["qdrant python", "pgvector fastapi", "chroma vector db"]. */
  searchTerms: string[];
  constraints?: string[];
}

/** One search result as the tool returned it — opaque on purpose. */
export interface RawHit {
  url: string;
  title?: string;
  snippet?: string;
}

/**
 * One tier's execution report. Whatever executes the recipes (an agent's
 * WebSearch tool today, structured APIs someday) must be able to fill this
 * in — nothing in it requires judgment beyond the hit selection itself.
 */
export interface TierResult {
  tier: SearchTier;
  /** The exact queries executed, placeholders filled — provenance for
   *  "Sources searched" in Phase 5 output. */
  queriesRun: string[];
  hits: RawHit[];
  /** SKILL.md: stop a tier early only at 8+ strong candidates. */
  stoppedEarly?: boolean;
}
