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
 * Where a companion skill was found (Phase 3.6 searches all four).
 *
 * Provenance determines how the result may be trusted — SKILL.md assigns
 * different semantics per source:
 *   - terminalskills-io: rated. rating is meaningful; SUSPICIOUS/MALICIOUS
 *     is an automatic Phase 3.7 discard.
 *   - skillsmp: unvetted (auto-indexed from public GitHub repos). A match
 *     is a pointer to go verify the underlying repo directly, never a
 *     trust signal on its own.
 *   - skills-sh / github-skill-md: search results; normal repository
 *     verification still applies.
 */
export type CompanionSkillSource =
  | "skills-sh"
  | "terminalskills-io"
  | "skillsmp"
  | "github-skill-md";

/**
 * Compile-time mirror of CompanionSkillSource, same pattern as the detector
 * registry's ALL_STACK_CATEGORIES: adding a source to the union without
 * adding it here fails to compile, so the runtime list cannot silently
 * drift from the contract.
 */
const ALL_COMPANION_SOURCES = {
  "skills-sh": true,
  "terminalskills-io": true,
  skillsmp: true,
  "github-skill-md": true,
} as const satisfies Record<CompanionSkillSource, boolean>;

export const companionSkillSources: CompanionSkillSource[] = Object.keys(
  ALL_COMPANION_SOURCES
) as CompanionSkillSource[];

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
  /** Required: provenance records where this was found; rating only ever
   *  records metadata that provenance provides. Neither substitutes for
   *  the other — see CompanionSkillSource for per-source trust rules. */
  source: CompanionSkillSource;
  /** Present only when the source provides one (terminalskills-io does;
   *  skillsmp explicitly does not). Absence here never implies anything
   *  about vetting — check source. */
  rating?: CompanionSkillRating;
  /** Phase 3.7 gate outputs, present on a SURVIVING skill only when the
   *  gate had something to report (WARN/FLAG); a skill without these from
   *  a gated run passed clean, while a skill that never went through the
   *  gate carries no claim at all. DISCARD-class skills are filtered out
   *  by findCompanionSkills() entirely and never appear here. */
  notes?: string[];
  sqpFlags?: string[];
}
