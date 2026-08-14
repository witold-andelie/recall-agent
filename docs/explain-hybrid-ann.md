# Hybrid ANN — EXPLAIN (cockroachdb-sql)

Skill: `vendor/cockroachdb-skills/skills/cockroachdb-query-and-schema-design/cockroachdb-sql`

Rules applied:
- `00-fundamental-principles.md` — UUID tenant key, no sequential hotspot
- `04-optimization.md` — index hint `table@index`; EXPLAIN required
- Query shape is prefix-only (`user_id` + `<->`) so CRDB plans **vector search**
- Bind `$1` / `$2` in the ANN CTE. Hint + `JOIN q` / `q.q_emb` inside the full hybrid statement is rejected: `index "memories_user_embedding_vec_idx" cannot be used for this query`

Connection: CockroachDB Cloud via `pg` wire (`DATABASE_URL`). `cockroach` CLI is not installed on this machine.

Captured: 2026-08-14T15:25:53.703Z
Sample `user_id`: `cd890f8d-c7bb-48a8-9dcb-74440d18ddb2`
Vector search in plan: **yes**

## Statement

```sql
SELECT m.id
FROM memories@memories_user_embedding_vec_idx AS m
WHERE m.user_id = $1::uuid
ORDER BY m.embedding <-> $2::vector
LIMIT 80
```

## EXPLAIN

```
distribution: local

• top-k
│ estimated row count: 4
│ order: +column20
│ k: 80
│
└── • render
    │
    └── • lookup join
        │ table: memories@memories_pkey
        │ equality: (id) = (id)
        │ equality cols are key
        │
        └── • vector search
              table: memories@memories_user_embedding_vec_idx
              target count: 80
              prefix spans: [/'cd890f8d-c7bb-48a8-9dcb-74440d18ddb2' - /'cd890f8d-c7bb-48a8-9dcb-74440d18ddb2']
```
