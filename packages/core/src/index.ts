/**
 * skillmama — package boundary only.
 *
 * skillmama/SKILL.md remains the sole source of truth for SKILLmama's
 * actual behavior. Only analyzeProject() is implemented so far; every
 * other exported function throws NotImplementedError so a caller fails
 * loudly instead of silently getting empty or fake data.
 *
 * Layout:
 *   contracts/  — shared types
 *   mechanical/ — functions where the underlying work is genuinely
 *                 deterministic (file parsing, arithmetic)
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
