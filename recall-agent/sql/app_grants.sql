-- Optional least-privilege app role. Do not commit the password.
-- Apply as an admin SQL user after schema_v3.sql:
--   CREATE USER IF NOT EXISTS recall_app;
--   ALTER USER recall_app WITH PASSWORD '...';
--   psql ... -f sql/app_grants.sql
-- Then point DATABASE_URL at recall_app.

GRANT USAGE ON SCHEMA public TO recall_app;

GRANT SELECT, INSERT, UPDATE ON
  users,
  auth_sessions,
  auth_tokens,
  threads,
  messages,
  memories,
  memory_links,
  memory_usage_events,
  memory_extraction_log,
  entities,
  memory_entities
TO recall_app;

GRANT SELECT ON
  v_memory_funnel,
  v_memory_reuse,
  v_hybrid_score_breakdown,
  v_duplicate_clusters,
  v_entity_clusters,
  v_l2_calibration
TO recall_app;
