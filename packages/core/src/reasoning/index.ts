import type { CapabilityRequest } from "../contracts/project.js";
import type { Candidate, CompanionSkill } from "../contracts/candidate.js";import type {
  ContentFinding,
  SecurityCheckResult,
  SecurityEvidence,
} from "../contracts/security.js";
import { NotImplementedError } from "../errors.js";

/**
 * Functions in this file wrap web search plus LLM/tool-backed judgment
 * (Phase 3, 3.5/3.7, 3.6 in skillmama/SKILL.md). Giving them a typed
 * signature does NOT mean they can be implemented as pure deterministic
 * code — they will likely stay backed by an LLM call, a web search, or
 * both. Kept separate from mechanical/ so that assumption is never lost.
 */

/**
 * Phase 2 + 3 — search Tiers 1-4 for candidates matching a request.
 *
 * Orchestrates the three-stage pipeline defined in contracts/search.ts:
 *   A. Plan (reasoning): request → SearchPlan (3-5 terms, constraints).
 *   B. Execute (tool-backed): run each tier's WebSearch recipes →
 *      TierResult[]. Needs a web-search tool; cannot be honest as a
 *      plain HTTP client while SKILL.md's tiers are WebSearch recipes.
 *   C. Normalize (mechanical): hits → Candidate[] with tier provenance,
 *      deduplicated across tiers by URL/name.
 *
 * Deliberately NOT implementable as pure deterministic code end-to-end:
 * stages A and B are judgment/tool work. An implementation that only
 * queries npm and skips Tiers 1/2/4 is not a partial implementation —
 * it is a different, wrong behavior.
 */
export function findCandidates(
  _request: CapabilityRequest
): Promise<Candidate[]> {
  throw new NotImplementedError("findCandidates");
}

/**
 * Phase 3.5 — security & quality gate for library/tool candidates.
 *
 * Consumes, rather than produces, the deterministic inputs: evidence from
 * live-data checks (OSV advisories, publisher continuity — see
 * contracts/security.ts) and content findings only an LLM reading the
 * candidate's docs/code can produce. The verdict it returns must respect
 * SKILL.md's precedence: DISCARD beats WARN and FLAG outright; WARN and
 * FLAG are independent and both reportable.
 */
export function verifyCandidate(
  _candidate: Candidate,
  _evidence: SecurityEvidence[],
  _findings: ContentFinding[]
): Promise<SecurityCheckResult> {
  throw new NotImplementedError("verifyCandidate");
}

/** Phase 3.6 / 3.7 — companion skill search + its own security gate. */
export function findCompanionSkills(
  _candidate: Candidate
): Promise<CompanionSkill[]> {
  throw new NotImplementedError("findCompanionSkills");
}
