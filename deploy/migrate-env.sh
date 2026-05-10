#!/usr/bin/env bash
# =============================================================================
# migrate-env.sh — Idempotent upgrade of an existing backend/.env
# =============================================================================
# On deploy/upgrade, the existing backend/.env is preserved (the rsync of
# server-update.sh explicitly excludes it).  When we add new variables to
# the .env.production template, those new keys never reach the live .env.
#
# This script appends to backend/.env any key that is present in
# deploy/.env.production but missing in the live file.  Existing keys and
# their values are never touched.  Safe to run multiple times.
#
# Usage (usually invoked from full-deploy.sh / server-update.sh):
#     bash deploy/migrate-env.sh /opt/arkmaniagest
# =============================================================================
set -euo pipefail

APP_DIR="${1:-/opt/arkmaniagest}"
LIVE_ENV="${APP_DIR}/backend/.env"
TEMPLATE="${APP_DIR}/deploy/.env.production"

if [ ! -f "$TEMPLATE" ]; then
    echo "  [migrate-env] Template not found: $TEMPLATE — skipping."
    exit 0
fi
if [ ! -f "$LIVE_ENV" ]; then
    echo "  [migrate-env] Live .env not found ($LIVE_ENV) — nothing to migrate."
    exit 0
fi

# Collect all KEY=... lines from the template (ignore comments and blanks)
# and append the missing ones inside a single fence-block.  Re-runs that
# add additional keys reuse the same fence (so the live .env doesn't
# accumulate one "Added by migrate-env.sh on …" header per upgrade).
FENCE_OPEN="# >>> migrate-env: appended keys >>>"
FENCE_CLOSE="# <<< migrate-env: appended keys <<<"

added=0
while IFS= read -r line; do
    # Skip comments and empty lines
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    # Validate that the "key" looks like an env var name (letters/digits/_).
    case "$key" in *[!A-Za-z0-9_]*) continue ;; esac
    # Skip if the key is already present in the live .env.
    if grep -q "^${key}=" "$LIVE_ENV"; then
        continue
    fi

    # Open the fence once; subsequent runs append BEFORE the closing
    # marker so the file never accumulates duplicated banners.
    if [ "$added" -eq 0 ]; then
        if grep -qF "$FENCE_OPEN" "$LIVE_ENV"; then
            # Insert BEFORE the closing marker so all migrated keys live
            # inside the same fence-block.
            tmp=$(mktemp)
            awk -v open="$FENCE_OPEN" -v close="$FENCE_CLOSE" -v line="$line" '
                $0 == close && !done { print line; done = 1 }
                { print }
            ' "$LIVE_ENV" > "$tmp"
            mv "$tmp" "$LIVE_ENV"
        else
            {
                echo ""
                echo "$FENCE_OPEN"
                printf '# Inserted by migrate-env.sh on %s\n' \
                    "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
                echo "$line"
                echo "$FENCE_CLOSE"
            } >> "$LIVE_ENV"
        fi
    else
        # Fence already opened in this run -- insert before the close.
        tmp=$(mktemp)
        awk -v close="$FENCE_CLOSE" -v line="$line" '
            $0 == close && !done { print line; done = 1 }
            { print }
        ' "$LIVE_ENV" > "$tmp"
        mv "$tmp" "$LIVE_ENV"
    fi
    echo "  [migrate-env] + $key"
    added=$((added + 1))
done < "$TEMPLATE"

if [ "$added" -eq 0 ]; then
    echo "  [migrate-env] .env already up-to-date (no new keys)."
else
    echo "  [migrate-env] Appended ${added} new key(s) to $LIVE_ENV."
fi
