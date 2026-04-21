"""
ssh/manager.py — SSH session management and SCP file transfer.

Wraps Paramiko to provide a simple, context-manager–compatible interface for:
  - Connecting to remote Linux hosts via SSH
  - Executing shell commands and capturing stdout / stderr / exit code
  - Uploading and downloading files and directories via SCP

Authentication order (first available method wins):
  1. Explicit private key file (``key_path`` argument)
  2. Default key at :data:`DEFAULT_SSH_KEY_PATH`
  3. Password authentication
  4. SSH agent + filesystem key discovery (fallback when neither key nor password given)
"""

import os
from typing import Optional, Tuple

import paramiko
from scp import SCPClient

DEFAULT_SSH_PORT: int = 22
DEFAULT_SSH_TIMEOUT: int = 30
DEFAULT_SSH_KEY_PATH: str = "/home/arkmania/.ssh/id_ed25519"


class SSHManager:
    """
    Manages a single SSH session with optional SCP file transfer capability.

    Supports use as a context manager for automatic connect/disconnect::

        with SSHManager(host="1.2.3.4", username="admin", password="secret") as ssh:
            stdout, stderr, code = ssh.execute("uptime")
    """

    def __init__(
        self,
        host: str,
        username: str,
        password: Optional[str] = None,
        key_path: Optional[str] = None,
        port: int = DEFAULT_SSH_PORT,
        timeout: int = DEFAULT_SSH_TIMEOUT,
    ) -> None:
        """
        Initialise the manager without connecting.

        Args:
            host:     Hostname or IP address of the remote server.
            username: SSH login username.
            password: Password for password auth, or key passphrase when using a key.
            key_path: Path to a private key file (``~``-expansion is applied).
            port:     SSH port number (default: 22).
            timeout:  Connection timeout in seconds (default: 30).
        """
        self.host = host
        self.username = username
        self.password = password or None     # Normalise empty string to None
        self.key_path = key_path or None     # Normalise empty string to None
        self.port = port or DEFAULT_SSH_PORT
        self.timeout = timeout or DEFAULT_SSH_TIMEOUT
        self._client: Optional[paramiko.SSHClient] = None

    # ── Connection lifecycle ──────────────────────────────────────────────

    def connect(self) -> None:
        """
        Open an SSH connection to the remote host.

        Authentication is attempted in the following order:
          1. ``key_path`` if provided and the file exists on disk.
          2. Default key at :data:`DEFAULT_SSH_KEY_PATH` if it exists.
          3. Password (used as both the login password and as the key passphrase
             when a key file is found).
          4. SSH agent + ``look_for_keys`` when neither key nor password is given.

        Raises:
            paramiko.ssh_exception.SSHException: Connection or authentication failed.
                The exception message includes diagnostic details about which
                auth methods were tried.
        """
        self._client = paramiko.SSHClient()
        self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        connect_kwargs = {
            "hostname": self.host,
            "port": self.port,
            "username": self.username,
            "timeout": self.timeout,
            "allow_agent": False,
            "look_for_keys": False,
        }

        # Resolve the private key file to use (explicit path takes priority)
        resolved_key: Optional[str] = None
        if self.key_path:
            expanded = os.path.expanduser(self.key_path)
            if os.path.exists(expanded):
                resolved_key = expanded

        if resolved_key is None:
            default_expanded = os.path.expanduser(DEFAULT_SSH_KEY_PATH)
            if os.path.exists(default_expanded):
                resolved_key = default_expanded

        if resolved_key:
            connect_kwargs["key_filename"] = resolved_key
            if self.password:
                # Password acts as the key passphrase when a key is used
                connect_kwargs["passphrase"] = self.password
        elif self.password:
            connect_kwargs["password"] = self.password
        else:
            # No explicit credentials: fall back to agent / filesystem key discovery
            connect_kwargs["allow_agent"] = True
            connect_kwargs["look_for_keys"] = True

        try:
            self._client.connect(**connect_kwargs)
        except paramiko.ssh_exception.SSHException as exc:
            # Build a diagnostic message listing each auth method that was tried
            tried = []
            if self.key_path:
                expanded = os.path.expanduser(self.key_path)
                tried.append(f"key={expanded} ({'found' if os.path.exists(expanded) else 'NOT FOUND'})")
            default_exp = os.path.expanduser(DEFAULT_SSH_KEY_PATH)
            tried.append(
                f"default_key={default_exp} ({'found' if os.path.exists(default_exp) else 'NOT FOUND'})"
            )
            tried.append(f"password={'yes' if self.password else 'no'}")
            raise paramiko.ssh_exception.SSHException(
                f"{exc} | Tried: {', '.join(tried)}"
            ) from exc

    def disconnect(self) -> None:
        """Close the SSH connection and release resources."""
        if self._client:
            self._client.close()
            self._client = None

    # ── Remote command execution ──────────────────────────────────────────

    def execute(self, command: str) -> Tuple[str, str, int]:
        """
        Execute a shell command on the remote host and wait for it to finish.

        Args:
            command: Shell command string to execute.

        Returns:
            A ``(stdout, stderr, exit_code)`` tuple.  Both streams are decoded
            as UTF-8 and trailing whitespace is stripped.

        Raises:
            ConnectionError: The SSH client is not connected.
        """
        if not self._client:
            raise ConnectionError("SSH client is not connected. Call connect() first.")

        _stdin, stdout, stderr = self._client.exec_command(command)
        exit_code = stdout.channel.recv_exit_status()

        return (
            stdout.read().decode("utf-8").strip(),
            stderr.read().decode("utf-8").strip(),
            exit_code,
        )

    # ── File transfer ─────────────────────────────────────────────────────

    def upload_file(self, local_path: str, remote_path: str) -> None:
        """
        Upload a single local file to the remote host via SCP.

        Args:
            local_path:  Absolute or relative path of the local source file.
            remote_path: Absolute path of the destination on the remote host.

        Raises:
            ConnectionError: SSH client is not connected.
        """
        if not self._client:
            raise ConnectionError("SSH client is not connected. Call connect() first.")
        with SCPClient(self._client.get_transport()) as scp:
            scp.put(local_path, remote_path)

    def download_file(self, remote_path: str, local_path: str) -> None:
        """
        Download a single file from the remote host via SCP.

        Args:
            remote_path: Absolute path of the source file on the remote host.
            local_path:  Absolute or relative path of the local destination.

        Raises:
            ConnectionError: SSH client is not connected.
        """
        if not self._client:
            raise ConnectionError("SSH client is not connected. Call connect() first.")
        with SCPClient(self._client.get_transport()) as scp:
            scp.get(remote_path, local_path)

    def upload_directory(self, local_dir: str, remote_dir: str) -> None:
        """
        Recursively upload a local directory to the remote host via SCP.

        Args:
            local_dir:  Path to the local directory to upload.
            remote_dir: Destination path on the remote host.

        Raises:
            ConnectionError: SSH client is not connected.
        """
        if not self._client:
            raise ConnectionError("SSH client is not connected. Call connect() first.")
        with SCPClient(self._client.get_transport()) as scp:
            scp.put(local_dir, remote_path=remote_dir, recursive=True)

    def file_exists(self, remote_path: str) -> bool:
        """
        Check whether a file exists on the remote host.

        Args:
            remote_path: Absolute path to test.

        Returns:
            True if the path exists and is a regular file.
        """
        stdout, _, _ = self.execute(
            f'test -f "{remote_path}" && echo "yes" || echo "no"'
        )
        return stdout == "yes"

    # ── Context manager support ───────────────────────────────────────────

    def __enter__(self) -> "SSHManager":
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        self.disconnect()
        return False  # Do not suppress exceptions
