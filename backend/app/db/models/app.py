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

    # --- Docker runtime ------------------------------------------------------
    container_name    = Column(String(128), nullable=False)
    image             = Column(
        String(128), nullable=False, default="acekorneya/asa_server:2_1_latest"
    )
    mem_limit_mb      = Column(Integer, nullable=False, default=16384)
    timezone          = Column(String(64), nullable=False, default="Europe/Rome")

    # --- POK / host paths ----------------------------------------------------
    pok_base_dir      = Column(String(512), nullable=False)
    instance_dir      = Column(String(512), nullable=False)

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


class ARKMMariaDBInstance(Base):
    """
    A managed MariaDB container running on one of the registered SSH
    machines — typically used as the plugin database for the ARK server
    instances co-located on that host.

    Multiple instances per host are supported (distinct ports + container
    names).  ``databases_json`` is a JSON-encoded array of ``{name, user,
    password_enc}`` objects describing the logical databases provisioned
    inside the MariaDB container; password blobs are AES-256-GCM encrypted
    and decrypted by the store layer.
    """
    __tablename__ = "ARKM_mariadb_instances"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    machine_id        = Column(
        Integer,
        ForeignKey("arkmaniagest_machines.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name              = Column(String(64), nullable=False)
    description       = Column(String(512), nullable=True)

    # --- Network + credentials ---------------------------------------------
    port              = Column(Integer, nullable=False, default=3306)
    root_password_enc = Column(Text, nullable=False)

    # --- Docker runtime ----------------------------------------------------
    container_name    = Column(String(128), nullable=False)
    image             = Column(String(128), nullable=False, default="mariadb:10.11")
    volume_path       = Column(String(512), nullable=False)
    mem_limit_mb      = Column(Integer, nullable=False, default=2048)

    # --- Logical databases/users -------------------------------------------
    # JSON array: [{"name": str, "user": str, "password_enc": str}, ...]
    databases_json    = Column(MEDIUMTEXT, nullable=False, default="[]")

    # --- Lifecycle ---------------------------------------------------------
    is_active         = Column(Boolean, nullable=False, default=True)
    # created | starting | running | stopping | stopped | error
    status            = Column(String(20), nullable=False, default="created")
    last_status_at    = Column(DateTime, nullable=True)
    last_started_at   = Column(DateTime, nullable=True)
    created_at        = Column(DateTime, server_default=func.now())
    updated_at        = Column(DateTime, server_default=func.now(), onupdate=func.now())



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
    Mapping between a panel-side application role and a Discord guild role.

    Direction controls how the sync engine reconciles disagreements:
      * ``panel_to_discord`` -- panel is authoritative; Discord is updated
        to match.
      * ``discord_to_panel`` -- Discord is authoritative; panel
        PermissionGroups is updated to match.
      * ``both``             -- bidirectional union; ``priority`` breaks
        ties (higher wins).

    Multiple mappings per ``app_role_name`` are allowed (one role can
    grant multiple Discord roles, possibly across multiple guilds).
    """
    __tablename__ = "arkmaniagest_discord_role_map"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    app_role_name       = Column(String(64), nullable=False, index=True)
    discord_guild_id    = Column(String(32), nullable=False)
    discord_role_id     = Column(String(32), nullable=False)
    # Cached human-readable Discord role name; refreshed by the sync
    # engine so the admin UI doesn't need to call Discord every page.
    discord_role_name   = Column(String(128), nullable=True)
    # 'both' | 'panel_to_discord' | 'discord_to_panel'
    direction           = Column(String(24), nullable=False, default="both")
    priority            = Column(Integer, nullable=False, default=0)
    is_active           = Column(Boolean, nullable=False, default=True)

    notes               = Column(Text, nullable=True)
    created_at          = Column(DateTime, server_default=func.now())
    updated_at          = Column(DateTime, server_default=func.now(), onupdate=func.now())
