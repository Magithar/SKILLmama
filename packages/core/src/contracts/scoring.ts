import type { Candidate } from "./candidate.js";

/**
 * Deterministic formula (Phase 4 in skillmama/SKILL.md):
 *   total = compatibility*0.40 + popularity*0.30 + maintenance*0.15 + simplicity*0.15
 *
 * IMPLEMENTED as pure arithmetic in mechanical/scoreCandidate(). The honest
 * boundary: this function consumes four factors already scored 1-10 and
 * computes the weighted total — nothing more. Producing the factors is NOT
 * deterministic and stays outside this package:
 *   - Compatibility / Simplicity are LLM judgment over verified local
 *     evidence (SKILL.md Phase 4's verification rules).
 *   - Popularity / Maintenance band-mapping starts from live GitHub/npm data,
 *     but SKILL.md defines bands (e.g. "7-9"), not points — picking the point
 *     within a band is still judgment.
 */
export interface ScoringFactors {
  /** Fit to detected stack, scored per SKILL.md Phase 4 Compatibility bands. */
  compatibility: number | "N/A";
  /** From github_stars + weekly_downloads, per the Popularity bands. */
  popularity: number | "N/A";
  /** From a verified last-commit date, per the Maintenance bands. */
  maintenance: number | "N/A";
  /** From install command + setup effort, per the Simplicity bands. */
  simplicity: number | "N/A";
}

export interface CandidateScore extends ScoringFactors {
  candidate: Candidate;
  /**
   * Weighted total rounded to one decimal (SKILL.md Phase 5 renders X.X).
   * When some factors are "N/A", the remaining weights are renormalized
   * proportionally (SKILL.md: "weight the remaining factors proportionally").
   * When every factor is "N/A", there is no arithmetic to trust: totalScore
   * is "N/A" too.
   */
  totalScore: number | "N/A";
  /**
   * Present only when renormalization or full exclusion happened — one note
   * per excluded factor plus the effective weight coverage, so an N/A input
   * can never silently read as a fully-weighted score.
   */
  notes?: string[];
}
