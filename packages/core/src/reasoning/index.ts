import type { CapabilityRequest } from "../contracts/project.js";
import type { Candidate, CompanionSkill } from "../contracts/candidate.js";
import type {
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

/** Phase 3 — search Tiers 1-4 for candidates matching a request. */
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
