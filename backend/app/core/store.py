"""
Data-access layer — wrappers around the application database.

Replaces the old local vault (encrypted JSON file) with direct DB access.
Exposes a consistent interface to minimise changes in the route handlers.

Sensitive fields (SSH passwords, passphrases) are stored AES-256-GCM
encrypted in the database and decrypted transparently here.

Two flavours of every function are provided:
  *_sync  — synchronous (PyMySQL); used by SSH code that cannot be async.
  *_async — async (SQLAlchemy); used by FastAPI route handlers.
"""
import json
import logging
import pymysql.cursors
from contextlib import contextmanager
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import server_settings
from app.core.encryption import encrypt_value, decrypt_value

log = logging.getLogger("arkmaniagest")

# Columns that update_user() is allowed to write — defined once at module level
# to avoid recreating the frozenset on every call.
_USER_ALLOWED_COLUMNS: frozenset[str] = frozenset(
    ("username", "password_hash", "display_name", "role", "active", "last_login")
)


# =============================================
#  Internal helpers
# =============================================

@contextmanager
def _sync_db_connection():
    """
    Context manager that yields a synchronous PyMySQL connection to the
    **panel** database.

    The connection is always closed in the finally block, regardless of errors.

    Yields:
        A ``pymysql.connections.Connection`` object.
    """
    s = server_settings
    conn = pymysql.connect(
        host=s.DB_HOST,
        port=s.DB_PORT,
        user=s.DB_USER,
        password=s.DB_PASSWORD,
        database=s.DB_NAME,
        charset="utf8mb4",
    )
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def _sync_plugin_db_connection():
    """
    Context manager that yields a synchronous PyMySQL connection to the
    **plugin** database.

    Falls back to the panel DSN when ``PLUGIN_DB_*`` is empty in .env, so
    legacy single-database installations keep working.

    Yields:
        A ``pymysql.connections.Connection`` object.
    """
    s = server_settings
    conn = pymysql.connect(
        host=s.plugin_db_host,
        port=s.plugin_db_port,
        user=s.plugin_db_user,
        password=s.plugin_db_password,
        database=s.plugin_db_name,
        charset="utf8mb4",
    )
    try:
        yield conn
    finally:
        conn.close()


def _row_to_machine_dict(row: dict) -> dict:
    """
    Convert a raw database row for a machine into a normalised dict.

    Actions performed:
      - Decrypt ``ssh_password_enc`` → ``ssh_password``
      - Decrypt ``ssh_passphrase_enc`` → ``ssh_passphrase``
      - Remove the ``*_enc`` columns from the result
      - Convert ``datetime`` values to ISO-8601 strings
      - Convert integer booleans (0/1) to Python booleans

    Args:
        row: Raw dict as returned by the database driver.

    Returns:
        Processed machine dict safe to return from the API.
    """
    m = dict(row)

    # Decrypt SSH credentials (silently fall back to None on errors)
    for enc_field, plain_field in [
        ("ssh_password_enc", "ssh_password"),
        ("ssh_passphrase_enc", "ssh_passphrase"),
    ]:
        if m.get(enc_field):
            try:
                m[plain_field] = decrypt_value(m[enc_field])
            except Exception:
                m[plain_field] = None
        else:
            m[plain_field] = None
        m.pop(enc_field, None)

    # Normalise datetime objects to ISO-8601 strings for JSON serialisation
    for field in ("created_at", "updated_at", "last_connection"):
        if m.get(field) and hasattr(m[field], "isoformat"):
            m[field] = m[field].isoformat()

    # Normalise integer booleans
    for field in ("is_active", "active"):
        if field in m:
            m[field] = bool(m[field])

    return m


# =============================================
#  Machines — synchronous
# =============================================

def get_machine_sync(machine_id: int) -> Optional[dict]:
    """
    Fetch a single SSH machine record (sync).

    Used by SSH code that runs outside of an async context.

    Args:
        machine_id: Primary key of the machine.

    Returns:
        Decrypted machine dict, or None if not found.
    """
    with _sync_db_connection() as conn:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute(
            "SELECT * FROM arkmaniagest_machines WHERE id = %s",
            (machine_id,),
        )
        row = cursor.fetchone()
        return _row_to_machine_dict(row) if row else None


def get_all_machines_sync() -> List[dict]:
    """
    Fetch all SSH machine records ordered by name (sync).

    Returns:
        List of decrypted machine dicts.
    """
    with _sync_db_connection() as conn:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute(
            "SELECT * FROM arkmaniagest_machines ORDER BY name"
        )
        return [_row_to_machine_dict(r) for r in cursor.fetchall()]


# =============================================
#  Settings — synchronous
# =============================================

def get_setting_sync(key: str) -> Optional[str]:
    """
    Read a single application setting by key (sync).

    Encrypted values are transparently decrypted before being returned.

    Args:
        key: The setting key (e.g. ``"sf_token"``).

    Returns:
        Setting value as a string, or None if the key does not exist.
    """
    with _sync_db_connection() as conn:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute(
            "SELECT `value`, `encrypted` FROM arkmaniagest_settings WHERE `key` = %s",
            (key,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return decrypt_value(row["value"]) if row["encrypted"] else row["value"]


def set_setting_sync(
    key: str,
    value: str,
    encrypted: bool = False,
    description: str = None,
) -> None:
    """
    Write (upsert) an application setting (sync).

    Args:
        key:         Setting key.
        value:       String value to store.
        encrypted:   If True the value is AES-256-GCM encrypted before storage.
        description: Optional human-readable description stored alongside.
    """
    store_value = encrypt_value(value) if encrypted else value
    with _sync_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO arkmaniagest_settings (`key`, `value`, `encrypted`, `description`) "
            "VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), `encrypted`=VALUES(`encrypted`)",
            (key, store_value, encrypted, description),
        )
        conn.commit()


# =============================================
#  Plugin config — synchronous
# =============================================

def get_plugin_config_sync(plugin_name: str) -> Optional[dict]:
    """
    Retrieve a plugin's JSON configuration from the settings table (sync).

    Args:
        plugin_name: Plugin identifier (used as key prefix ``plugin.<n>``).

    Returns:
        Parsed config dict, or None if not found or JSON is malformed.
    """
    raw = get_setting_sync(f"plugin.{plugin_name}")
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return None


def save_plugin_config_sync(plugin_name: str, config: dict) -> None:
    """
    Persist a plugin's JSON configuration in the settings table (sync).

    Args:
        plugin_name: Plugin identifier.
        config:      Config dict to serialise and store.
    """
    set_setting_sync(
        f"plugin.{plugin_name}",
        json.dumps(config, ensure_ascii=False),
        encrypted=False,
        description=f"Config plugin: {plugin_name}",
    )


def get_containers_map_sync() -> dict:
    """
    Read the persisted ``containers_map`` plugin config with the
    excluded-container filter applied at read time.

    Centralised here because numerous routes (players, servers, public,
    containers) iterate over the map; doing the filtering once at load
    means a stale entry like ``BobsMissions`` doesn't leak into any
    consumer just because nobody triggered a re-scan.

    Returns:
        Dict with ``machines`` (keyed by machine_id string) and
        ``last_scan``.  Returns an empty structure when the blob does
        not exist.
    """
    # Late import: app.ssh.scanner pulls in SSHManager which has its
    # own dependency tree, and store.py is imported very early in
    # bootstrap.  Importing here keeps the module-load order safe.
    from app.ssh.scanner import _is_excluded_container

    raw = get_plugin_config_sync("containers_map") or {"machines": {}, "last_scan": None}
    machines = raw.get("machines") or {}
    for mdata in machines.values():
        containers = mdata.get("containers") or []
        mdata["containers"] = [
            c for c in containers
            if not _is_excluded_container(c.get("name", ""))
        ]
    return raw


# =============================================
#  Machines — async
# =============================================

async def get_machine_async(db: AsyncSession, machine_id: int) -> Optional[dict]:
    """
    Fetch a single SSH machine record (async).

    Args:
        db:         SQLAlchemy async session.
        machine_id: Primary key of the machine.

    Returns:
        Decrypted machine dict, or None if not found.
    """
    result = await db.execute(
        text("SELECT * FROM arkmaniagest_machines WHERE id = :mid"),
        {"mid": machine_id},
    )
    row = result.mappings().fetchone()
    return _row_to_machine_dict(dict(row)) if row else None


async def get_all_machines_async(
    db: AsyncSession,
    active_only: bool = False,
) -> List[dict]:
    """
    Fetch all SSH machine records (async).

    Args:
        db:          SQLAlchemy async session.
        active_only: When True, only return machines where ``is_active = 1``.

    Returns:
        List of decrypted machine dicts ordered by name.
    """
    q = "SELECT * FROM arkmaniagest_machines"
    if active_only:
        q += " WHERE is_active = 1"
    q += " ORDER BY name"
    result = await db.execute(text(q))
    return [_row_to_machine_dict(dict(r)) for r in result.mappings().fetchall()]


# =============================================
#  Settings — async
# =============================================

async def get_setting_async(db: AsyncSession, key: str) -> Optional[str]:
    """
    Read a single application setting (async).

    Args:
        db:  SQLAlchemy async session.
        key: Setting key.

    Returns:
        Setting value string (decrypted if necessary), or None.
    """
    result = await db.execute(
        text(
            "SELECT `value`, `encrypted` FROM arkmaniagest_settings "
            "WHERE `key` = :k"
        ),
        {"k": key},
    )
    row = result.fetchone()
    if not row:
        return None
    value, is_encrypted = row
    return decrypt_value(value) if is_encrypted else value


async def set_setting_async(
    db: AsyncSession,
    key: str,
    value: str,
    encrypted: bool = False,
    description: str = None,
) -> None:
    """
    Write (upsert) an application setting (async).

    The calling route's ``get_db`` dependency will commit the transaction.

    Args:
        db:          SQLAlchemy async session.
        key:         Setting key.
        value:       String value to store.
        encrypted:   If True the value is AES-256-GCM encrypted before storage.
        description: Optional human-readable description.
    """
    store_value = encrypt_value(value) if encrypted else value
    await db.execute(
        text(
            "INSERT INTO arkmaniagest_settings (`key`, `value`, `encrypted`, `description`) "
            "VALUES (:k, :v, :e, :d) "
            "ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), `encrypted`=VALUES(`encrypted`)"
        ),
        {"k": key, "v": store_value, "e": encrypted, "d": description},
    )


# =============================================
#  Plugin config — async
# =============================================

async def get_plugin_config_async(
    db: AsyncSession,
    plugin_name: str,
) -> Optional[dict]:
    """Retrieve a plugin's JSON configuration (async)."""
    raw = await get_setting_async(db, f"plugin.{plugin_name}")
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return None


async def save_plugin_config_async(
    db: AsyncSession,
    plugin_name: str,
    config: dict,
) -> None:
    """Persist a plugin's JSON configuration (async)."""
    await set_setting_async(
        db,
        f"plugin.{plugin_name}",
        json.dumps(config, ensure_ascii=False),
        encrypted=False,
        description=f"Config plugin: {plugin_name}",
    )


# =============================================
#  Users — async
# =============================================

async def get_user_by_username(
    db: AsyncSession,
    username: str,
) -> Optional[dict]:
    """
    Find a user by username (async).

    The returned dict includes the ``password_hash`` field.

    Args:
        db:       SQLAlchemy async session.
        username: Case-sensitive login name.

    Returns:
        User dict, or None if not found.
    """
    result = await db.execute(
        text("SELECT * FROM arkmaniagest_users WHERE username = :u"),
        {"u": username},
    )
    row = result.mappings().fetchone()
    return dict(row) if row else None


async def get_user_by_id(db: AsyncSession, user_id: int) -> Optional[dict]:
    """Find a user by primary key (async)."""
    result = await db.execute(
        text("SELECT * FROM arkmaniagest_users WHERE id = :uid"),
        {"uid": user_id},
    )
    row = result.mappings().fetchone()
    return dict(row) if row else None


async def get_all_users(db: AsyncSession) -> List[dict]:
    """
    Return all user records ordered by id (async).

    The ``password_hash`` field is excluded from the query result for safety.
    """
    result = await db.execute(
        text(
            "SELECT id, username, display_name, role, active, created_at, last_login "
            "FROM arkmaniagest_users ORDER BY id"
        )
    )
    return [dict(r) for r in result.mappings().fetchall()]


async def create_user(db: AsyncSession, user_data: dict) -> dict:
    """
    Insert a new user record and return the newly created user (async).

    Args:
        db:        SQLAlchemy async session.
        user_data: Dict with keys: username, password_hash, display_name,
                   role, active, created_at.

    Returns:
        The freshly created user dict (fetched from the DB).
    """
    await db.execute(
        text(
            "INSERT INTO arkmaniagest_users "
            "(username, password_hash, display_name, role, active, created_at) "
            "VALUES (:u, :ph, :dn, :r, :a, :ca)"
        ),
        {
            "u":  user_data["username"],
            "ph": user_data["password_hash"],
            "dn": user_data.get("display_name", user_data["username"]),
            "r":  user_data.get("role", "viewer"),
            "a":  1 if user_data.get("active", True) else 0,
            "ca": user_data.get("created_at", datetime.now(timezone.utc)),
        },
    )
    return await get_user_by_username(db, user_data["username"])


async def update_user(
    db: AsyncSession,
    user_id: int,
    updates: dict,
) -> Optional[dict]:
    """
    Apply partial updates to a user record (async).

    Only columns present in :data:`_USER_ALLOWED_COLUMNS` are updated;
    any other keys in *updates* are silently ignored to prevent column
    injection.

    Args:
        db:       SQLAlchemy async session.
        user_id:  Primary key of the user to update.
        updates:  Dict of field → new value pairs.

    Returns:
        The updated user dict, or None if no valid fields were provided.
    """
    set_clauses: list[str] = []
    params: dict = {"uid": user_id}

    for key, value in updates.items():
        if key in _USER_ALLOWED_COLUMNS:
            set_clauses.append(f"{key} = :{key}")
            params[key] = value

    if not set_clauses:
        return None

    await db.execute(
        text(
            f"UPDATE arkmaniagest_users SET {', '.join(set_clauses)} WHERE id = :uid"
        ),
        params,
    )
    return await get_user_by_id(db, user_id)


async def delete_user(db: AsyncSession, user_id: int) -> bool:
    """
    Delete a user record by primary key (async).

    Returns:
        True if a row was deleted, False if the user was not found.
    """
    result = await db.execute(
        text("DELETE FROM arkmaniagest_users WHERE id = :uid"),
        {"uid": user_id},
    )
    return result.rowcount > 0


# =============================================
#  Server instances (panel DB) — async
# =============================================

def _row_to_instance_dict(row: dict) -> dict:
    """
    Normalise an ``ARKM_server_instances`` row for API consumption.

    - Decrypts admin/server password blobs and removes the ``*_enc`` columns.
    - Exposes ``has_admin_password`` / ``has_server_password`` convenience flags.
    - Converts datetimes to ISO-8601 strings and integer booleans to ``bool``.
    """
    m = dict(row)

    for enc_field, plain_field, has_field in (
        ("admin_password_enc",  "admin_password",  "has_admin_password"),
        ("server_password_enc", "server_password", "has_server_password"),
    ):
        raw = m.get(enc_field)
        m[has_field] = bool(raw)
        if raw:
            try:
                m[plain_field] = decrypt_value(raw)
            except Exception:
                m[plain_field] = None
        else:
            m[plain_field] = None
        m.pop(enc_field, None)

    for field in (
        "created_at", "updated_at",
        "last_status_at", "last_started_at", "last_stopped_at",
    ):
        if m.get(field) and hasattr(m[field], "isoformat"):
            m[field] = m[field].isoformat()

    for field in (
        "is_active", "mod_api", "battleye", "update_server", "cpu_optimization",
    ):
        if field in m:
            m[field] = bool(m[field])

    return m


async def get_instance_async(db: AsyncSession, instance_id: int) -> Optional[dict]:
    """Fetch a single ARK server instance by primary key."""
    result = await db.execute(
        text("SELECT * FROM ARKM_server_instances WHERE id = :iid"),
        {"iid": instance_id},
    )
    row = result.mappings().fetchone()
    return _row_to_instance_dict(dict(row)) if row else None


async def get_all_instances_async(
    db: AsyncSession,
    machine_id: Optional[int] = None,
    active_only: bool = False,
) -> List[dict]:
    """
    Fetch ARK server instance records, optionally filtered.

    Args:
        db:          SQLAlchemy async session.
        machine_id:  When set, only instances bound to that machine.
        active_only: When True, only instances with ``is_active = 1``.
    """
    clauses: List[str] = []
    params: Dict[str, Any] = {}
    if machine_id is not None:
        clauses.append("machine_id = :mid")
        params["mid"] = machine_id
    if active_only:
        clauses.append("is_active = 1")

    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    result = await db.execute(
        text(
            f"SELECT * FROM ARKM_server_instances{where} "
            f"ORDER BY machine_id, name"
        ),
        params,
    )
    return [_row_to_instance_dict(dict(r)) for r in result.mappings().fetchall()]


async def create_instance_async(
    db: AsyncSession,
    fields: Dict[str, Any],
) -> int:
    """
    Insert a new ARK server instance row and return its generated id.

    ``fields`` must contain every NOT NULL column not covered by the SQL
    defaults:  ``machine_id``, ``name``, ``container_name``, ``admin_password_enc``,
    ``pok_base_dir``, ``instance_dir``.  Every other key is optional.

    Password fields are expected to be already encrypted by the caller
    (``admin_password_enc`` / ``server_password_enc``); the store does not
    touch plaintext credentials.

    Raises:
        ValueError: A required column is missing from *fields*.
    """
    required = (
        "machine_id", "name", "container_name",
        "admin_password_enc", "pok_base_dir", "instance_dir",
    )
    missing = [k for k in required if k not in fields]
    if missing:
        raise ValueError(f"create_instance_async: missing required field(s) {missing}")

    # Columns that have SQL defaults or nullable=True can be omitted; the
    # UPDATE path handles the rest through update_instance_async.
    cols = list(fields.keys())
    placeholders = ", ".join(f":{c}" for c in cols)
    result = await db.execute(
        text(
            f"INSERT INTO ARKM_server_instances "
            f"({', '.join(cols)}) VALUES ({placeholders})"
        ),
        fields,
    )
    return result.lastrowid


async def update_instance_async(
    db: AsyncSession,
    instance_id: int,
    fields: Dict[str, Any],
) -> bool:
    """
    Apply a partial update to an ARK server instance row.

    *fields* is a flat dict of column names -> new values.  Empty dicts
    are a no-op and return True.  Encrypted password fields must arrive
    pre-encrypted (``admin_password_enc`` / ``server_password_enc``).

    Returns:
        True if a row was updated or the update was empty, False if the
        instance does not exist.
    """
    if not fields:
        return True
    assignments = ", ".join(f"{c} = :{c}" for c in fields)
    params = dict(fields)
    params["iid"] = instance_id
    result = await db.execute(
        text(
            f"UPDATE ARKM_server_instances SET {assignments} "
            f"WHERE id = :iid"
        ),
        params,
    )
    return result.rowcount > 0


async def delete_instance_async(db: AsyncSession, instance_id: int) -> bool:
    """Remove an ARK server instance row. Returns True if a row was deleted."""
    result = await db.execute(
        text("DELETE FROM ARKM_server_instances WHERE id = :iid"),
        {"iid": instance_id},
    )
    return result.rowcount > 0


async def set_instance_status_async(
    db: AsyncSession,
    instance_id: int,
    status: str,
    *,
    touch_started: bool = False,
    touch_stopped: bool = False,
) -> None:
    """
    Update the ``status`` column and the related lifecycle timestamps.

    The ``last_status_at`` column always receives the current UTC time.
    Pass ``touch_started=True`` to also bump ``last_started_at`` (for the
    ``running`` transition), and ``touch_stopped=True`` for the
    ``stopped``/``error`` transitions.
    """
    now = datetime.now(timezone.utc)
    sets = ["status = :st", "last_status_at = :now"]
    params: Dict[str, Any] = {"st": status, "now": now, "iid": instance_id}
    if touch_started:
        sets.append("last_started_at = :now")
    if touch_stopped:
        sets.append("last_stopped_at = :now")
    await db.execute(
        text(f"UPDATE ARKM_server_instances SET {', '.join(sets)} WHERE id = :iid"),
        params,
    )


# =============================================
#  Instance actions (panel DB) — async
# =============================================

def _row_to_action_dict(row: dict) -> dict:
    """Normalise a single ``ARKM_instance_actions`` row for API consumption."""
    m = dict(row)
    for field in ("started_at", "completed_at"):
        if m.get(field) and hasattr(m[field], "isoformat"):
            m[field] = m[field].isoformat()
    return m


async def log_action_async(
    db: AsyncSession,
    action: str,
    *,
    instance_id: Optional[int] = None,
    machine_id: Optional[int] = None,
    instance_name: Optional[str] = None,
    status: str = "pending",
    user_id: Optional[int] = None,
    username: Optional[str] = None,
    meta: Optional[str] = None,
) -> int:
    """
    Insert a new action log entry and return the generated id.

    Callers update ``status`` / ``stdout`` / ``stderr`` / ``exit_code`` /
    ``completed_at`` via :func:`finalise_action_async` once the action
    terminates.
    """
    result = await db.execute(
        text(
            "INSERT INTO ARKM_instance_actions "
            "(instance_id, machine_id, instance_name, action, status, "
            " meta, user_id, username, started_at) "
            "VALUES (:iid, :mid, :iname, :act, :st, :meta, :uid, :un, :now)"
        ),
        {
            "iid":   instance_id,
            "mid":   machine_id,
            "iname": instance_name,
            "act":   action,
            "st":    status,
            "meta":  meta,
            "uid":   user_id,
            "un":    username,
            "now":   datetime.now(timezone.utc),
        },
    )
    return result.lastrowid


async def finalise_action_async(
    db: AsyncSession,
    action_id: int,
    *,
    status: str,
    stdout: Optional[str] = None,
    stderr: Optional[str] = None,
    exit_code: Optional[int] = None,
    duration_ms: Optional[int] = None,
) -> None:
    """Mark an action as completed, storing stdout/stderr and timings."""
    await db.execute(
        text(
            "UPDATE ARKM_instance_actions SET "
            "status = :st, stdout = :out, stderr = :err, "
            "exit_code = :rc, duration_ms = :dur, completed_at = :now "
            "WHERE id = :id"
        ),
        {
            "st":  status,
            "out": stdout,
            "err": stderr,
            "rc":  exit_code,
            "dur": duration_ms,
            "now": datetime.now(timezone.utc),
            "id":  action_id,
        },
    )


async def list_actions_async(
    db: AsyncSession,
    *,
    instance_id: Optional[int] = None,
    machine_id: Optional[int] = None,
    action: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[dict]:
    """List action log entries matching the given filters (most recent first)."""
    clauses: List[str] = []
    params: Dict[str, Any] = {"lim": limit, "off": offset}
    if instance_id is not None:
        clauses.append("instance_id = :iid"); params["iid"] = instance_id
    if machine_id is not None:
        clauses.append("machine_id = :mid");  params["mid"] = machine_id
    if action:
        clauses.append("action = :act");      params["act"] = action
    if status:
        clauses.append("status = :st");       params["st"]  = status

    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    result = await db.execute(
        text(
            f"SELECT * FROM ARKM_instance_actions{where} "
            f"ORDER BY started_at DESC, id DESC LIMIT :lim OFFSET :off"
        ),
        params,
    )
    return [_row_to_action_dict(dict(r)) for r in result.mappings().fetchall()]


# =============================================
#  MariaDB instances (panel DB) — async
# =============================================

def _row_to_mariadb_dict(row: dict) -> dict:
    """
    Normalise an ``ARKM_mariadb_instances`` row for API consumption.

    - Decrypts the root password blob.
    - Parses ``databases_json`` into a list, stripping encrypted passwords
      (only ``has_password`` survives in the read projection).
    - Converts datetimes and booleans.
    """
    m = dict(row)

    raw_root = m.get("root_password_enc")
    m["has_root_password"] = bool(raw_root)
    if raw_root:
        try:
            m["root_password"] = decrypt_value(raw_root)
        except Exception:
            m["root_password"] = None
    else:
        m["root_password"] = None
    m.pop("root_password_enc", None)

    # Parse + sanitise the databases JSON blob
    raw_dbs = m.get("databases_json") or "[]"
    try:
        parsed = json.loads(raw_dbs)
    except (json.JSONDecodeError, ValueError):
        parsed = []
    sanitised: List[dict] = []
    for db in parsed if isinstance(parsed, list) else []:
        if not isinstance(db, dict):
            continue
        sanitised.append({
            "name":         db.get("name", ""),
            "user":         db.get("user", ""),
            "has_password": bool(db.get("password_enc")),
        })
    m["databases"] = sanitised
    m.pop("databases_json", None)

    for field in (
        "created_at", "updated_at", "last_status_at", "last_started_at",
    ):
        if m.get(field) and hasattr(m[field], "isoformat"):
            m[field] = m[field].isoformat()

    if "is_active" in m:
        m["is_active"] = bool(m["is_active"])

    return m


async def get_mariadb_async(db: AsyncSession, instance_id: int) -> Optional[dict]:
    """Fetch a single MariaDB instance record by primary key."""
    result = await db.execute(
        text("SELECT * FROM ARKM_mariadb_instances WHERE id = :iid"),
        {"iid": instance_id},
    )
    row = result.mappings().fetchone()
    return _row_to_mariadb_dict(dict(row)) if row else None


async def get_all_mariadb_async(
    db: AsyncSession,
    machine_id: Optional[int] = None,
    active_only: bool = False,
) -> List[dict]:
    """Fetch MariaDB instance records, optionally filtered by machine/active."""
    clauses: List[str] = []
    params: Dict[str, Any] = {}
    if machine_id is not None:
        clauses.append("machine_id = :mid"); params["mid"] = machine_id
    if active_only:
        clauses.append("is_active = 1")

    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    result = await db.execute(
        text(
            f"SELECT * FROM ARKM_mariadb_instances{where} "
            f"ORDER BY machine_id, name"
        ),
        params,
    )
    return [_row_to_mariadb_dict(dict(r)) for r in result.mappings().fetchall()]
