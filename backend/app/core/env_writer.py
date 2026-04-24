"""
core/env_writer.py — atomic key=value updates against the backend `.env`.

Pydantic loads the `.env` file once at import time, so any update written
by this module only takes effect after a service restart.  We never
auto-restart from inside the backend process; the caller surfaces a
"restart required" hint to the operator.

Design choices:

  - Editing is line-based on the original file, so comments and
    surrounding key order are preserved.
  - Writes are atomic: contents go to `<env>.tmp` then a single
    ``os.replace`` swaps it into place.  A crash mid-write leaves the
    original file untouched.
  - Values are escaped only when they contain a quote, backslash, or
    leading whitespace -- otherwise raw ASCII passes through verbatim
    (matches what installer scripts already produce, no surprises on
    diff).
  - The .env file is owned 600 by the service account; we preserve
    that mode after the rename so a panel-driven update doesn't
    accidentally widen permissions.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Iterable


def get_env_file_path() -> Path:
    """
    Resolve the absolute path of the backend's `.env` file.

    Pydantic's relative ``env_file = ".env"`` resolves against the
    process CWD; for production deployments that's
    ``/opt/arkmaniagest/backend``.  For dev / tests it can be anywhere.
    We anchor to the package directory so writes always hit the same
    file Pydantic read at boot.

    Override path via the ``ARKM_ENV_FILE`` environment variable for
    container / test scenarios.
    """
    override = os.environ.get("ARKM_ENV_FILE")
    if override:
        return Path(override).resolve()
    # __file__ is .../backend/app/core/env_writer.py
    # parents: [core, app, backend, ...]; backend/.env is parents[2] / ".env"
    return (Path(__file__).resolve().parents[2] / ".env")


def _quote_if_needed(value: str) -> str:
    """
    Quote the value only when needed for safe round-tripping by Pydantic
    + python-dotenv parsers.

    Both consumers strip surrounding double quotes; raw values are
    accepted as-is unless they begin with a space, contain a `"`, or
    contain a literal newline.  We over-quote in those edge cases.
    """
    needs_quote = (
        not value
        or value != value.strip()
        or "\n" in value
        or '"' in value
    )
    if not needs_quote:
        return value
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def update_env_file(
    updates: dict[str, str],
    *,
    path: Path | None = None,
) -> dict[str, str]:
    """
    Apply ``updates`` (env-key -> new value) to the .env file.

    For every key:
      - If a line ``KEY=...`` exists, its value is replaced in place
        (comment / position preserved).
      - Otherwise a new ``KEY=value`` line is appended at the end of
        the file.

    Returns a {key: applied-value} dict echoing what was written.
    Empty-string values are written as ``KEY=`` (i.e. cleared).  Use
    ``None`` semantics in the calling layer to skip a key entirely;
    only the keys that reach this function get touched.

    Raises ``ValueError`` when the file does not yet exist (we never
    create a fresh .env -- that's the installer's job).
    """
    target = (path or get_env_file_path())
    if not target.exists():
        raise ValueError(f".env file not found at {target}")

    original_mode = stat.S_IMODE(target.stat().st_mode)

    lines = target.read_text(encoding="utf-8").splitlines(keepends=True)

    pending = dict(updates)  # remaining keys not yet hit on a line
    new_lines: list[str] = []
    for raw in lines:
        # Quick filter: comments + blanks pass straight through.
        stripped = raw.lstrip()
        if not stripped or stripped.startswith("#"):
            new_lines.append(raw)
            continue
        # Key on this line is everything before the first '='.
        if "=" not in stripped:
            new_lines.append(raw)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in pending:
            new_value = pending.pop(key)
            new_lines.append(f"{key}={_quote_if_needed(new_value)}\n")
        else:
            new_lines.append(raw)

    # Any keys not found in the file get appended.
    if pending:
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines.append("\n")
        for key, value in pending.items():
            new_lines.append(f"{key}={_quote_if_needed(value)}\n")

    # Atomic write: tmp + replace.
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text("".join(new_lines), encoding="utf-8", newline="\n")
    os.chmod(tmp, original_mode)
    os.replace(tmp, target)

    return dict(updates)


def keys_in_env(keys: Iterable[str], *, path: Path | None = None) -> dict[str, bool]:
    """
    Lightweight presence check used by the diagnostic UI: reports which
    keys currently appear in the file (regardless of value).
    """
    target = (path or get_env_file_path())
    if not target.exists():
        return {k: False for k in keys}
    seen: set[str] = set()
    for line in target.read_text(encoding="utf-8").splitlines():
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        seen.add(stripped.split("=", 1)[0].strip())
    return {k: (k in seen) for k in keys}
