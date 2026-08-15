# Recall — Persistent Memory Agent

Hackathon build: AI agent with **CockroachDB** as the system of record for memory (vector + PostgreSQL full-text hybrid SQL), on **AWS**. UI chrome is English; replies follow the latest user-message language.

## Stack

- Next.js (App Router) + TypeScript
- CockroachDB (`pg` wire protocol) — see `sql/schema_v3.sql`
- AI: `AI_PROVIDER=openai` (compatible gateway) or `bedrock`

Google sign-in: create an OAuth 2.0 Web client in Google Cloud, set authorized redirect to `{APP_URL}/api/auth/google/callback`, then put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `APP_URL` in `.env.local`.

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
3. Open work: “I am shipping Recall this week. Left: 3-minute video, GitHub About license, public demo URL.”
4. “What is left?” — **Open work** stays pinned.
5. “Everything is done, close that job.” — live `task_state` gets `valid_to`.
6. “What do you know about my preferences?” — model should call `search_memory`.
7. `/memory` — search / delete; next chat turn reflects deletes.
8. Mid-thread language switch: `Responde en espanol: que sabes de mi?`

## API

| Route | Purpose |
|-------|---------|
| `POST /api/auth` | Guest session cookie + profile |
| `POST /api/auth/register` | Claim Guest with username + password (no email) |
| `POST /api/auth/login` | Username + password |
| `GET /api/auth/google` | Start Google OAuth |
| `GET /api/auth/google/callback` | Google OAuth callback |
| `POST /api/auth/logout` | Expire session |
| `POST /api/auth/password` | Change password (password accounts) |
| `GET/POST /api/threads` | Threads |
| `POST /api/chat` | NDJSON stream: retrieve → reply → extract → store |
| `GET/POST/DELETE /api/memories` | Memory browser + hybrid `?q=` + lineage. `?history=1` includes expired versions |
| `GET /api/entities` | Tenant entity clusters (`v_entity_clusters`) |
| `GET /api/health` | DB ping, schema, instance, pool, chat gate |
| `GET /api/ops/funnel` | This tenant's `v_memory_funnel` |

## Hackathon mapping

Repo-root artifacts (parent of this app) are the judge checklist.

| Requirement | Implementation |
|-------------|----------------|
| CRDB persistent memory | `memories` + write path in `src/lib/memory/dedupe.ts` |
| ① Vector index | `CREATE VECTOR INDEX (user_id, embedding)` in `sql/schema_v3.sql`; `<->` in `src/lib/memory/hybrid.ts` |
| Hybrid FTS | `to_tsvector('simple')` + entity CTE in `hybrid.ts` |
| Managed MCP | Official `https://cockroachlabs.cloud/mcp` — see `../docs/managed-mcp.md` |
| Agent Skills | Official `../vendor/cockroachdb-skills`. Overlay: `../skills/memory-analytics/` |
| AWS Bedrock | `AI_PROVIDER=bedrock` — Claude Haiku 4.5 + Titan V2 in `src/lib/ai/` |

## Operations

- `GET /api/health` — database ping plus `instance`, schema, pg pool, and in-flight chat counts
- `npm test` — password, locale, entity, L2 calibration, tool-result formatting
- `npm run db:check` — tables, views, ANN `vector search` plan
- `npm run db:grants` — `CREATE USER recall_app` + `sql/app_grants.sql` (does not rotate `DATABASE_URL`)
- `GET /api/ops/funnel` — tenant funnel from `v_memory_funnel`
- Optional least-privilege grants: `sql/app_grants.sql`
- Optional ANN scale seed (local hash embed): `node scripts/seed-memories.mjs 200`

### Concurrent chat (dozens → hundreds)

Session is cookie + CockroachDB. Any replica can serve any user — no sticky sessions, no Redis.

| Knob | Default | Meaning |
|------|---------|---------|
| `DATABASE_POOL_MAX` | 20 | pg connections **per process**. Total ≈ instances × this. |
| `CHAT_MAX_INFLIGHT` | 32 | embed + stream + extract loops **per process**. Extra callers wait, then `503 busy`. |
| `CHAT_SLOT_WAIT_MS` | 15000 | How long a chat waits for a slot |
| `INSTANCE_ID` | hostname / pid | Shows up on `/api/health` and logs |

Three processes × pool 16 × inflight 24 ≈ 48 CRDB sessions and 72 concurrent chats. That is the intended “hundreds of people, not all sending at the exact same millisecond” shape. Bedrock still rate-limits; the gate turns a stampede into wait/503 instead of a wedged pool.

Local (Windows-friendly), after `npm run build`:

```bash
npm run start:cluster
# INSTANCES=3  →  :3000 load-balances :3001–:3003
```

Docker (repo root):

```bash
docker compose up --build
```

nginx uses `least_conn` and **disables buffering** so NDJSON streams stay live.

## Scripts

- `npm run dev` — local single process
- `npm run build` — production build (`output: "standalone"`)
- `npm run start` — one process
- `npm run start:cluster` — N processes + round-robin on :3000
