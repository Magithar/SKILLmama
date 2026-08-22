import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { StackProfile } from "../contracts/project.js";
import type { Candidate } from "../contracts/candidate.js";
import type {
  CandidateScore,
  ScoringFactors,
} from "../contracts/scoring.js";
import {
  dependencyDetectors,
  fileDetectors,
  stackCategories,
  type DependencyDetectorEntry,
  type StackCategory,
} from "./detectors.js";
import { manifestParsers } from "./parsers.js";

export * from "./detectors.js";
export * from "./security.js";

/**
 * Functions in this file are the ones where the underlying capability is
 * genuinely mechanical (file parsing, arithmetic, plain-HTTP evidence
 * checks). analyzeProject(), scoreCandidate(), and the Phase 3.5 Stage 1
 * evidence gatherer (security.ts) are implemented; the remaining pipeline
 * functions are still unimplemented.
 */

function addTo<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

/** Sorted lexicographically, deduplicated — the pinned output convention
 *  every fixture in ../fixtures/ agrees with. */
function sortedValues(hits: Map<string, Set<string>>, key: string): string[] {
  const set = hits.get(key);
  return set ? [...set].sort() : [];
}

/** PEP 503-style normalization fallback. Manifests do not always carry
 *  registry-normalized names ("Django", "psycopg2_binary" are legal pip
 *  input), and ecosystems differ in how strictly they normalize. Exact
 *  match always wins; the fallback can only turn a registry miss into the
 *  same package's entry — matchedDependencies still stores the name
 *  verbatim as written in the manifest. */
function resolveDetector(raw: string): DependencyDetectorEntry | undefined {
  return (
    dependencyDetectors[raw] ??
    dependencyDetectors[raw.toLowerCase().replace(/[-_.]+/g, "-")]
  );
}

/**
 * Structured Project Scan — NOT full project understanding.
 *
 * Reads only the top-level entries of projectPath (no recursion). The v1
 * input matrix: seven dependency manifests whose contents are parsed
 * (package.json, pyproject.toml, Cargo.toml, requirements.txt, go.mod,
 * Gemfile, composer.json) plus presence-only detectors (the same manifests
 * for languages; fly.toml / render.yaml / vercel.json / railway.toml /
 * railway.json for deploymentTarget). Presence detectors never open their
 * files — a malformed fly.toml still yields a target. A manifest that must
 * be parsed but fails throws loudly instead of silently degrading the scan.
 *
 * When several deployment configs coexist there is no evidence-based
 * precedence yet, so the tie-break is deterministic: the
 * lexicographically first source filename wins.
 *
 * Evidence-correctness policy (adversarial review, step 11.5): names are
 * matched exactly first, then via PEP 503-style normalization (see
 * resolveDetector); Cargo rename syntax exposes the real crate name (see
 * parseCargoToml). Known accepted limitations, deliberately not resolved
 * for v1: npm alias/workspace/file:/GitHub specifiers are read by key
 * only; go.mod replace directives and requirements.txt -r includes are
 * not followed; peerDependencies are treated as stack evidence.
 *
 * Output is fully deterministic: category arrays and matchedDependencies
 * (both keys and raw-name values) are sorted lexicographically and
 * deduplicated; deploymentTarget is absent when no config-file evidence
 * exists. The fixtures in ../fixtures/ pin these conventions.
 */
export async function analyzeProject(projectPath: string): Promise<StackProfile> {
  const entries = await readdir(projectPath, { withFileTypes: true });
  const presentFiles = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  );

  const categoryHits = new Map<StackCategory, Set<string>>();
  const matchedHits = new Map<string, Set<string>>();

  // Pass 1 — presence detectors: filename seen ⇒ evidence recorded,
  // contents never read.
  const deploymentHits: Array<{ value: string; source: string }> = [];
  for (const [filename, detector] of Object.entries(fileDetectors)) {
    if (!presentFiles.has(filename)) continue;
    if (detector.target === "deploymentTarget") {
      deploymentHits.push({ value: detector.canonical, source: filename });
    } else {
      addTo(categoryHits, detector.target, detector.canonical);
    }
  }

  // Pass 2 — dependency manifests: parse contents, look up each raw name
  // in the registry, ignore unknowns (policy 5).
  for (const [filename, parseManifest] of Object.entries(manifestParsers)) {
    if (!presentFiles.has(filename)) continue;
    const contents = await readFile(join(projectPath, filename), "utf8");
    let rawNames: string[];
    try {
      rawNames = parseManifest(contents);
    } catch (cause) {
      throw new Error(
        `analyzeProject: ${filename} in ${projectPath} could not be parsed`,
        { cause }
      );
    }
    for (const raw of rawNames) {
      const detector = resolveDetector(raw);
      if (!detector) continue;
      addTo(categoryHits, detector.category, detector.canonical);
      addTo(matchedHits, detector.canonical, raw);
    }
  }

  const profile = {} as StackProfile;
  for (const category of stackCategories) {
    profile[category] = sortedValues(categoryHits, category);
  }
  profile.matchedDependencies = {};
  for (const canonical of [...matchedHits.keys()].sort()) {
    profile.matchedDependencies[canonical] = sortedValues(matchedHits, canonical);
  }
  if (deploymentHits.length > 0) {
    profile.deploymentTarget = [...deploymentHits].sort((a, b) =>
      a.source < b.source ? -1 : a.source > b.source ? 1 : 0
    )[0];
  }
  return profile;
}

/**
 * Phase 4 — deterministic weighted score for a candidate.
 *
 * Pure arithmetic over four factors already scored 1-10 per SKILL.md's
 * bands (see contracts/scoring.ts for why factor production stays outside
 * this package). Policies, all from SKILL.md Phase 4:
 *
 *  - Weights: compatibility 0.40, popularity 0.30, maintenance 0.15,
 *    simplicity 0.15.
 *  - "If a field is unknown, mark it N/A and weight the remaining factors
 *    proportionally": N/A factors are excluded and the surviving weights
 *    are renormalized, so a 3-factor candidate competes on equal terms —
 *    its total is not silently deflated by a missing zero. Every exclusion
 *    is recorded in notes; a fully-weighted score carries no notes.
 *  - All four N/A ⇒ totalScore is "N/A". No verified input, no number.
 *  - Factors must be numbers in [1, 10] or exactly "N/A" — anything else
 *    throws loudly instead of entering the arithmetic.
 *  - The total is rounded to one decimal (Phase 5 renders X.X), half-up.
 *    Rounding is boundary-tolerant: a quotient within 1e-9 of an exact .X5
 *    boundary is treated as the boundary and rounds up, so floating-point
 *    accumulation noise cannot flip an exact 5.15 between 5.1 and 5.2 —
 *    while genuinely mid-interval values (6.5454... -> 6.5) are never
 *    double-rounded across the boundary.
 *
 * Not this function's job (callers filter first, per Phase 4's preamble):
 * skipping BLOCKED candidates and marking ALREADY PRESENT ones.
 */
const HALF_BOUNDARY_EPS = 1e-9;

function roundHalfUp1dp(value: number): number {
  const scaled = value * 10;
  const lower = Math.floor(scaled);
  const frac = scaled - lower;
  const roundUp = frac >= 0.5 - HALF_BOUNDARY_EPS;
  return (lower + (roundUp ? 1 : 0)) / 10;
}
export function scoreCandidate(
  candidate: Candidate,
  factors: ScoringFactors
): CandidateScore {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("scoreCandidate: candidate must be an object");
  }

  const FACTOR_WEIGHTS = [
    ["compatibility", 0.4],
    ["popularity", 0.3],
    ["maintenance", 0.15],
    ["simplicity", 0.15],
  ] as const;

  let weightedSum = 0;
  let weightSum = 0;
  const notes: string[] = [];

  for (const [factor, weight] of FACTOR_WEIGHTS) {
    const value = factors[factor];
    if (value === "N/A") {
      notes.push(`${factor}: N/A — excluded, remaining factors renormalized`);
      continue;
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 1 ||
      value > 10
    ) {
      throw new Error(
        `scoreCandidate: ${factor} must be a number in [1, 10] or "N/A", got ${JSON.stringify(value)}`
      );
    }
    weightedSum += value * weight;
    weightSum += weight;
  }

  const totalScore =
    weightSum === 0 ? "N/A" : roundHalfUp1dp(weightedSum / weightSum);

  return {
    candidate,
    compatibility: factors.compatibility,
    popularity: factors.popularity,
    maintenance: factors.maintenance,
    simplicity: factors.simplicity,
    totalScore,
    ...(notes.length > 0 ? { notes } : {}),
  };
}
