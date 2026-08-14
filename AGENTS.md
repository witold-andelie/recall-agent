# Agent rules — Recall Agent

## CockroachDB Agent Skills Repo is mandatory

Any change that touches CockroachDB **must** load skills from the official repo first:

- Upstream: https://github.com/cockroachlabs/cockroachdb-skills
- Vendored submodule: `vendor/cockroachdb-skills/`
- Project discovery path: `.claude/skills/cockroachdb-skills/` (junction to the submodule `skills/` tree)

Do **not** invent CockroachDB SQL, schema, cluster-settings, privilege, or EXPLAIN guidance from memory when an official skill covers it.

### Required mapping for this repo

| Work | Official skill |
|---|---|
| Schema, `VECTOR`, indexes, hybrid / dedupe SQL, `EXPLAIN` | `cockroachdb-sql` |
| Single-TX write (extract → dedupe → store) | `designing-application-transactions` |
| `feature.vector_index.enabled` and other cluster settings | `managing-cluster-settings` |
| `recall_analyst` / least privilege | `hardening-user-privileges` |

Product-only overlay (not a substitute for the official repo):

- `skills/memory-analytics/` — how to read *this* app’s `v_*` views

## Managed MCP (required for judge / ops SQL)

Use the official Cloud MCP, not a local Postgres MCP:

- URL: `https://cockroachlabs.cloud/mcp`
- Project servers: `.grok/config.toml`, `.mcp.json`, `.cursor/mcp.json`
- After OAuth: `list_tables`, `get_table_schema`, `explain_query`, `select_query` on `v_*`

## Do not

- Put `.env.local` or any secret in git
- Put Cloud API keys in committed MCP config (OAuth only)
- Run MCP or `ccloud` on the chat request path
- Replace the official skills with a homemade “CRDB expertise” skill
