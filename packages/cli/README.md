# skillmama-cli

First real consumer of the [`skillmama`](../core) package. Runs a structured
project scan (`analyzeProject()`) and prints the resulting `StackProfile`.

## Usage

```
skillmama scan [dir]     Scan a project directory (default: current directory)
skillmama scan --json    Machine-readable output
```

Exit codes: `0` scan completed · `1` scan failed · `2` usage error.

The scan is the same deterministic slice SKILL.md's Phase 1 uses: it reads
only top-level manifest/config files, never README prose or source code.
Unknown technologies are silently ignored; a malformed manifest fails loudly.

Not yet implemented anywhere in code: candidate search, security gating,
and scoring factor production — those remain LLM reasoning in
[`skillmama/SKILL.md`](../../skillmama/SKILL.md).
