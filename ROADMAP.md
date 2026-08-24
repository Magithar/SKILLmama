# Roadmap — what is left

Status as of 2026-08-24. Reflects the working tree, which is ahead of the last
commit (`87443d7`, v1.7.0): the full pipeline skeleton, the CI workflow, and the
Phase 3.5 Stage 2 decision table are implemented but uncommitted.

`skillmama/SKILL.md` is the shipped product and the sole source of truth.
`packages/` is an additive layer that implements the deterministic slices of the
same pipeline and injects, rather than fakes, the rest. Nothing in `packages/`
is used by the skill today.

Priorities: **P0** blocks a release, **P1** is the next real work, **P2** is
hygiene, **P3** is optional or parked.

---

## P0 — before anything else ships

| # | Task | Why it blocks |
| --- | --- | --- |
| 1 | Commit the working tree | ~900 lines across 14 modified and 6 new files sit uncommitted, including two full orchestrations and CI. All 142 tests pass and the drift guard is green, so this is a commit, not a rescue — but until it lands, none of it is on `main` and CI has never actually run. |
| 2 | Cut v1.8.0 | The `[Unreleased]` CHANGELOG section is already written and substantial. It needs a version, a date, and a tag. |
| 3 | Tag v1.6.0 and v1.7.0 | Tags stop at `v1.5.0` while the CHANGELOG documents two further releases. Either backfill both tags or state in the CHANGELOG that code releases are untagged on purpose. |

## P1 — the next real work

| # | Task | Notes |
| --- | --- | --- |
| 4 | Decide whether to publish the packages | Both are `private: true` at `0.0.1` while the repo is at 1.7.0. The unscoped npm name `skillmama` is confirmed available. Two decisions, not one: publish or stay private, and whether package versions track the repo version or run independently. |
| 5 | Produce the scoring factors | `scoreCandidate()` takes four factors already on the 1–10 bands, and nothing in the package produces them. Popularity and Maintenance start from live data (stars, downloads, last-commit date) that no code fetches — the same shape as `gatherSecurityEvidence()`, so this is a real deterministic slice, not judgment. This is the largest genuine gap left in the pipeline. |
| 6 | Extend publisher continuity beyond npm | PyPI, crates.io, RubyGems, and Go all return `reason: "unsupported-ecosystem"`. A Python candidate can never be said to have passed this check, which is a visible hole given SKILLmama's Python examples. |
| 7 | Live-test Codex | The last open item of the four-adapter work. Antigravity was tested end to end and works; Codex has never been run at all, and its README status stays ⚠️ unverified until someone installs the CLI, restarts it, and runs a real capability prompt. |
| 8 | Wire the CLI to the rest of the pipeline | `skillmama scan [dir]` is still the only command. Correct while the pipeline was stubbed; now that the orchestrations exist, the CLI is the natural place to prove they compose — it needs a tooling implementation to inject. |

## P2 — hygiene

| # | Task | Notes |
| --- | --- | --- |
| 9 | Resolve the "5-tier" naming | SKILL.md's `description`, the README heading, and the nav link all say five tiers. There are four numbered tiers plus a Companion Skills search that SKILL.md explicitly calls *not* a scored tier. Touching `skillmama/SKILL.md` trips the drift guard by design, so do it as its own deliberate change with an eval re-run. |
| 10 | Publish the GitHub Releases | Every version through v1.5.0 has a GitHub Release; 1.6.0, 1.7.0 and 1.8.0 have none. The `dev/RELEASE-*.md` files are the drafts those release bodies come from verbatim — drafts for all three now exist. Format: title `vX.Y.Z — short description`, body `# SKILLmama vX.Y.Z` with Changed/Added/Fixed/Notes and a Full Changelog link. |
| 11 | Dev.to Part 9 | The build-in-public series stops at Part 8 (the OSV and publisher checks). The first real code in the project — the packages, the honesty boundary, injected tooling instead of fake determinism — has no post, and it is the most interesting entry in the series. |
| 12 | Recheck the upstream skills-CLI bug | Rechecked 2026-08-24: PR #1483 still unmerged, newer PR #2028 also open, `skills@1.5.23` still misroutes. The two ❌ rows in the AI Adapters table change only when a fix merges *and* ships in a released CLI version. Recheck on the next release. |
| 13 | skills.sh listing | Indexing request was to be filed as a GitHub issue in `vercel-labs/skills`; issue creation was restricted when last checked. |

## P3 — optional

| # | Task | Notes |
| --- | --- | --- |
| 14 | An eval covering the packages | 142 tests cover the deterministic functions. Nothing checks that SKILL.md's prose pipeline and the package's implementation of the same phase actually agree — the drift risk the guard script does not cover. |
| 15 | `analyzeProject()`'s accepted v1 limits | npm alias / workspace / `file:` / GitHub specifiers read by key only, `go.mod replace` not followed, `requirements.txt -r` includes not followed, no recursion below the top level. All deliberate; revisit only if a real scan gets them wrong. |

---

## Not planned

No server or hosted runtime as the foundation — an explicit decision, not an
omission. Optional adapters (MCP, a Cloudflare Agent runtime) stay parked and,
if ever built, sit on top of core rather than underneath it.
