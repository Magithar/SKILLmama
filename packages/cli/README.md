# skillmama-cli

The real consumer of the [`skillmama`](../core) package. Two commands, both
running only the parts of SKILLmama's pipeline that need no judgment.

## Usage

```
skillmama scan [dir]        Structured project scan (default: current directory)
skillmama check <package>   Live-data checks against a published package
```

Options: `--json` · `--ecosystem npm|PyPI|Go|crates.io` · `--version <v>` ·
`--repo <owner/name>` · `-h, --help`

Exit codes: `0` completed, verdict PASS or WARN · `1` failed · `2` usage error ·
`3` completed, verdict BLOCKED.

### scan

The same deterministic slice SKILL.md's Phase 1 uses: it reads only top-level
manifest/config files, never README prose or source code. Unknown technologies
are silently ignored; a malformed manifest fails loudly.

### check

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

## What this CLI still does not do

`discoverCapabilities()` in the core package composes Phases 2 through 5 end to
end, but four of its stages are injected judgment: choosing search terms,
judging which search hits count, reading a package's docs and code, and scoring
Compatibility and Simplicity. A CLI has no LLM to supply them, so rather than
stub them with something that looks like an answer, this tool runs the half it
can run honestly. Driving the full pipeline needs an agent harness, and
[`skillmama/SKILL.md`](../../skillmama/SKILL.md) remains where that happens.
