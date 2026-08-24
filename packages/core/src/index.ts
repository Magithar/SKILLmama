/**
 * skillmama — package boundary only.
 *
 * skillmama/SKILL.md remains the sole source of truth for SKILLmama's
 * actual behavior. Implemented so far: analyzeProject(), scoreCandidate(),
 * gatherSecurityEvidence() (Phase 3.5 Stage 1), resolveSecurityVerdict() +
 * verifyCandidate() (Phase 3.5 Stage 2's decision table), and
 * normalizeSearchHits() (Phase 3 Stage C). findCandidates() and
 * findCompanionSkills() are implemented as orchestrations that REQUIRE
 * injected tooling: the reasoning (choosing search terms) and tool work
 * (running searches, judging hits, reading skill content) are supplied by
 * the caller, never faked. Called without tooling they reject loudly
 * rather than silently searching nothing. No pipeline function throws
 * NotImplementedError anymore; the class stays exported for API stability.
 *
 * Layout:
 *   contracts/  — shared types
 *   mechanical/ — functions where the underlying work is genuinely
 *                 deterministic (file parsing, arithmetic, plain-HTTP
 *                 evidence checks, fixed decision tables)
 *   reasoning/  — functions that wrap web search + LLM/tool judgment;
 *                 a typed signature does not make these deterministic
 */

export * from "./contracts/project.js";
export * from "./contracts/candidate.js";
export * from "./contracts/security.js";
export * from "./contracts/scoring.js";
export * from "./errors.js";

export * from "./mechanical/index.js";
export * from "./reasoning/index.js";
