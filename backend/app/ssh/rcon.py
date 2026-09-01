"""
ssh/rcon.py -- Source RCON client spoken directly by the panel.

Historically the panel issued RCON by shelling out on the host: ``docker exec``
into the instance container and run POK-manager's ``rcon_interface.sh`` (or
gorcon as a fallback).  That works only where there *is* a container, so the
native-Windows runtime needs something else.

Rather than ship a second host-side binary, the panel now speaks the protocol
itself over a ``direct-tcpip`` channel on the SSH connection it already holds.
That gives one implementation for both runtimes, and RCON never touches the
network in the clear: the traffic rides inside the SSH transport and the
instance's RCON port stays bound to loopback on the host, closed at the
firewall.

The protocol (Valve's Source RCON) is small.  Every packet is::

    int32  size      -- byte count of everything after this field
    int32  id        -- caller-chosen; echoed back in the reply
    int32  type      -- see the SERVERDATA_* constants below
    bytes  body      -- NUL-terminated
    byte   0x00      -- second terminator

Authentication sends the password as ``SERVERDATA_AUTH``.  The server answers
with an empty ``SERVERDATA_RESPONSE_VALUE`` followed by a
``SERVERDATA_AUTH_RESPONSE`` whose id is our id on success, or ``-1`` on
failure.  ARK follows this faithfully; the only quirk it adds is that some
commands answer with an empty body, which is not an error.
"""

from __future__ import annotations

import struct
from typing import Optional, Protocol


# SERVERDATA_* packet types.
_AUTH = 3
_AUTH_RESPONSE = 2
_EXECCOMMAND = 2
_RESPONSE_VALUE = 0

# Sanity bound on the declared packet size.  The protocol caps a single
# response at 4096 bytes; we allow generous headroom for servers that ignore
# that, but refuse to allocate on a garbage length.
_MAX_PACKET = 65536

# Request id used for the auth exchange, and the base for command ids.
_AUTH_ID = 1
_CMD_ID = 2

DEFAULT_RCON_TIMEOUT = 10.0


class RconError(RuntimeError):
    """RCON transport, authentication or protocol failure."""


class _Sock(Protocol):
    """
    Minimal socket surface used by this module.

    Both :class:`socket.socket` and :class:`paramiko.Channel` satisfy it,
    which is what lets the same code run against a direct TCP connection in
    tests and against an SSH tunnel in production.
    """

    def settimeout(self, value: Optional[float]) -> None: ...
    def sendall(self, data: bytes) -> None: ...
    def recv(self, size: int) -> bytes: ...


# ── Wire format ───────────────────────────────────────────────────────────────

def _encode(packet_id: int, packet_type: int, body: str) -> bytes:
    """Serialise one RCON packet."""
    payload = struct.pack("<ii", packet_id, packet_type) + body.encode("utf-8") + b"\x00\x00"
    return struct.pack("<i", len(payload)) + payload


def _recv_exactly(sock: _Sock, count: int) -> bytes:
    """
    Read exactly *count* bytes, or raise.

    ``recv`` on both a socket and a paramiko channel may return short reads;
    a naive single call is the classic source of "RCON works until the reply
    gets big" bugs.
    """
    chunks: list[bytes] = []
    remaining = count
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RconError("RCON connection closed by the server.")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _read_packet(sock: _Sock) -> tuple[int, int, str]:
    """Read one packet and return ``(id, type, body)``."""
    raw_size = _recv_exactly(sock, 4)
    (size,) = struct.unpack("<i", raw_size)
    if size < 10 or size > _MAX_PACKET:
        raise RconError(f"RCON packet has an implausible length ({size}).")
    payload = _recv_exactly(sock, size)
    packet_id, packet_type = struct.unpack("<ii", payload[:8])
    # Strip the two trailing NULs; be tolerant if the server sent only one.
    body = payload[8:].rstrip(b"\x00").decode("utf-8", errors="replace")
    return packet_id, packet_type, body


# ── Public API ────────────────────────────────────────────────────────────────

def rcon_execute(
    sock: _Sock,
    password: str,
    command: str,
    *,
    timeout: float = DEFAULT_RCON_TIMEOUT,
) -> str:
    """
    Authenticate on *sock* and run a single RCON *command*.

    The socket is used for exactly one command and is expected to be closed
    by the caller afterwards -- ARK tolerates long-lived RCON sessions
    poorly, and a per-command channel keeps failure handling trivial.

    Args:
        sock:     Connected socket or paramiko channel to the RCON port.
        password: RCON password (ARK's ``ServerAdminPassword``).
        command:  Command to run, e.g. ``"saveworld"``.
        timeout:  Per-read timeout in seconds.

    Returns:
        The server's response body, stripped.  An empty string is a valid
        answer for commands that produce no output.

    Raises:
        RconError: Authentication was rejected, or the exchange broke.
    """
    if "\n" in command or "\r" in command:
        raise RconError("RCON command must be a single line.")

    sock.settimeout(timeout)

    # --- Authenticate -----------------------------------------------------
    sock.sendall(_encode(_AUTH_ID, _AUTH, password))
    while True:
        packet_id, packet_type, _body = _read_packet(sock)
        if packet_type == _AUTH_RESPONSE:
            if packet_id == -1:
                raise RconError("RCON authentication failed: wrong password.")
            break
        if packet_type != _RESPONSE_VALUE:
            raise RconError(
                f"Unexpected RCON packet type {packet_type} during authentication."
            )
        # A leading empty RESPONSE_VALUE before the auth answer is normal.

    # --- Execute ----------------------------------------------------------
    sock.sendall(_encode(_CMD_ID, _EXECCOMMAND, command))
    packet_id, packet_type, body = _read_packet(sock)
    if packet_type != _RESPONSE_VALUE:
        raise RconError(f"Unexpected RCON packet type {packet_type} in response.")
    return body.strip()
