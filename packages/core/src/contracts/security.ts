import type { Candidate } from "./candidate.js";

/**
 * Security/quality gate (Phase 3.5 / 3.7 in skillmama/SKILL.md).
 * This type is the one to be most suspicious of: SKILL.md's gate is
 * LLM reasoning over unstructured signals, not a documented checklist
 * that reduces to a function. This shape doesn't imply the verdict can
 * be computed deterministically — only that, however it's produced, it
 * comes back in this form.
 */
export type SecurityVerdict = "SAFE" | "SUSPICIOUS" | "MALICIOUS" | "BLOCKED";

export interface SecurityCheckResult {
  candidate: Candidate;
  verdict: SecurityVerdict;
  notes?: string[];
}
