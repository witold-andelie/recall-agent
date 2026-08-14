# CockroachDB Cloud Managed MCP (tool ②)

Official hosted endpoint (no local proxy):

`https://cockroachlabs.cloud/mcp`

Not on the chat request path. Default: read-only, audited by Cockroach Labs.

## Claude Code (this is the intended client)

Cloud Console snippet (Connect → MCP):

```json
{
  "mcpServers": {
    "cockroachdb-cloud": {
      "type": "http",
      "url": "https://cockroachlabs.cloud/mcp"
    }
  }
}
```

That file is already at repo-root [`.mcp.json`](../.mcp.json). Claude Code loads it when you open this folder.

Or add it from a terminal **in the repo root**:

```powershell
cd D:\AI_Models\hackson\AWS
claude mcp add cockroachdb-cloud https://cockroachlabs.cloud/mcp --transport http
```

Then in Claude Code:

1. `/mcp` → `cockroachdb-cloud` → Authenticate (browser OAuth)
2. Ask: list tables in `defaultdb`, then `EXPLAIN` the hybrid ANN, then `SELECT * FROM v_memory_funnel`

## Cursor (same endpoint)

[`.cursor/mcp.json`](../.cursor/mcp.json) uses the same URL. Settings → MCP → Connect → OAuth.

## Verified live (Claude Code + Cloud MCP)

Date: 2026-08-14. Client: Claude Code after OAuth to `https://cockroachlabs.cloud/mcp`.

- `list_tables` on `defaultdb`: `users`, `auth_sessions`, `threads`, `messages`, `memories`, `memory_links`, `memory_usage_events`, `memory_extraction_log`, plus views `v_memory_funnel`, `v_memory_reuse`, `v_hybrid_score_breakdown`, `v_duplicate_clusters`.
- `select_query` on `v_memory_funnel`: 5 rows (e.g. user `…ddb2` on 2026-08-14: 7 messages, 8 extractions, 8 ADD).
- First `EXPLAIN` landed on the **funnel view** (hash join of `messages` + `memory_extraction_log`). That plan correctly has **no** vector index — it is not the hybrid ANN.

To get `vector search` via MCP, ask Claude Code to `explain_query` this statement (bind a real `user_id` + query vector, or use the form in `docs/explain-hybrid-ann.md`):

```sql
SELECT id
FROM memories@memories_user_embedding_vec_idx
WHERE user_id = $1::uuid
ORDER BY embedding <-> $2::vector
LIMIT 80;
```

Do **not** add the suggested `CREATE INDEX ON messages (role) STORING (user_id, created_at)` for the demo — the table is tiny; the vector story is on `memories`.

## What Chat still uses

`DATABASE_URL` + npm `pg` + SQL user `witold`. MCP is for agents and judges.
