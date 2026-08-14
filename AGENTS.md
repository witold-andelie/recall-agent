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

## Do not

- Put `.env.local` or any secret in git
- Run MCP or `ccloud` on the chat request path
- Replace the official skills with a homemade “CRDB expertise” skill
