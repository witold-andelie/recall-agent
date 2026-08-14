-- =============================================================================
-- MCP read-only role (hackathon tool ②)
--
-- Managed MCP / local Postgres MCP connect as recall_analyst.
-- Authorization boundary = view boundary:
--   · SELECT on v_* analytics views only
--   · no base tables, so no memories.content full text, embeddings, or messages
--   · v_memory_reuse exposes left(content, 120) preview only
--
-- Apply after schema_v3.sql:
--   psql "$DATABASE_URL" -f mcp_readonly_role.sql
-- Set the password out of band (Cloud console or):
--   ALTER USER recall_analyst WITH PASSWORD '...';
-- Do not commit that password.
-- =============================================================================

CREATE USER IF NOT EXISTS recall_analyst;

GRANT USAGE ON SCHEMA public TO recall_analyst;

GRANT SELECT ON v_memory_funnel TO recall_analyst;
GRANT SELECT ON v_memory_reuse TO recall_analyst;
GRANT SELECT ON v_hybrid_score_breakdown TO recall_analyst;
GRANT SELECT ON v_duplicate_clusters TO recall_analyst;

-- Intentional deny (default: no privilege). Do not GRANT these:
--   memories / messages / threads / memory_usage_events / memory_extraction_log
--   memory_links / users / auth_sessions

SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'recall_analyst'
ORDER BY table_name;
