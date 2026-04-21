-- =============================================================================
-- Migration 002 — arkmaniagest_machines: os_type + wsl_distro columns
-- =============================================================================
-- Required by Fase 2 of the Docker/POK integration.
--
-- Adds two columns to describe the host OS of each registered SSH machine:
--   os_type    — "linux" (default) or "windows"
--   wsl_distro — distribution name to target when os_type = "windows"
--
-- Safe to run on an existing production DB: IF NOT EXISTS guards make this
-- migration idempotent.  create_app_tables() only creates new tables, not
-- columns, so this ALTER must be applied manually on upgrades (fresh deploys
-- via full-deploy.sh get the column from the ORM model directly).
-- =============================================================================

ALTER TABLE arkmaniagest_machines
    ADD COLUMN IF NOT EXISTS os_type    VARCHAR(16) NOT NULL DEFAULT 'linux'
        AFTER ark_plugins_path,
    ADD COLUMN IF NOT EXISTS wsl_distro VARCHAR(64) NULL DEFAULT 'Ubuntu'
        AFTER os_type;
