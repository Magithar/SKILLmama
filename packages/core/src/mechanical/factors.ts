import type {
  BandOutcome,
  FactorBand,
  FactorTarget,
  MaintenanceEvidence,
  PopularityEvidence,
} from "../contracts/factors.js";

/**
 * Phase 4 Stage 1 + Stage 2 — the two scoring factors that start from
 * live data, implemented.
 *
 * SKILL.md scores Popularity "from github_stars + weekly_downloads" and
 * Maintenance "from last commit date". Both numbers come off plain HTTP
 * APIs and both band tables are stated as fixed numeric ranges, so
 * evidence -> band is genuinely mechanical. What stays outside: choosing a
 * point inside a band (SKILL.md writes "7–9", not a number), and the
 * Compatibility/Simplicity factors, whose bands are written in terms only
 * a reader of the docs can assess.
 *
 * Honesty boundary, same as gatherSecurityEvidence(): transport failure
 * degrades to `status: "unverified"` and is surfaced in notes, never
 * dropped. SKILL.md is explicit for Maintenance: "If a specific
 * last-commit date genuinely can't be found, mark that candidate's
 * Maintenance N/A (unverified) rather than assigning a number."
 */

export interface GatherFactorEvidenceOptions {
  /** Injectable transport — tests substitute a stub keyed by URL.
   *  Defaults to global fetch (Node >= 18). */
  fetchImpl?: typeof fetch;
  /** Optional GitHub token. Unauthenticated api.github.com allows 60
   *  requests/hour per IP, which a multi-candidate run exhausts quickly;
   *  a rate-limited response is a non-2xx and degrades to unverified
   *  rather than to a wrong number. */
  githubToken?: string;
}

export interface FactorEvidence {
  popularity: PopularityEvidence[];
  maintenance: MaintenanceEvidence[];
}

const GITHUB_API_BASE = "https://api.github.com/repos";
const NPM_DOWNLOADS_BASE = "https://api.npmjs.org/downloads/point/last-week";

/** "owner/name", each segment non-empty and free of path separators.
 *  A full URL is not accepted: the caller owns URL parsing, and quietly
 *  coercing one here would make a typo look like a missing repo. */
const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

function assertValidTarget(target: FactorTarget): void {
  if (!target || typeof target !== "object") {
    throw new Error("gatherFactorEvidence: target must be an object");
  }
  if (target.repo !== undefined) {
    if (typeof target.repo !== "string" || !REPO_PATTERN.test(target.repo)) {
      throw new Error(
        `gatherFactorEvidence: target.repo must be "owner/name", got ${JSON.stringify(target.repo)}`
      );
    }
  }
  if (target.npmPackage !== undefined) {
    if (typeof target.npmPackage !== "string" || target.npmPackage === "") {
      throw new Error(
        "gatherFactorEvidence: target.npmPackage must be a non-empty string"
      );
    }
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  doFetch: typeof fetch
): Promise<unknown> {
  try {
    const response = await doFetch(url, init);
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * GitHub repo response -> the three fields SKILL.md's bands need, or null
 * when the payload cannot supply them. Pure.
 *
 * `pushed_at` is the last push to ANY branch, which is what SKILL.md's
 * own instruction approximates ("check the repo's releases/commits page,
 * or the Updated date from Tier 1's GitHub search" — that Updated column
 * IS pushed_at). Walking the default branch's commit list would be a
 * different, stricter number than the one SKILL.md's bands were written
 * against, so this reports pushed_at and says so.
 *
 * A payload missing `stargazers_count` or `pushed_at` yields null for that
 * half rather than a zero: a repo with no stars reports 0 explicitly, and
 * inventing one from an absent field would be indistinguishable.
 */
export interface ParsedGithubRepo {
  stars: number | null;
  lastCommitDate: string | null;
  archived: boolean;
}

export function normalizeGithubRepoResponse(payload: unknown): ParsedGithubRepo {
  if (!payload || typeof payload !== "object") {
    return { stars: null, lastCommitDate: null, archived: false };
  }
  const repo = payload as Record<string, unknown>;
  const rawStars = repo.stargazers_count;
  const rawPushed = repo.pushed_at;
  return {
    stars:
      typeof rawStars === "number" && Number.isFinite(rawStars) && rawStars >= 0
        ? Math.trunc(rawStars)
        : null,
    lastCommitDate:
      typeof rawPushed === "string" && Number.isFinite(Date.parse(rawPushed))
        ? rawPushed.slice(0, 10)
        : null,
    archived: repo.archived === true,
  };
}

/** npm downloads-point response -> weekly download count, or null. Pure. */
export function normalizeNpmDownloadsResponse(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as Record<string, unknown>).downloads;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return Math.trunc(raw);
}

/**
 * Both live factors for one candidate, in canonical order:
 * popularity [github-stars, npm-downloads], maintenance
 * [github-last-commit].
 *
 * One GitHub request serves both stars and last-push date, so a candidate
 * costs at most two HTTP calls. A target with no `repo` yields
 * `reason: "no-repo"` for both GitHub-sourced records; no `npmPackage`
 * yields `reason: "no-npm-package"`. Those are not failures — a Tier 4
 * curated template genuinely has no stars — but they are recorded so the
 * band mapper can say which sources were actually available.
 */
export async function gatherFactorEvidence(
  target: FactorTarget,
  options: GatherFactorEvidenceOptions = {}
): Promise<FactorEvidence> {
  assertValidTarget(target);
  const doFetch = options.fetchImpl ?? fetch;

  const githubHeaders: Record<string, string> = {
    accept: "application/vnd.github+json",
  };
  if (options.githubToken) {
    githubHeaders.authorization = `Bearer ${options.githubToken}`;
  }

  const [repoResult, downloadsResult] = await Promise.all([
    (async (): Promise<ParsedGithubRepo | null> => {
      if (!target.repo) return null;
      const payload = await fetchJson(
        `${GITHUB_API_BASE}/${target.repo}`,
        { headers: githubHeaders },
        doFetch
      );
      return payload === null ? null : normalizeGithubRepoResponse(payload);
    })(),
    (async (): Promise<number | null> => {
      if (!target.npmPackage) return null;
      const payload = await fetchJson(
        `${NPM_DOWNLOADS_BASE}/${encodeURIComponent(target.npmPackage)}`,
        { headers: { accept: "application/json" } },
        doFetch
      );
      return payload === null ? null : normalizeNpmDownloadsResponse(payload);
    })(),
  ]);

  const stars: PopularityEvidence = !target.repo
    ? { source: "github-stars", status: "unverified", reason: "no-repo" }
    : repoResult === null || repoResult.stars === null
      ? { source: "github-stars", status: "unverified", reason: "unreachable" }
      : { source: "github-stars", status: "ok", stars: repoResult.stars };

  const downloads: PopularityEvidence = !target.npmPackage
    ? { source: "npm-downloads", status: "unverified", reason: "no-npm-package" }
    : downloadsResult === null
      ? { source: "npm-downloads", status: "unverified", reason: "unreachable" }
      : {
          source: "npm-downloads",
          status: "ok",
          weeklyDownloads: downloadsResult,
        };

  const lastCommit: MaintenanceEvidence = !target.repo
    ? { source: "github-last-commit", status: "unverified", reason: "no-repo" }
    : repoResult === null || repoResult.lastCommitDate === null
      ? {
          source: "github-last-commit",
          status: "unverified",
          reason: "unreachable",
        }
      : {
          source: "github-last-commit",
          status: "ok",
          lastCommitDate: repoResult.lastCommitDate,
          archived: repoResult.archived,
        };

  return { popularity: [stars, downloads], maintenance: [lastCommit] };
}

/**
 * SKILL.md Phase 4's Popularity table, as data:
 *
 *   10:  >10k stars OR >1M weekly downloads
 *   7–9: 1k–10k stars OR 100k–1M downloads
 *   4–6: 100–1k stars OR 10k–100k downloads
 *   1–3: <100 stars OR <10k downloads
 *
 * Two boundary decisions SKILL.md leaves open, fixed here and documented
 * rather than left to chance:
 *
 *  - The band edges overlap (1k appears in both "100–1k" and "1k–10k").
 *    The higher band wins at an exact edge, matching how the table reads
 *    top-down.
 *  - The clauses are joined by OR, so a package qualifying on either axis
 *    takes that band: the BEST band across available sources wins. A
 *    library with 40 stars and 3M weekly downloads (a transitive
 *    workhorse) scores 10, which is what the OR plainly says.
 */
const STAR_BANDS: ReadonlyArray<{ min: number; band: FactorBand }> = [
  { min: 10_001, band: { low: 10, high: 10 } },
  { min: 1_000, band: { low: 7, high: 9 } },
  { min: 100, band: { low: 4, high: 6 } },
  { min: 0, band: { low: 1, high: 3 } },
];

const DOWNLOAD_BANDS: ReadonlyArray<{ min: number; band: FactorBand }> = [
  { min: 1_000_001, band: { low: 10, high: 10 } },
  { min: 100_000, band: { low: 7, high: 9 } },
  { min: 10_000, band: { low: 4, high: 6 } },
  { min: 0, band: { low: 1, high: 3 } },
];

function lookupBand(
  table: ReadonlyArray<{ min: number; band: FactorBand }>,
  value: number
): FactorBand {
  for (const row of table) {
    if (value >= row.min) return row.band;
  }
  return table[table.length - 1].band;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function mapPopularityBand(evidence: PopularityEvidence[]): BandOutcome {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error(
      "mapPopularityBand: evidence is empty — no source ran at all, refusing to emit a band"
    );
  }

  const notes: string[] = [];
  const candidates: FactorBand[] = [];

  for (const record of evidence) {
    if (!record || typeof record !== "object") {
      throw new Error("mapPopularityBand: every evidence record must be an object");
    }
    if (record.source === "github-stars") {
      if (record.status === "ok") {
        const band = lookupBand(STAR_BANDS, record.stars);
        candidates.push(band);
        notes.push(
          `github-stars: ${formatCount(record.stars)} stars -> ${bandLabel(band)}`
        );
      } else {
        notes.push(`github-stars: N/A (unverified — ${record.reason})`);
      }
    } else if (record.source === "npm-downloads") {
      if (record.status === "ok") {
        const band = lookupBand(DOWNLOAD_BANDS, record.weeklyDownloads);
        candidates.push(band);
        notes.push(
          `npm-downloads: ${formatCount(record.weeklyDownloads)} weekly -> ${bandLabel(band)}`
        );
      } else {
        notes.push(`npm-downloads: N/A (unverified — ${record.reason})`);
      }
    } else {
      throw new Error(
        `mapPopularityBand: unknown evidence source ${JSON.stringify((record as { source?: unknown }).source)}`
      );
    }
  }

  if (candidates.length === 0) {
    return {
      status: "unbanded",
      reason: "no-verified-evidence",
      notes: [
        ...notes,
        "No popularity source was verified — SKILL.md: mark the factor N/A (unverified) rather than assigning a number",
      ],
    };
  }

  const best = candidates.reduce((a, b) => (b.high > a.high ? b : a));
  notes.push(`Bands are OR'd; best available wins -> ${bandLabel(best)}`);
  return { status: "banded", band: best, notes };
}

function bandLabel(band: FactorBand): string {
  return band.low === band.high ? `${band.low}` : `${band.low}–${band.high}`;
}

/**
 * SKILL.md Phase 4's Maintenance table, as data:
 *
 *   10:  ≤30 days, active releases
 *   7–9: ≤90 days
 *   4–6: ≤180 days
 *   1–3: >365 days or archived
 *
 * Two things this mapper reports instead of guessing:
 *
 *  - 181–365 days has NO band in SKILL.md. The table jumps from "≤180"
 *    to "> 365", so a repo last pushed 8 months ago falls in a hole.
 *    That is a gap in SKILL.md, not in the data, so the outcome is
 *    `unbanded: "outside-defined-bands"` with the measured age. Closing it
 *    means editing SKILL.md (roadmap task 9's territory), not inventing a
 *    band here.
 *  - The 10 band also requires "active releases", which pushed_at cannot
 *    establish. A ≤30-day repo gets band 10 with an explicit note that the
 *    release half is unverified, so the point-picker knows to check.
 *
 * `archived` takes precedence over recency: SKILL.md's 1–3 band is
 * "> 365 days OR archived", and an archived repo pushed yesterday is
 * still archived.
 */
const MS_PER_DAY = 86_400_000;

export function mapMaintenanceBand(
  evidence: MaintenanceEvidence[],
  today: string
): BandOutcome {
  if (
    typeof today !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
    !Number.isFinite(Date.parse(today))
  ) {
    throw new Error(
      `mapMaintenanceBand: today must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(today)}`
    );
  }
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error(
      "mapMaintenanceBand: evidence is empty — no source ran at all, refusing to emit a band"
    );
  }

  const notes: string[] = [];
  const verified = evidence.filter(
    (
      record
    ): record is Extract<MaintenanceEvidence, { status: "ok" }> => {
      if (!record || typeof record !== "object") {
        throw new Error("mapMaintenanceBand: every evidence record must be an object");
      }
      if (record.source !== "github-last-commit") {
        throw new Error(
          `mapMaintenanceBand: unknown evidence source ${JSON.stringify((record as { source?: unknown }).source)}`
        );
      }
      return record.status === "ok";
    }
  );

  for (const record of evidence) {
    if (record.status === "unverified") {
      notes.push(`${record.source}: N/A (unverified — ${record.reason})`);
    }
  }

  if (verified.length === 0) {
    return {
      status: "unbanded",
      reason: "no-verified-evidence",
      notes: [
        ...notes,
        "No last-commit date could be verified — SKILL.md: mark Maintenance N/A (unverified) rather than assigning a number",
      ],
    };
  }

  // Most recent verified push wins if a caller ever supplies several.
  const newest = verified.reduce((a, b) =>
    Date.parse(b.lastCommitDate) > Date.parse(a.lastCommitDate) ? b : a
  );
  if (!Number.isFinite(Date.parse(newest.lastCommitDate))) {
    throw new Error(
      `mapMaintenanceBand: lastCommitDate must be an ISO date, got ${JSON.stringify(newest.lastCommitDate)}`
    );
  }

  if (newest.archived) {
    return {
      status: "banded",
      band: { low: 1, high: 3 },
      notes: [
        ...notes,
        `github-last-commit: repository is archived -> 1–3 (SKILL.md's 1–3 band is ">365 days or archived"; last push ${newest.lastCommitDate})`,
      ],
    };
  }

  const rawDays = (Date.parse(today) - Date.parse(newest.lastCommitDate)) / MS_PER_DAY;
  const days = Math.max(0, Math.round(rawDays));
  if (rawDays < 0) {
    notes.push(
      `github-last-commit: last push ${newest.lastCommitDate} is later than today (${today}); treated as 0 days old`
    );
  }
  const ageNote = `github-last-commit: last push ${newest.lastCommitDate}, ${days} days before ${today}`;

  if (days <= 30) {
    return {
      status: "banded",
      band: { low: 10, high: 10 },
      notes: [
        ...notes,
        `${ageNote} -> 10`,
        "SKILL.md's 10 band also requires \"active releases\", which a push date cannot establish — verify releases before taking the 10",
      ],
    };
  }
  if (days <= 90) {
    return { status: "banded", band: { low: 7, high: 9 }, notes: [...notes, `${ageNote} -> 7–9`] };
  }
  if (days <= 180) {
    return { status: "banded", band: { low: 4, high: 6 }, notes: [...notes, `${ageNote} -> 4–6`] };
  }
  if (days > 365) {
    return { status: "banded", band: { low: 1, high: 3 }, notes: [...notes, `${ageNote} -> 1–3`] };
  }
  return {
    status: "unbanded",
    reason: "outside-defined-bands",
    notes: [
      ...notes,
      `${ageNote}`,
      "SKILL.md's Maintenance table has no band for 181–365 days: it jumps from \"≤180 → 4–6\" to \">365 → 1–3\". Reporting the gap instead of inventing a band",
    ],
  };
}
