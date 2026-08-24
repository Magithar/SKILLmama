import {
  gatherFactorEvidence,
  gatherSecurityEvidence,
  mapMaintenanceBand,
  mapPopularityBand,
  type BandOutcome,
  type MaintenanceEvidence,
  type OsvEcosystem,
  type PopularityEvidence,
  type SecurityEvidence,
  type SecurityCheckResult,
} from "skillmama";
import { verifyCandidate } from "skillmama";

/**
 * `skillmama check` — the deterministic half of SKILLmama's per-candidate
 * work, run against live registries.
 *
 * This is deliberately NOT the whole pipeline. `discoverCapabilities()`
 * composes Phases 2-5, but four of its stages are injected judgment
 * (choosing search terms, judging hits, reading a package's docs and code,
 * scoring Compatibility/Simplicity) and a CLI has no LLM to supply them.
 * Rather than stub them with something that looks like an answer, this
 * command runs exactly the parts that need no judgment — the OSV query,
 * the npm publisher-continuity check, stars/downloads/last-push, and the
 * band lookups — and says plainly which half did not run.
 *
 * The omission is load-bearing, not a caveat: Phase 3.5's verdict is
 * evidence AND content findings, and this passes an empty finding list
 * because nobody read the code. A PASS here means "the live-data checks
 * found nothing", never "this package is safe".
 */

export interface CheckTarget {
  name: string;
  ecosystem: OsvEcosystem;
  version: string;
  repo?: string;
  npmPackage?: string;
}

export interface CheckResult {
  target: CheckTarget;
  security: SecurityCheckResult;
  popularity: { evidence: PopularityEvidence[]; band: BandOutcome };
  maintenance: { evidence: MaintenanceEvidence[]; band: BandOutcome };
  /** Always present. The content-inspection half of Phase 3.5 cannot run
   *  here, and every consumer of this result must be told so. */
  notRun: string[];
}

const CONTENT_INSPECTION_NOTE =
  "Phase 3.5 content inspection did not run: no docs or code were read, so guardrail-circumvention, exfiltration and SQP findings were not looked for. A PASS below means the live-data checks found nothing, not that the package is safe.";

export interface RunCheckOptions {
  fetchImpl?: typeof fetch;
  githubToken?: string;
  today?: string;
}

export async function runCheck(
  target: CheckTarget,
  options: RunCheckOptions = {}
): Promise<CheckResult> {
  const candidate = {
    name: target.name,
    tier: "package-registry" as const,
    url: registryUrl(target),
  };

  const [securityEvidence, factorEvidence] = await Promise.all([
    gatherSecurityEvidence(
      { name: target.name, ecosystem: target.ecosystem, version: target.version },
      {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.today ? { today: options.today } : {}),
      }
    ),
    gatherFactorEvidence(
      {
        ...(target.repo ? { repo: target.repo } : {}),
        ...(target.npmPackage ? { npmPackage: target.npmPackage } : {}),
      },
      {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.githubToken ? { githubToken: options.githubToken } : {}),
      }
    ),
  ]);

  const notRun = [CONTENT_INSPECTION_NOTE];
  if (!target.repo) {
    notRun.push(
      "No GitHub repository was resolved, so stars and last-commit date could not be checked."
    );
  }

  return {
    target,
    security: verifyCandidate(candidate, securityEvidence satisfies SecurityEvidence[], []),
    popularity: {
      evidence: factorEvidence.popularity,
      band: mapPopularityBand(factorEvidence.popularity),
    },
    maintenance: {
      evidence: factorEvidence.maintenance,
      band: mapMaintenanceBand(factorEvidence.maintenance, options.today ?? isoToday()),
    },
    notRun,
  };
}

function registryUrl(target: CheckTarget): string {
  switch (target.ecosystem) {
    case "npm":
      return `https://www.npmjs.com/package/${target.name}`;
    case "PyPI":
      return `https://pypi.org/project/${target.name}/`;
    case "crates.io":
      return `https://crates.io/crates/${target.name}`;
    case "Go":
      return `https://pkg.go.dev/${target.name}`;
  }
}

function isoToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Read the latest version and `owner/name` off the npm packument, for
 * filling in what the user did not supply. npm-only: every other
 * ecosystem must be told its version explicitly rather than have one
 * guessed for it.
 *
 * Reports only what it FOUND, never what was used. Deciding that is the
 * caller's, and announcing a substitution that did not happen is its own
 * kind of lie — an earlier version pushed the "queried latest" note
 * whenever it ran, including when the user had passed --version and only
 * the repo was being filled in.
 */
export async function resolveNpmDefaults(
  name: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ version?: string; repo?: string }> {
  let payload: unknown = null;
  try {
    const response = await fetchImpl(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      { headers: { accept: "application/json" } }
    );
    if (response.ok) payload = await response.json();
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== "object") return {};

  const doc = payload as Record<string, unknown>;
  const distTags = doc["dist-tags"];
  const latest =
    distTags && typeof distTags === "object"
      ? (distTags as Record<string, unknown>).latest
      : undefined;

  const result: { version?: string; repo?: string } = {};
  if (typeof latest === "string" && latest !== "") result.version = latest;
  const repo = extractRepo(doc);
  if (repo) result.repo = repo;
  return result;
}

/** "git+https://github.com/owner/name.git" and friends -> "owner/name". */
function extractRepo(doc: Record<string, unknown>): string | undefined {
  const repository = doc.repository;
  const raw =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object"
        ? (repository as Record<string, unknown>).url
        : undefined;
  if (typeof raw !== "string") return undefined;
  const match = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/.exec(raw);
  return match ? `${match[1]}/${match[2]}` : undefined;
}
