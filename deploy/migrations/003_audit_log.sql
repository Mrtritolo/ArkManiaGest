-- =============================================================================
-- Migration 003 — arkmaniagest_audit_log: security audit trail (NIS2)
-- =============================================================================
-- Records panel-level security events: login success/failure, user
-- management, SQL console usage, GDPR data-subject requests.  Written by
-- app/core/audit.py; purged after DATA_RETENTION_DAYS by the retention job.
--
-- Safe to run on an existing production DB: CREATE TABLE IF NOT EXISTS makes
-- this migration idempotent.  Fresh deploys get the table from the ORM model
-- via create_app_tables() on first boot.
-- =============================================================================

CREATE TABLE IF NOT EXISTS arkmaniagest_audit_log (
    id          INT          PRIMARY KEY AUTO_INCREMENT,
    username    VARCHAR(64)  NULL,
    action      VARCHAR(64)  NOT NULL,
    detail      VARCHAR(512) NULL,
    ip_address  VARCHAR(45)  NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_audit_username   (username),
    INDEX ix_audit_action     (action),
    INDEX ix_audit_created_at (created_at)
) ENGINE=InnoDB;
