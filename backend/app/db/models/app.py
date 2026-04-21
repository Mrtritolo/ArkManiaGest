"""
ORM models — application tables owned by ArkManiaGest.

These tables are created automatically on first startup if they do not exist.
They store users, SSH machines, and key-value application settings.
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime
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
