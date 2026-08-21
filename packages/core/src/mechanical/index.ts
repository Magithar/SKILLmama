import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { StackProfile } from "../contracts/project.js";
import type { Candidate } from "../contracts/candidate.js";
import type { CandidateScore } from "../contracts/scoring.js";
import { NotImplementedError } from "../errors.js";
import {
  dependencyDetectors,
  fileDetectors,
  stackCategories,
  type DependencyDetectorEntry,
  type StackCategory,
} from "./detectors.js";
import { manifestParsers } from "./parsers.js";

export * from "./detectors.js";

/**
 * Functions in this file are the ones where the underlying capability is
 * genuinely mechanical (file parsing, arithmetic). analyzeProject() is
 * implemented; the remaining pipeline functions are still unimplemented.
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
 * Note: the math is deterministic; the four input factors it consumes
 * are not guaranteed to be — see contracts/scoring.ts.
 */
export function scoreCandidate(
  _candidate: Candidate,
  _stack: StackProfile
): Promise<CandidateScore> {
  throw new NotImplementedError("scoreCandidate");
}
