# Modelli ORM per il database remoto MariaDB.
from app.db.session import Base

# Tabelle operative ARK (pre-esistenti)
from app.db.models.ark import (
    Player, ArkShopPlayer, PermissionGroup, TribePermission,
)

# Tabelle applicative ArkManiaGest (nuove)
from app.db.models.app import (
    AppUser, SSHMachine, AppSetting,
)

__all__ = [
    "Base",
    "Player", "ArkShopPlayer", "PermissionGroup", "TribePermission",
    "AppUser", "SSHMachine", "AppSetting",
]
