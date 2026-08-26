# Roadmap — what is left

Status as of 2026-08-26, at v1.8.0 plus unreleased work on `main`. CI is green
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

Before that: committed and pushed the pipeline skeleton, added CI, backfilled
the `v1.6.0` and `v1.7.0` tags, cut and tagged `v1.8.0`, and published GitHub
Releases for all three. CI failed on its first run and caught a genuine bug —
the CLI build needed core's `.d.ts` and `dist/` is gitignored, so the suite had
never run against a clean tree. Fixed and verified green.

## P1 — the next real work

| # | Task | Notes |
| --- | --- | --- |
| 5 | Cut a release for the factors work, and publish the package | The Popularity/Maintenance implementation sits under `[Unreleased]` in the CHANGELOG. Tag and publish it the same way as v1.6.0–v1.8.0, with the release body drafted in `dev/`. Per task 4's decision, the same cut publishes `skillmama@0.1.0` to npm: drop `"private": true`, `npm publish`, and update the README Packages table from "private, unpublished". Package versions run independently of the repo version from here on. |
| 6 | Extend publisher continuity beyond npm | PyPI, crates.io, RubyGems, and Go all return `reason: "unsupported-ecosystem"`. A Python candidate can never be said to have passed this check, which is a visible hole given SKILLmama's Python examples. |
| 7 | Live-test Codex | The last open item of the four-adapter work. Antigravity was tested end to end and works; Codex has never been run at all, and its README status stays ⚠️ unverified until someone installs the CLI, restarts it, and runs a real capability prompt. |

## P2 — hygiene

| # | Task | Notes |
| --- | --- | --- |
| 8 | Two SKILL.md corrections, as one deliberate edit | (a) The "5-tier" naming: `description`, the README heading, and the nav link all say five tiers, but there are four numbered tiers plus a Companion Skills search that SKILL.md explicitly calls *not* a scored tier. (b) The Maintenance band table has no band for 181-365 days — it jumps from "≤180 → 4-6" to "> 365 → 1-3". `mapMaintenanceBand()` currently reports that hole rather than guessing; closing it needs a decision about what a 6-month-stale repo should score. Touching `skillmama/SKILL.md` trips the drift guard by design, so do both together with an eval re-run. |
| 9 | Dev.to Part 9 | The build-in-public series stops at Part 8 (the OSV and publisher checks). The first real code in the project — the packages, the honesty boundary, injected tooling instead of fake determinism — has no post, and it is the most interesting entry in the series. |
| 10 | Recheck the upstream skills-CLI bug | Rechecked 2026-08-24: PR #1483 still unmerged, newer PR #2028 also open, `skills@1.5.23` still misroutes. The two ❌ rows in the AI Adapters table change only when a fix merges *and* ships in a released CLI version. Recheck on the next release. |
| 11 | skills.sh listing | Indexing request was to be filed as a GitHub issue in `vercel-labs/skills`; issue creation was restricted when last checked. |

## P3 — optional

| # | Task | Notes |
| --- | --- | --- |
| 12 | `analyzeProject()`'s accepted v1 limits | npm alias / workspace / `file:` / GitHub specifiers read by key only, `go.mod replace` not followed, `requirements.txt -r` includes not followed, no recursion below the top level. All deliberate; revisit only if a real scan gets them wrong. |

---

## Not planned

No server or hosted runtime as the foundation — an explicit decision, not an
omission. Optional adapters (MCP, a Cloudflare Agent runtime) stay parked and,
if ever built, sit on top of core rather than underneath it.
