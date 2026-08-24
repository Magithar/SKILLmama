import type { Candidate, CompanionSkill } from "./candidate.js";
import type { CandidateScore } from "./scoring.js";
import type { SecurityCheckResult } from "./security.js";
import type { BandOutcome } from "./factors.js";

/**
 * End-to-end discovery result (Phases 2 through 5 in skillmama/SKILL.md).
 *
 * Until this existed, every phase was individually implemented and nothing
 * composed them: a caller had to know the order, remember to filter
 * BLOCKED candidates before scoring, remember that ALREADY PRESENT ones
 * are never scored at all, and remember that a factor with no verified
 * evidence must be "N/A". Those are exactly the invariants an agent
 * harness gets wrong, so discoverCapabilities() owns them and this type
 * is what it returns.
 *
 * The three lists are disjoint and together account for every candidate
 * the search produced. Nothing is silently dropped: a candidate that does
 * not appear in `ranked` appears in `blocked` or `alreadyPresent`, with
 * the reason attached.
 */
export interface DiscoveryEntry {
  candidate: Candidate;
  /** Phase 4 output. Its popularity/maintenance points are guaranteed to
   *  lie inside the bands below — see discoverCapabilities(). */
  score: CandidateScore;
  /** Phase 3.5 result. Always PASS or WARN here; BLOCKED never reaches
   *  `ranked`. A WARN entry still ranks — SKILL.md says summarize rather
   *  than discard — so its notes must be surfaced alongside the score. */
  security: SecurityCheckResult;
  /** The deterministic band the score's popularity point was picked from,
   *  kept so a reader can see the evidence, not just the number. */
  popularityBand: BandOutcome;
  maintenanceBand: BandOutcome;
  /** Phase 3.6 + 3.7 survivors for this candidate. Empty means "searched
   *  all four sources, nothing survived", never "skipped". */
  companionSkills: CompanionSkill[];
}

export interface DiscoveryResult {
  /** Sorted by totalScore descending. Candidates whose total is "N/A"
   *  sort last; ties break by search tier, then by name, so the ordering
   *  is total and reproducible. */
  ranked: DiscoveryEntry[];
  /** Phase 3.5 BLOCKED. Reported, never scored and never silently
   *  dropped — the user should know something was found and rejected. */
  blocked: SecurityCheckResult[];
  /** SKILL.md Phase 4's preamble: "Skip any candidate whose package name
   *  already appears in the Stack Profile's detected dependencies — mark
   *  it ALREADY PRESENT instead of scoring it." */
  alreadyPresent: Candidate[];
  /** Run-level notes: what was filtered and why, in a fixed order. */
  notes: string[];
}
