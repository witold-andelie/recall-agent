# Recall — Persistent Memory Agent

Hackathon build: **English-only** AI agent with **CockroachDB** as the system of record for memory (vector + PostgreSQL full-text hybrid SQL), deployable on **AWS**.

## Stack

- Next.js (App Router) + TypeScript
- CockroachDB (`pg` wire protocol) — see `sql/schema_v3.sql`
- AI: `AI_PROVIDER=openai` (compatible gateway) or `bedrock`

## Quick start

```bash
cp .env.example .env.local
# set DATABASE_URL, OPENAI_API_KEY (or Bedrock creds)

# Apply schema once (cockroach sql / psql against your cluster)
psql "$DATABASE_URL" -f sql/schema_v3.sql
# Enable vector indexes on CRDB if needed:
# SET CLUSTER SETTING feature.vector_index.enabled = true;

npm install
npm run dev
```

Open http://localhost:3000

## Memory loop (demo script)

1. “I prefer concise answers. I work in TypeScript on AWS.”
2. New message: “What do you know about my preferences?”
3. Watch **Memory hits** (hybrid scores) and **New writes** (ADD/UPDATE/SKIP).
4. `/memory` — search / delete; next chat turn reflects deletes.
5. Mid-thread language switch: `用中文再说一遍我的偏好。`

## API

| Route | Purpose |
|-------|---------|
| `POST /api/auth` | Anonymous session cookie |
| `GET/POST /api/threads` | Threads |
| `POST /api/chat` | NDJSON stream: retrieve → reply → extract → store |
| `GET/POST/DELETE /api/memories` | Memory browser + hybrid `?q=` |

## Hackathon mapping

Repo-root artifacts (parent of this app) are the judge checklist.

| Requirement | Implementation |
|-------------|----------------|
| CRDB persistent memory | `memories` + write path in `src/lib/memory/dedupe.ts` |
| ① Vector index | `CREATE VECTOR INDEX (user_id, embedding)` in `sql/schema_v3.sql`; `<->` in `src/lib/memory/hybrid.ts` |
| Hybrid FTS | `content_tsv` + `ts_rank` fused with recency / hits in `hybrid.ts` |
| ② Managed MCP | Official `https://cockroachlabs.cloud/mcp` — see `../docs/managed-mcp.md` |
| ③ ccloud CLI | `ccloud cluster list --output json` (ops/demo) |
| ④ Agent Skills | Official `../vendor/cockroachdb-skills` (mandatory for CRDB work). Overlay: `../skills/memory-analytics/` |
| AWS Bedrock | `AI_PROVIDER=bedrock` — Claude Haiku 4.5 + Titan V2 in `src/lib/ai/` |

## Scripts

- `npm run dev` — local
- `npm run build` — production build
