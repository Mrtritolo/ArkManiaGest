-- 006: index ARKM_instance_actions.started_at.
--
-- The daily retention purge (DELETE ... WHERE started_at < ...) and the
-- action history list (ORDER BY started_at DESC) both filter or sort on
-- this column.  Without an index the purge scans, and locks, every row
-- while the executor is inserting and finalising actions.
--
-- The panel also adds the index on boot (create_app_tables), so this file
-- is only needed when schema changes are applied by hand.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS (MariaDB 10.1.4+).

CREATE INDEX IF NOT EXISTS ix_ARKM_instance_actions_started_at
    ON ARKM_instance_actions (started_at);
