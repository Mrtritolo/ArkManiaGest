-- 004: panel-owned web-shop pricing tables (gene matrix + forge species list)
-- Idempotent: safe to run on an install where create_all already made them.

CREATE TABLE IF NOT EXISTS arkmaniagest_gene_prices (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    category   VARCHAR(32) NOT NULL,
    tier       INT NOT NULL,
    price      INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX ix_gene_prices_category (category)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS arkmaniagest_forge_prices (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    blueprint      VARCHAR(512) NOT NULL,
    label          VARCHAR(128) NOT NULL DEFAULT '',
    egg_price      INT NOT NULL DEFAULT 0,
    embryo_price   INT NOT NULL DEFAULT 0,
    egg_enabled    TINYINT(1) NOT NULL DEFAULT 1,
    embryo_enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY ux_forge_prices_blueprint (blueprint)
) ENGINE=InnoDB;
