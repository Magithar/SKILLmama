import type { Candidate } from "./candidate.js";

/**
 * Security/quality gate data model (Phase 3.5 in skillmama/SKILL.md),
 * split so deterministic evidence gathering and LLM security judgment
 * never blur:
 *
 *   Stage 1 — EVIDENCE (deterministic, future code): live-data checks that
 *   produce SecurityEvidence records. Two exist in SKILL.md today: the
 *   OSV.dev advisory query and the npm publisher-continuity check. Both are
 *   plain HTTP APIs; neither involves judgment. Every record carries an
 *   explicit status — "unverified" records (registry unreachable, ecosystem
 *   unsupported) must be surfaced, never dropped, per SKILL.md: "Never let
 *   an unverified candidate read as having passed."
 *
 *   Stage 2 — JUDGMENT (LLM reasoning): consumes evidence plus content
 *   findings (guardrail circumvention, undisclosed exfiltration, SQP-1/2/3 —
 *   signals that only exist after reading docs/code) and emits the final
 *   SecurityCheckResult.
 *
 * Much of stage 2's rule mapping over stage-1 evidence is itself mechanical
 * (CRITICAL/HIGH with no fix → BLOCKED; with a fix → WARN; recent publisher
 * handoff → WARN). That mapping is implemented in
 * mechanical/security.ts as resolveSecurityVerdict() + verifyCandidate();
 * these types pin the shapes it consumes and returns.
 */

/**
 * The verdicts SKILL.md Phase 3.5 actually emits. Deliberately NOT the
 * SAFE/SUSPICIOUS/MALICIOUS vocabulary — those words are TerminalSkills.io's
 * third-party reliability rating (Phase 3.7 input), not this gate's output.
 */
export type GateVerdict = "PASS" | "WARN" | "BLOCKED";

/** Severity exactly as OSV reports it (`vulns[].database_specific.severity`),
 *  including UNKNOWN — the PyPI PYSEC-* trap SKILL.md warns about. */
export type AdvisorySeverity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

export interface OsvAdvisory {
  id: string;
  /** Cross-references used to dedupe (PYSEC-* twins of GHSA-* records);
   *  severity is read off the GHSA twin when the twin carries it. */
  aliases: string[];
  severity: AdvisorySeverity;
  /** Whether any affected[].ranges[].events[] carries a `fixed` event. */
  hasFix: boolean;
  summary?: string;
}

/** A human-to-human publish-rights change, under 12 months old. Stale
 *  handoffs are never reported (SKILL.md: measured 51% of npm without the
 *  recency filter, 7% with), so absence of a handoff here means none was
 *  recent enough to matter. */
export interface PublisherHandoff {
  from: string;
  to: string;
  version: string;
  /** ISO date (YYYY-MM-DD) of the newcomer's first publish. */
  date: string;
}

/**
 * One deterministically gathered fact-set about a candidate. The gatherer
 * owns the normalization traps SKILL.md documents (dedupe advisories on
 * aliases; query the version you intend to recommend, not the latest; drop
 * bot publishers before handoff detection).
 */
export type SecurityEvidence =
  | {
      source: "osv";
      status: "ok";
      /** The version that was queried — not necessarily the latest. */
      queriedVersion: string;
      advisories: OsvAdvisory[];
    }
  | { source: "osv"; status: "unverified"; reason: "unreachable" }
  | {
      source: "publisher-continuity";
      status: "ok";
      /** null = no recent handoff found (solo maintainer, team rotation,
       *  CI-published, or stale-only). npm has no notion of "check failed
       *  to find anything" distinct from a clean result. */
      handoff: PublisherHandoff | null;
    }
  | {
      source: "publisher-continuity";
      status: "unverified";
      reason: "unreachable" | "unsupported-ecosystem";
    };

/**
 * A content signal only an LLM reading the candidate's docs/code can
 * produce. `weight` is SKILL.md's own rule class; DISCARD beats WARN and
 * FLAG outright, WARN and FLAG are independent and both reportable.
 * `rule` stays an opaque identifier (e.g. "SQP-2") rather than a closed
 * union on purpose: SKILL.md rewords rules between releases and remains
 * the source of truth — this package must not force a migration every
 * time it does.
 */
export interface ContentFinding {
  weight: "DISCARD" | "WARN" | "FLAG";
  rule: string;
  detail: string;
}

export interface SecurityCheckResult {
  candidate: Candidate;
  verdict: GateVerdict;
  /** The evidence the verdict consumed — including unverified records. */
  evidence: SecurityEvidence[];
  /** FLAG-class findings, reported independently of the verdict. */
  sqpFlags?: string[];
  notes?: string[];
}
