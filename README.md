# Recall Agent

A persistent-memory AI assistant. **CockroachDB** is the long-term memory layer (relational + vector + full-text in one Postgres-compatible database). **AWS** is the intended runtime (Bedrock now; Lambda / S3 later).

UI chrome is English. Replies follow the **latest user message language** (default English; mid-thread switches are allowed). Memories are stored in the language the user used for that fact.

App code lives in [`recall-agent/`](./recall-agent). Schema is [`schema_v3.sql`](./schema_v3.sql) (copy under `recall-agent/sql/`).

---

## Architecture

One CockroachDB cluster is the record system: ops rows, `VECTOR(1024)`, PostgreSQL `tsvector` / `ts_rank`, and a small memory graph. Hybrid retrieval is a single SQL statement, not a sidecar search engine.

### System objects

| Object | Role |
|---|---|
| **Recall App** | Next.js agent: Chat `/`, Memory Browser `/memory` |
| **Auth session** | Anonymous trial cookie → stable `user_id` (every memory SQL is tenant-scoped) |
| **Thread / Message** | Conversation + lineage (`source_message_id`) |
| **Memory** | Fact table: `preference` \| `fact` \| `task_state`; `content` + `content_tsv`; `embedding VECTOR(1024)`; `hit_count`, `last_used_at`, `importance` |
| **MemoryLink** | Graph edges: `supersedes` \| `duplicates` \| `derived_from` |
| **MemoryUsageEvent** | Per-hit analytics: vector / text / recency / usage / hybrid scores |
| **HybridScore** | `α·vec + β·ts_rank + γ·recency + δ·usage` in one CTE (CRDB vector index accelerates L2 `<->`, not cosine) |
| **Chat / Embed models** | **Amazon Bedrock** — Claude Haiku 4.5 + Titan Embed V2 (1024-d); OpenAI-compatible chat as fallback |
| **CockroachDB** | Serverless / PG wire; distributed **vector index** with `user_id` prefix; GIN on `content_tsv` |
| **Analytics views** | `v_memory_funnel`, `v_memory_reuse`, `v_hybrid_score_breakdown`, `v_duplicate_clusters` |
| **CRDB toolchain** | ① vector index (runtime) · ② Managed MCP (read-only role) · ③ `ccloud` CLI · ④ Agent Skills |
| **AWS** | Bedrock (live) · Lambda / S3 (optional later) |

### Memory lifecycle (the product loop)

```
User message
  → embed query
  → hybrid retrieve  (1 SQL: vector L2 + ts_rank + recency + hits, WHERE user_id = $uid)
  → assemble EN prompt + top-K memories
  → stream reply
  → LLM extracts candidates only  (preference | fact | task_state)
  → SQL dedupe decides ADD | UPDATE | SKIP  (near-neighbor L2 + optional links)
  → store row + vector + tsvector  (per-candidate transaction)
```

Reads are retrieval into the prompt. Writes are extract → SQL decision → persist. The model never decides merge/skip; SQL does.

Conversation control is the same tenant rule: authenticate (anonymous first login), create/list threads, browse / hybrid-search / CRUD memories. A delete in `/memory` changes the next answer.

### SQL surface (what judges can EXPLAIN)

**Hybrid retrieve** — two candidate sets (ANN L2 top-50, FTS `ts_rank` top-50) fused with recency `exp(-age_days/14)` and `ln(1+hits)` usage, weighted 0.55 / 0.25 / 0.10 / 0.10.

**Dedupe** — `ORDER BY embedding <-> $candidate` under `user_id` + `kind`; threshold → ADD / UPDATE / SKIP, then `memory_extraction_log`.

**Analytics** — daily funnel (messages → extractions → ADD/UPDATE/SKIP), reuse buckets, score-component averages.

Demo path: Managed MCP or `ccloud` against the cluster, `EXPLAIN` the hybrid statement, then `SELECT * FROM v_memory_funnel`.

### Hackathon requirements

**CockroachDB tools (4/4 artifacts in-repo):**

| Tool | How it is used |
|---|---|
| ① Distributed vector index | `CREATE VECTOR INDEX memories_user_embedding_vec_idx (user_id, embedding)` in [`schema_v3.sql`](./schema_v3.sql). Runtime ANN is `ORDER BY embedding <-> $q` under `user_id` in [`hybrid.ts`](./recall-agent/src/lib/memory/hybrid.ts). |
| ② Managed MCP server | Official Cloud MCP: `https://cockroachlabs.cloud/mcp` in [`.mcp.json`](./.mcp.json), [`.grok/config.toml`](./.grok/config.toml), [`.cursor/mcp.json`](./.cursor/mcp.json). Header `mcp-cluster-id` (cluster `shadow-kelpie-31718`). Read-only + audit by default. Setup: [`docs/managed-mcp.md`](./docs/managed-mcp.md). Not on the chat request path. |
| ③ ccloud CLI | Cluster list / status JSON (`ccloud cluster list --output json`). Schema apply: `psql "$DATABASE_URL" -f schema_v3.sql` then `-f mcp_readonly_role.sql`. |
| ④ Agent Skills repo | **Required:** official [cockroachlabs/cockroachdb-skills](https://github.com/cockroachlabs/cockroachdb-skills) as submodule [`vendor/cockroachdb-skills/`](./vendor/cockroachdb-skills). Hybrid ANN was validated with skill `cockroachdb-sql` (`EXPLAIN` → `vector search`): [`docs/explain-hybrid-ann.md`](./docs/explain-hybrid-ann.md). Agents must load the official skills for any further CRDB work (`AGENTS.md`). Overlay: [`skills/memory-analytics/`](./skills/memory-analytics/). |

**AWS (1+ required):**

| Service | How it is used |
|---|---|
| Amazon Bedrock | Live path when `AI_PROVIDER=bedrock`. Chat: `us.anthropic.claude-haiku-4-5-20251001-v1:0`. Embed: `amazon.titan-embed-text-v2:0` (1024-d, matches `VECTOR(1024)`). Code: [`recall-agent/src/lib/ai/`](./recall-agent/src/lib/ai/). |
| Lambda / S3 | Optional later deploy. Not required for the memory demo. |

Judge walkthrough: chat two turns → Memory hits / ADD → `/memory` delete → next turn changes. Then MCP or `ccloud` + `EXPLAIN` the hybrid statement and `SELECT * FROM v_memory_funnel`.

### Known limitations

- CockroachDB vector indexes accelerate **L2 `<->`**, not cosine. Hybrid weights assume that operator. The ANN CTE binds `$1`/`$2` directly (an index hint plus `JOIN q` is rejected). Soft-delete and `kind` are applied after over-fetch.
- `v_hybrid_score_breakdown.retrieval_hits` is **one row per memory hit**, not per chat turn. Funnel and reuse views are the right grain for “how many turns / how many memories.”
- `v_memory_reuse.content_preview` is `left(content, 120)` — treat as an identifier, not text to quote.
- Official CockroachDB skills are **dev-time**. Chat does not invoke them. After clone: `git submodule update --init --recursive`.
- Managed MCP is the official Cloud HTTP server. First connect needs OAuth in Grok/Cursor. Chat still uses `DATABASE_URL` + `pg`, not MCP.
- Older on-demand Claude 3.x model IDs are often EOL on new accounts. Prefer the `us.*` inference-profile ID or Amazon Nova. Probe with `recall-agent/scripts/probe-bedrock.mjs`.

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

Open http://localhost:3000

Demo:

1. `I prefer concise answers. I work in TypeScript on AWS.`
2. `What do you know about my preferences?`
3. Memory hits (hybrid scores) and New writes (ADD / UPDATE / SKIP) on the right.
4. `/memory` — search or delete; the next turn reflects deletes.
5. Switch mid-thread: `用中文再说一遍我的偏好。` — reply language follows this turn.

### API

| Route | Purpose |
|---|---|
| `POST /api/auth` | Anonymous session cookie |
| `GET` / `POST /api/threads` | Threads |
| `POST /api/chat` | NDJSON stream: retrieve → reply → extract → store |
| `GET` / `POST` / `DELETE /api/memories` | Browser + hybrid `?q=` |

More app notes: [`recall-agent/README.md`](./recall-agent/README.md).
