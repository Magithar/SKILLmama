# skillmama

Typed contract boundary for SKILLmama's capability-discovery pipeline. This
package does not implement SKILLmama — it is scaffolding for what a future
deterministic implementation could look like.

**[`skillmama/SKILL.md`](../../skillmama/SKILL.md) is the shipped product and
the sole source of truth for SKILLmama's actual behavior.** It is not built,
not published, and not used by that skill today.

## What's actually implemented

The full pipeline skeleton: five deterministic functions plus both
tool-backed orchestrations (`findCandidates()`, `findCompanionSkills()`),
which complete their phases by taking reasoning and web search as INJECTED
tooling rather than pretending to be deterministic code.

**`analyzeProject()`**, in [`src/mechanical/index.ts`](src/mechanical/index.ts).
It is a **Structured Project Scan**, not full project understanding: it reads
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

**`scoreCandidate(candidate, factors)`**, also in
[`src/mechanical/index.ts`](src/mechanical/index.ts). The deterministic
slice of Phase 4: given four factors already scored 1–10 per SKILL.md's
bands, it computes the weighted total
(`compatibility×0.40 + popularity×0.30 + maintenance×0.15 + simplicity×0.15`),
renormalizes proportionally when a factor is `"N/A"`, rounds half-up to one
decimal with boundary-tolerant handling, and refuses out-of-range input
loudly. It does **not** produce the factors — Compatibility/Simplicity are
LLM judgment over verified local evidence, and Popularity/Maintenance
band-mapping starts from live data whose point-within-band selection is
still judgment. Callers also filter BLOCKED and ALREADY PRESENT candidates
first, per Phase 4's preamble.

**`gatherSecurityEvidence(target, options)`**, in
[`src/mechanical/security.ts`](src/mechanical/security.ts) — Phase 3.5
Stage 1, the evidence half of the security gate. Both live-data checks
SKILL.md runs are plain HTTP APIs, so this one is genuinely deterministic:
the [OSV.dev](https://osv.dev) advisory query (severity off
`database_specific.severity`, `hasFix` from any `fixed` event, PYSEC-*/
GHSA-* twins deduped on aliases with severity read off the GHSA twin) and
the npm publisher-continuity check — a faithful port of SKILL.md Check 2's
reference script with all four load-bearing rules: sort by publish time not
packument key order; a handoff means the old guard never publishes again;
only the most recent handoff under 12 months is ever reported; bot and
unknown publishers are dropped before detection. Transport failure degrades
to `{ status: "unverified", reason: "unreachable" }` per SKILL.md's "never
let an unverified candidate read as having passed", while a reachable
registry returning garbage throws loudly instead of reading clean.
Non-npm ecosystems report publisher continuity as
`unsupported-ecosystem` so a Python candidate can never imply it was
checked. It deliberately does **not** judge — that is the next function's
job. The two pure normalizers (`normalizeOsvQueryResponse`,
`detectPublisherHandoff`) are exported and fixture-tested directly; tests
inject a fetch stub, so the suite never touches the network.

**`resolveSecurityVerdict(evidence, findings)` / `verifyCandidate(...)`,
also in [`src/mechanical/security.ts`](src/mechanical/security.ts) — Phase
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

**`normalizeSearchHits(tierResults)`**, in
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

Everything judgment-shaped is injected, never faked:

**`findCandidates(request, tooling)`, in
[`src/reasoning/index.ts`](src/reasoning/index.ts)** — Phase 2+3
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

**`findCompanionSkills(candidate, tooling)`, also in
[`src/reasoning/index.ts`](src/reasoning/index.ts)** — Phase 3.6+3.7
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

## Layout

```
src/
  contracts/   shared types (StackProfile, Candidate, SecurityEvidence/
               SecurityCheckResult, SearchPlan/TierResult, ScoringFactors/CandidateScore)
  mechanical/  functions where the work is genuinely deterministic (file parsing,
               scoring arithmetic, plain-HTTP security-evidence gathering,
               fixed decision tables, search-hit normalization, recipe
               template filling)
  reasoning/   orchestration of the tool-backed phases — judgment and web
               search are injected; invariants and normalization stay here
fixtures/      sample projects + expected StackProfile output, used by test/fixtures.test.js
```

## Testing

```
npm test
```

Runs `tsc` then the `node:test` suite (unit tests for detectors/parsers/scoring/
security/search/pipeline, a public-API export boundary test, and fixture-driven
tests for `analyzeProject()`). The security and pipeline tests inject fetch/search
stubs — nothing here touches the network.
