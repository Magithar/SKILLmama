/**
 * Structured Project Scan (the mechanical slice of Flow A / Phase 1 in
 * skillmama/SKILL.md — config-file parsing only).
 *
 * Deliberately NOT in scope for a StackProfile producer:
 *  - reading README/SETUP/DEPLOY prose
 *  - inferring technology from arbitrary source code
 *  - deciding what the application "actually does"
 *  - any of Flow B's deeper Phase B1 analysis
 * Those stay LLM-interpreted behavior that SKILL.md owns directly.
 *
 * Every field here must trace back to structured evidence (a dependency
 * name, a config key) — not an inferred/aspirational value.
 */
export interface StackProfile {
  languages: string[];
  frameworks: string[];
  databases: string[];
  aiTools: string[];
  authSystems: string[];
  caching: string[];
  queues: string[];
  search: string[];
  storage: string[];
  email: string[];
  payments: string[];
  observability: string[];
  testing: string[];
  /**
   * Raw dependency evidence behind the profile — feeds ALREADY PRESENT
   * detection (SKILL.md Phase 4 + Rules) and provenance queries.
   *
   * Invariant: every key is a canonical ID produced by the detector
   * registry (dependencyDetectors), and every value lists the raw
   * manifest dependency names — exactly as written in the manifest,
   * across all dependency sections the format supports — that matched
   * that canonical ID. File-detector canonicals (languages, deployment
   * platforms) do not appear here; they carry no dependency evidence.
   *
   * Required, never optional: analyzeProject() returns {} when nothing
   * matched, so consumers never optional-chain into a scan result.
   */
  matchedDependencies: Record<string, string[]>;
  /**
   * Deployment target with provenance. SKILL.md's Deployment Persistence
   * Check reads the *contents* of the source file (mounts/volumes/disk
   * blocks), not just the platform name, so source is not optional once
   * a target is known.
   */
  deploymentTarget?: {
    /** Canonical file-detector ID, e.g. "render", "vercel", "flyio", "railway".
     *  Display formatting ("Render", "Fly.io") is a presentation concern. */
    value: string;
    /** e.g. "fly.toml" */
    source: string;
  };
}

export interface CapabilityRequest {
  /** e.g. "vector database for RAG" */
  capability: string;
  stack?: StackProfile;
  constraints?: string[];
}
