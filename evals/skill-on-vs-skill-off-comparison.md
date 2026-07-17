# SKILLmama: Skill-On vs. Skill-Off — A Real Paired Comparison

Same question, same project, two agents. One had SKILLmama installed. One didn't. This is the actual output from both, unedited, run against a real external repo (`nutri-bot` — a FastAPI/Redis/Telegram bot deployed on Render). The skill-off side below is unedited from its original run (Run 5); the skill-on side was re-run live on 2026-07-17 against SKILLmama v1.4.6 to pick up the OSV.dev security gate added since the last refresh.

**Query:** "What vector DB should I use for RAG in my FastAPI app?"

This comparison is what motivated [`evals/skillmama-ablation.md`](skillmama-ablation.md) Runs 5, 6, and 7 — see that file for the full eval log and the fixes that resulted from it.

---

## Skill-Off (plain agent, no SKILLmama, no live web search)

> I looked at your nutri-bot repo before answering. Here's what I found and what I'd recommend.
>
> ### What your stack actually looks like
> - **FastAPI** (`fastapi==0.110.0`) + `uvicorn`, deployed on **Render** (free/small web service tier, per `SETUP.md`)
> - **Redis** already wired in for caching (`src/cache.py`, `REDIS_URL` in `.env.example`)
> - LLMs: **Gemini** as primary, **Groq** as fallback
> - No existing vector DB, embeddings, or RAG code anywhere in `src/`
>
> ### My recommendation: pgvector (Postgres) — or if you want zero new infra, Redis Stack / Upstash Vector
>
> **Option A — Upstash Vector:** you already depend on Redis; Upstash Vector has a free tier and a dead-simple REST API.
>
> **Option B — pgvector:** Render has native managed Postgres. More durable if the corpus grows or you want relational joins alongside vector search (e.g. "alternatives with score < X in the same category").
>
> ### What I'd avoid
> - **Pinecone / Weaviate / Qdrant Cloud / Milvus** — overkill for a single-bot side project.
> - **FAISS / Chroma running in-process** — tempting because they're "zero infra," but **on Render's free/small web dynos your process can restart or spin down (cold starts), so an in-memory or local-disk vector index disappears or desyncs.** Only reasonable if your corpus is tiny and rebuildable in a few seconds on startup.
>
> ### Concrete suggestion
> Start with **Upstash Vector** for fastest path to shipping, or **Render Postgres + pgvector** if you want structured filtering alongside similarity search. For embeddings, use Gemini's `text-embedding-004` since you're already calling Gemini — avoids adding an OpenAI dependency you don't otherwise need.
>
> If you tell me what the RAG is actually for, I can narrow this further.

**Self-reported meta-note:** 5 options seriously compared. No live web search, no verified popularity/maintenance/star data — pure training-data judgment plus direct inspection of the repo's actual files.

---

## Skill-On (SKILLmama, v1.4.6 + precondition-quoting fix, full pipeline — includes live OSV.dev security gate)

**Stack detected:** Python / FastAPI 0.110 / Redis / Telegram bot — no Postgres, no vector DB in requirements.txt
**Deployment detected:** Render Web Service (Free tier) — via `SETUP.md`; no `render.yaml`, no persistent disk configured

| Candidate | Compat | Pop | Maint | Simple | **Score** |
|-----------|--------|-----|-------|--------|-----------|
| Chroma | — | — | — | — | **BLOCKED** — CVE-2026-45829 (CRITICAL, unpatched) |
| Qdrant | 6 | 10 | 10 | 6 | **7.80** |
| pgvector | 3 | 10 | 10 | 3 | **6.15** |

**Chroma — BLOCKED**
> `curl -X POST https://api.osv.dev/v1/query -d '{"package":{"name":"chromadb","ecosystem":"PyPI"},"version":"1.5.9"}'` returns `GHSA-f4j7-r4q5-qw2c` / `CVE-2026-45829` — a CRITICAL pre-authentication code injection vulnerability, unpatched as of the current latest release (`first_patched_version: null`, confirmed directly against the GitHub Advisory API). Discarded per the Phase 3.5 hard rule before it ever reaches scoring — no persistence-risk analysis needed, it doesn't survive the security gate.
> `security_note`: "Pre-authentication code injection — triggered via a malicious model repository with `trust_remote_code` set to true on `/api/v2/tenants/{tenant}/databases/{db}/collections`." Still blocked regardless of the precondition, but nutri-bot's usage (embedded, in-process, no `trust_remote_code` flag anywhere in the codebase) would never hit this path — the note is what lets a user tell the difference between "unsafe for me" and "unsafe in a mode I don't use."

**#1 — Qdrant · 7.80/10**
> Hosted vector engine (Qdrant Cloud) sidesteps the Render ephemeral-disk problem entirely, and OSV.dev returned no advisories for `qdrant-client` 1.18.0.
> Popularity: 10/10 (33.3k GitHub stars, ~6.06M downloads/week, verified) · Maintenance: 10/10 (main repo updated today, verified) · Simplicity: 6/10 · Security: PASS (OSV clean)
> `pip install qdrant-client` · Official MCP server available (`qdrant/mcp-server-qdrant`) · Official companion-skill repo found (`qdrant/skills`)

**#2 — pgvector · 6.15/10**
> Requires Postgres — not present in requirements.txt or `.env.example`. OSV.dev clean for the Python binding.
> Popularity: 10/10 (22.2k stars, verified) · Maintenance: 10/10 (verified last commit 2026-07-11) · Simplicity: 3/10 · Security: PASS (OSV clean)

**Next Steps:** Qdrant Cloud's free tier is the safe default here — no persistence risk on Render's ephemeral disk, and nothing in its security scan. Chroma is off the table until a patched release exists for CVE-2026-45829, regardless of how well it otherwise fits a small self-contained bot.

---

## What the comparison actually shows

| | Skill-off | Skill-on |
|---|---|---|
| **Live verification** | None — training-data judgment | Real GitHub stars, PyPI downloads, commit dates, live OSV.dev security screening, MCP + companion-skill discovery |
| **Caught the Render ephemeral-disk risk** | Yes, immediately | Yes, as of the v1.4.5 Deployment Persistence Check |
| **Caught the unpatched CRITICAL CVE in Chroma** | No | Yes, as of the v1.4.6 OSV.dev gate — this run is the first time either condition actually hit it |
| **Structured, comparable scoring** | No | Yes — same formula every time |
| **Options seriously considered** | 5 | 3 scored + Also-Considered tier (broader search surface) |
| **Asked what the RAG is actually for** | Yes | No |

**The interesting result was never "skill-on wins" or "skill-off wins" — it's that each ablation round exposed something the other missed, and the skill got fixed each time instead of the gap getting explained away.** The first version of this comparison (SKILLmama v1.4.4) had Chroma at Compatibility 8/10 with no ephemeral-storage warning at all — a straightforwardly worse recommendation than skill-off's read of the same `SETUP.md`. That gap is what prompted the **Deployment Persistence Check** added in v1.4.5 (see [CHANGELOG.md](../CHANGELOG.md)).

Then v1.4.6 replaced Phase 3.5's unsourced "known CVE" rule with a real `curl` to OSV.dev, and the very first live re-run of this exact prompt found something neither skill-off's judgment nor any prior skill-on run had caught: `chromadb` 1.5.9 — the current latest release, and the library every earlier run of this eval ranked #1 — carries `CVE-2026-45829`, a CRITICAL pre-authentication code injection vulnerability with **no patched version available at all** (`first_patched_version: null`, confirmed against the GitHub Advisory API directly). Chroma is now BLOCKED before it ever reaches scoring, and Qdrant — clean on OSV, verified-maintained as of today — is the uncontested #1. The output above is that run's result, not a hypothetical.

This is the point of running the ablation for real instead of just describing it: it doesn't just validate the skill, it finds bugs — and now live, current-world risks — that a plain "does this look right?" review wouldn't have caught.
