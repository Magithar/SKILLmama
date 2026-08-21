import type { Candidate } from "./candidate.js";

/**
 * Deterministic formula (Phase 4 in skillmama/SKILL.md):
 *   total = compatibility*0.40 + popularity*0.30 + maintenance*0.15 + simplicity*0.15
 * The arithmetic is the easy, genuinely deterministic part. Producing the
 * four input factors still requires verified data (GitHub API, npm
 * downloads, .env.example checks) that this type does not represent.
 */
export interface CandidateScore {
  candidate: Candidate;
  compatibility: number | "N/A";
  popularity: number | "N/A";
  maintenance: number | "N/A";
  simplicity: number | "N/A";
  totalScore: number | "N/A";
  notes?: string[];
}
