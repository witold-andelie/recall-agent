# Recall Agent

A persistent-memory AI assistant. **CockroachDB Cloud** is the long-term memory layer (relational + vector + full-text in one Postgres-compatible database). **Amazon Bedrock** provides chat and embeddings. The app is Next.js on [Render](https://recall-agent.onrender.com/).

**Live demo:** [https://recall-agent.onrender.com/](https://recall-agent.onrender.com/)

UI chrome is English. Replies follow the **latest user message language** (default English; mid-thread switches are allowed). Memories are stored in the language the user used for that fact.

App code lives in [`recall-agent/`](./recall-agent). Schema is [`schema_v3.sql`](./schema_v3.sql) (copy under `recall-agent/sql/`).

---

## Architecture

One CockroachDB cluster is the record system: ops rows, `VECTOR(1024)`, PostgreSQL `tsvector` / `ts_rank`, and a small memory graph. Hybrid retrieval is a single SQL statement, not a sidecar search engine.

### System objects

| Object | Role |
|---|---|
| **Recall App** | Next.js agent: Chat `/`, Memory Browser `/memory` |
| **Auth session** | Guest cookie trial, then username/password or Google OAuth. Same `user_id` across browsers. Every memory SQL is tenant-scoped. |
| **Thread / Message** | Conversation + lineage (`source_message_id`) |
| **Memory** | Fact table: `preference` \| `fact` \| `task_state`; `content` + `content_tsv`; `embedding VECTOR(1024)`; `hit_count`, `last_used_at`, `importance` |
| **MemoryLink** | Graph edges: `supersedes` \| `duplicates` \| `derived_from` |
| **MemoryUsageEvent** | Per-hit analytics: vector / text / recency / usage / hybrid scores |
| **HybridScore** | `α·vec + β·ts_rank + γ·recency + δ·usage` in one CTE (CRDB vector index accelerates L2 `<->`, not cosine) |
| **Chat / Embed models** | **Amazon Bedrock** — Claude Haiku 4.5 + Titan Embed V2 (1024-d); OpenAI-compatible chat as fallback |
| **CockroachDB** | Serverless / PG wire; distributed **vector index** with `user_id` prefix; GIN on `content_tsv` |
| **Analytics views** | `v_memory_funnel`, `v_memory_reuse`, `v_hybrid_score_breakdown`, `v_duplicate_clusters`, `v_entity_clusters`, `v_l2_calibration` |
| **CRDB toolchain** | (1) distributed vector index (runtime) · (2) Managed Cloud MCP · (3) official Agent Skills repo |
| **AWS** | Amazon Bedrock (chat + Titan Embed V2) |

### Memory lifecycle (the product loop)

```
User message
  → pin live task_state (open work)
  → model may call search_memory / insert_memory / close_open_work
      search_memory → one hybrid SQL (vector L2 + simple FTS + entity hop)
      insert_memory → SQL ADD | UPDATE | SKIP
      close_open_work → SET valid_to on live task_state
  → stream reply
  → LLM may extract more candidates / entities / close_open_work
  → SQL stores row + vector + tsvector (per-candidate transaction)
```

Open work is always in the prompt. Archival facts are retrieved only via `search_memory`. The model never decides merge/skip; SQL does.

Start as Guest, then claim the same `user_id` with **username + password** (no email check) or **Google OAuth**. Sign in on another browser, list threads, browse / hybrid-search / CRUD memories. A delete in `/memory` changes the next answer.

### SQL surface (what judges can EXPLAIN)

**Hybrid retrieve** — two candidate sets (ANN L2 top-80, FTS `simple` `ts_rank` top-50) fused with recency `exp(-age_days/14)` and `ln(1+hits)` usage, then an **entity CTE** hops through shared person/org/place names. Weights 0.55 / 0.25 / 0.10 / 0.10 plus a small entity bonus.

**Dedupe** — `ORDER BY embedding <-> $candidate` under `user_id` + `kind`; L2 cutoffs come from `v_l2_calibration` (Titan labeled log) when there are enough rows, else 0.35 / 0.7.

**Analytics** — daily funnel (messages → extractions → ADD/UPDATE/SKIP), reuse buckets, score-component averages.

Demo path: Claude Code + Managed Cloud MCP, `EXPLAIN` the hybrid ANN statement, then `SELECT * FROM v_memory_funnel`.

Open-work loop: user names a job → extract `task_state` → every later turn **pins** live `task_state`. Archival recall is a `search_memory` tool (hybrid SQL), not auto-injected. `close_open_work` or extract `close_open_work=true` expires live `task_state`.

### Hackathon requirements

**CockroachDB tools we use** (ccloud CLI is **not** used and is not claimed):

| Tool | How it is used |
|---|---|
| Distributed vector index | `CREATE VECTOR INDEX memories_user_embedding_vec_idx (user_id, embedding)` in [`schema_v3.sql`](./schema_v3.sql). Runtime ANN is `ORDER BY embedding <-> $q` under `user_id` in [`hybrid.ts`](./recall-agent/src/lib/memory/hybrid.ts). |
| Managed MCP server | Official Cloud MCP `https://cockroachlabs.cloud/mcp`. Claude Code reads [`.mcp.json`](./.mcp.json) (`type: http`). Cursor: [`.cursor/mcp.json`](./.cursor/mcp.json). Verified live: [`docs/managed-mcp.md`](./docs/managed-mcp.md). Not on the chat request path. |
| Agent Skills repo | Official [cockroachlabs/cockroachdb-skills](https://github.com/cockroachlabs/cockroachdb-skills) as submodule [`vendor/cockroachdb-skills/`](./vendor/cockroachdb-skills). Hybrid ANN validated with skill `cockroachdb-sql` (`EXPLAIN` → `vector search`): [`docs/explain-hybrid-ann.md`](./docs/explain-hybrid-ann.md). Overlay: [`skills/memory-analytics/`](./skills/memory-analytics/). |

**AWS (1+ required):**

| Service | How it is used |
|---|---|
| Amazon Bedrock | Live when `AI_PROVIDER=bedrock`. Chat: `us.anthropic.claude-haiku-4-5-20251001-v1:0`. Embed: `amazon.titan-embed-text-v2:0` (1024-d). Code: [`recall-agent/src/lib/ai/`](./recall-agent/src/lib/ai/). |

Judge walkthrough: open [https://recall-agent.onrender.com/](https://recall-agent.onrender.com/) → chat two turns → Memory hits / ADD → `/memory` delete → next turn changes. Then Claude Code + Cloud MCP: `EXPLAIN` the hybrid ANN and `SELECT * FROM v_memory_funnel`. The first load after idle can take ~30s (Render free sleep).

### Known limitations

- CockroachDB vector indexes accelerate **L2 `<->`**, not cosine. Hybrid weights assume that operator. The ANN CTE binds `$1`/`$2` directly (an index hint plus `JOIN q` is rejected). Soft-delete and `kind` are applied after over-fetch.
- `v_hybrid_score_breakdown.retrieval_hits` is **one row per memory hit**, not per chat turn. Funnel and reuse views are the right grain for “how many turns / how many memories.”
- `v_memory_reuse.content_preview` is `left(content, 120)` — treat as an identifier, not text to quote.
- Official CockroachDB skills are **dev-time**. Chat does not invoke them. After clone: `git submodule update --init --recursive`.
- Managed MCP is the official Cloud HTTP server. First connect needs OAuth in Claude Code (or Cursor). Chat still uses `DATABASE_URL` + `pg`, not MCP.
- Older on-demand Claude 3.x model IDs are often EOL on new accounts. Prefer the `us.*` inference-profile ID or Amazon Nova. Probe with `recall-agent/scripts/probe-bedrock.mjs`.
- Operations in this repo: structured JSON logs, `/api/health` (process liveness), `/api/ready` (Cockroach + pool + chat gate), `npm test`, `npm run db:check`, Zod on memory extract, configurable `DATABASE_POOL_MAX`, per-process `CHAT_MAX_INFLIGHT` gate, `recall_app` grants. Scale is CRDB row/transaction volume plus multiple Next.js processes (`npm run start:cluster` or repo-root `docker compose up`). Not Lambda/S3. Bedrock IAM stays `AmazonBedrockFullAccess` on purpose. No email sending.

---

## Quick start

```bash
cd recall-agent
cp .env.example .env.local
# set DATABASE_URL and Bedrock (or OpenAI-compatible) keys

psql "$DATABASE_URL" -f sql/schema_v3.sql
psql "$DATABASE_URL" -f ../mcp_readonly_role.sql   # optional: MCP read-only role
# if needed: SET CLUSTER SETTING feature.vector_index.enabled = true;

npm install
npm run dev
```

### Deploy on Render

**Live service:** [https://recall-agent.onrender.com/](https://recall-agent.onrender.com/)  
`APP_URL` on that service is `https://recall-agent.onrender.com`. Health: `/api/health`. Ready (SQL): `/api/ready`.

The GitHub repo has [`render.yaml`](./render.yaml). To recreate in [Render Dashboard](https://dashboard.render.com/):

1. **New → Blueprint** and select `witold-andelie/recall-agent` (`main`).
2. Set secrets (do not commit them):
   - `DATABASE_URL` — CockroachDB Cloud connection string (`sslmode=verify-full` is fine).
   - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — same keys you use locally for Bedrock.
   - `SESSION_SECRET` is generated if you use the Blueprint.
   - `APP_URL` — `https://recall-agent.onrender.com`
3. If the Cloud cluster has an IP allowlist, allow Render egress (or `0.0.0.0/0` for the demo).
4. Google login (optional): in Google Cloud, add  
   `https://recall-agent.onrender.com/api/auth/google/callback`  
   as an authorized redirect, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Render health is `GET /api/health` (process only). After Live, open `GET /api/ready` — if `db` is false, the Cloud cluster is blocking Render (Networking → IP allowlist; for a public demo add `0.0.0.0/0` SQL).

Free Render instances sleep after idle time; the first request after sleep can take ~30s.

Local: http://localhost:3000 after `npm run dev`.

Demo (on the live URL or locally):

1. Register a username + password, or Continue with Google.
2. `I prefer concise answers. I work in TypeScript on AWS.`
3. `What do you know about my preferences?` — the model should call `search_memory` (right-hand Memory tools).
4. Open work: `I am shipping Recall this week. Left: the 3-minute video.` Then `What is left?`
5. `Everything is done — close that job.` — live `task_state` gets `valid_to`.
6. `/memory` — search, lineage, entities, or delete; the next turn reflects deletes.
7. Switch mid-thread: `Responde en espanol: que sabes de mi?` — reply language follows this turn.

### API

| Route | Purpose |
|---|---|
| `POST /api/auth` | Guest session cookie + profile |
| `POST /api/auth/register` | Claim Guest with username + password (no email) |
| `POST /api/auth/login` | Username + password |
| `GET /api/auth/google` | Start Google OAuth |
| `GET /api/auth/google/callback` | Google OAuth return |
| `POST /api/auth/logout` | Expire session; next request is a new Guest |
| `POST /api/auth/password` | Change password (password accounts) |
| `GET` / `POST /api/threads` | Threads |
| `POST /api/chat` | NDJSON: pin open work → memory tools → stream → extract |
| `GET` / `POST` / `DELETE /api/memories` | Browser + hybrid `?q=` + lineage. `?history=1` includes expired versions |
| `GET /api/entities` | Tenant entity clusters |
| `GET /api/health` | Process liveness (Render uses this; no SQL) |
| `GET /api/ready` | CockroachDB + schema + pool + chat gate |
| `GET /api/ops/funnel` | This tenant's `v_memory_funnel` (last 7 days) |

More app notes: [`recall-agent/README.md`](./recall-agent/README.md).

## License

Apache License 2.0. See [`LICENSE`](./LICENSE). The GitHub repository About field is set to Apache-2.0.
