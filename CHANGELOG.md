# Changelog

All notable changes to SKILLmama are documented here.

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
