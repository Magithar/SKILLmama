# skillmama

Typed contract boundary for SKILLmama's capability-discovery pipeline. This
package does not implement SKILLmama — it is scaffolding for what a future
deterministic implementation could look like.

**[`skillmama/SKILL.md`](../../skillmama/SKILL.md) is the shipped product and
the sole source of truth for SKILLmama's actual behavior.** It is not built,
not published, and not used by that skill today.

## What's actually implemented

Two functions so far.

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

Everything else — `findCandidates`, `verifyCandidate`, `findCompanionSkills`
— is an unimplemented stub that throws `NotImplementedError`.
Their contracts document *why*: the search/security-gate functions in
`reasoning/` wrap web search and LLM judgment and are unlikely to ever become
pure deterministic code.

## Layout

```
src/
  contracts/   shared types (StackProfile, Candidate, SecurityCheckResult, CandidateScore)
  mechanical/  functions where the work is genuinely deterministic (file parsing)
  reasoning/   functions that wrap web search + LLM/tool judgment — stubs only
fixtures/      sample projects + expected StackProfile output, used by test/fixtures.test.js
```

## Testing

```
npm test
```

Runs `tsc` then the `node:test` suite (unit tests for detectors/parsers/scoring, a
public-API export boundary test, and fixture-driven tests for
`analyzeProject()`).
