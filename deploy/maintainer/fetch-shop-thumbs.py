#!/usr/bin/env python3
"""
fetch-shop-thumbs.py — bake the shop catalogue thumbnails into static assets.

Why this exists
---------------
Shop tiles used to resolve their image at render time: the frontend built a
chain of guessed wiki page names and let ``<img onError>`` walk it until one
stuck, each hop going through the panel's ``/market/thumb`` cache proxy.

That failed in two distinct ways, both of which read to a player as "half the
shop has no picture":

  1. **Throttling.** Painting the catalogue fires ~50 thumb requests at once.
     On a cold cache every one of them hits ark.wiki.gg, which answers 429 to
     the burst.  A 429 is (correctly) not negative-cached, so nothing lands on
     disk and the next paint repeats the whole thing.
  2. **Wrong names.** A dozen entries have no wiki page under any name the
     chain can derive -- boss packs named after the arena, mod items, and
     titles like ``[BOSS] Red-Handed`` whose wiki page is *Lost King*.

Both stop existing if the images stop being a runtime concern.  This script
resolves every catalogue entry ONCE, serially, with backoff, and writes the
result to ``frontend/public/shop-thumbs/<item_key>.png``.  The frontend then
loads ``/shop-thumbs/<key>.png``: same-origin, static, no wiki, no proxy.

Run it after editing the ArkShop catalogue:

    python deploy/maintainer/fetch-shop-thumbs.py \
        --config ../ArkMania-Plugin/BasePlugin/ArkShop/config.json

Entries it cannot resolve are listed at the end: add them to WIKI_PAGE (a wiki
page name) or WIKI_IMAGE (a wiki file name, extension included) and re-run.
Until then those tiles fall back to the generic per-kind icon -- the same
behaviour as an entry added to the catalogue after the last run.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

WIKI = "https://ark.wiki.gg/wiki/Special:FilePath/"
UA = "ArkManiaGest-Panel/1.0 (https://gestionale.arkmania.it)"

# Politeness: the wiki starts answering 429 well before 2 req/s.  This is a
# maintainer script run by hand a few times a year -- slow is free.
DELAY_SECONDS = 1.5
RETRIES = 4


# -- Explicit picture per catalogue entry ------------------------------------
# Keyed by ArkShop item key.  WIKI_IMAGE values are wiki FILE names, extension
# included, used verbatim.  WIKI_PAGE values are wiki PAGE names, fetched as
# "<page>.png" -- the right form when the picture is a normal item/creature
# icon that the derivation chain simply guesses wrong.

WIKI_IMAGE: dict[str, str] = {
    # The catalogue names the boss, the wiki names the page it lives on.
    "RedHanded": "Lost_King.jpg",
    # Arena shots are photographs, so the wiki files are .jpg and the
    # "<page>.png" form never finds them.
    "TheCenterBoss": "The Center Arena.jpg",
    # Both "<full name>.png" forms redirect to the same line-art icon, so the
    # two Void bosses came out with an identical picture. These are their
    # actual screenshots, and they are the only images the wiki has of them.
    "ShallocisAlpha": "Shallocis_Size_Comparison.JPG",
    "AbyssalusAlpha": "Abyssalus.JPG",
}

WIKI_PAGE: dict[str, str] = {
    "TekCave":       "Tek Cave",
    "Manticore":     "Manticore",
    "Megapithecus":  "Megapithecus",
    "KibblePack":    "Basic Kibble",
    "Metal":         "Metal Ingot",
    "WhitePearl":    "Silica Pearls",
    "MotoSega":      "Chainsaw",
    "SOSTAMING":     "Crossbow",
    "TamingBPSet":   "Crossbow",
    "Dreadmare":     "Dreadmare",
    "Rhyniognatha":  "Rhyniognatha",
}


# -- Name derivation (port of frontend/src/utils/arkItem.ts) -----------------

_PREFIXES = [
    r"^PrimalItemResource_", r"^PrimalItemConsumable_",
    r"^PrimalItemConsumableEatable_", r"^PrimalItemConsumableEat_",
    r"^PrimalItemArmor_", r"^PrimalItemAmmo_", r"^PrimalItemStructure_",
    r"^PrimalItemDye_", r"^PrimalItemSkin_", r"^PrimalItemCostume_",
    r"^PrimalItem_Weapon", r"^PrimalItem_",
]
_SUBPREFIXES = [r"^Berry_", r"^Egg_", r"^Kibble_", r"^Soup_", r"^Veggie_"]
_NAME_OVERRIDES = {
    "Fiber": "Fibers", "Cementing Paste": "Chitin or Keratin",
    "Metal Helmet": "Flak Helmet", "Metal Shirt": "Flak Chestpiece",
    "Metal Gloves": "Flak Gauntlets", "Metal Pants": "Flak Leggings",
    "Metal Boots": "Flak Boots", "Hazard Suit Helmet": "Hazard Suit Hat",
    "Scuba Helmet Goggles": "SCUBA Mask", "Base X Small": "Basic Kibble",
    "Dedicated Storage": "Tek Dedicated Storage",
}


def display_name(blueprint: str) -> str:
    s = (blueprint or "").strip()
    if s.startswith("Blueprint'") and s.endswith("'"):
        s = s[len("Blueprint'"):-1]
    cls = (s.split(".")[-1] or s).split("/")[-1]
    if cls.endswith("_C"):
        cls = cls[:-2]
    if not cls:
        return ""
    out = cls
    for pat in _PREFIXES:
        if re.match(pat, out, re.I):
            out = re.sub(pat, "", out, flags=re.I)
            break
    for pat in _SUBPREFIXES:
        if re.match(pat, out, re.I):
            nxt = re.sub(pat, "", out, flags=re.I)
            if len(nxt) >= 2:
                out = nxt
            break
    out = re.sub(r"([a-z])([A-Z])", r"\1 \2", out)
    out = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", out)
    out = re.sub(r"\s+", " ", out.replace("_", " ")).strip()
    return _NAME_OVERRIDES.get(out, out)


# -- Title derivation (port of frontend/src/utils/shopImage.ts) --------------

_TITLE_TAGS = ["[BOSS]", "[BP]", "[KIT]"]
_BUNDLE_SUFFIXES = [" Taming Kit", " Boss Pack", " Arena", " Kit", " Pack", " Set"]


def strip_tags(title: str) -> str:
    out = title.strip()
    for tag in _TITLE_TAGS:
        if out.upper().startswith(tag):
            out = out[len(tag):].strip()
    return out


def title_candidates(label: str) -> list[str]:
    """Every wiki page name the title itself could stand for."""
    base = strip_tags(label)
    out: list[str] = []

    def push(value: str) -> None:
        v = value.strip()
        if v and v not in out:
            out.append(v)

    bases = [base]
    if "/" in base:
        bases.append(base.split("/")[0])
    for b in bases:
        push(b)
        for suffix in _BUNDLE_SUFFIXES:
            if b.lower().endswith(suffix.lower()):
                push(b[:-len(suffix)])
    return out


def candidates(key: str, label: str, lines: list, blueprint: str) -> list[str]:
    """
    Wiki file names to try, best first.

    A boss entry leads with its own title: the picture that belongs on a
    "[BOSS] Dragon" tile is the dragon, not the first artifact needed to
    summon it.  Everything else leads with the item it actually contains.
    """
    if key in WIKI_IMAGE:
        return [WIKI_IMAGE[key]]

    names: list[str] = []
    if key in WIKI_PAGE:
        names.append(WIKI_PAGE[key] + ".png")

    titles = [t + ".png" for t in title_candidates(label)]
    items: list[str] = []
    if lines and isinstance(lines[0], dict):
        items.append(display_name(str(lines[0].get("Blueprint", ""))) + ".png")
    if blueprint:
        items.append(display_name(blueprint) + ".png")

    is_boss = label.strip().upper().startswith("[BOSS]")
    names.extend(titles + items if is_boss else items + titles)

    seen: set[str] = set()
    return [n for n in names if n and n != ".png" and not (n in seen or seen.add(n))]


# -- Fetch -------------------------------------------------------------------

def fetch(name: str) -> bytes | None:
    """
    GET one wiki file.  None means the wiki has no such image.

    A 429/5xx is retried with a widening pause rather than reported as a miss:
    mistaking throttling for "no image" is exactly the bug this script exists
    to retire.
    """
    url = WIKI + urllib.parse.quote(name)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*"})
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                ctype = resp.headers.get("content-type", "")
                if resp.status == 200 and ctype.startswith("image/"):
                    return resp.read()
                return None
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 429) or exc.code >= 500:
                time.sleep(DELAY_SECONDS * (attempt + 2))
                continue
            return None
        except Exception:
            time.sleep(DELAY_SECONDS * (attempt + 2))
    return None


def downscale(data: bytes, max_px: int) -> bytes:
    """
    Shrink an image to *max_px* on its long edge and re-encode it as PNG.

    Tiles render at 72 px (144 covers a 2x display), but the wiki serves
    full-resolution art: the arena photographs are ~280 KB each and the
    untouched catalogue came to 2.8 MB.  Requires Pillow; without it the
    original bytes are kept, which still works, just heavier.
    """
    try:
        import io
        from PIL import Image
    except ImportError:
        print("  (Pillow not installed -- keeping full-size images)", file=sys.stderr)
        return data
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = img.convert("RGBA")
            if max(img.size) > max_px:
                img.thumbnail((max_px, max_px), Image.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="PNG", optimize=True)
            return out.getvalue()
    except Exception as exc:                                       # noqa: BLE001
        print(f"  (resize failed: {exc} -- keeping original)", file=sys.stderr)
        return data


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description="Bake shop thumbnails into static assets.")
    ap.add_argument("--config", required=True,
                    help="Path to BasePlugin/ArkShop/config.json")
    ap.add_argument("--out", default=str(root / "frontend" / "public" / "shop-thumbs"),
                    help="Output directory (default: frontend/public/shop-thumbs)")
    ap.add_argument("--force", action="store_true",
                    help="Re-download entries that already have a file")
    ap.add_argument("--max-size", type=int, default=144,
                    help="Long-edge pixel cap for the stored image (0 = keep original)")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    shop = cfg.get("ShopItems", {})
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    entries = [
        (key, str(val.get("Title") or key), val.get("Items") or [],
         str(val.get("Blueprint") or ""))
        for key, val in shop.items()
        if str(val.get("Type", "")).lower() in ("item", "dino")
    ]
    print(f"{len(entries)} catalogue entries -> {out_dir}")

    unresolved: list[tuple[str, str, list[str]]] = []
    written = skipped = 0
    for key, label, lines, blueprint in sorted(entries):
        target = out_dir / f"{key}.png"
        if target.exists() and not args.force:
            skipped += 1
            continue
        tried = candidates(key, label, lines, blueprint)
        data = None
        hit = ""
        for name in tried:
            data = fetch(name)
            time.sleep(DELAY_SECONDS)
            if data:
                hit = name
                break
        if data:
            if args.max_size:
                data = downscale(data, args.max_size)
            target.write_bytes(data)
            written += 1
            print(f"  OK   {key:24s} {label:36s} <- {hit}  ({len(data) // 1024} KB)")
        else:
            unresolved.append((key, label, tried))
            print(f"  MISS {key:24s} {label:36s} tried {tried}")

    print(f"\nwritten {written}, already present {skipped}, unresolved {len(unresolved)}")
    if unresolved:
        print("\nAdd these to WIKI_PAGE / WIKI_IMAGE and re-run:")
        for key, label, tried in unresolved:
            print(f'    "{key}": "",   # {label} -- tried {tried}')
    return 0


if __name__ == "__main__":
    sys.exit(main())
