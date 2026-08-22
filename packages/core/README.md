# skillmama

Typed contract boundary for SKILLmama's capability-discovery pipeline. This
package does not implement SKILLmama — it is scaffolding for what a future
deterministic implementation could look like.

**[`skillmama/SKILL.md`](../../skillmama/SKILL.md) is the shipped product and
the sole source of truth for SKILLmama's actual behavior.** It is not built,
not published, and not used by that skill today.

## What's actually implemented

Three functions so far.

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
checked. It deliberately does **not** judge: turning evidence into a
GateVerdict stays with verifyCandidate() (stage 2, LLM reasoning). The two
pure normalizers (`normalizeOsvQueryResponse`, `detectPublisherHandoff`)
are exported and fixture-tested directly; tests inject a fetch stub, so the
suite never touches the network.

Everything else — `findCandidates`, `verifyCandidate`, `findCompanionSkills`
— is an unimplemented stub that throws `NotImplementedError`.
Their contracts document *why*: the search/security-gate functions in
`reasoning/` wrap web search and LLM judgment and are unlikely to ever become
pure deterministic code.

## Layout

```
src/
  contracts/   shared types (StackProfile, Candidate, SecurityEvidence/
               SecurityCheckResult, SearchPlan/TierResult, ScoringFactors/CandidateScore)
  mechanical/  functions where the work is genuinely deterministic (file parsing,
               scoring arithmetic, plain-HTTP security-evidence gathering)
  reasoning/   functions that wrap web search + LLM/tool judgment — stubs only
fixtures/      sample projects + expected StackProfile output, used by test/fixtures.test.js
```

## Testing

```
npm test
```

Runs `tsc` then the `node:test` suite (unit tests for detectors/parsers/scoring/
security, a public-API export boundary test, and fixture-driven tests for
`analyzeProject()`). The security tests inject a fetch stub — nothing here
touches the network.
