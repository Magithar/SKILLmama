# Roadmap: what is left

Status as of 2026-11-19: v1.11.0 is released, and `skillmama@0.4.0` is live on
npm. `main` is one feature ahead of both (item 19). Lint, typecheck, 233 tests,
coverage thresholds, package validation and the drift guard all pass.

`skillmama/SKILL.md` is the shipped product and the source of truth.
`packages/core` implements the deterministic parts of the same pipeline as the
`skillmama` npm package, which has its own 0.x version. Nothing in `packages/`
is used by the skill itself.

What shipped, and when, is in [CHANGELOG.md](CHANGELOG.md). This file only
tracks open work. Item numbers are stable, so closed items leave gaps.

---

## P1: next

| # | Task | Notes |
| --- | --- | --- |
| 19 | Release PyPI downloads in the CLI | On `main`, not on npm. `skillmama check --ecosystem PyPI` bands Popularity on pypistats.org `last_week` as well as stars, and links it in the Sources block. It adds a `pypiPackage` API field, so it ships as `skillmama@0.5.0`, with `v1.12.0` for the repo. |
| 14 | File the skills.sh re-audit issue | Checked 2026-11-19: both audits are still dated Nov 6, 2026. Gen Agent Trust Hub shows FAIL (HIGH, from the `curl \| python3` publisher checks) and Snyk shows WARN (W011, third-party content). The FAIL was fixed in v1.10.0. File one upstream issue asking for a re-audit, covering the stale dep-egress audit too. W011 may stay a WARN, since the skill reads third-party content by design. |

## P2: hygiene

| # | Task | Notes |
| --- | --- | --- |
| 10 | Recheck the upstream skills-CLI bug on `skills@1.9.0` | Last checked on `skills@1.7.6` (2026-11-06): Codex and Antigravity global installs land only in `~/.agents/skills`. `1.9.0` came out 2026-11-16. Keep the manual-copy guidance until a fix ships. The two Antigravity fix PRs, vercel-labs/skills#1483 and #2028, closed unmerged. |
| 20 | Find out why PR #1 got no CI | Magithar/SKILLmama#1 got no Actions run on `pull_request`, even after a close and reopen. Pushes to `main` run normally, Actions is enabled, and GitHub reported no outage. It was the repo's first PR. Check the Actions tab when the next PR opens. |
| 16 | Show the commit a release was built from | Read `gitHead` from the npm packument for the checked version and show it next to the version. Print "commit unknown" when it is missing. Never infer one from the latest tag. |

## P3: optional

| # | Task | Notes |
| --- | --- | --- |
| 17 | Maintainer responsiveness | Issue response time and stale-issue analysis as one check. It costs many GitHub API calls per candidate (60/hour unauthenticated), and stale bots and triage bots distort the numbers. Build it only once it's decided which `mapMaintenanceBand()` band it would change, and report a rate-limited run as `N/A (unverified)`. |
| 18 | Compare against previous evaluations | Needs somewhere to keep history, since the skill has no state today. A local cache file is the simplest option. Depends on item 16, so the diff has stable fields to compare. |
| 12 | `analyzeProject()`'s accepted limits | npm alias, workspace, `file:` and GitHub specifiers are read by key only. `go.mod replace` and `requirements.txt -r` includes are not followed, and there's no recursion below the top level. All deliberate. Revisit only if a real scan gets one wrong. |

---

## Known limits, by design

- **Compatibility and Simplicity have no deterministic producer, and never
  will.** Their bands are written in terms only a reader of the docs can
  assess, so the package can't score a candidate alone. Something with
  judgment sits in the middle.
- **Publisher continuity can't run on PyPI or Go.** Neither registry publishes
  a per-release uploader. It's reported as `N/A (unsupported ecosystem)` and
  doesn't change the verdict.
- **No server or hosted runtime as the foundation.** Optional adapters, such as
  MCP or a Cloudflare Agent runtime, stay parked. If they're ever built, they
  sit on top of core, not underneath it.
