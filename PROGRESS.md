# Recall Agent — progress

Saved: 2026-08-14  
Purpose: hackathon continuation notes  
Path: `D:\AI_Models\hackson\AWS\`

---

## Status in one line

**Product loop + AWS requirement are live:** CockroachDB Cloud persistent memory, hybrid retrieve, English UI chrome, **Amazon Bedrock (Claude Haiku 4.5 + Titan Embed V2)**. Browser demo shows Memory hits / New writes. Replies follow the latest user-message language. **ccloud CLI is dropped** — not used and not claimed.

Secrets stay in local `.env.local` only (gitignored). Do not rotate; do not commit.

---

## Hackathon map

Build an agent whose durable memory is **CockroachDB**, running against **AWS**.

CockroachDB tools we use (ccloud is **out**):

| # | Tool | Status |
|---|------|--------|
| 1 | Distributed vector index | Done. `CREATE VECTOR INDEX`; hybrid ANN uses `<->`. |
| 2 | Managed MCP Server | Done. Claude Code OAuth to `https://cockroachlabs.cloud/mcp`. Listed `defaultdb` tables; read `v_memory_funnel`. See `docs/managed-mcp.md`. |
| 3 | Agent Skills Repo | Done. Official `cockroachlabs/cockroachdb-skills` submodule at `vendor/cockroachdb-skills`. `AGENTS.md` requires it. Overlay: `skills/memory-analytics/`. |

AWS (at least one service):

| Service | Status |
|---------|--------|
| Amazon Bedrock | Live (IAM user + real API + memory loop) |
| Lambda / S3 | Not deployed (optional) |

Language: UI chrome is English. Replies match the **latest user message**. Memories are stored in the language of the fact.

---

## Done

### Schema

| File | Role |
|------|------|
| `README.md` | Architecture + judge checklist |
| `schema_v3.sql` | Full DDL |
| `recall-agent/sql/schema_v3.sql` | App copy (applied on the cluster) |

### CockroachDB Cloud

- Cluster in `aws-eu-central-1`
- SQL user `witold`, database `defaultdb`
- CRDB ~v26.2.5
- Tables, GIN FTS, **VECTOR INDEX**, analytics views applied
- `feature.vector_index.enabled = true`
- Embeddings write + L2 retrieve verified

### App (`recall-agent/`)

| Piece | Status |
|-------|--------|
| Next.js 16 + TS + Tailwind | Done |
| Anonymous cookie session | Done |
| `POST /api/chat` NDJSON memory loop | Done |
| Hybrid SQL (vector + ts_rank + recency + hits) | Done |
| Extract → SQL ADD/UPDATE/SKIP | Done |
| Memory panel + `/memory` | Done |
| Per-turn reply language | Done |
| Bedrock path | Live |
| OpenCode / local hash embed | Backup only |

### Bedrock (2026-08-14)

- IAM user `recall-bedrock`, `AmazonBedrockFullAccess`, keys only in `.env.local`
- Region `us-east-1`
- Chat: `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- Embed: `amazon.titan-embed-text-v2:0` (1024-d)
- Account is a **Paid account plan** (pay-as-you-go, not a monthly Support plan). Cannot downgrade to Free.

### Managed MCP (verified)

Claude Code + official Cloud MCP listed all product tables/views and returned 5 `v_memory_funnel` rows.

### Official skills

Submodule `vendor/cockroachdb-skills`. Hybrid ANN `EXPLAIN` (`vector search`) recorded in `docs/explain-hybrid-ann.md`.

---

## Not doing

- **ccloud CLI** — removed from the story. Do not install, demo, or list it as a tool.
- Lambda / S3 unless there is leftover time
- New product features

## Still optional

- [ ] 2–3 minute demo video (write memory → second-turn hit → `/memory` delete)
- [ ] Confirm `git status` never shows `.env.local` before a push

---

## Run

```powershell
cd D:\AI_Models\hackson\AWS\recall-agent
npm run dev
```

Demo:

1. `I prefer concise answers. I work in TypeScript on AWS.`
2. `What do you know about my preferences?`
3. Memory hits / ADD on the right; then `/memory`
4. Mid-thread: `Responde en espanol: que sabes de mi?`

---

## Notes

1. Never `git add` `.env.local`.
2. Public narrative is Bedrock + CRDB (vector index, Cloud MCP, official skills).
3. Paid plan has no monthly rent; set a $1 budget alarm if useful.
4. Do not close the AWS account during the hackathon.
