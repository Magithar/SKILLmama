/**
 * skillmama — the package's public API boundary.
 *
 * SKILLmama is a capability discovery system. skillmama/SKILL.md is the
 * agent-native implementation and the specification. This package provides
 * a CLI and a programmatic runtime for the deterministic parts of that
 * system. The shared deterministic rules are checked against SKILL.md by
 * test/skill-conformance.test.js.
 *
 * What this file exports is the supported surface: the pipeline entry
 * points, the per-phase functions an adapter (CLI, MCP, Worker) needs to
 * compose, and the contract types those signatures reference. Everything
 * else — the detector and parser registries, the search/companion query
 * builders and hit normalizers, and the HTTP payload normalizers — is
 * internal. It is reachable from inside the package by relative import
 * (that is how test/ exercises it) but is NOT part of the published API:
 * package.json's "exports" maps "." only, so no consumer can deep-import
 * past this file.
 *
 * The export list is pinned by test/index.test.js. Widening it is a
 * deliberate API decision, not an accident of adding a function.
 *
 * Layout:
 *   contracts/  — shared types
 *   mechanical/ — functions where the underlying work is genuinely
 *                 deterministic (file parsing, arithmetic, plain-HTTP
 *                 evidence checks, fixed decision tables)
 *   reasoning/  — functions that wrap web search + LLM/tool judgment;
 *                 a typed signature does not make these deterministic
 *   cli/        — the `skillmama` binary; a consumer of the above, and
 *                 not exported from here
 */

// --- Contract types -------------------------------------------------------
// Types only (plus companionSkillSources, the provenance registry). These
// are what public signatures are written in terms of, so they are public.
export * from "./contracts/project.js";
export * from "./contracts/candidate.js";
export * from "./contracts/search.js";
export * from "./contracts/security.js";
export * from "./contracts/scoring.js";
export * from "./contracts/factors.js";
export * from "./contracts/discovery.js";
export { NotImplementedError } from "./errors.js";

// --- Phase 2: project analysis -------------------------------------------
export { analyzeProject } from "./mechanical/index.js";

// --- Phase 3: candidate search -------------------------------------------
// The orchestration only. The tier-query recipes and hit normalizers behind
// it are internal; SKILL.md, not this package, is where they are specified.
export {
  findCandidates,
  findCompanionSkills,
  discoverCapabilities,
  type FindCandidatesTooling,
  type CompanionSkillTooling,
  type DiscoveryTooling,
  type DiscoveryTargets,
  type FactorJudgmentInput,
  type DiscoverCapabilitiesOptions,
} from "./reasoning/index.js";

// --- Phase 3.5: security gate --------------------------------------------
// Stage 1 gathers evidence, Stage 2 resolves it. Both are public: the
// verdict resolver is unusable without a way to produce its input.
export {
  gatherSecurityEvidence,
  resolveSecurityVerdict,
  verifyCandidate,
  type OsvEcosystem,
  type SecurityTarget,
  type GatherSecurityEvidenceOptions,
  type GateMapping,
} from "./mechanical/security.js";

// --- Phase 4: scoring -----------------------------------------------------
// Evidence + band lookup are deterministic. Picking a point inside a
// returned band stays judgment and is the caller's job.
export { scoreCandidate } from "./mechanical/index.js";
export {
  gatherFactorEvidence,
  mapPopularityBand,
  mapMaintenanceBand,
  type GatherFactorEvidenceOptions,
  type FactorEvidence,
} from "./mechanical/factors.js";
