-- =============================================================================
-- ArkManiaGest — Migration 001
-- Required database change for V2.0a code fixes.
-- Run ONCE against the live arkmania database before restarting the backend.
-- =============================================================================

-- [CRITICAL] Add UNIQUE constraint on ARKM_config(server_key, config_key).
--
-- Without this index, every ON DUPLICATE KEY UPDATE upsert in the backend
-- silently inserts a new row instead of updating the existing one, causing
-- unlimited duplicate rows for all plugin config keys.
--
-- BEFORE running ALTER TABLE:
-- 1. Check for existing duplicate pairs (must be zero for the ALTER to succeed):
--
--    SELECT server_key, config_key, COUNT(*) AS cnt
--    FROM ARKM_config
--    GROUP BY server_key, config_key
--    HAVING cnt > 1;
--
-- 2. If duplicates exist, keep the most recent row and delete the others:
--
--    DELETE c1 FROM ARKM_config c1
--    INNER JOIN ARKM_config c2
--      ON c1.server_key = c2.server_key
--      AND c1.config_key = c2.config_key
--      AND c1.id < c2.id;  -- keeps the row with the highest id
--
-- 3. Then run the ALTER:

ALTER TABLE ARKM_config
    ADD UNIQUE KEY IF NOT EXISTS uq_server_config (server_key, config_key);

-- Verify:
-- SHOW INDEX FROM ARKM_config WHERE Key_name = 'uq_server_config';
