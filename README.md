# Recall Agent

A persistent-memory AI assistant. **CockroachDB** is the long-term memory layer (relational + vector + full-text in one Postgres-compatible database). **AWS** is the intended runtime (Bedrock now; Lambda / S3 later).

The product surface is English-only: UI, prompts, and stored memories.

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
| **Chat / Embed models** | Bedrock (Claude + Titan 1024-d) or OpenAI-compatible chat + local hash embed fallback |
| **CockroachDB** | Serverless / PG wire; distributed **vector index** with `user_id` prefix; GIN on `content_tsv` |
| **Analytics views** | `v_memory_funnel`, `v_memory_reuse`, `v_hybrid_score_breakdown` |
| **CRDB toolchain** | ① vector index (runtime) · ② Managed MCP · ③ `ccloud` CLI · ④ Agent Skills repo |
| **AWS (planned)** | Bedrock (required) · Lambda / S3 (optional deploy) |

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

### Deploy & hackathon map

| Requirement | Where |
|---|---|
| CRDB persistent memory | `memories` + write path in `recall-agent/src/lib/memory/dedupe.ts` |
| ① Distributed vector index | `CREATE VECTOR INDEX (user_id, embedding)` + `<->` in `hybrid.ts` |
| ② Managed MCP | Ops/demo (read-only SQL + audit), not in the request path |
| ③ ccloud CLI | Cluster list / status JSON |
| ④ Agent Skills repo | Dev-time CRDB guidance |
| AWS | `AI_PROVIDER=bedrock` in `recall-agent/src/lib/ai/` |

---

## Quick start

```bash
cd recall-agent
cp .env.example .env.local
# set DATABASE_URL and either OpenAI-compatible keys or Bedrock creds

psql "$DATABASE_URL" -f sql/schema_v3.sql
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

### API

| Route | Purpose |
|---|---|
| `POST /api/auth` | Anonymous session cookie |
| `GET` / `POST /api/threads` | Threads |
| `POST /api/chat` | NDJSON stream: retrieve → reply → extract → store |
| `GET` / `POST` / `DELETE /api/memories` | Browser + hybrid `?q=` |

More app notes: [`recall-agent/README.md`](./recall-agent/README.md).
