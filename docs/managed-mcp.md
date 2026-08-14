# CockroachDB Cloud Managed MCP (tool ②)

Official hosted endpoint (no local proxy):

`https://cockroachlabs.cloud/mcp`

This is **not** `mcp-server-postgres` and **not** on the chat request path.
Grok / Cursor / VS Code / Claude connect as an AI client. Default: read-only,
audited by Cockroach Labs.

## Project config

| Client | File |
|---|---|
| Grok | `.grok/config.toml` → `[mcp_servers.cockroachdb-cloud]` |
| Cursor / generic | `.mcp.json`, `.cursor/mcp.json` |

All point at `https://cockroachlabs.cloud/mcp` with header:

```
mcp-cluster-id: shadow-kelpie-31718
```

If the Cloud Console URL is `cockroachlabs.cloud/cluster/<UUID>`, set that UUID
instead (env `COCKROACH_CLUSTER_ID`).

## Auth

OAuth in the MCP client (browser). Do **not** commit a service-account API key.

Grok: after opening this repo, complete the OAuth prompt for
`cockroachdb-cloud`. Then:

```text
list_tables / get_table_schema on memories
explain_query on the ANN statement in docs/explain-hybrid-ann.md
select_query: SELECT * FROM v_memory_funnel ORDER BY day DESC LIMIT 14
```

## What Chat still uses

`DATABASE_URL` + npm `pg` + SQL user `witold`. MCP is for agents and judges.
