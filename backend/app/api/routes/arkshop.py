"""
api/routes/arkshop.py — ArkShop plugin configuration editor.

Extends the generic plugin infrastructure from :mod:`app.api.routes.plugin_base`
with ArkShop-specific sections:

  GET/PUT /mysql        — MySQL connection settings
  GET/PUT /general      — General plugin settings
  GET     /shop-items   — List all shop items
  GET/PUT /shop-items   — CRUD for individual shop items
  GET/PUT /kits         — CRUD for kit definitions
  GET/PUT /sell-items   — CRUD for sellable items
  GET/PUT /messages     — In-game message strings
"""
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel

from app.api.routes.plugin_base import create_plugin_router

# Build the base router (pull, deploy, versions, section CRUD, etc.)
router = create_plugin_router(
    plugin_name  = "arkshop",
    versions_key = "arkshop_versions",
    folder_names = ["ArkShop", "arkshop"],
)

# Extract pre-built helpers attached by the factory
_h             = router.plugin_helpers
_require_vault = _h["require_vault"]
_get_config    = _h["get_config"]
_save_config   = _h["save_config"]


# ── Request schemas ────────────────────────────────────────────────────────────

class ShopItemUpdate(BaseModel):
    key:  str
    item: dict

class KitUpdate(BaseModel):
    key: str
    kit: dict

class SellItemUpdate(BaseModel):
    key:  str
    item: dict

class MysqlUpdate(BaseModel):
    mysql: dict

class GeneralUpdate(BaseModel):
    general: dict

class MessagesUpdate(BaseModel):
    messages: dict


# ── MySQL ──────────────────────────────────────────────────────────────────────

@router.get("/mysql")
async def get_mysql():
    """Return the ArkShop MySQL connection configuration block."""
    _require_vault()
    return _get_config().get("Mysql", {})


@router.put("/mysql")
async def update_mysql(data: MysqlUpdate):
    """Replace the ArkShop MySQL configuration block."""
    _require_vault()
    config = _get_config()
    config["Mysql"] = data.mysql
    _save_config(config)
    return {"success": True}


# ── General settings ───────────────────────────────────────────────────────────

@router.get("/general")
async def get_general():
    """Return the ArkShop General settings block."""
    _require_vault()
    return _get_config().get("General", {})


@router.put("/general")
async def update_general(data: GeneralUpdate):
    """Replace the ArkShop General settings block."""
    _require_vault()
    config = _get_config()
    config["General"] = data.general
    _save_config(config)
    return {"success": True}


# ── Shop items ─────────────────────────────────────────────────────────────────

@router.get("/shop-items")
async def list_shop_items():
    """Return all shop items sorted by title."""
    _require_vault()
    items = _get_config().get("ShopItems", {})
    return [
        {"key": key, **val}
        for key, val in sorted(items.items(), key=lambda x: x[1].get("Title", x[0]))
    ]


@router.get("/shop-items/{key}")
async def get_shop_item(key: str):
    """
    Return a single shop item by key.

    Raises:
        HTTPException 404: Item not found.
    """
    _require_vault()
    items = _get_config().get("ShopItems", {})
    if key not in items:
        raise HTTPException(status_code=404, detail=f"Item '{key}' not found.")
    return {"key": key, **items[key]}


@router.put("/shop-items")
async def update_shop_item(data: ShopItemUpdate):
    """Create or replace a shop item."""
    _require_vault()
    config = _get_config()
    config.setdefault("ShopItems", {})[data.key] = data.item
    _save_config(config)
    return {"success": True, "key": data.key}


@router.delete("/shop-items/{key}")
async def delete_shop_item(key: str):
    """
    Delete a shop item.

    Raises:
        HTTPException 404: Item not found.
    """
    _require_vault()
    config = _get_config()
    items  = config.get("ShopItems", {})
    if key not in items:
        raise HTTPException(status_code=404, detail=f"Item '{key}' not found.")
    del config["ShopItems"][key]
    _save_config(config)
    return {"success": True, "deleted": key}


# ── Kits ───────────────────────────────────────────────────────────────────────

@router.get("/kits")
async def list_kits():
    """Return all kit definitions sorted by key."""
    _require_vault()
    kits = _get_config().get("Kits", {})
    return [{"key": key, **val} for key, val in sorted(kits.items())]


@router.put("/kits")
async def update_kit(data: KitUpdate):
    """Create or replace a kit definition."""
    _require_vault()
    config = _get_config()
    config.setdefault("Kits", {})[data.key] = data.kit
    _save_config(config)
    return {"success": True, "key": data.key}


@router.delete("/kits/{key}")
async def delete_kit(key: str):
    """
    Delete a kit definition.

    Raises:
        HTTPException 404: Kit not found.
    """
    _require_vault()
    config = _get_config()
    kits   = config.get("Kits", {})
    if key not in kits:
        raise HTTPException(status_code=404, detail=f"Kit '{key}' not found.")
    del config["Kits"][key]
    _save_config(config)
    return {"success": True, "deleted": key}


# ── Sell items ─────────────────────────────────────────────────────────────────

@router.get("/sell-items")
async def list_sell_items():
    """Return all sellable items sorted by key."""
    _require_vault()
    items = _get_config().get("SellItems", {})
    return [{"key": key, **val} for key, val in sorted(items.items())]


@router.put("/sell-items")
async def update_sell_item(data: SellItemUpdate):
    """Create or replace a sellable item."""
    _require_vault()
    config = _get_config()
    config.setdefault("SellItems", {})[data.key] = data.item
    _save_config(config)
    return {"success": True, "key": data.key}


@router.delete("/sell-items/{key}")
async def delete_sell_item(key: str):
    """
    Delete a sellable item.

    Raises:
        HTTPException 404: Item not found.
    """
    _require_vault()
    config = _get_config()
    items  = config.get("SellItems", {})
    if key not in items:
        raise HTTPException(status_code=404, detail=f"Item '{key}' not found.")
    del config["SellItems"][key]
    _save_config(config)
    return {"success": True, "deleted": key}


# ── Messages ───────────────────────────────────────────────────────────────────

@router.get("/messages")
async def get_messages():
    """Return all in-game message strings."""
    _require_vault()
    return _get_config().get("Messages", {})


@router.put("/messages")
async def update_messages(data: MessagesUpdate):
    """Replace all in-game message strings."""
    _require_vault()
    config = _get_config()
    config["Messages"] = data.messages
    _save_config(config)
    return {"success": True}
