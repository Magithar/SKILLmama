<p align="center"><img src="logo.png" alt="SKILLmama" width="350"/></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="License"/>
  <img src="https://img.shields.io/badge/Claude_Code-slash_command-8A2BE2" alt="Claude Code"/>
  <img src="https://img.shields.io/badge/Claude.ai-skill-orange" alt="Claude.ai"/>
  <img src="https://img.shields.io/badge/OpenAI_Codex-AGENTS.md-412991" alt="OpenAI Codex"/>
  <img src="https://img.shields.io/badge/Antigravity-system_prompt-black" alt="Antigravity"/>
  <img src="https://img.shields.io/github/stars/Magithar/SKILLmama?color=yellow" alt="Stars"/>
  <img src="https://img.shields.io/github/issues/Magithar/SKILLmama" alt="Issues"/>
  <img src="https://img.shields.io/github/v/release/Magithar/SKILLmama?include_prereleases&label=release" alt="Release"/>
</p>

<p align="center">
  SKILLmama eliminates the hours spent researching which library, SDK, or tool to use — it scans your project's actual stack, searches across 5 tiers of the ecosystem, and returns the top 3 ranked picks with scored evidence. No more Reddit threads or outdated blog posts; just the right tool for your exact setup, with install commands and links, in seconds.<br/><br/>
  Works with Claude Code, Claude.ai, OpenAI Codex, and Antigravity.
</p>

---

<p align="center">
  <a href="#install">Install</a> • <a href="#usage">Usage</a> • <a href="#ai-adapters">AI Adapters</a> • <a href="#core-workflow">Core Workflow</a> • <a href="#ranking-formula">Ranking Formula</a> • <a href="#5-tier-search-hierarchy">5-Tier Search</a> • <a href="#output-format">Output Format</a> • <a href="#end-to-end-example">Example</a> • <a href="#project-structure">Project Structure</a>
</p>

---

## Install

### Claude Code (CLI)

Copy the skill file into your project's `.claude/commands/` folder:

```bash
mkdir -p /your-project/.claude/commands
cp .claude/commands/skillmama.md /your-project/.claude/commands/skillmama.md
```

Then type `/skillmama` in any Claude Code session inside that project.

### Claude.ai (Web / Desktop)

1. Clone or download this repo
2. Zip the `skillmama/` folder:
   ```bash
   zip -r skillmama.zip skillmama/
   ```
3. Go to **Customize → Skills → +** and upload `skillmama.zip`
4. Type `/skillmama` in any Claude.ai conversation

### OpenAI Codex

Place `codex/AGENTS.md` in your repo root, then run naturally:

```bash
codex "find me the best job queue for this project"
```

### Antigravity

Load `antigravity/PROMPT.md` as the system prompt, then ask naturally:

```
find me a vector database for this project
```

---

## Usage

```
/skillmama find me a vector database for my FastAPI project
/skillmama what auth library should I use for my Next.js app?
/skillmama scan my project and tell me what's missing
/skillmama find a .dwg parser for Node.js
```

---

## AI Adapters

| AI System    | File                                                           | How to use                               |
| ------------ | -------------------------------------------------------------- | ---------------------------------------- |
| Claude Code  | [.claude/commands/skillmama.md](.claude/commands/skillmama.md) | `/skillmama` slash command               |
| Claude.ai    | [skillmama/skill.md](skillmama/skill.md)                       | Upload zip via Customize → Skills        |
| OpenAI Codex | [codex/AGENTS.md](codex/AGENTS.md)                             | Place in repo root as agent instructions |
| Antigravity  | [antigravity/PROMPT.md](antigravity/PROMPT.md)                 | Load as system prompt                    |

All four adapters run the same pipeline and produce the same output format.

---

## Core Workflow

```
┌─────────────────────────────────────────────────────────┐
│                      USER REQUEST                       │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   PHASE 0             │
              │   Understand Request  │
              │   Extract: capability,│
              │   stack, constraints  │
              └───────────┬───────────┘
                          │
                          ▼
                   ◇ Capability
                     vague?
                   /         \
                 YES           NO
                  │             │
                  ▼             │
          Ask 1 clarifying      │
          question, await       │
          user response         │
                  │             │
                  └──────┬──────┘
                         │
                         ▼
              ┌───────────────────────┐
              │   PHASE 1             │
              │   Architecture Scan   │
              └───────────┬───────────┘
                          │
                          ▼
                   ◇ In a project
                     repo?
                   /         \
                 YES           NO
                  │             │
                  ▼             │
        Read: package.json,     │
        Dockerfile, README,     │
        source files            │
        Extract: lang,          │
        frameworks, DBs,        │
        gaps                    │
                  │             │
                  └──────┬──────┘
                         │
                         ▼
              ┌───────────────────────┐
              │   PHASE 2             │
              │   Capability Gap      │
              │   Detection           │
              │                       │
              │   Define:             │
              │   CAPABILITY          │
              │   STACK               │
              │   CONSTRAINTS         │
              │   SEARCH_TERMS (3–5)  │
              └───────────┬───────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   PHASE 3             │
              │   5-Tier Search       │
              └───────────┬───────────┘
                          │
                    ┌─────┴───────────────────────────────────────┐
                    │         Search loop (tiers in order)        │
                    │                                             │
                    │  Tier 1 ── skills.sh                        │
                    │     ↓                                       │
                    │  Tier 2 ── GitHub (stars, recency, contrib) │
                    │     ↓                                       │
                    │  Tier 3 ── MCP Ecosystem                    │
                    │     ↓                                       │
                    │  Tier 4 ── npm / PyPI registries            │
                    │     ↓                                       │
                    │  Tier 5 ── Templates & Cookbooks            │
                    └─────────────────┬───────────────────────────┘
                                      │
                          ◇ 8+ candidates
                            found?
                           /        \
                         YES          NO
                          │            │
                     Skip remaining    │
                     tiers             │
                          │            │
                          └─────┬──────┘
                                │
                                ▼
              ┌────────────────────────────────────────┐
              │   PHASE 3.5 — Security & Quality Gate  │
              │                                        │
              │   Hard Gate (per candidate):           │
              │   🚫 BLOCKED → discard, never score    │
              │   ⚠️  WARN   → show, user confirms     │
              │                                        │
              │   Quality flags (SQP rules):           │
              │   SQP-1  Vague triggers                │
              │   SQP-2  Missing user warnings         │
              │   SQP-3  Policy violations             │
              └───────────────┬────────────────────────┘
                              │
                              ▼
              ┌────────────────────────────────────────┐
              │   PHASE 4 — Score Each Candidate       │
              │                                        │
              │   Score = (C × 0.40) +                 │
              │           (P × 0.30) +                 │
              │           (M × 0.15) +                 │
              │           (S × 0.15)                   │
              │                                        │
              │   C — Compatibility   (stack fit)      │
              │   P — Popularity      (stars/downloads)│
              │   M — Maintenance     (last commit)    │
              │   S — Simplicity      (install effort) │
              │                                        │
              │   Each factor: 1–10                    │
              └───────────────┬────────────────────────┘
                              │
                              ▼
              ┌────────────────────────────────────────┐
              │   PHASE 5 — Present Results            │
              │                                        │
              │   #1, #2, #3 — full score breakdown    │
              │   Also Considered — table              │
              │   MCP callout (if found)               │
              │   Next Steps (3 actions)               │
              └────────────────────────────────────────┘
```

---

## Security & Quality Gate

Before scoring, every candidate passes through a two-layer gate (Phase 3.5):

| Layer | What it checks | Action |
| ----- | -------------- | ------ |
| Hard Gate | CVE dependencies, data exfiltration, no-disclosure destructive ops, jailbreak instructions | 🚫 BLOCKED (discarded) or ⚠️ WARN (user confirms) |
| SQP-1 | Vague trigger phrases with no exclusion conditions | Flag in result |
| SQP-2 | Destructive/sensitive ops with no user-visible warning | Flag in result |
| SQP-3 | Hardcoded language/locale without user opt-in | Flag in result |

Inspired by [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector) (Apache 2.0) semantic quality policy rules. For deeper static analysis with 64 vulnerability patterns and live CVE lookups, run SkillSpector directly: `pip install skillspector && skillspector scan <repo-url>`.

---

## Ranking Formula

Every candidate that passes the gate is scored 1–10 on four dimensions:

| Factor        | Weight | Signals                                                  |
| ------------- | ------ | -------------------------------------------------------- |
| Compatibility | 40%    | Language/framework fit, official SDK, integration effort |
| Popularity    | 30%    | GitHub stars, npm/PyPI/go weekly downloads               |
| Maintenance   | 15%    | Days since last commit, release cadence                  |
| Simplicity    | 15%    | Setup effort, documentation quality                      |

`Total = (Compat × 0.40) + (Pop × 0.30) + (Maint × 0.15) + (Simp × 0.15)`

---

## 5-Tier Search Hierarchy

| Tier | Source                                          | What it finds                              |
| ---- | ----------------------------------------------- | ------------------------------------------ |
| 1    | [skills.sh](https://skills.sh)                  | Reusable skills and capability patterns    |
| 2    | GitHub                                          | Open-source libraries, frameworks, SDKs    |
| 3    | [Smithery](https://smithery.ai) / MCP Ecosystem | AI-native tools installable as MCP servers |
| 4    | npm / PyPI / pkg.go.dev                         | Package registries with download signals   |
| 5    | Curated Templates                               | LangGraph, OpenHands, cookbook examples    |

---

## Output Format

Each result card includes:

```
#1 — [Name] · Score: X.X/10
[One sentence on why it wins for this stack]
- Compatibility: X/10 — [reason]
- Popularity:    X/10 — [stars/downloads]
- Maintenance:   X/10 — [last commit / release cadence]
- Simplicity:    X/10 — [setup effort]
- Security:      [PASS | ⚠️ SQP-N — finding | 🚫 BLOCKED]
- Install: `[command]`
- Links: [skills.sh] · [npm] · [PyPI] · [pkg.go.dev] · [Smithery] · [GitHub]
```

Followed by:

- **Also Considered** table with Name · Score · Why not #1 · Links
- **MCP Option** callout with Smithery + GitHub links
- **Next Steps** — 3 concrete actions

---

## End-to-End Example

**User prompt:**

```
find me a vector database for my FastAPI + Python project
```

**Step 1 — Architecture Scan**

```
✓ pyproject.toml    → Python 3.11, FastAPI, SQLAlchemy
✓ Dockerfile        → containerized, no GPU
✓ .env.example      → OPENAI_API_KEY present → RAG use case confirmed
```

Detected stack: `Python / FastAPI / PostgreSQL / Docker / OpenAI`

**Step 2 — Capability Detection**

```
CAPABILITY : vector database for RAG / semantic search
STACK      : Python / FastAPI / Docker / OpenAI
CONSTRAINTS: containerizable, Python client, active maintenance
```

**Step 3 — 5-Tier Search**

```
Tier 1 skills.sh   → "qdrant-memory-skill", "chroma-rag-skill"
Tier 2 GitHub      → qdrant/qdrant (17k★), chroma-core/chroma (14k★),
                     pgvector/pgvector (11k★), milvus-io/milvus (29k★)
Tier 3 MCP         → qdrant-mcp-server, chroma-mcp
Tier 4 PyPI        → qdrant-client (380k/wk), chromadb (620k/wk), pgvector (180k/wk)
Tier 5 Templates   → LangChain + Qdrant RAG template, FastAPI + Chroma starter
```

**Step 4 — Scoring**

| Candidate | Compat | Popular | Maint | Simple | **Score** |
| --------- | ------ | ------- | ----- | ------ | --------- |
| Qdrant    | 9      | 8       | 10    | 9      | **9.05**  |
| pgvector  | 10     | 7       | 9     | 7      | **8.65**  |
| Chroma    | 8      | 8       | 9     | 10     | **8.55**  |
| Milvus    | 6      | 9       | 10    | 4      | **7.05**  |

**Step 5 — Output**

```
## SKILLmama Results

Capability: vector database for RAG
Stack: Python / FastAPI / PostgreSQL / Docker / OpenAI
Sources: Tier 1 (skills.sh) · Tier 2 (GitHub) · Tier 3 (MCP) · Tier 4 (PyPI) · Tier 5 (Templates)

---

#1 — Qdrant · Score: 9.05/10
Docker-native, official Python client, active MCP server for AI workflows.
- Compatibility: 9/10  — official qdrant-client SDK, FastAPI examples in docs
- Popularity:    8/10  — 17k GitHub stars, 380k PyPI downloads/week
- Maintenance:  10/10  — committed 2 days ago, weekly releases
- Simplicity:   9/10  — docker run + pip install, 5-min setup
- Security:     PASS  — no findings
- Install: docker run -p 6333:6333 qdrant/qdrant && pip install qdrant-client
- Links: [skills.sh](https://skills.sh/qdrant) · [PyPI](https://pypi.org/project/qdrant-client) · [Smithery](https://smithery.ai/server/qdrant-mcp-server) · [GitHub](https://github.com/qdrant/qdrant)

#2 — pgvector · Score: 8.65/10
Stay on PostgreSQL — no new infra, native SQL queries.
- Links: [PyPI](https://pypi.org/project/pgvector) · [GitHub](https://github.com/pgvector/pgvector)

#3 — Chroma · Score: 8.55/10
Easiest local dev setup; best for prototyping before scaling.
- Links: [PyPI](https://pypi.org/project/chromadb) · [Smithery](https://smithery.ai/server/chroma-mcp) · [GitHub](https://github.com/chroma-core/chroma)

---

Also Considered:
| Name   | Score | Why not #1                        | Links |
|--------|-------|-----------------------------------|-------|
| Milvus | 7.05  | Complex setup, over-engineered for solo/small team | [PyPI](https://pypi.org/project/pymilvus) · [gh](https://github.com/milvus-io/milvus) |

---

MCP Option: qdrant-mcp-server — install as MCP tool for direct AI memory integration.
[Smithery](https://smithery.ai/server/qdrant-mcp-server) · [GitHub](https://github.com/qdrant/mcp-server-qdrant)

Next Steps:
1. docker run qdrant/qdrant and pip install qdrant-client to validate locally
2. Use the LangChain + Qdrant RAG template as a starting point
3. If staying Postgres-only, evaluate pgvector — saves an infra hop
```

---

## What SKILLmama Is Not

- Not an IDE or autocomplete assistant
- Not a chatbot
- Not a package manager

SKILLmama is a **capability oracle**: it tells you what to use and why, with evidence.

---

## Project Structure

```
SKILLmama/
├── skillmama/
│   └── skill.md               # Claude.ai skill (upload as zip)
├── .claude/
│   └── commands/
│       └── skillmama.md       # Claude Code slash command
├── codex/
│   └── AGENTS.md              # OpenAI Codex agent instructions
├── antigravity/
│   └── PROMPT.md              # Antigravity system prompt
├── skillmama.zip              # Pre-built zip for Claude.ai upload
└── README.md
```
