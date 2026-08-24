/**
 * Scoring-factor evidence data model (Phase 4 in skillmama/SKILL.md),
 * split the same way Phase 3.5 is — so deterministic data gathering and
 * LLM judgment never blur:
 *
 *   Stage 1 — EVIDENCE (deterministic): the live numbers SKILL.md's
 *   Popularity and Maintenance bands are read off. Stars and last-push
 *   date come from the GitHub repo API, weekly downloads from the npm
 *   downloads API. No judgment involved.
 *
 *   Stage 2 — BAND MAPPING (deterministic): SKILL.md states each band as
 *   a fixed numeric range, so evidence -> band is a lookup table.
 *
 *   Stage 3 — POINT SELECTION (LLM judgment, NOT in this package): SKILL.md
 *   defines bands ("7–9"), not points. Picking 7 vs 9 inside a band is
 *   judgment, and scoreCandidate() still takes the chosen point.
 *
 * Compatibility and Simplicity have no stage 1 at all: their bands are
 * written in terms of "well-documented", "significant glue code",
 * "minimal config" — properties only a reader of the docs can assess.
 * This module deliberately covers the two factors that start from live
 * data and leaves the other two to the caller.
 */

/**
 * An inclusive 1–10 range from SKILL.md's band table. `low === high` for
 * the single-point band (Popularity/Maintenance 10).
 */
export interface FactorBand {
  low: number;
  high: number;
}

/** Where a candidate's factor evidence is fetched from. Both are optional:
 *  a Tier 4 curated template may have neither, and a GitHub-only project
 *  has no npm downloads. Absence is recorded as unverified evidence, never
 *  silently skipped. */
export interface FactorTarget {
  /** GitHub "owner/name". Source of stars AND last-push date. */
  repo?: string;
  /** npm package name. SKILL.md's downloads band is stated in npm weekly
   *  downloads; no other registry publishes a comparable number, so this
   *  stays npm-only rather than pretending PyPI equivalence. */
  npmPackage?: string;
}

export type PopularityEvidence =
  | { source: "github-stars"; status: "ok"; stars: number }
  | {
      source: "github-stars";
      status: "unverified";
      reason: "unreachable" | "no-repo";
    }
  | { source: "npm-downloads"; status: "ok"; weeklyDownloads: number }
  | {
      source: "npm-downloads";
      status: "unverified";
      reason: "unreachable" | "no-npm-package";
    };

export type MaintenanceEvidence =
  | {
      source: "github-last-commit";
      status: "ok";
      /** ISO date (YYYY-MM-DD) from the repo's `pushed_at`. See
       *  gatherFactorEvidence() for why that field and not a commit walk. */
      lastCommitDate: string;
      /** SKILL.md's 1–3 band is "> 365 days OR archived", so archived is
       *  evidence in its own right, not a derived opinion. */
      archived: boolean;
    }
  | {
      source: "github-last-commit";
      status: "unverified";
      reason: "unreachable" | "no-repo";
    };

/**
 * The result of mapping evidence onto SKILL.md's bands.
 *
 * Three outcomes, not two, because "no data" and "data that SKILL.md has
 * no band for" are different facts and collapsing them would hide a gap
 * in SKILL.md itself:
 *
 *   banded   — the band SKILL.md assigns. Pick a point inside it.
 *   unbanded — `no-verified-evidence`: every source came back unverified,
 *              so the factor is SKILL.md's `N/A (unverified)`.
 *            — `outside-defined-bands`: verified evidence that falls in a
 *              hole between SKILL.md's stated ranges. Today exactly one
 *              exists: Maintenance 181–365 days, between "≤180 → 4–6" and
 *              "> 365 → 1–3". Reported rather than guessed.
 *
 * `notes` is always populated: which source was used, which was
 * unverified, and any qualifier the evidence cannot settle. Never empty,
 * so a band can never read as more verified than it is.
 */
export type BandOutcome =
  | { status: "banded"; band: FactorBand; notes: string[] }
  | {
      status: "unbanded";
      reason: "no-verified-evidence" | "outside-defined-bands";
      notes: string[];
    };
