#!/usr/bin/env python3
"""Quick diagnostic: test machine decryption + DB queries."""
import sys, os, traceback
os.chdir("/opt/arkmaniagest/backend")
sys.path.insert(0, ".")

from app.core.config import server_settings
print(f"DB_HOST: {server_settings.DB_HOST}")
print(f"DB_NAME: {server_settings.DB_NAME}")
print(f"ENCRYPTION_KEY set: {bool(server_settings.FIELD_ENCRYPTION_KEY)}")

# Test 1: sync DB connection
import pymysql
try:
    conn = pymysql.connect(
        host=server_settings.DB_HOST, port=server_settings.DB_PORT,
        user=server_settings.DB_USER, password=server_settings.DB_PASSWORD,
        database=server_settings.DB_NAME, charset="utf8mb4",
    )
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM arkmaniagest_machines")
    count = cur.fetchone()[0]
    print(f"\nTest 1 - DB connect: OK ({count} machines)")
    conn.close()
except Exception:
    print("\nTest 1 - DB connect: FAILED")
    traceback.print_exc()

# Test 2: decrypt machines
try:
    from app.core.store import get_all_machines_sync
    machines = get_all_machines_sync()
    print(f"\nTest 2 - Decrypt machines: OK ({len(machines)} machines)")
    for m in machines:
        print(f"  - {m['name']}: status={m.get('last_status')}")
except Exception:
    print("\nTest 2 - Decrypt machines: FAILED")
    traceback.print_exc()

# Test 3: check arkmania tables
try:
    conn = pymysql.connect(
        host=server_settings.DB_HOST, port=server_settings.DB_PORT,
        user=server_settings.DB_USER, password=server_settings.DB_PASSWORD,
        database=server_settings.DB_NAME, charset="utf8mb4",
    )
    cur = conn.cursor()
    for t in ["ARKM_sessions", "ARKM_servers", "ARKM_players"]:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {t}")
            c = cur.fetchone()[0]
            print(f"  {t}: {c} rows")
        except Exception as e:
            print(f"  {t}: MISSING - {e}")
    conn.close()
    print("\nTest 3 - Tables: OK")
except Exception:
    print("\nTest 3 - Tables: FAILED")
    traceback.print_exc()
