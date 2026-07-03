# Changelog

All notable changes to SKILLmama are documented here.

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
