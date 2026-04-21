"""
ORM models — pre-existing ARK plugin tables in the MariaDB database.

These tables are created and managed by the ARK server plugins (ArkShop,
Permissions, etc.) and are mapped here for read/write access.
ArkManiaGest never drops or re-creates these tables.
"""
from sqlalchemy import Column, Integer, BigInteger, String, Text
from app.db.session import Base


class Player(Base):
    """
    Players table — permission group assignments per player EOS ID.

    Managed by the Permissions ARK plugin.
    """
    __tablename__ = "Players"

    Id                    = Column(Integer, primary_key=True, autoincrement=True)
    EOS_Id                = Column(String(50), unique=True, nullable=False)
    PermissionGroups      = Column(String(256), nullable=False, default="Default,")
    TimedPermissionGroups = Column(String(256), nullable=False, default="")
    Giocatore             = Column(String(45), nullable=True)


class ArkShopPlayer(Base):
    """
    ArkShopPlayers table — per-player shop points and kit cooldowns.

    Managed by the ArkShop plugin.
    """
    __tablename__ = "ArkShopPlayers"

    Id         = Column(Integer, primary_key=True, autoincrement=True)
    EosId      = Column(String(50), unique=True, nullable=False)
    Kits       = Column(Text, nullable=False, default="")
    Points     = Column(Integer, default=0)
    TotalSpent = Column(Integer, default=0)


class PermissionGroup(Base):
    """
    PermissionGroups table — group definitions with their permission flags.

    Managed by the Permissions ARK plugin.
    """
    __tablename__ = "PermissionGroups"

    Id          = Column(Integer, primary_key=True, autoincrement=True)
    GroupName   = Column(String(128), unique=True, nullable=False)
    Permissions = Column(String(768), nullable=False, default="")


class TribePermission(Base):
    """
    TribePermissions table — permission overrides at the tribe level.

    Managed by the Permissions ARK plugin.
    """
    __tablename__ = "TribePermissions"

    Id                    = Column(Integer, primary_key=True, autoincrement=True)
    TribeId               = Column(BigInteger, unique=True, nullable=False)
    PermissionGroups      = Column(String(256), nullable=False, default="")
    TimedPermissionGroups = Column(String(256), nullable=False, default="")
