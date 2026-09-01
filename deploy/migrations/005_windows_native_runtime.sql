-- 005: native-Windows runtime support.
--
-- Adds the per-machine runtime selector (POK/Docker vs native Windows), the
-- cluster-directory bookkeeping used by the cluster-sync probe, and the
-- per-instance native columns.  Also relaxes the Docker-only instance
-- columns to NULL, because a native instance has no container.
--
-- Idempotent: every statement is guarded, so re-running on an already
-- migrated install is a no-op.  MariaDB has no "ADD COLUMN IF NOT EXISTS"
-- in every supported version, hence the information_schema guards.

-- ── arkmaniagest_machines ────────────────────────────────────────────────

SET @ddl = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'arkmaniagest_machines'
        AND COLUMN_NAME  = 'runtime') = 0,
    'ALTER TABLE arkmaniagest_machines
       ADD COLUMN runtime VARCHAR(16) NOT NULL DEFAULT ''pok'' AFTER wsl_distro',
    'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'arkmaniagest_machines'
        AND COLUMN_NAME  = 'cluster_dir') = 0,
    'ALTER TABLE arkmaniagest_machines
       ADD COLUMN cluster_dir VARCHAR(512) NULL AFTER runtime',
    'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'arkmaniagest_machines'
        AND COLUMN_NAME  = 'cluster_sync_mode') = 0,
    'ALTER TABLE arkmaniagest_machines
       ADD COLUMN cluster_sync_mode VARCHAR(16) NOT NULL DEFAULT ''none''
       AFTER cluster_dir',
    'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── ARKM_server_instances ────────────────────────────────────────────────

SET @ddl = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'ARKM_server_instances'
        AND COLUMN_NAME  = 'install_dir') = 0,
    'ALTER TABLE ARKM_server_instances
       ADD COLUMN install_dir VARCHAR(512) NULL AFTER instance_dir',
    'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'ARKM_server_instances'
        AND COLUMN_NAME  = 'service_name') = 0,
    'ALTER TABLE ARKM_server_instances
       ADD COLUMN service_name VARCHAR(128) NULL AFTER install_dir',
    'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Docker-only columns become nullable: a native instance has no container,
-- no image and no POK base directory.  Guarded on IS_NULLABLE so a re-run
-- does not rewrite the table.

SET @ddl = IF(
    (SELECT IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'ARKM_server_instances'
        AND COLUMN_NAME  = 'container_name') = 'NO',
    'ALTER TABLE ARKM_server_instances
       MODIFY COLUMN container_name VARCHAR(128) NULL',
    'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl = IF(
    (SELECT IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'ARKM_server_instances'
        AND COLUMN_NAME  = 'image') = 'NO',
    'ALTER TABLE ARKM_server_instances
       MODIFY COLUMN image VARCHAR(128) NULL',
    'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl = IF(
    (SELECT IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'ARKM_server_instances'
        AND COLUMN_NAME  = 'pok_base_dir') = 'NO',
    'ALTER TABLE ARKM_server_instances
       MODIFY COLUMN pok_base_dir VARCHAR(512) NULL',
    'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
