---
name: memory-analytics
description: Query Recall Agent memory analytics over the read-only MCP channel — write funnel (ADD/UPDATE/SKIP), reuse buckets, hybrid score mix, duplicate/supersede clusters. Use when asked how the memory layer is performing, whether extracted memories are stored or skipped, which memories are reused, or to interpret any v_* view.
---

# Memory analytics (read-only)

All data comes through the `recall-analytics` MCP server (or Cockroach Cloud MCP) as the `recall_analyst` role. That role has `SELECT` on four views only.

## What you can and cannot see

| Allowed | Denied |
|---|---|
| `v_memory_funnel` | `memories`, `messages`, `threads` |
| `v_memory_reuse` | `memory_usage_events`, `memory_extraction_log` |
| `v_hybrid_score_breakdown` | `memory_links`, `users`, `auth_sessions` |
| `v_duplicate_clusters` | embeddings, full message text |
| `v_entity_clusters` | `entities` / `memory_entities` base tables |
| `v_l2_calibration` | raw extraction_log rows |

`v_memory_reuse.content_preview` is `left(content, 120)`. Treat it as an id for triage — do not quote or summarize user memories.

## Views and grain

| View | Grain | What it answers |
|---|---|---|
| `v_memory_funnel` | `user_id` × day | Messages → extractions → ADD / UPDATE / SKIP |
| `v_memory_reuse` | one row per **active** memory | Who gets hit; `never_used` / `low` / `medium` / `hot` |
| `v_hybrid_score_breakdown` | `user_id` × day | Average vec / text / recency / usage / hybrid scores |
| `v_duplicate_clusters` | `user_id` × `rel` | `supersedes` / `duplicates` / `derived_from` edge counts |
| `v_entity_clusters` | `user_id` × entity | person/org/place names + memory_count (SQL graph, not Neo4j) |
| `v_l2_calibration` | one row | SKIP/UPDATE/ADD L2 percentiles for Titan thresholding |

Scoping: every view has `user_id` except you must still filter. Never present one user's row as platform-wide, and never sum `user_id` rows then call it “the product hit rate” without saying so.

## Counting rules

**Funnel is the write path, not retrieval quality.**  
`messages` = user turns that day. `extractions` = candidate rows the model proposed. `add_n` / `update_n` / `skip_n` come from `memory_extraction_log`. `add_rate` = ADD / extractions. A high skip rate can mean healthy dedupe, not a broken extractor.

**Reuse is memory-grain.**  
`never_used` means `hit_count = 0` (written, never retrieved). Soft-deleted rows (`deleted_at IS NOT NULL`) are excluded from this view and from hybrid retrieve. Chat forget (`recall-agent/src/lib/memory/forget.ts`) also lists those rows so the model cannot rebuild them from thread history.

**Breakdown is hit-grain, not turn-grain.**  
`retrieval_hits` counts one row per surfaced memory. A turn that returns k memories contributes k. Do not call `sum(retrieval_hits)` “number of chats.” For “how many turns wrote memory,” use `v_memory_funnel.messages` / `.extractions`.

## Practice

1. Start from the narrowest view: funnel for writes, reuse for a single memory, breakdown for score mix, clusters for graph edges.
2. State grain and scope: “12 user messages, 7 extractions, 4 ADD (user X, last 3 days).”
3. Percentages need a denominator: “add_rate 0.57 (4 of 7 extractions).”
4. Judge demo: `SELECT * FROM v_memory_funnel ORDER BY day DESC LIMIT 14;` then `SELECT reuse_bucket, count(*) FROM v_memory_reuse GROUP BY 1;`
