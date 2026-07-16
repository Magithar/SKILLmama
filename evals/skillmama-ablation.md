# SKILLmama Ablation Eval

Manual eval, run by hand, not wired into any pipeline. Based on the trigger rules in
[skillmama/SKILL.md](../skillmama/SKILL.md#L10-L21) and the skill-on/skill-off ablation
approach described in the "Don't Ship Skills Without Evals" talk (Philipp Schmid,
Google DeepMind) and SkillsBench (skillsbench.ai).

## How to run

For each prompt:
1. **Skill-off** — paste the prompt into a fresh session with SKILLmama not installed/disabled. Record what the agent does.
2. **Skill-on** — paste the same prompt into a fresh session with SKILLmama available. Record whether it triggered, and if so, whether it followed the right flow (A vs B).
3. Mark PASS/FAIL against the "Expected" column.

Re-run this whenever SKILL.md's Trigger/Do-NOT-activate section changes.

---

## Should trigger (5)

| # | Prompt | Expected flow | Notes |
|---|--------|----------------|-------|
| 1 | "What vector DB should I use for RAG in my FastAPI app?" | Flow A — named capability, stack given inline | Should skip Phase 1.5 (constraint) only if none stated — here none given, so it should ask once. |
| 2 | "Find me the best job queue for my Node stack, self-hosted only." | Flow A | Constraint already stated → Phase 1.5 should be skipped entirely. |
| 3 | "/skillmama" (no arguments, run inside a real project directory) | Flow B — project scanner | Should announce read-only scan, build Stack Profile, propose gaps, then stop for reply. |
| 4 | "Scan my project and tell me what I'm missing." | Flow B | Same as #3 via natural language instead of slash command. |
| 5 | "Recommend something for authentication, must have MCP support." | Flow A | Constraint stated inline (MCP support) → should search and surface MCP tier results prominently. |

## Should NOT trigger (5)

| # | Prompt | Why it shouldn't fire | Notes |
|---|--------|------------------------|-------|
| 6 | "How do I configure Redis pub/sub in Python?" | How-to question about a tool the user already has | Explicitly excluded, SKILL.md line 19. |
| 7 | "Why is my pgvector query returning zero results?" | Debugging an existing integration | Explicitly excluded, SKILL.md line 20. |
| 8 | "Can you review this auth middleware I wrote for security issues?" | Code review request | Explicitly excluded, SKILL.md line 20. |
| 9 | "I've decided to use Stripe for payments — walk me through the webhook setup." | User already knows the tool, wants implementation help | Explicitly excluded, SKILL.md line 21. |
| 10 | "What's the difference between REST and GraphQL?" | General conceptual question, not a capability search for their stack | Not a discovery/ranking request — no candidates to score. |

---

## Result log

**Run 1 — 2026-07-16 — trigger-classification only (fresh-context agent, no pipeline execution)**

Method: a subagent with no memory of this repo was given the verbatim Trigger / Do-NOT-activate text from SKILL.md and all 10 prompts, and asked to classify each independently (TRIGGER/NO-TRIGGER + flow), without running the actual search pipeline. This tests the decision layer only, not phase execution.

| Prompt # | Expected | Classified | Flow (if trigger) | Verdict |
|----------|----------|------------|--------------------|---------|
| 1 | TRIGGER | TRIGGER | A | PASS |
| 2 | TRIGGER | TRIGGER | A | PASS |
| 3 | TRIGGER | TRIGGER | B | PASS |
| 4 | TRIGGER | TRIGGER | B | PASS |
| 5 | TRIGGER | TRIGGER | A | PASS |
| 6 | NO-TRIGGER | NO-TRIGGER | — | PASS |
| 7 | NO-TRIGGER | NO-TRIGGER | — | PASS |
| 8 | NO-TRIGGER | NO-TRIGGER | — | PASS |
| 9 | NO-TRIGGER | NO-TRIGGER | — | PASS |
| 10 | NO-TRIGGER | NO-TRIGGER | — | PASS |

**Result: 10/10 PASS.** Trigger logic is unambiguous on this prompt set — no over-triggering, no under-triggering, correct flow selection where relevant.

**Not yet tested:** full phase execution (Phase 0 through 5) for the 5 should-trigger prompts — this run only validated the activation decision, not whether the pipeline itself produces good output once triggered. That requires live web searches and would stop mid-flow for constraint/clarification replies (Phase 1.5, Phase B3), so it needs a manual interactive run rather than a scripted one.

---

**Run 2 — 2026-07-16 — full pipeline execution, prompt #1 (live, manual)**

Prompt: "What vector DB should I use for RAG in my FastAPI app?" run against a real project (`nutri-bot` — FastAPI/Redis/Telegram bot, no existing vector DB).

Outcome: pipeline completed end-to-end (stack detection → constraint question/stop → 4-tier search → companion-skill search → scoring → Phase 5 output). Result: Chroma #1 (9.05), Qdrant #2 (7.30), pgvector #3 (5.55) — correctly penalized pgvector for a missing Postgres dependency and correctly preferred the zero-infra option for a lightweight bot.

Two gaps found and fixed in SKILL.md (and synced to `codex/AGENTS.md`, `antigravity/PROMPT.md`, `.claude/commands/skillmama.md`):

1. **Directory/stack mismatch not caught.** Phase 1 was first run against the SKILLmama meta-repo itself (wrong project — no FastAPI files exist there) and silently produced an empty scan instead of flagging the mismatch. Fix: Phase 1 now checks user-stated stack against what's actually detected and asks which directory to scan if they don't match.
2. **Maintenance scores estimated, not verified.** Compatibility already required per-candidate verification (env vars, CLI, config files) but Maintenance did not — 2 of 3 candidates' last-commit dates were estimated from general knowledge rather than searched. Fix: Maintenance now requires the same per-candidate verification, with an `N/A (unverified)` fallback instead of a confident-looking guess.

Verdict: **PASS with fixes applied.** Scoring math and final ranking were sound; the two gaps were about verification rigor and error handling, not about the recommendation being wrong.

| Date | Prompt # | Skill-off behavior | Skill-on behavior | Verdict |
|------|----------|---------------------|--------------------|---------|
| 2026-07-16 | 1 | (not run — pipeline-quality check only ran skill-on) | Full 5-phase pipeline, correct ranking, 2 gaps found & fixed | PASS (post-fix) |

---

**Run 3 — 2026-07-16 — regression check of the two fixes (live, manual)**

Same prompt, re-run post-fix from the wrong directory first (SKILLmama meta-repo) to confirm fix #1, then redirected to `nutri-bot` to confirm fix #2.

1. **Directory-mismatch check:** fired correctly. Ran from `/Users/magi/Documents/GitHub/SKILLmama` (no FastAPI/Python files present) — the skill stopped and asked "I didn't find FastAPI in this directory... want me to scan a different folder?" instead of silently completing an empty scan (the exact failure from Run 2). **PASS.**
2. **Maintenance verification:** fired correctly. Chroma (10, verified 2026-07-14) and pgvector (8, verified last push 2026-06-10) both got real dates from search. Qdrant's last-commit date could not be confirmed after two targeted searches — correctly marked `N/A (unverified)` in the output table instead of an estimated number, with the total score renormalized across the remaining three factors (7.41 vs. the guessed 7.30 in Run 2). **PASS.**

Final ranking unchanged from Run 2 (Chroma #1, Qdrant #2, pgvector #3) — the fixes changed transparency/error-handling, not the recommendation.

**Result: both fixes confirmed working, no regressions.**

---

**Run 4 — 2026-07-16 — trigger-classification regression check (fresh-context agent, post-fix)**

Same method as Run 1 (independent fresh-context classification, no pipeline execution), re-run after the Phase 1 and Phase 4 edits to confirm the fixes didn't disturb trigger behavior — the Trigger/Do-NOT-activate section itself wasn't touched by either fix.

| Prompt # | Expected | Classified | Flow (if trigger) | Verdict |
|----------|----------|------------|--------------------|---------|
| 1 | TRIGGER | TRIGGER | A | PASS |
| 2 | TRIGGER | TRIGGER | A | PASS |
| 3 | TRIGGER | TRIGGER | B | PASS |
| 4 | TRIGGER | TRIGGER | B | PASS |
| 5 | TRIGGER | TRIGGER | A | PASS |
| 6 | NO-TRIGGER | NO-TRIGGER | — | PASS |
| 7 | NO-TRIGGER | NO-TRIGGER | — | PASS |
| 8 | NO-TRIGGER | NO-TRIGGER | — | PASS |
| 9 | NO-TRIGGER | NO-TRIGGER | — | PASS |
| 10 | NO-TRIGGER | NO-TRIGGER | — | PASS |

**Result: 10/10 PASS, no regression.**

---

**Run 5 — 2026-07-16 — real paired skill-off vs. skill-on ablation, prompt #1**

Prior runs never actually executed the skill-off condition (Run 2's log entry literally says "not run"), so the eval wasn't a true paired ablation despite citing that methodology. This run fixes that: same prompt, same project (`nutri-bot`), skill-off run by a fresh agent with file-read access but no SKILLmama pipeline, no web search, no structured scoring — just its own judgment.

**Skill-off recommendation:** pgvector or Upstash Vector — explicitly *rejected* Chroma/FAISS in-process stores, because it read `nutri-bot/SETUP.md`'s Render deployment section and reasoned that Render's free/small web dynos have ephemeral disk, so an in-process vector store would silently lose data on restart. Also tied embedding-model choice to the existing Gemini dependency, and asked what the RAG is actually for before committing. Self-disclosed: no live verification, pure training-data judgment, 5 options seriously compared.

**Skill-on recommendation (from Run 3):** Chroma #1 — recommended specifically *for* being in-process/zero-infra, the exact property skill-off flagged as a deployment risk on this hosting platform. Verified real GitHub stars/PyPI downloads/commit dates, ran the security gate, found the official Qdrant companion-skill repo — grounding skill-off didn't have.

**Finding:** skill-on is substantially more grounded (verified popularity/maintenance data, security screening, MCP/companion-skill discovery) but has a real blind spot — Phase 4's Compatibility check verifies *local project* dependencies (env vars, CLI, config files) but never checks *hosting-platform* constraints (ephemeral vs. persistent disk, dyno restarts) that would make an "easy, zero-infra" pick fail silently in production. Skill-off caught this by reading `SETUP.md`; SKILLmama's own file list (Phase 1/B1) doesn't read deployment docs like `SETUP.md` at all — it reads `Dockerfile, docker-compose.yml, .env.example, vercel.json, fly.toml, railway.toml` but has no equivalent for Render, and doesn't extract "does deployed storage persist across restarts" from any of those even when present.

**Not yet fixed** — this is a real, higher-effort gap (requires reading deployment config/docs and reasoning about storage persistence, not just checking presence/absence of a file) rather than a quick one-line patch like the two fixes from Run 2. Logged here as a known limitation; worth a dedicated SKILL.md change (e.g. a "Deployment Persistence Check" sub-step in Phase 4 Compatibility) rather than folding into this session's fixes.

---

**Run 6 — 2026-07-16 — Deployment Persistence Check fix, live re-test**

Fixed and propagated to all 4 files (`skillmama/SKILL.md`, `codex/AGENTS.md`, `antigravity/PROMPT.md`, `.claude/commands/skillmama.md`):
- Phase 1/B1 file lists now also read `render.yaml`, `SETUP.md`, `DEPLOY.md`/`DEPLOYMENT.md`, and extract a detected deployment target
- Stack Profile template gained a `Deployment:` field
- Phase 4 Compatibility gained a **Deployment Persistence Check** sub-step: for any candidate that stores data locally/in-process/on-disk, check whether the detected deployment target actually persists local disk (`fly.toml` `[[mounts]]`, `railway.toml` volumes, `render.yaml` `disk:` block, `docker-compose.yml` `volumes:` mapping; Vercel/serverless always ephemeral). If a deployment target is detected with no persistent volume, cap Compatibility at 4–6 and add an explicit warning rather than scoring the candidate as if storage just works.

Re-ran prompt #1 against `nutri-bot` end-to-end. Result: Phase 1 correctly detected "Render Web Service (Free tier)" from `SETUP.md` (no `render.yaml` exists, so this came from the doc-reading fallback, confirming that fallback path works too, not just the config-file path). Chroma's Compatibility dropped from 8 (Run 3, uncaught) to 5, with the explicit persistence warning — matching what the skill-off baseline in Run 5 caught by reading the same file. Final score gap between Chroma (7.85) and Qdrant (7.41) narrowed to 0.44, triggering the tiebreaker-explanation rule; output now recommends Qdrant Cloud as the safer default if the corpus grows, Chroma only if it's cheaply rebuildable on cold start.

**Result: PASS.** The gap identified in Run 5 is now caught and surfaced in the actual pipeline output, not just in a side-by-side comparison. All 3 fixes from this session (directory-mismatch check, Maintenance verification, Deployment Persistence Check) are now live across all 4 adapters and confirmed working via live re-runs.
