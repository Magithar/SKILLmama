import type {
  Candidate,
  SearchTier,
} from "../contracts/candidate.js";
import type { RawHit, SearchPlan, TierResult } from "../contracts/search.js";
import type { CapabilityRequest, StackProfile } from "../contracts/project.js";

/**
 * Phase 3 Stage C — NORMALIZE, implemented.
 *
 * The deterministic tail of findCandidates(): TierResult[] whose hits have
 * already been judged to count (Stage B) -> deduplicated Candidate[] with
 * tier provenance. Stages A (plan) and B (execute) stay reasoning/tool work
 * in ../reasoning/index.ts; everything here is pure string and set logic so
 * the same hits always normalize to the same candidates.
 */

/** Canonical search order from SKILL.md Phase 3 ("search each tier in
 *  order"): Tier 1 GitHub, Tier 2 MCP, Tier 3 registries, Tier 4 templates.
 *  Exhaustive over SearchTier — adding a tier without ranking it here fails
 *  to compile, same pattern as ALL_COMPANION_SOURCES. */
const TIER_RANK: Record<SearchTier, number> = {
  github: 1,
  mcp: 2,
  "package-registry": 3,
  "curated-template": 4,
};

/** The four tiers in SKILL.md search order — the runtime mirror of
 *  SearchTier, derived from the exhaustive TIER_RANK table. */
export const searchTiers: SearchTier[] = Object.entries(TIER_RANK)
  .sort((a, b) => a[1] - b[1])
  .map(([tier]) => tier as SearchTier);

/**
 * Validate TierResult[] shape — the contract every Stage B executor's
 * output must satisfy before Stage C will touch it: array of objects with
 * a known tier, a queriesRun array, and hits that each carry a non-empty
 * url string. Exported because findCandidates() must apply the exact same
 * bar to tooling-produced results that normalizeSearchHits() applies to
 * caller-supplied ones; silent partial output would read as a smaller
 * search, which is a lie about coverage.
 */
export function assertValidTierResults(tierResults: TierResult[]): void {
  if (!Array.isArray(tierResults)) {
    throw new Error("normalizeSearchHits: tierResults must be an array");
  }
  const validTiers = new Set(Object.keys(TIER_RANK));
  for (const [i, result] of tierResults.entries()) {
    if (!result || typeof result !== "object") {
      throw new Error(`normalizeSearchHits: tierResults[${i}] must be an object`);
    }
    if (!validTiers.has(result.tier)) {
      throw new Error(
        `normalizeSearchHits: tierResults[${i}].tier must be one of ${[...validTiers].join(", ")}, got ${JSON.stringify(result.tier)}`
      );
    }
    if (!Array.isArray(result.hits)) {
      throw new Error(`normalizeSearchHits: tierResults[${i}].hits must be an array`);
    }
    for (const [j, hit] of result.hits.entries()) {
      if (!hit || typeof hit !== "object" || typeof hit.url !== "string" || hit.url === "") {
        throw new Error(
          `normalizeSearchHits: tierResults[${i}].hits[${j}].url must be a non-empty string`
        );
      }
    }
  }
}

/** Split a URL into { host (lowercased, no www.), path (no query/hash,
 *  no leading/trailing slashes) }. Returns null for anything without a
 *  plausible host/path shape. */
function parseUrl(url: string): { host: string; segments: string[] } | null {
  let rest = url.trim();
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  rest = rest.split(/[?#]/, 1)[0];
  rest = rest.replace(/^www\./i, "").replace(/\/+$/, "");
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const host = rest.slice(0, slash).toLowerCase();
  if (host === "" || !host.includes(".")) return null;
  const segments = rest
    .slice(slash + 1)
    .split("/")
    .filter((segment) => segment !== "");
  return { host, segments };
}

/** GitHub site namespaces that precede a non-repo resource (topic pages,
 *  product/marketing paths, org listings). github.com/{anything}/{word} is
 *  otherwise indistinguishable from owner/repo by shape alone. Kept to
 *  well-known product namespaces on purpose: an unknown namespace that
 *  turns out to be a repo costs nothing — Stage B judged the hit counts,
 *  so it still normalizes; inventing more blocklist entries risks eating
 *  real repos named like site pages. */
const GITHUB_SITE_NAMESPACES = new Set([
  "topics",
  "features",
  "marketplace",
  "trending",
  "collections",
  "explore",
  "orgs",
  "sponsors",
  "security",
]);

/**
 * Derive { name, url } from one raw hit, or null when nothing is derivable.
 * Pure. Registry/repo URLs carry their name structurally, so extraction is
 * mechanical there; any other host falls back to the hit's own title — the
 * one field Stage B's judgment already vetted — and only when that title is
 * non-empty. A hit with neither a known URL pattern nor a usable title is
 * DROPPED, never guessed at: inventing a display name is exactly the
 * judgment this stage must not perform.
 */
function deriveCandidate(hit: RawHit): { name: string; url: string } | null {
  const parsed = parseUrl(hit.url);
  if (parsed) {
    const { host, segments } = parsed;

    // github.com/{owner}/{repo}[/anything] — deep links (tree, blob, issues)
    // still identify their repo; .git suffix is stripped. Site namespaces
    // (topics, trending, ...) are pages ABOUT repos, never repos themselves.
    if (
      host === "github.com" &&
      segments.length >= 2 &&
      !GITHUB_SITE_NAMESPACES.has(segments[0])
    ) {
      const repo = segments[1].replace(/\.git$/, "");
      if (repo !== "") {
        return { name: repo, url: `https://github.com/${segments[0]}/${repo}` };
      }
    }

    // npmjs.com/package/{name}[/{version-or-file}] — scoped names span two
    // segments (@scope/pkg) and survive intact; bare npmjs.com/{page} paths
    // (policies, search) are NOT packages.
    if (host === "npmjs.com" && segments[0] === "package") {
      const first = segments[1];
      if (typeof first === "string" && first !== "") {
        const pkgPath = first.startsWith("@")
          ? typeof segments[2] === "string" && segments[2] !== ""
            ? `${first}/${segments[2]}`
            : undefined
          : first;
        if (pkgPath !== undefined) {
          return {
            name: decodeURIComponent(pkgPath),
            url: `https://www.npmjs.com/package/${pkgPath}`,
          };
        }
      }
    }

    // pypi.org/project/{name}[/{version}]
    if (host === "pypi.org" && segments[0] === "project" && typeof segments[1] === "string" && segments[1] !== "") {
      return { name: decodeURIComponent(segments[1]), url: `https://pypi.org/project/${segments[1]}/` };
    }
  }

  const title = typeof hit.title === "string" ? hit.title.trim() : "";
  if (title !== "") {
    return { name: title, url: hit.url.trim() };
  }
  return null;
}

/** Dedupe key for a URL: ignores scheme, www., trailing slashes, and
 *  query/hash — the same page under two spellings is one hit. Shared with
 *  the companion-skill normalizer so "same hit" means the same thing in
 *  every dedupe this package performs. */
export function urlDedupeKey(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  return `${parsed.host}/${parsed.segments.join("/")}`;
}

/**
 * Stage C entry point: TierResult[] -> Candidate[].
 * Pure and deterministic.
 *
 * Ordering policy (SKILL.md Phase 3 searches tiers 1-4 in order; earlier
 * tiers carry stronger evidence): results are processed in canonical tier
 * rank, then input order within a tier, and the output preserves that
 * processing order — so on a cross-tier duplicate the EARLIER TIER's
 * occurrence survives with its own provenance, deterministically.
 *
 * Dedupe: a later hit is dropped when its URL key OR its derived name key
 * matches a candidate already emitted (contract: "deduplicated across
 * tiers by URL/name"). Fields Stage B cannot report from RawHit (stars,
 * downloads, lastCommitDate, hasOwnSkill) stay absent rather than guessed.
 *
 * Structurally invalid input throws loudly — same policy as
 * analyzeProject() with a malformed manifest: silent partial output would
 * read as a smaller search, which is a lie about coverage.
 */
export function normalizeSearchHits(tierResults: TierResult[]): Candidate[] {
  assertValidTierResults(tierResults);

  const ordered = [...tierResults].sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]
  );

  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();
  const candidates: Candidate[] = [];

  for (const result of ordered) {
    for (const hit of result.hits) {
      const derived = deriveCandidate(hit);
      if (!derived) continue;

      const uKey = urlDedupeKey(derived.url);
      if (uKey !== null && seenUrls.has(uKey)) continue;
      const nKey = derived.name.toLowerCase();
      if (seenNames.has(nKey)) continue;

      if (uKey !== null) seenUrls.add(uKey);
      seenNames.add(nKey);
      candidates.push({
        name: derived.name,
        tier: result.tier,
        url: derived.url,
      });
    }
  }

  return candidates;
}

/**
 * Phase 2/3 Stage A support — the SKILL.md tier recipes as mechanical
 * template filling. The recipes are DATA (skillmama/SKILL.md lines
 * "Tier 1..4"); filling their [search_term]/[capability]/[language]/
 * [framework]/[stack] placeholders is string substitution, not judgment,
 * so it lives here. What stays reasoning: CHOOSING the search terms
 * (Stage A's SearchPlan, injected by the caller of findCandidates()) and
 * executing/judging queries (Stage B, also injected).
 *
 * Placeholder policy when the stack is unknown or a category is empty:
 * drop the token rather than guess — `site:github.com {capability} open
 * source` instead of inventing a language. Deterministic picks otherwise:
 * first sorted language / framework from the StackProfile.
 */
export function buildTierQueries(
  plan: SearchPlan,
  stack?: StackProfile
): Record<SearchTier, string[]> {
  if (!plan || typeof plan !== "object") {
    throw new Error("buildTierQueries: plan must be an object");
  }
  const capability = plan.capability;
  if (typeof capability !== "string" || capability.trim() === "") {
    throw new Error("buildTierQueries: plan.capability must be a non-empty string");
  }
  const cap = capability.trim();
  if (!Array.isArray(plan.searchTerms) ||
      plan.searchTerms.length < 3 ||
      plan.searchTerms.length > 5 ||
      !plan.searchTerms.every((term) => typeof term === "string" && term.trim() !== "")) {
    throw new Error(
      "buildTierQueries: plan.searchTerms must be 3-5 non-empty strings (SKILL.md Phase 2)"
    );
  }

  const pick = (values?: string[]): string | undefined => {
    const sorted = values ? [...values].sort() : [];
    return sorted.length > 0 ? sorted[0] : undefined;
  };
  const language = pick(stack?.languages);
  const framework = pick(stack?.frameworks);
  const stackHint = language ?? framework;

  return {
    github: [
      ...plan.searchTerms.map((term) => `site:github.com ${term} stars:>500`),
      language
        ? `site:github.com ${cap} ${language} open source`
        : `site:github.com ${cap} open source`,
    ],
    mcp: [
      `MCP server ${cap}`,
      `model context protocol ${cap} tool`,
      `site:github.com modelcontextprotocol ${cap}`,
    ],
    "package-registry": [
      framework
        ? `site:npmjs.com ${cap} ${framework}`
        : `site:npmjs.com ${cap}`,
      `site:pypi.org ${cap}`,
    ],
    "curated-template": [
      stackHint
        ? `${cap} starter template ${stackHint}`
        : `${cap} starter template`,
      `awesome ${cap} github list`,
    ],
  };
}

/**
 * Validate a CapabilityRequest before any tooling runs against it. The
 * capability is the one input every stage consumes; constraints ride along
 * to the executor verbatim (applying them is filtering judgment, not a
 * field format).
 */
export function assertValidCapabilityRequest(request: CapabilityRequest): void {
  if (!request || typeof request !== "object") {
    throw new Error("findCandidates: request must be an object");
  }
  if (typeof request.capability !== "string" || request.capability.trim() === "") {
    throw new Error("findCandidates: request.capability must be a non-empty string");
  }
}
