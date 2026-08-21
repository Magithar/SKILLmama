import type { SecurityVerdict } from "./security.js";

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
}

export interface CompanionSkill {
  name: string;
  url: string;
  pairsWith: string;
  verdict: SecurityVerdict;
}
