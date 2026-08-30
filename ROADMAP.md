# Roadmap — what is left

Status as of 2026-08-31, at v1.8.0 plus unreleased work on `main`. CI is green
on Node 18/20/22, and v1.6.0/v1.7.0/v1.8.0 are tagged with GitHub Releases
published.

`skillmama/SKILL.md` is the shipped product and the sole source of truth.
`packages/` is an additive layer that implements the deterministic slices of the
same pipeline and injects, rather than fakes, the rest. Nothing in `packages/`
is used by the skill today.

Priorities: **P1** is the next real work, **P2** is hygiene, **P3** is optional
or parked. P0 is empty — nothing currently blocks a release.

Known limits, deliberate rather than pending: Compatibility and Simplicity have
no deterministic producer and never will (their bands are written in terms only
a reader of the docs can assess), so the package cannot score a candidate alone
— something with judgment sits in the middle by design.

---

## Done since the last revision

Task 8 is done: SKILL.md's "5-tier" naming is corrected to "4-tier search plus a
companion-skills pass" everywhere it appeared as a live claim (frontmatter
`description`, README hero line, README nav link), and the Maintenance
181-365 day gap is closed with a `3-5` band, splitting the difference between
`≤180 → 4-6` and `>365 → 1-3`. `mapMaintenanceBand()`'s `outside-defined-bands`
branch had exactly one producer, so it and the reason itself are gone from
`BandOutcome` rather than left unreachable. The conformance test that
tripwired on the gap now tripwires on it reopening instead. Core is still at
204 tests (5 rewritten, 0 added — the gap closure changed what existing tests
assert, not how many there are).

The two packages are now one: `packages/cli` is deleted and folded into
`packages/core`, which carries the `skillmama` bin and the programmatic API as
a single publishable unit (version 0.0.1 -> 0.1.0, engines ->18.3 for
`util.parseArgs`, LICENSE copied in at pack time). The public API surface went
from wholesale `export *` re-exports to a declared boundary — `exports` maps
`.` only, `src/index.ts` names what is public, and `test/index.test.js` pins
the list. One merged suite, 204 tests.

Task 4's two decisions are made: publish to npm, with the package running its
own independent 0.x semver rather than tracking the repo's 1.x — honest about
an API whose boundary was just declared, and free to break without dragging
the repo's major along. Execution folds into task 5, the release cut.

Tasks 8 and 13 are done, plus the three structural problems behind them.

`packages/` had no consumer: SKILL.md never referenced it, so it was a parallel
implementation nothing exercised. `skillmama check <package>` now runs the
live-data half of the pipeline — OSV advisories, npm publisher continuity, the
Popularity/Maintenance bands — against real registries. Verified end to end:
`flatmap-stream@0.1.1`, the event-stream backdoor payload, comes back BLOCKED
with exit 3. SKILL.md is untouched; that stays a separate decision.

Nothing composed the phases: each was implemented and a caller had to remember
the order and the filtering rules. `discoverCapabilities()` runs Phases 2-5 and
owns those rules, including the one that makes the factor work worth having —
an injected judge may pick a point inside a verified band and nothing else.

Task 13 was promoted out of P3 on the way: SKILL.md's prose and the
package's code for the same phase are now checked against each other by
`packages/core/test/skill-conformance.test.js`, which parses SKILL.md at test
time. Mutation-tested against ten separate SKILL.md edits, all caught.

Task 5 is done: Phase 4's two live-data scoring factors are implemented
(`gatherFactorEvidence()`, `mapPopularityBand()`, `mapMaintenanceBand()` in
`packages/core/src/mechanical/factors.ts`). `scoreCandidate()` no longer takes
four factors that nothing produces — two of them now come from verified live
data, with the caller only picking a point inside the returned band. The work
also surfaced a genuine gap in SKILL.md itself: its Maintenance table has no
band for 181-365 days, which the mapper reports as `outside-defined-bands`
rather than guessing. Folded into task 8, which already owns the SKILL.md edit.
Core is at 152 tests.

Task 6 is done: publisher continuity now covers crates.io alongside npm.
`detectCratesIoPublisherHandoff()` in `packages/core/src/mechanical/security.ts`
runs the same four rules as the npm check against crates.io's crate response
(`versions[]` is embedded directly, no separate time map to join) — a null
`published_by` (trusted publishing via CI, or a legacy version from before
crates.io tracked publishers) is dropped before detection the same way npm's
missing `_npmUser` is, so no literal bot list is needed on this side.
Verified end to end against live data: `ripgrep` and `rustls` (whose `ctz`/
`djc`/`cpu` team rotation is the crates.io analogue of npm's express/lodash/
chalk) both correctly report no handoff. crates.io's crawler policy 403s
requests with no descriptive `User-Agent`, unlike npm's registry. SKILL.md's
Check 2 documents the crates.io script alongside the npm one; PyPI and Go
remain `N/A (unsupported ecosystem)` — neither exposes a per-release
uploader. Core is at 212 tests (8 added).

Before that: committed and pushed the pipeline skeleton, added CI, backfilled
the `v1.6.0` and `v1.7.0` tags, cut and tagged `v1.8.0`, and published GitHub
Releases for all three. CI failed on its first run and caught a genuine bug —
the CLI build needed core's `.d.ts` and `dist/` is gitignored, so the suite had
never run against a clean tree. Fixed and verified green.

## P1 — the next real work

| # | Task | Notes |
| --- | --- | --- |
| 5 | Cut a release for the factors work, and publish the package | The Popularity/Maintenance implementation and the crates.io publisher check both sit under `[Unreleased]` in the CHANGELOG. Tag and publish it the same way as v1.6.0–v1.8.0, with the release body drafted in `dev/`. Per task 4's decision, the same cut publishes `skillmama@0.1.0` to npm: drop `"private": true`, `npm publish`, and update the README Packages table from "private, unpublished". Package versions run independently of the repo version from here on. |
| 7 | Live-test Codex | The last open item of the four-adapter work. Antigravity was tested end to end and works; Codex has never been run at all, and its README status stays ⚠️ unverified until someone installs the CLI, restarts it, and runs a real capability prompt. |

## P2 — hygiene

| # | Task | Notes |
| --- | --- | --- |
| 9 | Dev.to Part 9 | Draft written: `dev/devto-article-v9.md` — the mechanical/judgment line, the SKILL.md conformance test and the gap it caught, the crates.io extension. References the npm-published CLI and the closed Maintenance gap, so hold publishing until task 5's release actually ships them. Posting itself needs a human with Dev.to account access. |
| 10 | Recheck the upstream skills-CLI bug | Rechecked 2026-08-31: no change since 2026-08-24. PR #1483 and PR #2028 both still open and unmerged; issues #1060/#1470 both still open; npm's published `skills` is still `1.5.23` (released 2026-08-19, before either PR). The two ❌ rows in the AI Adapters table change only when a fix merges *and* ships in a released CLI version. Recheck on the next release. |
| 11 | skills.sh listing | Rechecked 2026-08-31: issue creation on `vercel-labs/skills` is no longer restricted (issues enabled, blank issues allowed). What's unclear now is the ask itself — the README's skills.sh badge/link already resolves for this repo, so what gap the original "indexing request" meant to close needs to be re-established before filing anything. |

## P3 — optional

| # | Task | Notes |
| --- | --- | --- |
| 12 | `analyzeProject()`'s accepted v1 limits | npm alias / workspace / `file:` / GitHub specifiers read by key only, `go.mod replace` not followed, `requirements.txt -r` includes not followed, no recursion below the top level. All deliberate; revisit only if a real scan gets them wrong. |

---

## Not planned

No server or hosted runtime as the foundation — an explicit decision, not an
omission. Optional adapters (MCP, a Cloudflare Agent runtime) stay parked and,
if ever built, sit on top of core rather than underneath it.
