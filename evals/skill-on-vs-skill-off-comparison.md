# SKILLmama: Skill-On vs. Skill-Off — A Real Paired Comparison

Same question, same project, two agents. One had SKILLmama installed. One didn't. This is the actual output from both, unedited, run against a real external repo (`nutri-bot` — a FastAPI/Redis/Telegram bot deployed on Render).

**Query:** "What vector DB should I use for RAG in my FastAPI app?"

This comparison is what motivated [`evals/skillmama-ablation.md`](skillmama-ablation.md) Run 5 and Run 6 — see that file for the full eval log and the fix that resulted from it.

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

## Skill-On (SKILLmama, post-fix, full pipeline)

**Stack detected:** Python / FastAPI 0.110 / Redis / Telegram bot — no Postgres, no vector DB in requirements.txt
**Deployment detected:** Render Web Service (Free tier) — via `SETUP.md`; no `render.yaml`, no persistent disk configured

| Candidate | Compat | Pop | Maint | Simple | **Score** |
|-----------|--------|-----|-------|--------|-----------|
| Chroma | 5 | 10 | 10 | 9 | **7.85** |
| Qdrant | 6 | 10 | N/A (unverified) | 6 | **7.41** |
| pgvector | 3 | 10 | 8 | 3 | **5.85** |

**#1 — Chroma · 7.85/10**
> ⚠️ in-process storage — no persistent disk found. Render's Free-tier Web Service has ephemeral local disk; every deploy or dyno restart wipes an in-process Chroma store. Fine if the corpus is small and cheaply rebuildable on startup — not fine if you're accumulating data over time.
> Popularity: 10/10 (28.7k GitHub stars, verified) · Maintenance: 10/10 (verified last commit 2026-07-14) · Simplicity: 9/10 · Security: PASS
> `pip install chromadb`

**#2 — Qdrant · 7.41/10**
> Hosted vector engine (Qdrant Cloud) sidesteps the persistence problem entirely.
> Popularity: 10/10 (~6M downloads/week, verified) · Maintenance: N/A (unverified — couldn't confirm last-commit date) · Simplicity: 6/10 · Security: PASS
> `pip install qdrant-client` · Official MCP server available · Official companion-skill repo found (`qdrant/skills`)

**#3 — pgvector · 5.85/10**
> Requires Postgres — not present in requirements.txt or `.env.example`.
> Popularity: 10/10 (22.2k stars, verified) · Maintenance: 8/10 (verified last push 2026-06-10) · Simplicity: 3/10 · Security: PASS

**Next Steps:** if the corpus is small and rebuildable on cold start, Chroma is fine — rebuild the index at app startup. If it grows over time, skip Chroma, use Qdrant Cloud's free tier instead — no persistence risk, no new infra to self-manage.

---

## What the comparison actually shows

| | Skill-off | Skill-on |
|---|---|---|
| **Live verification** | None — training-data judgment | Real GitHub stars, PyPI downloads, commit dates, security screening, MCP + companion-skill discovery |
| **Caught the Render ephemeral-disk risk** | Yes, immediately | Only after this comparison led to a fix — see below |
| **Structured, comparable scoring** | No | Yes — same formula every time |
| **Options seriously considered** | 5 | 3 scored + Also-Considered tier (broader search surface) |
| **Asked what the RAG is actually for** | Yes | No |

**The interesting result wasn't "skill-on wins" or "skill-off wins" — it's that they were each strong on different axes, and skill-off caught something skill-on's original design missed.** The first version of this comparison (SKILLmama v1.4.4) had Chroma at Compatibility 8/10 with no ephemeral-storage warning at all — a straightforwardly worse recommendation than skill-off's. That gap is what prompted the **Deployment Persistence Check** added in v1.4.5 (see [CHANGELOG.md](../CHANGELOG.md)): SKILLmama's Phase 4 now checks `SETUP.md`/`render.yaml`/`fly.toml`/`railway.toml`/`docker-compose.yml` for actual persistent storage before scoring any in-process candidate, and caps the score with an explicit warning if the deployment target won't survive a restart. The output above is the result of that fix — post-fix, skill-on catches the same risk skill-off caught, while still keeping the live-verified grounding skill-off never had.

This is the point of running the ablation for real instead of just describing it: it doesn't just validate the skill, it finds bugs a plain "does this look right?" review wouldn't have caught.
