# skillmama

Score a library, SDK, or tool the same way SKILLmama's agent skill does, from the terminal.

```bash
npx skillmama scan .                             # what's already in this project
npx skillmama check lodash --version 4.17.15     # live OSV + publisher-continuity + factor bands
```

[![npm](https://img.shields.io/npm/v/skillmama)](https://www.npmjs.com/package/skillmama)
[![npm downloads](https://img.shields.io/npm/dt/skillmama)](https://www.npmjs.com/package/skillmama)

## Why this exists

[`SKILL.md`](../../skillmama/SKILL.md) is the agent-native implementation and
the specification for capability discovery — it is the shipped product and
the sole source of truth. This package implements the slice of that pipeline
that is genuinely deterministic (manifest parsing, scoring arithmetic, plain
HTTP evidence-gathering, fixed decision tables) and injects rather than fakes
everything that is judgment: choosing search terms, judging which hits count,
reading a package's docs and code, scoring Compatibility and Simplicity.
`test/skill-conformance.test.js` parses SKILL.md at test time and fails if the
package's numbers, tables, or query recipes drift from what it actually says.

Published to npm as [`skillmama`](https://www.npmjs.com/package/skillmama),
independently of the repo's own version; the skill does not call it.

`packages/core` is a folder name, not a second package identity. There is one
publishable unit named `skillmama`: it owns the `skillmama` bin (`src/cli/`)
and the API, so a user installing the command never has to learn about a
`core`/`cli` split. `package.json`'s `exports` maps `.` only, so the supported
surface is exactly what [`src/index.ts`](src/index.ts) names — the detector and
parser registries, the tier/companion query builders, the hit normalizers and
the HTTP payload normalizers are internal and cannot be deep-imported.
`test/index.test.js` fails if that list drifts in either direction.

## What's actually implemented

The full pipeline: six deterministic functions, both tool-backed phase
orchestrations (`findCandidates()`, `findCompanionSkills()`), and
`discoverCapabilities()`, which composes Phases 2 through 5 end to end.
Everything judgment-shaped is taken as INJECTED tooling rather than
pretended to be deterministic code.

### `analyzeProject()`

[`src/mechanical/index.ts`](src/mechanical/index.ts).
A **Structured Project Scan**, not full project understanding: it reads
the top-level entries of a project directory and parses a fixed set of
dependency manifests (`package.json`, `pyproject.toml`, `Cargo.toml`,
`requirements.txt`, `go.mod`, `Gemfile`, `composer.json`) plus a few
presence-only config files (`fly.toml`, `render.yaml`, `vercel.json`,
`railway.toml`/`.json`) to produce a `StackProfile`.

It deliberately does **not**: read README/SETUP/DEPLOY prose, infer
technology from source code, decide what the app "actually does," or
reproduce SKILL.md's deeper Phase B1 source-sampling analysis. Those stay
LLM-interpreted behavior that SKILL.md owns directly — see the doc comment
above `analyzeProject()` for the full scope statement.

### `scoreCandidate(candidate, factors)`

Also in [`src/mechanical/index.ts`](src/mechanical/index.ts). The deterministic
slice of Phase 4: given four factors already scored 1–10 per SKILL.md's
bands, it computes the weighted total
(`compatibility×0.40 + popularity×0.30 + maintenance×0.15 + simplicity×0.15`),
renormalizes proportionally when a factor is `"N/A"`, rounds half-up to one
decimal with boundary-tolerant handling, and refuses out-of-range input
loudly. It does **not** produce the factors: Compatibility/Simplicity are
LLM judgment over verified local evidence, and while Popularity/Maintenance
now have a deterministic evidence + band step (`gatherFactorEvidence()`,
below), picking a point inside a band stays judgment for every factor.
Callers also filter BLOCKED and ALREADY PRESENT candidates first, per
Phase 4's preamble.

### `gatherSecurityEvidence(target, options)`

[`src/mechanical/security.ts`](src/mechanical/security.ts) — Phase 3.5
Stage 1, the evidence half of the security gate. Both live-data checks
SKILL.md runs are plain HTTP APIs, so this one is genuinely deterministic:
the [OSV.dev](https://osv.dev) advisory query (severity off
`database_specific.severity`, `hasFix` from any `fixed` event, PYSEC-*/
GHSA-* twins deduped on aliases with severity read off the GHSA twin) and
the npm and crates.io publisher-continuity checks — a faithful port of
SKILL.md Check 2's reference script(s) with all four load-bearing rules:
sort by publish time not registry key/list order; a handoff means the old
guard never publishes again; only the most recent handoff under 12 months
is ever reported; non-human publishers are dropped before detection (npm's
literal bot list; crates.io's null `published_by`, which covers both
trusted-publishing/CI releases and legacy versions from before crates.io
tracked publishers). The two registries parse into a shared history shape
and run through one `findRecentHumanHandoff()`. Transport failure degrades
to `{ status: "unverified", reason: "unreachable" }` per SKILL.md's "never
let an unverified candidate read as having passed", while a reachable
registry returning garbage throws loudly instead of reading clean. PyPI and
Go report publisher continuity as `unsupported-ecosystem` — neither exposes
a per-release uploader, so a candidate there can never imply the check ran.
It deliberately does **not** judge — that is the next function's job. The
pure normalizers (`normalizeOsvQueryResponse`, `detectPublisherHandoff`,
`detectCratesIoPublisherHandoff`) are exported and fixture-tested directly;
tests inject a fetch stub, so the suite never touches the network.

### `resolveSecurityVerdict(evidence, findings)` / `verifyCandidate(...)`

Also in [`src/mechanical/security.ts`](src/mechanical/security.ts) — Phase
3.5 Stage 2. Once Stage 1's evidence exists and an LLM has produced
`ContentFinding[]` by actually reading the candidate's docs/code, emitting
the verdict is not judgment at all but SKILL.md's own decision table:
CRITICAL/HIGH with no fix blocks (note carries the advisory summary
verbatim); with a fix warns ("recommend the fixed version"); MODERATE/LOW
warns; a recent publisher handoff warns; DISCARD-weight findings block
outright over WARN/FLAG; FLAG rules surface independently as `sqpFlags`;
and any unverified check floors the verdict at WARN, because the closed
`GateVerdict` union has no honest third state for "didn't check" and
SKILL.md forbids letting unverified read as passed. Notes are emitted in a
fixed order so identical inputs give byte-identical output;
`verifyCandidate()` only assembles the `SecurityCheckResult`.

### `gatherFactorEvidence(target, options)` + `mapPopularityBand()` / `mapMaintenanceBand()`

[`src/mechanical/factors.ts`](src/mechanical/factors.ts) — the two Phase 4
factors that start from live data, split the same way Phase 3.5 is.
`gatherFactorEvidence()` pulls stars and last-push date from the GitHub repo
API in one request and weekly downloads from the npm downloads API, so a
candidate costs at most two HTTP calls; the mappers then apply SKILL.md's
band tables, which are stated as fixed numeric ranges and so are a lookup,
not a judgment.

Two things it reports rather than guesses:

- **Unverified stays unverified.** A missing repo, a missing npm package, a
  rate-limited GitHub response, and a network failure all produce
  `status: "unverified"` with a distinct reason, and a factor whose sources
  were all unverified maps to `no-verified-evidence` — SKILL.md's explicit
  instruction for Maintenance: mark it `N/A (unverified)` rather than
  assigning a number.
- **The 10 band asks for more than a push date.** SKILL.md's Maintenance 10
  is "≤30 days, *active releases*", which `pushed_at` cannot establish, so
  the band comes with an explicit note saying the release half is
  unverified.

Two boundary decisions SKILL.md leaves open are fixed and documented: its
band edges overlap (1k stars is in both "100–1k" and "1k–10k"), so the
higher band wins at an exact edge; and the Popularity clauses are joined by
OR, so the best band across available sources wins — a library with 40 stars
and 3M weekly downloads scores 10, which is what the OR plainly says.
Compatibility and Simplicity get no such treatment on purpose: their bands
are written in terms of "well-documented", "significant glue code",
"minimal config", which only a reader of the docs can assess.

### `normalizeSearchHits(tierResults)`

[`src/mechanical/search.ts`](src/mechanical/search.ts) — Phase 3 Stage C,
the deterministic tail of `findCandidates()`: TierResult[] whose hits Stage
B has judged to count become deduplicated `Candidate[]` with tier
provenance. Names are extracted structurally where URLs carry them
(`github.com/{owner}/{repo}` deep links incl. `.git` stripping,
`npmjs.com/package/{name}` including `@scope/pkg`, `pypi.org/project/{name}`),
with the hit's own title as fallback and a GitHub site-namespace blocklist
(`/topics`, `/trending`, …) so product pages never masquerade as repos.
Results process in canonical tier rank, so cross-tier duplicates resolve to
the earlier tier deterministically; hits with neither a known URL pattern
nor a usable title are dropped rather than guessed at.

## Everything judgment-shaped is injected, never faked

### `findCandidates(request, tooling)`

[`src/reasoning/index.ts`](src/reasoning/index.ts) — Phase 2+3
orchestration. `tooling.plan()` (Stage A: choose 3–5 search terms — LLM
judgment) and `tooling.executeTier()` (Stage B: run a tier's queries with a
web-search tool and judge which hits count) are the caller's; everything
an agent harness must never get wrong is the package's: the SKILL.md tier
recipes as mechanically filled templates (`buildTierQueries`, with
deterministic first-sorted language/framework picks and token-dropping
when the stack is unknown), all four tiers executed in canonical order,
per-tier structural validation that surfaces a broken executor at its own
tier, SKILL.md's early-stop state passed through (`candidatesSoFar`,
verbatim constraints), and Stage C normalization through
`normalizeSearchHits()`. Malformed stage output throws loudly — missing
work must never read as "fewer results".

### `findCompanionSkills(candidate, tooling)`

Also in [`src/reasoning/index.ts`](src/reasoning/index.ts) — Phase 3.6+3.7
end-to-end. Phase 3.6 needs no planner at all: its four searches are FIXED
(`buildCompanionQueries()` pins them verbatim, including the load-bearing
quotes in `site:github.com "SKILL.md"`), executed via injected
`tooling.search()`, normalized per source by `normalizeCompanionHits()`
(repo names from GitHub, slugs from skill directories, title fallback,
drop-don't-guess), deduplicated across sources resolving to the earlier
recipe. The terminalskills.io reliability rating is extracted worst-wins
from hit text for that source alone. Every found skill then goes through
`resolveCompanionGate()` — the Phase 3.7 decision table: SUSPICIOUS/
MALICIOUS rating auto-discards regardless of findings; DISCARD-weight
findings win outright over WARN/FLAG; FLAGs surface as deduplicated
`sqpFlags`. Judgment stays where it belongs: `tooling.evaluate()` (reading
the skill's content) is injected. BLOCKED skills are filtered entirely —
discarded skills never surface; survivors carry `notes`/`sqpFlags` only
when the gate fired. All four sources always run: an empty return means
"searched everything, nothing survived", never "skipped".

### `discoverCapabilities(request, tooling, options)`

[`src/reasoning/index.ts`](src/reasoning/index.ts) — Phases 2 through 5,
composed. Every phase above was individually implemented and none of them
composed: a caller had to know the order, remember to filter BLOCKED
candidates before scoring, remember that ALREADY PRESENT ones are never
scored at all, and remember that a factor with no verified evidence must be
`"N/A"`. Those are exactly the rules SKILL.md states as prohibitions,
because they are the ones that get forgotten, so this function owns them:

- ALREADY PRESENT candidates are dropped **before** scoring, matched with
  the same PEP 503-style normalization `analyzeProject()` uses, and returned
  in their own list rather than discarded.
- BLOCKED candidates never reach scoring and never rank — but they are
  returned too, because the user should know something was found and
  rejected.
- Security and factor evidence are gathered in parallel per candidate, then
  the Phase 3.5 decision table and the band lookups run on it.
- **The judged factors are checked against their verified bands before any
  arithmetic runs.** An injected judge may pick a point inside a band and
  nothing else: Popularity `10` on a candidate whose live evidence says
  `7–9` throws, and so does `"N/A"` on a factor whose band *was* verified.
  This is the invariant that makes the deterministic factor work worth
  having, and it is the reason `judgeFactors()` receives bands rather than
  raw numbers.
- Ranking is total and reproducible: score descending, `"N/A"` totals last,
  ties broken by search tier then name.
- The companion-skill phase runs by default because SKILL.md marks it
  REQUIRED. Skipping it needs an explicit `skipCompanionSkills: true`, and
  the omission is recorded in `notes` — an empty `companionSkills` list must
  never silently mean "nothing found".

What stays injected: `plan()` and `executeTier()` (as above), `resolve()`
(which package at which version — SKILL.md's "query the version you intend
to recommend" trap lives here), `inspect()` (reading a library's docs and
code for Phase 3.5 content findings), and `judgeFactors()`. Missing tooling
throws by name; there is no mode in which a stage silently does less.

## The `skillmama` CLI

Two commands, both running only the parts of SKILLmama's pipeline that need no
judgment. Source in [`src/cli/`](src/cli); process-level behavior is pinned by
`test/cli-e2e.test.js`, which spawns the built binary against `fixtures/`.

### Usage

```
skillmama scan [dir]        Structured project scan (default: current directory)
skillmama check <package>   Live-data checks against a published package
```

| Option | Effect |
| --- | --- |
| `--json` | machine-readable output |
| `--ecosystem npm\|PyPI\|Go\|crates.io` | registry to check against (default `npm`) |
| `--version <v>` | version to check; omit to query the registry's latest (npm only) |
| `--repo <owner/name>` | GitHub repo to pull stars/last-push from; inferred from npm metadata when omitted |
| `-h, --help` | show usage |

| Exit code | Meaning |
| --- | --- |
| `0` | completed, verdict PASS or WARN |
| `1` | failed |
| `2` | usage error |
| `3` | completed, verdict BLOCKED |

#### scan

The same deterministic slice SKILL.md's Phase 1 uses: it reads only top-level
manifest/config files, never README prose or source code. Unknown technologies
are silently ignored; a malformed manifest fails loudly.

#### check

Runs the OSV.dev advisory query, the npm publisher-continuity check, and the
Popularity/Maintenance band lookups against live registries, then applies
Phase 3.5's decision table.

```
$ skillmama check lodash --version 4.17.15

lodash@4.17.15  (npm)

Not checked:
  ! Repository lodash/lodash was read from the npm metadata, not supplied.
  ! Phase 3.5 content inspection did not run: no docs or code were read, so
    guardrail-circumvention, exfiltration and SQP findings were not looked for.
    A PASS below means the live-data checks found nothing, not that the package
    is safe.

Verdict  WARN

  - OSV HIGH GHSA-35jh-r3h4-6jhm: Command Injection in lodash has a fixed
    version available — recommend the fixed version
  ...

Popularity    10/10  (pick a point in this band)
Maintenance   7-9/10  (pick a point in this band)
```

Three things about that output are deliberate:

- **What did not run prints before the verdict.** This command has no LLM, so
  it cannot produce Phase 3.5's content findings — it passes an empty finding
  list because nobody read the code. A reader who stops after the first screen
  must not come away thinking a package was cleared when half the gate ran.
- **The bands are ranges, not scores.** SKILL.md defines bands, and picking a
  point inside one is judgment. The CLI hands you the band it verified.
- **Substitutions are announced.** With no `--version`, npm's latest is queried
  and the output says so, because SKILL.md is explicit that querying "latest"
  instead of the version you intend to recommend is a trap. Outside npm, no
  version is guessed at all: `--version` is required.

`GITHUB_TOKEN`, if set, is sent to the GitHub API. Unauthenticated requests are
capped at 60/hour per IP; a rate-limited response degrades to `unverified`
rather than to a wrong number.

### What this CLI still does not do

`discoverCapabilities()` composes Phases 2 through 5 end to
end, but four of its stages are injected judgment: choosing search terms,
judging which search hits count, reading a package's docs and code, and scoring
Compatibility and Simplicity. A CLI has no LLM to supply them, so rather than
stub them with something that looks like an answer, this tool runs the half it
can run honestly. Driving the full pipeline needs an agent harness, and
[`skillmama/SKILL.md`](../../skillmama/SKILL.md) remains where that happens.

## Layout

```
src/
  contracts/   shared types (StackProfile, Candidate, SecurityEvidence/
               SecurityCheckResult, SearchPlan/TierResult, ScoringFactors/CandidateScore,
               PopularityEvidence/MaintenanceEvidence/BandOutcome,
               DiscoveryEntry/DiscoveryResult)
  mechanical/  functions where the work is genuinely deterministic (file parsing,
               scoring arithmetic, plain-HTTP security- and scoring-factor
               evidence gathering, fixed decision tables and band tables,
               search-hit normalization, recipe template filling)
  reasoning/   orchestration of the tool-backed phases and the end-to-end
               composition — judgment and web search are injected;
               sequencing, filtering and normalization stay here
  cli/         the `skillmama` binary (scan, check) — a consumer of the above,
               not part of the exported API
  index.ts     the public API boundary; `exports` maps "." to this file only
fixtures/      sample projects + expected StackProfile output, used by test/fixtures.test.js
```

## Testing

```
npm test
```

Runs `tsc` then the `node:test` suite (unit tests for detectors/parsers/scoring/
security/search/factors/pipeline/discovery, a public-API export boundary test, and
fixture-driven tests for `analyzeProject()`, plus `cli-render`/`cli-check`/`cli-e2e`
for the binary). The security, factors, pipeline, discovery and CLI tests inject
fetch/search stubs or spawn the binary offline — nothing here touches the network.

`test/skill-conformance.test.js` is the one that keeps this package honest.
`scripts/check-skill-untouched.sh` guards `skillmama/SKILL.md` against copy
drift; nothing guarded SKILL.md's *prose* against the code reimplementing the
same phase, so the two could diverge silently. That test parses SKILL.md at test
time and asserts the package agrees with what it actually says: the 40/30/15/15
weights, both band tables (probed on both sides of every stated edge), the
literal npm bot-publisher list, the tier headings and their query recipes
(expanded to concrete strings and compared exactly, so a dropped literal word
cannot slip through a wildcard), and Phase 3.6's four fixed companion searches.
It was mutation-tested: ten separate edits to SKILL.md — a moved weight, a moved
band edge on either table, a removed bot, a reworded tier heading, a changed
`stars:>500` filter, a dropped word in a recipe, a changed companion query — each
produce a failure. SKILL.md stays the source of truth: when one of these fails,
the question is what changed in SKILL.md and whether the code still matches,
never how to make the test pass.
