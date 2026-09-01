"""
ORM models — application tables owned by ArkManiaGest.

These tables are created automatically on first startup if they do not exist
and always live in the **panel** database (``DB_*`` connection).  They store
users, SSH machines, key-value application settings, and — starting from
Fase 1 of the Docker/POK integration — the managed ARK server instances,
the related action audit log, and the managed MariaDB instances.

Note: these ``ARKM_*`` tables are distinct from the ARK plugin tables with
similar names living in the plugin database (e.g. ``ARKM_config``,
``ARKM_players``).  The panel DB hosts only the three ``ARKM_*`` tables
defined below, which the panel itself fully owns.
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.sql import func
from app.db.session import Base


class AppUser(Base):
    """
    ArkManiaGest portal users.

    Not to be confused with ARK game players — these are admin/operator
    accounts that log into this management interface.
    """
    __tablename__ = "arkmaniagest_users"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    username      = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(256), nullable=False)
    display_name  = Column(String(100), nullable=False, default="")
    role          = Column(String(20), nullable=False, default="viewer")  # admin | operator | viewer
    active        = Column(Boolean, nullable=False, default=True)
    created_at    = Column(DateTime, server_default=func.now())
    last_login    = Column(DateTime, nullable=True)


class AppAuditLog(Base):
    """
    Security audit trail of panel-level administrative events (NIS2).

    Complements ``ARKM_instance_actions`` (which covers server-instance
    lifecycle): this table records authentication and account/configuration
    events — login success/failure, user management, SQL console usage,
    GDPR data-subject requests.  Rows are purged after
    ``DATA_RETENTION_DAYS`` by the retention job (see
    app/services/retention.py), so the trail never grows unbounded.
    """
    __tablename__ = "arkmaniagest_audit_log"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    # Who: panel username or "discord:<id>"; NULL for anonymous events
    # (e.g. failed logins with unknown usernames are logged without the
    # attempted name to avoid storing third-party identifiers).
    username   = Column(String(64), nullable=True, index=True)
    # What: dotted event key, e.g. "auth.login", "auth.login_failed",
    # "users.create", "sql.execute", "gdpr.account_delete".
    action     = Column(String(64), nullable=False, index=True)
    # Free-text context (target username, table name, …).  Never contains
    # passwords, tokens or query bodies.
    detail     = Column(String(512), nullable=True)
    # Source IP as resolved by the trusted-proxy-aware extractor.
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)


class SSHMachine(Base):
    """
    SSH machine credentials for connecting to ARK server hosts.

    SSH passwords and passphrases are stored AES-256-GCM encrypted in the
    ``*_enc`` columns and decrypted transparently by the store layer.
    """
    __tablename__ = "arkmaniagest_machines"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    name                = Column(String(128), unique=True, nullable=False)
    description         = Column(String(256), nullable=True)
    hostname            = Column(String(256), nullable=False)
    ip_address          = Column(String(45), nullable=True)
    ssh_port            = Column(Integer, nullable=False, default=22)
    ssh_user            = Column(String(64), nullable=False)
    auth_method         = Column(String(20), nullable=False, default="password")

    # Credentials stored AES-256-GCM encrypted (base64-encoded blobs)
    ssh_password_enc    = Column(Text, nullable=True)
    ssh_key_path        = Column(String(512), nullable=True)
    ssh_passphrase_enc  = Column(Text, nullable=True)

    # ARK server directory paths on the remote host
    ark_root_path       = Column(String(512), nullable=False, default="/opt/ark")
    ark_config_path     = Column(String(512), nullable=True)
    ark_plugins_path    = Column(String(512), nullable=True)

    # Host OS — selects which shell / container runtime wrapper is applied.
    #   * "linux"   → POK-manager and docker invoked directly in bash
    #   * "windows" → POK-manager invoked through WSL (``wsl.exe -d <distro>``),
    #                 because POK-manager.sh is bash-only and the ASA image
    #                 runs in a Linux container regardless of host OS.
    os_type             = Column(String(16), nullable=False, default="linux",
                                 server_default="linux")
    # WSL distribution name to target on Windows hosts.  Ignored on Linux.
    wsl_distro          = Column(String(64), nullable=True, default="Ubuntu")

    # Execution runtime used for the ARK instances hosted on this machine.
    #   * "pok"    → POK-manager + Docker.  The ASA Windows binaries run
    #                under Proton inside a Linux container, on a Linux host
    #                directly or on a Windows host through WSL.
    #   * "native" → ArkAscendedServer.exe supervised by WinSW straight on
    #                Windows.  No Docker, no WSL, no Proton.  Only valid
    #                together with ``os_type == "windows"``.
    # Legacy rows default to "pok" so existing installs keep their behaviour.
    runtime             = Column(String(16), nullable=False, default="pok",
                                 server_default="pok")

    # Root of the ARK cluster directory on this host — the parent that ARK
    # appends ``clusters/<ClusterID>/`` to when given ``-ClusterDirOverride``.
    # Required on native hosts; on POK hosts it is informational and only
    # used by the cluster-sync health probe.
    cluster_dir         = Column(String(512), nullable=True)

    # How the cluster directory is kept in step with the other machines:
    #   * "none"      → standalone host, no replication.
    #   * "syncthing" → bidirectional replication by a Syncthing daemon.
    #   * "smb"       → the directory is a UNC path served by another host,
    #                   so there is a single authoritative copy.
    # The panel never performs the replication itself; it provisions and
    # monitors it (see the cluster-sync probe in app/ssh/cluster_sync.py).
    cluster_sync_mode   = Column(String(16), nullable=False, default="none",
                                 server_default="none")

    # Status fields
    is_active           = Column(Boolean, nullable=False, default=True)
    last_connection     = Column(DateTime, nullable=True)
    last_status         = Column(String(20), nullable=False, default="unknown")
    created_at          = Column(DateTime, server_default=func.now())
    updated_at          = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AppSetting(Base):
    """
    Generic key-value settings store for ArkManiaGest.

    Used for application preferences, plugin configurations, and any other
    data that does not warrant its own table.  Values flagged as ``encrypted``
    are stored as AES-256-GCM blobs.

    ``value`` uses MEDIUMTEXT (up to 16 MB) rather than TEXT (up to 65 KB)
    because the ``containers_map`` entry can grow large on clusters with
    many containers.  This matches the live DB column type.
    """
    __tablename__ = "arkmaniagest_settings"

    key         = Column(String(128), primary_key=True)
    value       = Column(MEDIUMTEXT, nullable=False, default="")
    encrypted   = Column(Boolean, nullable=False, default=False)
    description = Column(String(256), nullable=True)
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ARKMBlueprint(Base):
    """
    A single ARK blueprint entry — creature, item, structure, weapon, …

    Replaces the legacy single-JSON-blob storage at
    ``arkmaniagest_settings.key='plugin.blueprints_db'`` with one row per
    blueprint so the operator can manage entries individually (filter,
    delete, accumulate from multiple imports).

    Identity:
      ``blueprint_hash`` is SHA-256 of the lowercased / stripped path —
      acts as the dedup key across re-imports.  Storing the hash in a
      fixed-length column keeps the UNIQUE index size predictable
      regardless of how long the original path is.
    """
    __tablename__ = "ARKM_blueprints"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    # Hash of the normalized blueprint path -- stable identity across imports.
    blueprint_hash = Column(String(64), nullable=False, unique=True, index=True)
    # Full original blueprint path, kept verbatim for display + GFI usage.
    blueprint      = Column(Text, nullable=False)
    name           = Column(String(255), nullable=False)
    category       = Column(String(100), nullable=True, index=True)
    type           = Column(String(50), nullable=True, index=True)
    gfi            = Column(Text, nullable=True)
    # Where this entry came from -- "dododex-github", "beacon:Complete",
    # "manual-import", etc.  Used by the by-source delete endpoint so the
    # operator can wipe a single import at a time.
    source         = Column(String(150), nullable=True, index=True)
    class_name     = Column(String(255), nullable=True)
    description    = Column(Text, nullable=True)
    # The original `id` field upstream provided (Dododex slug, Beacon
    # creatureId, …).  Kept as metadata; not used as the primary key.
    ext_id         = Column(String(150), nullable=True)
    created_at     = Column(DateTime, server_default=func.now())
    updated_at     = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ARKMServerInstance(Base):
    """
    A managed ARK: Survival Ascended container instance running on one of
    the registered SSH machines.

    Each row represents a single Docker container created via POK-manager on
    the remote host.  ``instance_dir`` is the absolute path on the host where
    POK-manager stores the Instance_<name>/ folder; ``pok_base_dir`` is the
    parent directory that hosts POK-manager itself plus the shared
    ``ServerFiles`` and ``Cluster`` volumes.

    Credentials (admin/server passwords) are AES-256-GCM encrypted in the
    ``*_enc`` columns and decrypted transparently by the store layer.
    """
    __tablename__ = "ARKM_server_instances"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    machine_id        = Column(
        Integer,
        ForeignKey("arkmaniagest_machines.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name              = Column(String(64), nullable=False)
    display_name      = Column(String(128), nullable=False, default="")
    description       = Column(String(512), nullable=True)

    # --- Gameplay parameters -------------------------------------------------
    map_name          = Column(String(64), nullable=False, default="TheIsland_WP")
    session_name      = Column(String(128), nullable=False, default="")
    max_players       = Column(Integer, nullable=False, default=70)
    cluster_id        = Column(String(64), nullable=True)
    mods              = Column(Text, nullable=True)           # comma-separated
    passive_mods      = Column(Text, nullable=True)
    custom_args       = Column(Text, nullable=True)

    # --- Credentials (encrypted) --------------------------------------------
    admin_password_enc  = Column(Text, nullable=False)
    server_password_enc = Column(Text, nullable=True)

    # --- Network -------------------------------------------------------------
    game_port         = Column(Integer, nullable=False, default=7777)
    rcon_port         = Column(Integer, nullable=False, default=27020)

    # --- Docker runtime (machine.runtime == "pok" only) ----------------------
    # NULL on native-Windows instances, which have no container at all.
    container_name    = Column(String(128), nullable=True)
    image             = Column(
        String(128), nullable=True, default="acekorneya/asa_server:2_1_latest"
    )
    # Enforced by the Docker cgroup on POK hosts.  Windows has no cgroup
    # equivalent, so on native instances this is an advisory threshold used
    # by the panel's memory watchdog, not a hard cap.
    mem_limit_mb      = Column(Integer, nullable=False, default=16384)
    timezone          = Column(String(64), nullable=False, default="Europe/Rome")

    # --- POK / host paths ----------------------------------------------------
    # ``pok_base_dir`` is NULL on native instances; ``instance_dir`` is used
    # by both runtimes (POK: Instance_<name>/ ; native: the per-instance tree
    # holding Saved/, Config/, the WinSW service definition and the junctions
    # back into the shared install).
    pok_base_dir      = Column(String(512), nullable=True)
    instance_dir      = Column(String(512), nullable=False)

    # --- Native Windows runtime (machine.runtime == "native" only) ----------
    # Shared ASA installation this instance junctions into.  One SteamCMD
    # tree per host serves every instance: only ShooterGame/Binaries is
    # copied per instance (AsaApi writes its logs and loads its plugins from
    # there), while Content/ and Engine/ — the bulk of the ~20 GB — are
    # directory junctions.
    install_dir       = Column(String(512), nullable=True)
    # Name of the WinSW-registered Windows service supervising this instance.
    service_name      = Column(String(128), nullable=True)

    # --- Feature flags -------------------------------------------------------
    mod_api           = Column(Boolean, nullable=False, default=False)
    battleye          = Column(Boolean, nullable=False, default=False)
    update_server     = Column(Boolean, nullable=False, default=True)
    update_coordination_role     = Column(String(16), nullable=False, default="FOLLOWER")
    update_coordination_priority = Column(Integer, nullable=False, default=1)
    cpu_optimization  = Column(Boolean, nullable=False, default=False)

    # --- Lifecycle ----------------------------------------------------------
    is_active         = Column(Boolean, nullable=False, default=True)
    # created | starting | running | stopping | stopped | updating | error
    status            = Column(String(20), nullable=False, default="created")
    last_status_at    = Column(DateTime, nullable=True)
    last_started_at   = Column(DateTime, nullable=True)
    last_stopped_at   = Column(DateTime, nullable=True)
    created_at        = Column(DateTime, server_default=func.now())
    updated_at        = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ARKMInstanceAction(Base):
    """
    Audit log of lifecycle actions executed on ARK server instances and
    their host machines.

    Every entry is kept even after the related instance is deleted (hence
    ``ondelete="SET NULL"``), so the history of a retired instance remains
    queryable through ``machine_id`` + ``instance_name``.
    """
    __tablename__ = "ARKM_instance_actions"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    instance_id       = Column(
        Integer,
        ForeignKey("ARKM_server_instances.id", ondelete="SET NULL"),
        nullable=True,
    )
    machine_id        = Column(
        Integer,
        ForeignKey("arkmaniagest_machines.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Kept after delete so the audit trail is readable without joins.
    instance_name     = Column(String(64), nullable=True)

    # bootstrap | create | start | stop | restart | update | backup | delete
    # | rcon | pok_sync | prereqs_check
    action            = Column(String(32), nullable=False)
    # pending | running | success | failed
    status            = Column(String(16), nullable=False, default="pending")

    stdout            = Column(MEDIUMTEXT, nullable=True)
    stderr            = Column(MEDIUMTEXT, nullable=True)
    exit_code         = Column(Integer, nullable=True)
    # Optional JSON blob with action-specific parameters (rcon command,
    # backup path, mod ids, etc.).  Kept as text to avoid a hard JSON dep
    # on older MariaDB versions; callers serialise / parse as needed.
    meta              = Column(MEDIUMTEXT, nullable=True)

    user_id           = Column(
        Integer,
        ForeignKey("arkmaniagest_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    username          = Column(String(50), nullable=True)

    started_at        = Column(DateTime, server_default=func.now())
    completed_at      = Column(DateTime, nullable=True)
    duration_ms       = Column(Integer, nullable=True)


# =============================================
#  Discord integration (panel DB)
# =============================================
#
# See docs/DISCORD_INTEGRATION.md for the rollout plan.  These two
# tables are the persistence layer for Phases 1-7:
#
#   * arkmaniagest_discord_accounts  — 1:1 link between a Discord
#     identity and an ARK player (matched on EOS_Id).  Holds the
#     OAuth2 access + refresh token for the Discord API, encrypted
#     with the same AES-256-GCM helper used for SSH credentials.
#
#   * arkmaniagest_discord_role_map  — admin-defined mapping from an
#     application permission group (panel-side) to a Discord role
#     (guild + role IDs).  The sync engine (Phase 5) walks every
#     linked account and reconciles role membership both ways.

class DiscordAccount(Base):
    """
    Persistent link between a Discord user and an ARK player record.

    The link is 1:1 in BOTH directions: a Discord user can be linked
    to at most one player and vice-versa (enforced via UNIQUE indexes
    on ``discord_user_id`` and ``eos_id``).

    OAuth tokens are stored AES-256-GCM-encrypted in the ``*_enc``
    columns -- the store layer decrypts on read, never on the wire.
    """
    __tablename__ = "arkmaniagest_discord_accounts"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    # Discord identity (snowflake -- 17-19 digit base-10 string).
    discord_user_id     = Column(String(32), nullable=False, unique=True, index=True)
    discord_username    = Column(String(64), nullable=True)
    discord_global_name = Column(String(128), nullable=True)
    discord_avatar      = Column(String(64), nullable=True)
    # Linked player (matched on Players.EOS_Id from the plugin DB).
    # Stored as a string here rather than a real FK because Players
    # lives in the plugin DB, which is a separate connection.
    eos_id              = Column(String(64), nullable=True, unique=True, index=True)
    # Linked panel AppUser (e.g. operator, admin).  When set, the
    # OAuth callback issues a panel JWT for THIS user so a single
    # Discord login powers both the player dashboard (via eos_id)
    # AND the admin panel (via app_user_id).  Independent of eos_id:
    # an admin can be linked to a Discord identity that is NOT also
    # linked to a player record, and vice versa.
    app_user_id         = Column(
        Integer,
        ForeignKey("arkmaniagest_users.id", ondelete="SET NULL"),
        nullable=True, unique=True, index=True,
    )

    # OAuth tokens (AES-256-GCM via app.core.encryption).  refresh_token
    # is rotated by Discord on every refresh; access_token has a short
    # life (~10 min) so the panel always refreshes lazily before use.
    access_token_enc    = Column(Text, nullable=True)
    refresh_token_enc   = Column(Text, nullable=True)
    token_expires_at    = Column(DateTime, nullable=True)
    # Space-separated OAuth scopes the token was issued with (e.g.
    # "identify guilds.members.read").
    scope               = Column(String(256), nullable=True)

    # Audit
    linked_at           = Column(DateTime, nullable=True)
    linked_by_user_id   = Column(
        Integer,
        ForeignKey("arkmaniagest_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_sync_at        = Column(DateTime, nullable=True)

    created_at          = Column(DateTime, server_default=func.now())
    updated_at          = Column(DateTime, server_default=func.now(), onupdate=func.now())


class DiscordRoleMap(Base):
    """
    Discord role -> ARK permission group mapping (Phase 7+).

    Each row says: 'every linked player who owns Discord role X gets
    the ARK permission group Y written into Players.PermissionGroups'.
    The sync engine walks every row, fetches the corresponding guild
    members, computes the diff vs the plugin DB, and applies it.

    The original Phase-1 model carried `app_role_name` (panel role)
    instead of `ark_group_name` (in-game group); both are kept in the
    schema -- `app_role_name` stays nullable for back-compat in case a
    future Phase reintroduces the panel-side mapping it was originally
    designed for.  New rows only need to populate `ark_group_name` and
    `discord_role_id`.

    `direction` is kept for future bidirectional flows; for now the
    sync engine only honours `discord_to_panel` (or `both`, treated as
    discord_to_panel since panel is downstream).  Multiple rows per
    ARK group are allowed (e.g. several Discord roles all granting the
    same in-game perk).
    """
    __tablename__ = "arkmaniagest_discord_role_map"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    # Phase 1 column -- kept nullable for back-compat.  Sync engine
    # ignores it; new rows can leave this null.
    app_role_name       = Column(String(64), nullable=True, index=True)
    discord_guild_id    = Column(String(32), nullable=False)
    discord_role_id     = Column(String(32), nullable=False)
    # Cached human-readable Discord role name; refreshed by the sync
    # engine so the admin UI doesn't need to call Discord every page.
    discord_role_name   = Column(String(128), nullable=True)
    # Phase 7+ -- the ARK permission-group string this Discord role
    # maps to.  When set, the sync engine grants this group to every
    # linked player who has discord_role_id on Discord.
    ark_group_name      = Column(String(64), nullable=True, index=True)
    # 'both' | 'panel_to_discord' | 'discord_to_panel'
    direction           = Column(String(24), nullable=False, default="discord_to_panel")
    priority            = Column(Integer, nullable=False, default=0)
    is_active           = Column(Boolean, nullable=False, default=True)

    notes               = Column(Text, nullable=True)
    created_at          = Column(DateTime, server_default=func.now())
    updated_at          = Column(DateTime, server_default=func.now(), onupdate=func.now())


class WebShopGenePrice(Base):
    """
    Admin-set gene price matrix (category x tier) for the web shop.

    ARKM_gene_traits is rewritten by the plugin at every boot with a
    uniform price, so admin pricing cannot live there: this panel-owned
    matrix overrides it at catalog/buy time. A missing cell falls back
    to the plugin-published trait cost.
    """
    __tablename__ = "arkmaniagest_gene_prices"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    category   = Column(String(32), nullable=False, index=True)
    tier       = Column(Integer, nullable=False)   # 1..3
    price      = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class WebShopForgePrice(Base):
    """
    Admin-set per-species price list for the fertilized-egg / embryo
    shops. Only species listed here (and enabled per shop) can be
    bought; the egg hatches at the configured fixed level with wild-like
    randomly rolled stats, so the price is per species, not per stat.
    """
    __tablename__ = "arkmaniagest_forge_prices"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    blueprint      = Column(String(512), nullable=False, unique=True)
    label          = Column(String(128), nullable=False, default="")
    egg_price      = Column(Integer, nullable=False, default=0)
    embryo_price   = Column(Integer, nullable=False, default=0)
    egg_enabled    = Column(Boolean, nullable=False, default=True)
    embryo_enabled = Column(Boolean, nullable=False, default=True)

    created_at     = Column(DateTime, server_default=func.now())
    updated_at     = Column(DateTime, server_default=func.now(), onupdate=func.now())
