# Changelog

All notable changes to SKILLmama are documented here.

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
