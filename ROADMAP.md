# Roadmap — what is left

Status as of 2026-08-31, at v1.9.0. CI is green on Node 18/20/22; v1.6.0
through v1.9.0 are tagged with GitHub Releases published. `skillmama@0.1.0`
is live on npm, publishing independently of the repo's own version from
here on.

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

**v1.9.0 is tagged, released, and `skillmama@0.1.0` is live on npm** —
verified post-publish via `npx skillmama@0.1.0`, not just a local build:
`scan` reads a real project's manifest correctly, `check flatmap-stream
--version 0.1.1` reproduces the BLOCKED/exit-3 result against the real
event-stream backdoor payload, and `check ripgrep --ecosystem crates.io`
exercises the new crates.io publisher-continuity path end to end, JSON
output included. This folds in everything below plus task 4's publish
decision (own 0.x semver, independent of the repo's 1.x) and task 5's
release cut (CHANGELOG's `[Unreleased]` moved to `[1.9.0]`, GitHub Release
published from `dev/RELEASE-1.9.0.md`).

Task 8: SKILL.md's "5-tier" naming corrected to "4-tier search plus a
companion-skills pass" everywhere it appeared as a live claim, and the
Maintenance 181–365 day gap closed with a `3-5` band. `mapMaintenanceBand()`'s
`outside-defined-bands` branch had exactly one producer, so it and the reason
itself are gone from `BandOutcome` rather than left unreachable.

Task 6: publisher continuity now covers crates.io alongside npm.
`detectCratesIoPublisherHandoff()` runs the same four rules as the npm check
against crates.io's shape (`versions[]` embedded directly, no separate time
map to join; a null `published_by` — trusted-publishing/CI or a pre-tracking
legacy version — takes the place of npm's bot list). Verified against
`ripgrep` and `rustls` (whose `ctz`/`djc`/`cpu` rotation is the crates.io
analogue of npm's express/lodash/chalk). PyPI and Go stay
`unsupported-ecosystem` — neither exposes a per-release uploader.

The two packages are one now: `packages/cli` is deleted and folded into
`packages/core`, publishing as a single unit named `skillmama` with a
declared `exports` boundary (`src/index.ts` names exactly what's public,
`test/index.test.js` pins the list).

`packages/` also gained a real consumer (`skillmama check`), full-pipeline
composition (`discoverCapabilities()`, owning the sequencing rules SKILL.md
states as prohibitions), and a conformance suite
(`skill-conformance.test.js`) that parses SKILL.md at test time instead of
hardcoding its numbers — mutation-tested against ten separate SKILL.md edits,
all caught. Core is at 212 tests.

Dev.to Part 9 is drafted (`dev/devto-article-v9.md`), covering the
mechanical/judgment boundary, the conformance test, and the crates.io
extension — ready to post now that the release it references has shipped.

## P1 — the next real work

| # | Task | Notes |
| --- | --- | --- |
| 7 | Live-test Codex | The last open item of the four-adapter work. Antigravity was tested end to end and works; Codex has never been run at all, and its README status stays ⚠️ unverified until someone installs the CLI, restarts it, and runs a real capability prompt. |

## P2 — hygiene

| # | Task | Notes |
| --- | --- | --- |
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
