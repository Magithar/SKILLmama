# Changelog

All notable changes to SKILLmama are documented here.

---

## [Unreleased]

### Added
- **The two scoring factors that start from live data**
  (`packages/core/src/mechanical/factors.ts`, `src/contracts/factors.ts`): Phase 4's
  Popularity and Maintenance now have a deterministic path, split the same way Phase 3.5
  is. `gatherFactorEvidence()` pulls stars and last-push date from the GitHub repo API in
  one request and weekly downloads from the npm downloads API, so a candidate costs at
  most two HTTP calls; `mapPopularityBand()` and `mapMaintenanceBand()` then apply
  SKILL.md's band tables, which are stated as fixed numeric ranges and so are a lookup
  rather than a judgment. This closes the gap where `scoreCandidate()` took four factors
  nothing in the package computed — two of them are now produced from verified live data,
  with the caller only picking a point inside the returned band
- **Three things the mappers report instead of guessing.** SKILL.md's Maintenance table
  has no band for 181-365 days: it jumps from "≤180 → 4-6" straight to "> 365 → 1-3", so
  a repo last pushed 8 months ago falls in a hole. That is a gap in SKILL.md, not in the
  data, so the outcome is `unbanded: "outside-defined-bands"` carrying the measured age
  rather than an invented band. SKILL.md's Maintenance 10 is "≤30 days, *active
  releases*", and `pushed_at` cannot establish the release half, so that band comes with
  an explicit note. And a factor whose sources all came back unverified maps to
  `no-verified-evidence`, which is SKILL.md's own instruction: mark Maintenance
  `N/A (unverified)` rather than assigning a number
- **Two band-edge decisions SKILL.md leaves open, fixed and documented.** Its ranges
  overlap (1k stars is in both "100-1k" and "1k-10k"), so the higher band wins at an exact
  edge, matching how the table reads top-down. And the Popularity clauses are joined by
  OR, so the best band across available sources wins: a library with 40 stars and 3M
  weekly downloads scores 10, which is what the OR plainly says
- **23 tests** covering both payload normalizers, the request-count and absent-source
  behavior of the gatherer, every band edge in both tables from both sides, the 181-365
  gap, archived-beats-recency, and a gathered-evidence-to-band end-to-end pass. Fetch is
  stubbed throughout; the suite still never touches the network. Core is at 152 tests

- **SKILL.md conformance tests** (`packages/core/test/skill-conformance.test.js`):
  `check-skill-untouched.sh` guarded SKILL.md against copy drift, but nothing guarded
  SKILL.md's prose against the code reimplementing the same phase — the two could diverge
  silently and the suite would stay green. This parses SKILL.md at test time and asserts
  the package agrees with what it actually says: the 40/30/15/15 weights (verified
  functionally over several factor tuples, not by reading a constant), both band tables
  probed on **both sides** of every stated edge, the literal npm bot-publisher list, the
  tier headings and their query recipes, and Phase 3.6's four fixed companion searches.
  Tier recipes are expanded to concrete strings and compared exactly rather than
  wildcard-matched: the first version used regex wildcards for `[placeholders]`, and a
  wildcard silently swallowed a dropped literal word. Mutation-tested against ten separate
  SKILL.md edits — moved weight, moved band edge on either table, removed bot, renamed
  tier, changed `stars:>500`, dropped word in a recipe, changed companion query — all ten
  now fail the suite. SKILL.md stays the source of truth: a failure means the code needs
  updating, never the test
- **Test counts**: core 129 -> 177, CLI 13 -> 26

- **`discoverCapabilities()`** (`packages/core/src/reasoning/index.ts`,
  `src/contracts/discovery.ts`): Phases 2 through 5, composed. Every phase was
  individually implemented and none of them composed — a caller had to know the order,
  remember to filter BLOCKED candidates before scoring, remember that ALREADY PRESENT ones
  are never scored at all, and remember that a factor with no verified evidence must be
  `"N/A"`. Those are the rules SKILL.md states as prohibitions, because they are the ones
  that get forgotten, so the function owns them: ALREADY PRESENT dropped before scoring
  (matched with the same PEP 503-style normalization `analyzeProject()` uses) and returned
  in its own list, BLOCKED never scored but never silently dropped either, evidence
  gathered in parallel per candidate, ranking total and reproducible (score, then tier,
  then name), and the REQUIRED companion phase impossible to skip by accident — omitting it
  takes an explicit flag and is recorded in `notes`
- **The band invariant.** `discoverCapabilities()` verifies the injected judge's factors
  against the bands the live evidence produced, before any arithmetic runs. Popularity `10`
  on a candidate whose evidence says `7-9` throws; so does `"N/A"` on a factor whose band
  *was* verified, since that direction is equally a lie. This is what makes the
  deterministic factor work worth having, and it is why `judgeFactors()` receives bands
  rather than raw numbers
- **`skillmama check <package>`** (`packages/cli`): the CLI now consumes more than
  `analyzeProject()`. `check` runs the OSV.dev advisory query, the npm publisher-continuity
  check and the Popularity/Maintenance band lookups against live registries, then applies
  Phase 3.5's decision table. `--ecosystem`, `--version`, `--repo`, `--json`; exit `3` on
  BLOCKED so it is usable in CI. Verified end to end against live data:
  `flatmap-stream@0.1.1`, the actual event-stream backdoor payload, comes back BLOCKED
- **What the CLI cannot do prints before the verdict.** It has no LLM, so it cannot produce
  Phase 3.5's content findings and passes an empty finding list because nobody read the
  code. That omission is stated above the verdict, not as a footnote: a reader who stops
  after the first screen must not come away thinking a package was cleared when half the
  gate ran. Substitutions are announced for the same reason — with no `--version` the
  registry's latest is queried and the output says so, since SKILL.md is explicit that
  querying "latest" instead of the version you intend to recommend is a trap. Outside npm
  no version is guessed at all

### Fixed
- **`resolveNpmDefaults()` announced a substitution that had not happened.** It reported
  "no --version given, so latest was queried" whenever it ran, including when the user had
  passed `--version` and only the repository was being filled in. The version actually
  queried was always correct; the note was not. Found by running the command against
  `lodash --version 4.17.15` and reading the output. The function now reports only what it
  found, and the caller decides what to announce

### Notes
- Compatibility and Simplicity deliberately get no equivalent. Their bands are written in
  terms of "well-documented", "significant glue code", "minimal config" — properties only
  a reader of the docs can assess, so there is no evidence stage to build. Two of four
  factors is the honest ceiling here, not a partial job

---

## [1.8.0] - 2026-08-24

### Added
- **CI workflow** (`.github/workflows/ci.yml`): `npm test` across the workspaces plus
  `scripts/check-skill-untouched.sh`, on push and PR, Node 18/20/22. Until now both the
  test suite and the drift guard only ran when someone remembered to run them locally; the guard exists
  because copy drift caused two shipped bugs, so it should be load-bearing
- **`findCandidates()` implemented via injected tooling** (`packages/core/src/reasoning/index.ts`):
  Phase 2+3 is now orchestrated end-to-end instead of throwing. The design keeps the package's
  honesty boundary intact — reasoning (Stage A: choosing 3-5 search terms) and tool work (Stage B:
  running web searches and judging which hits count) are injected as `tooling.plan()` /
  `tooling.executeTier()`, never faked; what the package owns is what an agent harness must never
  get wrong: the SKILL.md tier recipes as mechanically filled templates (`buildTierQueries()` with
  deterministic first-sorted language/framework picks from the StackProfile and token-dropping when
  unknown), all four tiers executed in canonical order (SKILL.md's early-stop rule lives within a
  tier, so there is deliberately no orchestrator-level cross-tier stop), per-tier structural
  validation surfacing a broken executor at its own tier, early-stop state (`candidatesSoFar`) and
  verbatim constraints passed through to the executor, and Stage C normalization through the tested
  `normalizeSearchHits()`. Malformed plan or tier output throws loudly at the offending stage —
  missing work must never read as "fewer results"
- **`findCompanionSkills()` implemented end-to-end** (same file + new
  `packages/core/src/mechanical/companions.ts`): Phase 3.6 turns out to need no planner at all —
  its four searches are FIXED per candidate. `buildCompanionQueries()` pins them verbatim from
  SKILL.md (including the load-bearing quoted `"SKILL.md"` on the GitHub recipe); hits normalize
  per source via `normalizeCompanionHits()` (repo names from GitHub deep links with the same
  site-namespace blocklist as Stage C, directory slugs for terminalskills.io/skillsmp/skills.sh,
  title fallback, drop-don't-guess) and dedupe across sources resolving to the earlier recipe.
  terminalskills.io's reliability rating extracts worst-wins from hit text for that source alone
  (skillsmp explicitly carries none). Phase 3.7's decision table lands as `resolveCompanionGate()`:
  SUSPICIOUS/MALICIOUS rating auto-discards regardless of findings; DISCARD-weight findings win
  outright over WARN/FLAG; FLAGs surface independently as deduplicated `sqpFlags`. Reading a
  skill's content stays injected (`tooling.evaluate()`). BLOCKED skills are filtered entirely —
  discarded skills never surface in output; survivors carry `notes`/`sqpFlags` only when the gate
  fired (new optional fields on the CompanionSkill contract). All four sources always run: an
  empty return means "searched everything, nothing survived", never "skipped" — the REQUIRED-phase
  failure mode is now structurally impossible rather than merely documented
- **`resolveSecurityVerdict()` + `verifyCandidate()` implemented**
  (`packages/core/src/mechanical/security.ts`): Phase 3.5 Stage 2 is now code rather than a stub.
  Once Stage 1's evidence exists and an LLM has produced `ContentFinding[]` upstream, emitting the
  verdict turns out to be SKILL.md's own decision table rather than judgment: CRITICAL/HIGH with no
  fix → BLOCKED (note carries the advisory summary verbatim); with a fix → WARN ("recommend the
  fixed version"); MODERATE/LOW → WARN; recent publisher handoff → WARN naming both publishers,
  version, and date; DISCARD-weight findings block outright over WARN/FLAG; FLAG rules surface
  independently as deduplicated `sqpFlags`; any unverified check floors the verdict at WARN — the
  closed GateVerdict union has no honest third state for "didn't check", and SKILL.md forbids
  letting unverified read as passed. Notes emit in one fixed order so identical inputs give
  byte-identical output; empty evidence refuses loudly instead of implying a clean gate.
  `verifyCandidate()` moved out of `reasoning/` into `mechanical/` and is now synchronous — the
  judgment it used to promise arrives as its `findings` argument, produced upstream
- **`normalizeSearchHits()` implemented** (`packages/core/src/mechanical/search.ts`):
  Phase 3 Stage C, the deterministic tail of `findCandidates()`. TierResult[] whose hits Stage B
  has judged to count become deduplicated `Candidate[]` with tier provenance. Names extract
  structurally where URLs carry them (`github.com/{owner}/{repo}` deep links with `.git`
  stripping and a site-namespace blocklist for `/topics`-style pages,
  `npmjs.com/package/{name}` including two-segment `@scope/pkg`,
  `pypi.org/project/{name}`), with the hit's own title as fallback; hits with neither are dropped
  rather than guessed at. Results process in canonical tier rank (GitHub → MCP → registries →
  templates), so cross-tier duplicates resolve to the earlier tier deterministically, and URL-key
  dedupe ignores scheme/www./trailing-slash/query spelling variants. Stages A/B of
  `findCandidates()` stay injected rather than implemented — they need reasoning plus a
  web-search tool — but the function itself no longer stubs out; see its entry above
- **`ROADMAP.md`**: a single place recording what is implemented and what is left — the remaining
  `NotImplementedError` pipeline function halves, the known limits of what already ships (publisher
  continuity is npm-only, scoring factors are produced nowhere in code, `analyzeProject()`'s
  accepted v1 manifest limits), the open publish/tagging/CI decisions for the two packages, the
  documentation inconsistencies, and the one remaining adapter item
- **README "Packages" section**: the repo shipped `packages/core` and `packages/cli` in 1.6.0 and
  1.7.0 but the README never mentioned they existed. It now states which functions are implemented,
  that the rest throw `NotImplementedError` deliberately, how to run the suites and the CLI, and
  what the drift guard checks. A "Roadmap" section and two new nav links were added alongside it

### Changed
- **Working drafts moved out of the repo root into a gitignored `dev/`**: the eight
  `devto-article*.md` drafts, `linkedin-post.md`, the seven `RELEASE-1.4.x`/`1.5.0` notes, and
  `core-workflow.html`/`.svg` all sat untracked alongside the source, referenced by nothing — the
  published Dev.to Parts 1-8 are linked from the README, the CHANGELOG is the tracked release
  record, and the README draws its Core Workflow as inline ASCII, so these are working files
  rather than repo artifacts. `dev/` is now in `.gitignore`, leaving the repo root tracked-only

### Fixed
- **CI failed on its very first run — workspace build ordering** (`package.json`): `packages/cli`'s
  `tsc` needs `packages/core`'s emitted `.d.ts`, but `dist/` is gitignored, so a clean checkout has
  none. `npm test --workspaces` resolves `cli` before `core`, so the CLI build failed with
  `TS2307: Cannot find module 'skillmama'` on all three Node versions. It passed locally only
  because a stale `packages/core/dist/` was lying around from an earlier build — the exact class of
  bug CI exists to catch, caught on the first run. The root `test` and `build` scripts now order the
  workspaces explicitly instead of relying on resolution order. Verified by deleting both `dist/`
  directories and re-running, which now reproduces a clean-checkout build faithfully
- **`.claude-plugin/plugin.json` version was stale at `1.5.0`**, three releases behind the
  CHANGELOG; now tracks the release (`1.8.0`). Nothing reads it for behavior, but it is what a plugin install reports as the
  installed version
- **README "Project Structure" tree was two releases out of date**: it showed only `skillmama/`,
  `.claude/`, `evals/` and the README, omitting `packages/`, `scripts/`, `.claude-plugin/`,
  `CHANGELOG.md`, and the second eval file

### Changed
- **Upstream skills-CLI bug rechecked (2026-08-24), still open**: PR #1483 unmerged; found the
  newer, more targeted fix PR [#2028](https://github.com/vercel-labs/skills/pull/2028) now also
  open, and `skills@1.5.23` + upstream `main` both still misroute Codex/Antigravity global
  installs (main's Antigravity target has since moved to a *third* wrong directory). README
  install warning and adapters-table notes updated with the recheck date and the second PR;
  the two ❌ rows stay until a fix merges AND ships in a released CLI version

### Notes
- Test suite grew from 92 to 129 core tests (search normalization, gate mapping, recipe
  templates, both orchestrations); CLI unchanged at 13. `skillmama/SKILL.md` untouched —
  verified by the guard script, now also enforced in CI
- No pipeline function throws `NotImplementedError` anymore. The class stays exported for API
  stability but nothing uses it: the remaining non-deterministic work (planning, search
  execution, skill-content judgment) is injected tooling, not a missing implementation

---

## [1.7.0] - 2026-08-22

### Added
- **`gatherSecurityEvidence()` implemented** (`packages/core/src/mechanical/security.ts`): Phase 3.5 Stage 1, the evidence half of the security gate, is now code rather than a contract. Both live-data checks SKILL.md runs turn out to be plain HTTP APIs, so this slice is genuinely deterministic and fixture-testable
  - **OSV.dev advisory check**: queries `api.osv.dev/v1/query` at exactly the version the caller intends to recommend (SKILL.md's "query the version you intend to recommend, not the latest" trap — the function never resolves "latest" itself), reads severity off `vulns[].database_specific.severity` case-normalized with anything unrecognized mapped to UNKNOWN rather than guessed, sets `hasFix` from any `affected[].ranges[].events[]` `fixed` event, and handles the PyPI trap: PYSEC-* records duplicating a GHSA-* record for the same flaw are deduped on shared id/aliases (transitively — A~B, B~C is one flaw) with severity read off the GHSA twin instead of reporting a false UNKNOWN
  - **npm publisher-continuity check**: faithful port of SKILL.md Check 2's reference script with all four load-bearing rules intact — versions sort by publish time, never packument key order; a handoff requires the old guard to *never* publish again once the newcomer arrives (any human-to-human change fires on express/lodash/chalk-shaped team rotation); only the most recent qualifying handoff survives, and only under 12 months old (the measured 51%→7% false-positive rule) — stale ones return null, never a record; bot and unknown publishers are dropped before detection via SKILL.md's literal list, kept exact because a regex generalization measured identically across 98 packages. The pure detector (`detectPublisherHandoff`) is exported and takes `today` as an explicit parameter so results are reproducible rather than clock-dependent
  - **Honest degradation policy, split the same way as `analyzeProject()`'s**: transport-level failure (network error, non-2xx, unparseable body) degrades that one check to `{ status: "unverified", reason: "unreachable" }` per SKILL.md's "never let an unverified candidate read as having passed" — and one check failing never takes the other down; but a reachable registry returning garbage throws loudly instead of silently reading clean, since "unreachable" would be a lie and silence would be a false PASS. Non-npm ecosystems yield `reason: "unsupported-ecosystem"` without touching the npm registry, so a Python candidate can never imply publisher continuity was checked
  - **Boundary kept honest**: this module gathers evidence only — turning it into a GateVerdict (CRITICAL/HIGH with no fix → BLOCKED, etc.) stays with `verifyCandidate()`, which remains an unimplemented reasoning-layer stub. The two pure normalizers (`normalizeOsvQueryResponse`, `detectPublisherHandoff`) are exported for direct fixture testing; orchestration tests inject a fetch stub keyed by URL, so the test suite never touches the network
- **33 new tests** (`test/security.test.js`): OSV normalization (severity rescue, transitive alias clusters, hasFix, malformed-record tolerance), handoff detection (team rotation vs genuine handoff, recency boundary, backport ordering, CI migration, most-recent-wins, loud failure on invalid input), and orchestration (canonical evidence order, version-verbatim query bodies, scoped-name URL encoding, per-check degradation independence). Core suite now 92 tests; full workspace green including the CLI e2e suite

### Notes
- This work did not touch `skillmama/SKILL.md` — verified by the guard script

---

## [1.6.0] - 2026-08-21

### Added
- **`packages/core` — SKILLmama's first deterministic code artifact**: a new npm workspace (package name `skillmama`, currently `"private": true` and unpublished) that starts extracting the mechanical slice of the pipeline from `skillmama/SKILL.md` into testable code. The skill remains the sole source of truth for full behavior; the package implements only what is genuinely deterministic and fails loudly everywhere else
  - **Contracts** (`src/contracts/`): `StackProfile` (the structured scan result, with `matchedDependencies` provenance and `deploymentTarget`), `Candidate`/`CompanionSkill`, `SecurityCheckResult` with its evidence/judgment split, and `ScoringFactors`/`CandidateScore`. Every type documents what it deliberately does *not* represent — e.g. `ContentFinding` states outright that SKILL.md's gate is LLM reasoning, not a checklist that reduces to a function
  - **`analyzeProject()` implemented** (`src/mechanical/index.ts`): a Structured Project Scan — reads only the top-level entries of a project directory, parses seven dependency manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `requirements.txt`, `go.mod`, `Gemfile`, `composer.json`) across all dependency sections each format supports, plus presence-only detectors for five deployment configs (`fly.toml`, `render.yaml`, `vercel.json`, `railway.toml`/`.json`). Output is fully deterministic: sorted, deduplicated, fixture-pinned. It deliberately does not read README/SETUP/DEPLOY prose or infer technology from source code — those stay LLM-interpreted behavior owned by SKILL.md
  - **`scoreCandidate()` implemented** (`src/mechanical/index.ts`): the deterministic slice of Phase 4 — given four factors already scored 1–10 per SKILL.md's bands, computes `compatibility×0.40 + popularity×0.30 + maintenance×0.15 + simplicity×0.15`. Unknown factors are `"N/A"` and the surviving weights renormalize proportionally (SKILL.md: "weight the remaining factors proportionally"), with every exclusion recorded in `notes` so an unverified factor never silently reads as fully weighted; all four N/A yields a `"N/A"` total, never a number. Out-of-range or non-numeric factors throw naming the offender. Totals round half-up to one decimal (Phase 5 renders `X.X`) with boundary-tolerant rounding — an exact 5.15 always renders 5.2 regardless of floating-point accumulation noise, while genuinely mid-interval values are never double-rounded across a boundary. The function deliberately does not produce the factors: Compatibility/Simplicity are LLM judgment over verified local evidence, and Popularity/Maintenance band-mapping starts from live data whose point-within-band selection is still judgment. Skipping BLOCKED candidates and marking ALREADY PRESENT ones stays with the caller, per Phase 4's preamble
  - **Candidate verification data model** (`src/contracts/security.ts`): the gate is split so deterministic evidence gathering and LLM security judgment never blur. `SecurityEvidence` pins the two live-data checks SKILL.md actually runs — the OSV.dev advisory query (with `queriedVersion`, since SKILL.md says to query the version you intend to recommend, not the latest) and the npm publisher-continuity check (handoff records carry both publishers, version, and date; stale >12-month handoffs are never reported, per the measured 51%→7% false-positive rule) — each with an explicit `status: "ok" | "unverified"` so an unreachable registry can never silently read as passed. `ContentFinding` carries the LLM-only signals (guardrail circumvention, undisclosed exfiltration, SQP-1/2/3) with SKILL.md's own DISCARD/WARN/FLAG weights. Two vocabulary errors fixed along the way: the old `SecurityVerdict` ("SAFE"/"SUSPICIOUS"/"MALICIOUS") was TerminalSkills.io's third-party rating vocabulary, not what Phase 3.5 emits — the gate's real outputs are now `GateVerdict` ("PASS"/"WARN"/"BLOCKED"); and `CompanionSkill.verdict` becomes optional `rating?: CompanionSkillRating` because skillsmp.com matches carry no rating at all (auto-indexed, unvetted). The `verifyCandidate()` stub signature now consumes `(candidate, evidence, findings)` instead of a bare candidate, encoding that the judgment stage consumes rather than produces its deterministic inputs
  - **Search pipeline contracts** (`src/contracts/search.ts`): `findCandidates()`'s boundary defined as three stages with three different honesty profiles — Plan (reasoning: request → `SearchPlan`, the 3–5 combined terms from Phase 2), Execute (tool-backed: each tier's WebSearch recipes → `TierResult`, which pins the provenance any executor must report — tier, exact queries run, raw hits, early-stop flag), and Normalize (mechanical: hits → deduplicated `Candidate[]`). The stub's doc states plainly that an implementation querying only npm and skipping Tiers 1/2/4 is not a partial implementation but a different, wrong behavior. `Candidate` gains `hasOwnSkill?: boolean` — SKILL.md's Tier 1 tags repos that ship their own SKILL.md, and Phase 5 must surface those under Companion Skills even when Phase 3.6 found nothing else
  - **Companion-skill provenance** (`src/contracts/candidate.ts`): `CompanionSkill` gains a required `source` field — Phase 3.6 searches four sources whose trust semantics differ, and provenance determines how a result may be trusted: terminalskills.io is rated (SUSPICIOUS/MALICIOUS auto-discards), skillsmp.com is unvetted (a match is a pointer to go verify the underlying repo, never a trust signal), skills.sh and GitHub are normal search results. Design rule pinned in the type docs: `source` records where a skill was found, `rating` records metadata that source may provide; neither substitutes for the other. The source list ships as runtime data (`companionSkillSources`, same compile-time-mirror pattern as the detector registry) so adding a source to the union without registering it fails to compile; a contract test pins the exact four. `findCompanionSkills()`'s stub documents the three-stage pipeline (tool-backed search → mechanical normalization → Phase 3.7 gate with DISCARD-wins precedence) and SKILL.md's REQUIRED rule: an empty result means "searched all four sources, nothing found", never "skipped"
  - **Detector registry** (`src/mechanical/detectors.ts`): data-only mapping from raw manifest names to canonical IDs (e.g. `pg`/`postgres`/`postgres.js` → `postgresql`) with six written policies so canonical IDs cannot drift casually; compile-time checks force the registry to stay in sync with the `StackProfile` contract
  - **Manifest parsers** (`src/mechanical/parsers.ts`): internal module (not exported through the package boundary) handling PEP 508/621/735 and Poetry layouts, Cargo rename syntax, go.mod require blocks, and Gemfile DSL; a malformed manifest throws with cause instead of silently degrading the scan
  - **Everything else throws `NotImplementedError`**: `findCandidates`, `verifyCandidate`, and `findCompanionSkills` are typed stubs kept separate in `src/reasoning/` so the assumption that they need web search + LLM judgment is never lost. A public-API boundary test pins the exact export list, so nothing can leak into the surface silently
  - **59 tests passing**: unit tests for detectors/parsers/scoring, the export-boundary test, and fixture-driven tests (`fixtures/` contains six sample projects with expected `StackProfile` output). Only runtime dependency is `smol-toml`; clean `npm ci` installs with zero vulnerabilities
- **`scripts/check-skill-untouched.sh`**: smoke test asserting `skillmama/SKILL.md` is unchanged relative to the last commit and byte-identical to its `.claude/skills/skillmama/` install copy — drift between the two copies was the failure mode behind fixes 1.4.3 and 1.4.6, and this makes the invariant mechanically enforced rather than caught in review
- **`packages/cli` (`skillmama-cli`, private) — the first real consumer of the core package**: `skillmama scan [dir]` runs `analyzeProject()` on a directory and prints the StackProfile, with display labels per category, deployment target with provenance (`flyio (fly.toml)`), and a dependency-evidence section mapping canonical IDs back to the raw manifest names that matched them. `--json` emits the profile verbatim for machine consumption; exit codes distinguish scan failure (1) from usage error (2); argument parsing uses Node's built-in `util.parseArgs`, so the CLI adds zero runtime dependencies beyond core itself. E2E tests spawn the built binary against core's fixtures and assert the JSON output deep-equals the fixture's expected profile
- **npm workspace root**: private `package.json` with `workspaces: ["packages/*"]` and a committed lockfile

### Changed
- `.gitignore` now excludes `node_modules/` and `dist/`

### Notes
- The unscoped npm name `skillmama` was chosen over `@skillmama/core`: one package, one brand, simpler install; the scoped name implied an org with multiple packages that doesn't exist. Name confirmed available on the registry; the package stays `"private": true` until a publish decision is made
- This work did not touch `skillmama/SKILL.md` — verified by the new guard script

---

## [1.5.0] - 2026-08-08

### Changed
- **Four hand-maintained adapter copies collapsed into one `skillmama/SKILL.md`**: `codex/AGENTS.md` and `antigravity/PROMPT.md` regenerated byte-for-byte from the canonical file by variable substitution, so they carried no information it lacked, and nothing ever installed them anyway (the skills CLI only discovers files literally named `SKILL.md`, confirmed by "Found 1 skill" even with `--full-depth`). They had already drifted twice, tracked as fixes in 1.4.3 and 1.4.6, and `.claude/commands/skillmama.md` had drifted a third time: a Phase 3.5 bullet sat at a different position and had lost its backticks. Both platform files are deleted, and `.claude/commands/skillmama.md` becomes `.claude/skills/skillmama/SKILL.md`, a symlink to the canonical file, so the repo-local slash command keeps working and drift is now structurally impossible rather than something caught in review. Windows contributors need `core.symlinks=true` to check this out as a real symlink
- **Phase 3.5 and 3.7 now state rule precedence**: neither gate said what happens when a candidate matches a DISCARD bullet and a FLAG bullet at once, which is common. With no precedence stated the model resolved it differently across runs, sometimes softening a DISCARD to a FLAG. Both phases now say DISCARD wins outright and is never downgraded because a lesser rule also matched, and that WARN and FLAG are independent and may both be reported. Re-running the DISCARD cases with the rules quoted verbatim came back 2/2 both with and without the new line, so this closes a real ambiguity rather than a demonstrated failure
- **Four DISCARD criteria reworded** in Phase 3.5 and 3.7. SKILLmama's own `SKILL.md` scored `100 / CRITICAL / DO_NOT_INSTALL` under [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector): phrases like "instructions to bypass safety checks" and "with no warning" describe patterns the skill *rejects*, but the static matcher has no negation handling and read them as the attack. One line alone produced three separate HIGH findings across Anti-Refusal, Prompt Injection and Rogue Agent. The reworded criteria score `7 / LOW / SAFE`, with both halves of every rule preserved; four independent phrasings all scored identically, so the wording shipped is the clearest one rather than the best-scoring one. This is cosmetic and changes how a scanner reads the file, not how safe the file is. Adding a user-consent section was tested and *raised* the score, because describing a safeguard trips the same patterns as describing the danger

### Added
- **Installable as a Claude Code plugin**: `.claude-plugin/plugin.json` declares the `skillmama/` skill, so the repo can be added as a plugin directly rather than only through the skills CLI or a manual copy

### Fixed
- **Install docs recommended commands that silently do nothing**: the README told Codex and Antigravity users to run `npx skills add`, which prints `Done!`, exits 0, and writes to `~/.agents/skills/` where neither agent looks. Still reproduces on `skills@1.5.22` as of 2026-08-08. Root cause is `isUniversalAgent()` in the upstream installer misclassifying agents whose *project* dir is `.agents/skills` and discarding their `globalSkillsDir`, affecting 13 agents; tracked upstream in [#1060](https://github.com/vercel-labs/skills/issues/1060) and [#1470](https://github.com/vercel-labs/skills/issues/1470), fix pending in [PR #1483](https://github.com/vercel-labs/skills/pull/1483). Install now leads with the bug notice and gives two-line copy commands per agent that land in the directory each one actually reads
- **Three stale claims in the install docs**, all corrected after running every command verbatim: `~/.agents/skills/` is the CLI's canonical store, not simply a wrong path; Codex *does* have a native global skills dir at `~/.codex/skills/`; and `-a claude-code` is not required to avoid skipped wiring, it is required because the CLI auto-detects the *calling* agent, so running the install from inside another agent's shell installs to that agent instead
- **`pip install skillspector` 404s**: that package does not exist on PyPI. The Security & Quality Gate section now installs it the way it actually installs, `uv tool install git+https://github.com/NVIDIA/skillspector.git`
- **Antigravity's global skills path documented with its source**: `~/.gemini/config/skills/` is shared across Antigravity 2.0, the IDE, and the `agy` CLI since Google consolidated their config. Confirmed by live testing here and independently by extraction from the `agy` binary's embedded docs in [#1470](https://github.com/vercel-labs/skills/issues/1470)
- **AI Adapters table rewritten**: it listed four files and their install status. There is one file now, so the table lists each platform's global skill directory and whether `npx skills add -g` reaches it

### Notes
- The optional install-and-verify helper [`skill-land`](https://www.npmjs.com/package/skill-land) is published on npm and installs to every agent at once, exiting non-zero if the file did not land. It is not required; the copy commands work on their own. It runs a SkillSpector scan before writing and reports findings without blocking, since static mode returns `DO_NOT_INSTALL` for 44% of a sample of 18 known-good installed skills
- The DISCARD rewording is **not** eval'd. These are instructions an LLM acts on, and the change was verified against a static scanner, not against model behavior. Recorded as such in `evals/skillmama-ablation.md`

---

## [1.4.6] - 2026-07-17

### Changed
- **Security & Quality Gate CVE check now queries live data instead of an unsourced rule**: the old hard rule ("Has a dependency with a known CVE") named no data source, so in practice it depended on whatever a web search happened to surface. Phase 3.5 now runs a real [OSV.dev](https://osv.dev) query against the exact version being recommended, across npm, PyPI, Go, and crates.io. A CRITICAL/HIGH advisory with no fix available blocks the candidate, quoting the advisory's stated trigger condition (a specific mode, flag, or endpoint) verbatim in `security_note` when OSV names one, so the user can judge whether their own usage is actually exposed rather than taking the block at face value — added after re-running `evals/skillmama-ablation.md`'s paired ablation found `chromadb` 1.5.9 (the library that had won every prior run of that eval) carrying an unpatched CRITICAL pre-auth code injection CVE that only triggers in server mode with `trust_remote_code=true`, a flag most embedded/in-process usage never sets; a CRITICAL/HIGH advisory with a fix warns and names the fixed version; MODERATE/LOW is summarized rather than discarded. Verified against real advisories (lodash, requests, event-stream) before shipping, including a PyPI-specific trap: `PYSEC-*` records report `severity: UNKNOWN` and duplicate a `GHSA-*` record for the same flaw (e.g. `requests` 2.19.0's HIGH-severity credential leak reads as UNKNOWN unless deduped via `aliases`)

### Added
- **npm publisher-continuity check**: a maintainer prompted this directly — "known CVEs is one bar, this maintainer won't quietly change hands in 8 months is a much harder one and honestly the one that's bitten people more." Phase 3.5 now compares who published recent versions of a candidate and flags it (WARN, never an automatic discard) if publish rights passed from one human to a different human within the last 12 months, naming both publishers and the date. Tested point-in-time against the event-stream incident: the check fires as of 2018-10-01, roughly 7 weeks before the malicious-code advisory was publicly disclosed on 2018-11-26 — the exact case where advisory-based scanning alone comes too late
  - The rule went through three broken iterations before shipping, each caught by testing against real npm data rather than assumed correct: (1) any human-to-human change flags healthy team rotations (express, lodash, chalk) as false handoffs; (2) requiring the prior publisher to never publish again is accurate but fires on ~58% of long-lived packages, since nearly every one has an old handoff somewhere in its history — recency-limiting to the most recent handoff within 12 months brings this down to a measured 7.1% across a 98-package sweep; (3) a generalized bot-detection regex (to replace the hardcoded `GitHub Actions`-style exclusion list) was measured head-to-head against the hardcoded list and scored identically, so it was dropped as complexity with no benefit
  - Known limits, stated in the gate itself and the README: npm only (PyPI exposes no per-release uploader identity, so Python candidates report `N/A (unsupported ecosystem)`); catches handoffs, not account takeovers where the attacker publishes under the real maintainer's name (e.g. ua-parser-js, rc, coa — those are only caught by the OSV check, and only post-disclosure); an unreachable registry reports `N/A (unverified)` rather than passing silently

### Fixed
- **README oversold the security gate**: the gate table advertised "CVE dependencies" as a check without saying what powered it, and a footnote pointed users to a third-party tool for "live CVE lookups" as if SKILLmama didn't do them. The table and a new "Known limits" section now describe both checks accurately, including what they don't cover

---

## [1.4.5] - 2026-07-16

### Added
- **Deployment-target detection**: Phase 1/B1 across all four adapters now also read `render.yaml`, `SETUP.md`, and `DEPLOY.md`/`DEPLOYMENT.md`, and extract a detected deployment target (Render, Vercel, Fly.io, Railway, self-hosted Docker) into the Stack Profile's new `Deployment:` field

### Fixed
- **Deployment persistence blind spot**: Phase 4's Compatibility scoring verified local project dependencies (env vars, CLI, config files) but never checked whether the *hosting platform* actually persists local disk across restarts — so an "easy, zero-infra" candidate that stores data in-process (e.g. an embedded vector DB) could be recommended as a top pick even when the target platform's storage is ephemeral and would silently lose that data on every deploy or restart. Found via a genuine paired skill-off/skill-on ablation run in `evals/skillmama-ablation.md` (Run 5): an unassisted baseline agent caught this by reading a project's `SETUP.md`, while SKILLmama's pipeline missed it. Phase 4 now runs a **Deployment Persistence Check** for any local/in-process/on-disk candidate — checking `fly.toml` `[[mounts]]`, `railway.toml` volumes, `render.yaml` `disk:` blocks, and `docker-compose.yml` `volumes:` mappings (Vercel/serverless is always treated as ephemeral) — and caps Compatibility at 4–6 with an explicit warning when the detected platform has no persistent storage configured, instead of scoring the candidate as if storage just works

---

## [1.4.4] - 2026-07-16

### Added
- **`evals/skillmama-ablation.md`**: a manual eval harness — 5 prompts that should trigger SKILLmama, 5 that shouldn't (mapped directly to the Trigger / Do-NOT-activate rules), plus a result log. Prompted by "Don't Ship Skills Without Evals" (Philipp Schmid, Google DeepMind) and the paired skill-on/skill-off ablation methodology from [SkillsBench](https://arxiv.org/abs/2602.12670) (Li et al.)
- Trigger-classification and full-pipeline runs logged against the eval set, including one live end-to-end run against a real external project (`nutri-bot`, a FastAPI/Redis/Telegram app) to validate output quality on a non-trivial stack

### Fixed
- **Silent empty scan on directory/stack mismatch**: Phase 1 across all four adapters (`skillmama/SKILL.md`, `codex/AGENTS.md`, `antigravity/PROMPT.md`, `.claude/commands/skillmama.md`) previously scanned whatever directory the agent happened to be in with no check against the user-stated stack — if they didn't match (e.g. invoked from an unrelated repo), it silently completed an empty scan instead of flagging it. Found live during eval testing: running from SKILLmama's own repo while asking about "my FastAPI app" produced an empty, misleading scan. Phase 1 now detects the mismatch and asks which directory to scan
- **Maintenance scores estimated instead of verified**: Phase 4's Compatibility factor already required per-candidate local verification (env vars, CLI, config files), but Maintenance had no equivalent rule — last-commit dates were sometimes estimated from general knowledge of a project rather than checked. Maintenance now requires the same per-candidate verification, falling back to `N/A (unverified)` in the Phase 5 output (with the total score renormalized across the remaining factors) rather than presenting a guess with false confidence

---

## [1.4.3] - 2026-07-14

### Added
- **SkillsMP as a companion-skills source** in Phase 3.6 across all four adapters (Claude Code, Claude.ai, OpenAI Codex, Antigravity) and the README: searched alongside skills.sh, TerminalSkills.io, and GitHub `SKILL.md`
  - SkillsMP auto-indexes public GitHub repos with no vetting, so a match is treated as a pointer to verify the underlying repo, not a trust signal — unlike TerminalSkills.io's rated results
  - Companion Skills output examples updated to include a SkillsMP link
- **Verified Compatibility scoring** in Phase 4 across all four adapters: before scoring a candidate's Compatibility factor, the skill now checks locally whether its required API keys, CLI tools, or config actually exist (`.env.example`, `which [cli]`, config files) instead of relying purely on inferred stack fit
  - Missing required dependencies are flagged inline on the candidate's Compatibility line (e.g. "⚠️ requires `REDIS_URL` — not found in .env.example") rather than silently scoring high
  - Dependencies that can't be verified either way (e.g. hosted services) are left unpenalized and noted as unverified
- **`ALREADY PRESENT` duplicate guard** in Phase 4 across all four adapters: candidates whose package name already appears in the detected stack's dependencies are excluded from scoring and surfaced in Also Considered instead of being re-recommended

### Fixed
- **Multi-agent pipeline drift**: `codex/AGENTS.md` and `antigravity/PROMPT.md` had diverged from `skillmama/SKILL.md` in wording (leftover from a two-stage Haiku-search/Sonnet-score architecture that was since dropped). Consolidated all three to run identical Phases 0–5, scoring, and Rules — only legitimately agent-specific bits differ now (title framing, trigger wording, and per-agent `npx skills use [owner/repo] | <agent>` install syntax in Companion Skills)
- **Claude-specific language in the universal CLI-install file**: `npx skills add` only discovers files literally named `SKILL.md`, so `skillmama/SKILL.md` is what actually gets installed for every agent via `-a codex` / `-a antigravity`, not just Claude. Generalized its "Recommended model: Claude Sonnet" note and `README.md, CLAUDE.md` file-list line to be agent-neutral
- **Antigravity skill discovery**: confirmed via live testing that `npx skills add -a antigravity` installs to `~/.agents/skills/`, a path Antigravity never reads — the skill was silently invisible to the app. Root-caused against Antigravity's official docs: the real global path is `~/.gemini/config/skills/`. README now documents a working manual install (curl one-liner or local `cp`, no CLI dependency) with confirmed-working usage via explicit invocation (`SKILLmama <request>`); filed corroborating repro on the upstream bug ([vercel-labs/skills#1470](https://github.com/vercel-labs/skills/issues/1470))
- **Codex CLI install status downgraded to unverified**: `npx skills add -a codex` was never live-tested against a real Codex client this cycle — README now marks it ⚠️ rather than claiming it works, pending an actual test
- **`.claude/commands/skillmama.md` was missing SkillsMP entirely**: the SkillsMP addition above was supposed to land in all four adapters, but this file never got it (0 mentions vs. 5 in the other three). Caught during a full project audit; patched all 4 locations (Phase 3.6 search + note, Sources searched line, both Companion Skills link lines) to match

### Changed
- **README restructured with a "See it in action" demo section**: added a screen-recorded GIF of SKILLmama running live inside Antigravity (asking a capability question, Phase 1.5 constraint question firing correctly), placed after the intro paragraph and linked from the nav row — visitors now see proof the tool works before the Install section
- **New `assets/` folder**: `logo.png` moved there (via `git mv`, history preserved) alongside the new demo GIF, replacing the previous repo-root image layout

---

## [1.4.2] - 2026-07-03

### Fixed
- **Claude Code install command**: `npx skills add Magithar/SKILLmama` silently fails to register `/skillmama` when run non-interactively (e.g. via an agent's own shell tool), because the skills.sh CLI skips wiring the skill into `.claude/skills/` without an explicit agent flag. The Claude Code install instructions in the README now use `npx skills add Magithar/SKILLmama -a claude-code`, verified via clean uninstall/reinstall

---

## [1.4.1] - 2026-07-03

### Added
- **TerminalSkills.io as a companion-skills source** in Phase 3.6 across all four adapters (Claude Code, Claude.ai, OpenAI Codex, Antigravity) and the README: searched alongside skills.sh and GitHub `SKILL.md`
  - Its SAFE / SUSPICIOUS / MALICIOUS reliability rating now feeds Phase 3.7 — SUSPICIOUS or MALICIOUS is an automatic discard
  - Companion Skills output and install-command examples updated to include `terminal-skills install [skill-name]`

---

## [1.4.0] - 2026-07-01

### Added
- **Phase 1.5 — Confirm Constraints** in Flow A across all four adapters (Claude Code, Claude.ai, OpenAI Codex, Antigravity): when a capability is named but no constraints are stated, the skill now scans the project, then asks one informed constraint question and **hard-stops** before searching — bringing Flow A's ambiguity-reduction in line with Flow B
  - Fires only when the user gave no constraints; skips entirely if they already constrained the search (e.g. "find me an *open-source* job queue")
  - Question is informed by the Phase 1 scan (references detected stack/tools); falls back to a generic constraint question when no project files are detected
  - Asks once, never re-prompts; `"none"` reply searches with no filters
- **README Core Workflow diagram** updated to show Phase 1.5 in the Flow A column

---

## [1.3.1] - 2026-07-01

### Fixed
- **PROMPT.md phase order**: shared pipeline in the Antigravity adapter had phases in wrong order (3.6 → 3.7 → 3.5); corrected to 3.5 → 3.6 → 3.7 to match all other adapters and the documented workflow
- **README Project Structure**: removed `skillmama.zip` entry that referenced a non-existent file
- **SQP-1 — Trigger scope tightened** across all four adapters: replaced the broad catch-all trigger clause with explicit **Do NOT activate for** exclusions (how-to questions, debugging, code review, documentation lookups, and cases where the tool is already known)
- **SQP-2 — User-visible scan notice** added to Phase B1 across all four adapters: agents must now output a disclosure to the user before reading any files or running shell commands during Flow B project scans

---

## [1.3.0] - 2026-07-01

### Added
- **Flow B — Project Scanner**: invoking `/skillmama` with no arguments now triggers a full project scan instead of asking for a capability
  - Phase B1: deep scan reads package files, config, infra, source structure, and 2–4 representative source files to build a Stack Profile
  - Phase B2: gap analysis identifies missing capability categories (Auth, DB/ORM, Caching, Queue, Search, Storage, Email, Observability, AI/LLM, Vector/RAG, Payments, Rate Limiting, Testing, Schema Validation) with severity ratings (High / Medium / Low)
  - Phase B3: presents the gap table and asks 3 clarifying questions (which gaps to focus on, constraints, anything missed) — hard stop until user replies
  - After user responds, jumps directly to Phase 2 (search terms) — Phase 0 and Phase 1 are skipped since the stack is already known
- **Two-flow entry point** added to all four adapters (Claude Code, Claude.ai, OpenAI Codex, Antigravity): Flow A for named capabilities, Flow B for project scans; both converge at Phase 2

---

## [1.2.0] - 2026-06-29

### Changed
- **Output format — scoring table header**: scoring table is now prefixed with `**Scoring all candidates against [stack]:**` instead of a bare table, making the detected stack explicit at a glance
- **Output format — no Sources section**: trailing `Sources:` block removed from all results; links are surfaced inline within each candidate card only
- **Output format — Phase 3.5 is internal only**: security gate no longer renders as a standalone section in output; findings appear only on each candidate's `Security:` line

---

## [1.1.0] - 2026-06-22

### Added
- **Phase 3.5 — Security & Quality Gate** across all four adapters (Claude Code, Claude.ai, OpenAI Codex, Antigravity)
  - Hard gate: discards candidates with CVE dependencies, undisclosed data exfiltration, jailbreak instructions, or no-warning destructive ops
  - SQP-1: flags overly broad trigger phrases with no exclusion conditions
  - SQP-2: flags destructive/sensitive operations with no user-visible warning
  - SQP-3: flags hardcoded language/locale without user opt-in
  - Inspired by [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector) (Apache 2.0)
- **Security line** added to output format for all result cards (`PASS` / `⚠️ SQP-N` / `🚫 BLOCKED`)
- `.vscode/` added to `.gitignore`

---

## [1.0.0] - 2026-06-19

### Added
- Initial release
- 5-tier search hierarchy (skills.sh → GitHub → MCP Ecosystem → npm/PyPI → Templates)
- Deterministic ranking formula: `(Compatibility × 0.40) + (Popularity × 0.30) + (Maintenance × 0.15) + (Simplicity × 0.15)`
- Adapters for Claude Code (slash command), Claude.ai (skill zip), OpenAI Codex (AGENTS.md), Antigravity (system prompt)
