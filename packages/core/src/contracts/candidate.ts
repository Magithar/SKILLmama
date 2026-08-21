/**
 * Search result representation (Phase 3 in skillmama/SKILL.md).
 * The shape is stable; the tier-ordering *logic* (e.g. "prefer Tier 1
 * over Tier 4 on a tie") is not captured here — that's still judgment
 * exercised by whatever produces a Candidate[], not this type.
 */
export type SearchTier =
  | "github"
  | "mcp"
  | "package-registry"
  | "curated-template";

export interface Candidate {
  name: string;
  tier: SearchTier;
  url: string;
  githubStars?: number;
  weeklyDownloads?: number;
  lastCommitDate?: string;
  /** Tier 1 tags this when the repo ships its own SKILL.md; Phase 5 must
   *  surface such libraries under Companion Skills even when Phase 3.6
   *  found nothing else. */
  hasOwnSkill?: boolean;
}

/**
 * Third-party reliability rating where one exists (terminalskills.io).
 * Deliberately a different vocabulary than the Phase 3.5 gate's GateVerdict:
 * these words are terminalskills.io's rating, an INPUT to the companion-skill
 * gate (SUSPICIOUS/MALICIOUS is an automatic discard there), never its output.
 */
export type CompanionSkillRating = "SAFE" | "SUSPICIOUS" | "MALICIOUS";

export interface CompanionSkill {
  name: string;
  url: string;
  pairsWith: string;
  /** Optional on purpose: skillsmp.com matches carry no rating (auto-indexed,
   *  unvetted) — SKILL.md treats them as pointers to go verify the underlying
   *  repo directly, not as trust signals. */
  rating?: CompanionSkillRating;
}
