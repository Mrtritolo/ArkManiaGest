#!/usr/bin/env python3
"""Quick diagnostic: test panel + plugin DB connectivity and core tables.

Run on the server as the app user:
    sudo -u arkmania /opt/arkmaniagest/backend/venv/bin/python \
        /opt/arkmaniagest/deploy/test_db.py
"""
import sys, os, traceback
os.chdir("/opt/arkmaniagest/backend")
sys.path.insert(0, ".")

from app.core.config import server_settings

s = server_settings
print("=== Config ===")
print(f"Panel   : {s.DB_USER}@{s.DB_HOST}:{s.DB_PORT}/{s.DB_NAME}")
print(f"Plugin  : {s.plugin_db_user}@{s.plugin_db_host}:{s.plugin_db_port}/{s.plugin_db_name}"
      f" {'[separate]' if s.plugin_db_is_separate else '[shared with panel]'}")
print(f"Encryption key set: {bool(s.FIELD_ENCRYPTION_KEY)}")
print()

import pymysql

def _connect(label, host, port, user, password, database):
    try:
        conn = pymysql.connect(
            host=host, port=port, user=user, password=password,
            database=database, charset="utf8mb4",
        )
        print(f"[{label}] connect: OK")
        return conn
    except Exception:
        print(f"[{label}] connect: FAILED")
        traceback.print_exc()
        return None

def _row_count(conn, table):
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        return cur.fetchone()[0]
    except Exception as e:
        return f"MISSING ({e})"

# --- Test 1: Panel DB connectivity + core panel tables ---
print("=== Test 1: Panel DB ===")
conn = _connect("panel", s.DB_HOST, s.DB_PORT, s.DB_USER, s.DB_PASSWORD, s.DB_NAME)
if conn:
    for t in ["arkmaniagest_machines", "arkmaniagest_users", "arkmaniagest_settings"]:
        print(f"  {t}: {_row_count(conn, t)} rows")
    conn.close()
print()

# --- Test 2: Plugin DB connectivity + core plugin tables ---
print("=== Test 2: Plugin DB ===")
conn = _connect(
    "plugin", s.plugin_db_host, s.plugin_db_port,
    s.plugin_db_user, s.plugin_db_password, s.plugin_db_name,
)
if conn:
    for t in ["ARKM_config", "ARKM_servers", "ARKM_players", "ARKM_sessions"]:
        print(f"  {t}: {_row_count(conn, t)} rows")
    conn.close()
print()

# --- Test 3: Decrypt machines (requires Panel DB + FIELD_ENCRYPTION_KEY) ---
print("=== Test 3: Machine decryption ===")
try:
    from app.core.store import get_all_machines_sync
    machines = get_all_machines_sync()
    print(f"  OK: {len(machines)} machines")
    for m in machines:
        print(f"    - {m['name']}: status={m.get('last_status')}")
except Exception:
    print("  FAILED")
    traceback.print_exc()
