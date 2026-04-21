"""
ASA INI parser / writer for ARK: Survival Ascended server configuration files.

Handles:
  - Standard INI sections ([SectionName])
  - Duplicate keys (ConfigOverrideItemMaxQuantity, ConfigOverrideSupplyCrateItems, …)
  - Line comments (;…) and metadata preservation
  - Order and whitespace preservation
  - Dynamic mod sections
  - Faithful round-trip writing (Key=Value, no spaces around ``=``)

Public API
----------
  parse_ini(content)           → IniFile
  write_ini(ini)               → str
  apply_changes(ini, changes)  → IniFile

  get_setting_definitions()    → dict   (groups for the frontend)
  get_current_values(gus, game)→ dict   (current values per group/key)
  get_all_overrides(game_ini)  → dict   (parsed ConfigOverride* entries)

  parse_stack_override(value)  → dict | None
  build_stack_override(item)   → str
  parse_supply_crate_override  → dict | None
  parse_crafting_override      → dict | None
  build_crafting_override      → str
  parse_npc_replacement        → dict | None
  build_npc_replacement        → str
  parse_spawn_entry            → dict | None
"""
from __future__ import annotations

import re
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

# ── Key sets ───────────────────────────────────────────────────────────────────

# INI keys that may appear more than once in the same section
REPEATABLE_KEYS: frozenset[str] = frozenset({
    "ConfigOverrideItemMaxQuantity",
    "ConfigOverrideSupplyCrateItems",
    "ConfigOverrideItemCraftingCosts",
    "ConfigAddNPCSpawnEntriesContainer",
    "ConfigOverrideNPCSpawnEntriesContainer",
    "ConfigSubtractNPCSpawnEntriesContainer",
    "NPCReplacements",
    "OverrideEngramEntries",
    "OverrideNamedEngramEntries",
    "OverridePlayerLevelEngramPoints",
    "DinoSpawnWeightMultipliers",
    "DinoClassDamageMultipliers",
    "DinoClassResistanceMultipliers",
    "HarvestResourceItemAmountClassMultipliers",
    "EngramEntryAutoUnlocks",
    "ManagedKeys",
    "LastJoinedSessionPerCategory",
    "CinematicForNoteShouldReset",
    "agreedToTerms",
    "CameraZoomPerDinoNameTag",
    "CameraHeightPerDinoNameTag",
    "PhotomodePresets_Camera",
    "PhotomodePresets_Movement",
    "PhotomodePresets_Splines",
    "PhotomodePresets_PPs",
    "PhotomodePresets_Targeting",
})

# Sections that should never be edited by admins (client-only or tool metadata)
READONLY_SECTIONS: frozenset[str] = frozenset({
    "/Script/ShooterGame.ShooterGameUserSettings",
    "ScalabilityGroups",
    "/Script/Engine.GameUserSettings",
    "Startup",
    "Beacon",
})

# Sections relevant to the server config editor
_SERVER_SECTIONS_GUS: frozenset[str] = frozenset({
    "ServerSettings",
    "SessionSettings",
    "MessageOfTheDay",
    "/Script/Engine.GameSession",
    "MultiHome",
    "Ragnarok",
})

_SERVER_SECTIONS_GAME: frozenset[str] = frozenset({
    "/script/shootergame.shootergamemode",
    "/Script/ShooterGame.ShooterGameMode",
})

# Keys that have dedicated GUI editors (not shown in the generic text area)
OVERRIDE_KEYS: frozenset[str] = frozenset({
    "ConfigOverrideItemMaxQuantity",
    "ConfigOverrideSupplyCrateItems",
    "ConfigOverrideItemCraftingCosts",
    "ConfigAddNPCSpawnEntriesContainer",
    "ConfigOverrideNPCSpawnEntriesContainer",
    "ConfigSubtractNPCSpawnEntriesContainer",
    "NPCReplacements",
})


# ── Data structures ────────────────────────────────────────────────────────────

@dataclass
class IniEntry:
    """
    A single parsed line in an INI file.

    At most one of ``is_comment`` and ``is_blank`` should be True.
    For normal key=value lines both are False.
    """
    key:        str
    value:      str
    comment:    str = ""
    is_comment: bool = False
    is_blank:   bool = False
    raw_line:   str = ""


@dataclass
class IniSection:
    """
    A named section within an INI file (e.g. ``[ServerSettings]``).

    Entries preserve the original order including blank lines and comments.
    """
    name:        str
    entries:     list[IniEntry] = field(default_factory=list)
    is_readonly: bool = False

    # -- Read helpers ----------------------------------------------------------

    def get(self, key: str, default: str = "") -> str:
        """Return the first value for *key*, or *default* if not found."""
        for e in self.entries:
            if not e.is_comment and not e.is_blank and e.key == key:
                return e.value
        return default

    def get_all(self, key: str) -> list[str]:
        """Return all values for a repeatable *key*."""
        return [
            e.value for e in self.entries
            if not e.is_comment and not e.is_blank and e.key == key
        ]

    # -- Write helpers ---------------------------------------------------------

    def set(self, key: str, value: str) -> None:
        """Update the first occurrence of *key*, or append a new entry."""
        for e in self.entries:
            if not e.is_comment and not e.is_blank and e.key == key:
                e.value = str(value)
                return
        self.entries.append(IniEntry(key=key, value=str(value)))

    def remove(self, key: str) -> None:
        """Remove all entries with the given *key*."""
        self.entries = [
            e for e in self.entries
            if e.is_comment or e.is_blank or e.key != key
        ]

    def set_all(self, key: str, values: list[str]) -> None:
        """Replace all occurrences of *key* with the supplied *values* list."""
        self.remove(key)
        for v in values:
            self.entries.append(IniEntry(key=key, value=str(v)))

    # -- Export ----------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """
        Return a plain dict representation of this section.

        Repeatable keys produce list values; all other keys produce strings.
        """
        result: dict[str, Any] = {}
        for e in self.entries:
            if e.is_comment or e.is_blank:
                continue
            if e.key in REPEATABLE_KEYS:
                result.setdefault(e.key, []).append(e.value)
            else:
                result[e.key] = e.value
        return result


@dataclass
class IniFile:
    """
    Complete in-memory representation of an ARK INI file.

    Preserves section order and preamble (lines before the first section).
    """
    sections: OrderedDict[str, IniSection] = field(default_factory=OrderedDict)
    preamble: list[str] = field(default_factory=list)

    def get_section(self, name: str) -> IniSection | None:
        """
        Find a section by name (case-insensitive fallback).

        Returns None if the section does not exist.
        """
        if name in self.sections:
            return self.sections[name]
        name_lower = name.lower()
        for k, v in self.sections.items():
            if k.lower() == name_lower:
                return v
        return None

    def ensure_section(self, name: str) -> IniSection:
        """
        Return the named section, creating it if it does not exist.
        """
        s = self.get_section(name)
        if s is None:
            s = IniSection(name=name, is_readonly=name in READONLY_SECTIONS)
            self.sections[name] = s
        return s

    def to_dict(self) -> dict[str, Any]:
        """Return all sections as a nested dict."""
        return {name: section.to_dict() for name, section in self.sections.items()}

    def server_sections(self) -> dict[str, dict]:
        """Return only non-readonly sections."""
        return {
            name: section.to_dict()
            for name, section in self.sections.items()
            if not section.is_readonly
        }

    def mod_sections(self) -> dict[str, dict]:
        """
        Return sections that are neither standard ASA sections nor readonly.

        These are typically added by mods and are shown in the "Mod Settings"
        tab of the config editor.
        """
        standard = _SERVER_SECTIONS_GUS | _SERVER_SECTIONS_GAME | READONLY_SECTIONS
        return {
            name: section.to_dict()
            for name, section in self.sections.items()
            if not section.is_readonly
            and not any(s.lower() == name.lower() for s in standard)
        }


# ── Parser ─────────────────────────────────────────────────────────────────────

def parse_ini(content: str) -> IniFile:
    """
    Parse an ARK INI file string into an :class:`IniFile` object.

    Handles:
      - ``[SectionName]`` headers
      - ``Key=Value`` lines (no space around ``=``)
      - Comment lines starting with ``;`` or ``#``
      - Blank lines (preserved for round-trip fidelity)
      - Lines before the first section (preamble)

    Args:
        content: Raw INI file text.

    Returns:
        Populated :class:`IniFile`.
    """
    ini = IniFile()
    current_section: IniSection | None = None

    for raw_line in content.split("\n"):
        line    = raw_line.rstrip("\r")
        stripped = line.strip()

        # Blank line
        if not stripped:
            if current_section:
                current_section.entries.append(
                    IniEntry(key="", value="", is_blank=True, raw_line=line)
                )
            else:
                ini.preamble.append(line)
            continue

        # Comment line
        if stripped.startswith(";") or stripped.startswith("#"):
            if current_section:
                current_section.entries.append(
                    IniEntry(key="", value="", is_comment=True, comment=stripped, raw_line=line)
                )
            else:
                ini.preamble.append(line)
            continue

        # Section header
        section_match = re.match(r"^\[(.+)\]\s*$", stripped)
        if section_match:
            section_name = section_match.group(1)
            is_ro        = section_name in READONLY_SECTIONS
            current_section = IniSection(name=section_name, is_readonly=is_ro)
            ini.sections[section_name] = current_section
            continue

        # Key=Value pair
        eq_pos = stripped.find("=")
        if eq_pos > 0 and current_section:
            key   = stripped[:eq_pos]
            value = stripped[eq_pos + 1:]
            current_section.entries.append(
                IniEntry(key=key, value=value, raw_line=line)
            )
        elif current_section:
            # Unrecognised line inside a section — treat as comment
            current_section.entries.append(
                IniEntry(key="", value="", is_comment=True, comment=stripped, raw_line=line)
            )
        else:
            ini.preamble.append(line)

    return ini


# ── Writer ─────────────────────────────────────────────────────────────────────

def write_ini(ini: IniFile) -> str:
    """
    Serialise an :class:`IniFile` back to a string in ASA INI format.

    Rules:
      - ``Key=Value`` with no spaces around ``=``
      - Sections separated by a single blank line
      - The file always ends with a newline

    Args:
        ini: The :class:`IniFile` to serialise.

    Returns:
        INI file content as a string.
    """
    lines: list[str] = list(ini.preamble)

    first_section = True
    for name, section in ini.sections.items():
        if not first_section:
            lines.append("")
        first_section = False
        lines.append(f"[{name}]")

        for entry in section.entries:
            if entry.is_blank:
                lines.append("")
            elif entry.is_comment:
                lines.append(entry.comment or entry.raw_line)
            else:
                lines.append(f"{entry.key}={entry.value}")

    result = "\n".join(lines)
    if not result.endswith("\n"):
        result += "\n"
    return result


# ── Mutation helper ────────────────────────────────────────────────────────────

def apply_changes(ini: IniFile, changes: dict[str, dict[str, Any]]) -> IniFile:
    """
    Apply a nested dict of changes to an :class:`IniFile` in place.

    The *changes* dict maps section names to key/value dicts.  The special
    key ``"__delete__"`` may contain a list of key names to remove from that
    section.

    Readonly sections are silently skipped.  List values are written via
    :meth:`IniSection.set_all`; scalar values via :meth:`IniSection.set`.

    Args:
        ini:     The file to modify.
        changes: Dict of {section_name: {key: value, …}}.

    Returns:
        The same :class:`IniFile` object (mutated in place).
    """
    for section_name, section_changes in changes.items():
        section = ini.ensure_section(section_name)
        if section.is_readonly:
            continue

        to_delete = section_changes.pop("__delete__", [])
        if isinstance(to_delete, list):
            for key in to_delete:
                section.remove(key)

        for key, value in section_changes.items():
            if isinstance(value, list):
                section.set_all(key, [str(v) for v in value])
            else:
                section.set(key, str(value))

    return ini


# ── Override parsers / builders ────────────────────────────────────────────────

def parse_stack_override(value: str) -> dict | None:
    """
    Parse a ``ConfigOverrideItemMaxQuantity`` value.

    Expected format::

        (ItemClassString="...",Quantity=(MaxItemQuantity=N,bIgnoreMultiplier=true))

    Returns:
        Dict with ``class``, ``max_quantity``, ``ignore_multiplier``, or None.
    """
    m = re.match(
        r'\(ItemClassString="([^"]+)",\s*Quantity=\('
        r'MaxItemQuantity=(\d+),\s*bIgnoreMultiplier=(true|false)\)\)',
        value, re.IGNORECASE,
    )
    if m:
        return {
            "class":             m.group(1),
            "max_quantity":      int(m.group(2)),
            "ignore_multiplier": m.group(3).lower() == "true",
        }
    return None


def build_stack_override(item: dict) -> str:
    """Build a ``ConfigOverrideItemMaxQuantity`` line from a dict."""
    ignore = "true" if item.get("ignore_multiplier", True) else "false"
    return (
        f'(ItemClassString="{item["class"]}",'
        f'Quantity=(MaxItemQuantity={item["max_quantity"]},'
        f'bIgnoreMultiplier={ignore}))'
    )


def parse_supply_crate_override(value: str) -> dict | None:
    """
    Parse a ``ConfigOverrideSupplyCrateItems`` value.

    Returns a summary dict with the crate class, set/entry counts, and the
    raw line preserved for lossless round-tripping.
    """
    m = re.match(r'\(SupplyCrateClassString="([^"]+)"', value)
    if not m:
        return None

    result: dict = {"crate_class": m.group(1), "raw": value}

    for field_name in ("MinItemSets", "MaxItemSets", "NumItemSetsPower"):
        fm = re.search(rf"{field_name}=([\d.]+)", value)
        if fm:
            v = fm.group(1)
            result[field_name.lower()] = float(v) if "." in v else int(v)

    bsets = re.search(r"bSetsRandomWithoutReplacement=(True|False|true|false)", value)
    if bsets:
        result["sets_random"] = bsets.group(1).lower() == "true"

    result["item_sets_count"]    = value.count("SetName=")
    result["item_entries_count"] = value.count("EntryWeight=")
    return result


def build_supply_crate_override(data: dict) -> str:
    """Return the raw line for a supply-crate override entry."""
    return data.get("raw", "")


def parse_crafting_override(value: str) -> dict | None:
    """
    Parse a ``ConfigOverrideItemCraftingCosts`` value.

    Returns a dict with the item class, resource list, and the raw line.
    """
    m = re.match(
        r'\(ItemClassString="([^"]+)",\s*BaseCraftingResourceRequirements=\((.+)\)\s*\)',
        value, re.IGNORECASE,
    )
    if not m:
        return None

    result: dict = {"item_class": m.group(1), "raw": value, "resources": []}

    for res_match in re.finditer(
        r'\(ResourceItemTypeString="([^"]+)",\s*'
        r'BaseResourceRequirement=([\d.]+),\s*'
        r'bCraftingRequireExactResourceType=(true|false)\)',
        m.group(2), re.IGNORECASE,
    ):
        result["resources"].append({
            "resource_class": res_match.group(1),
            "amount":         float(res_match.group(2)),
            "exact_type":     res_match.group(3).lower() == "true",
        })
    return result


def build_crafting_override(data: dict) -> str:
    """Build a ``ConfigOverrideItemCraftingCosts`` line from a dict."""
    if data.get("raw"):
        return data["raw"]
    resources = ",".join(
        f'(ResourceItemTypeString="{r["resource_class"]}",'
        f'BaseResourceRequirement={r["amount"]},'
        f'bCraftingRequireExactResourceType={"true" if r.get("exact_type") else "false"})'
        for r in data.get("resources", [])
    )
    return (
        f'(ItemClassString="{data["item_class"]}",'
        f'BaseCraftingResourceRequirements=({resources}))'
    )


def parse_npc_replacement(value: str) -> dict | None:
    """
    Parse an ``NPCReplacements`` value.

    Expected format::

        (FromClassName="...",ToClassName="...")
    """
    m = re.match(
        r'\(FromClassName="([^"]+)",\s*ToClassName="([^"]*)"\)',
        value, re.IGNORECASE,
    )
    if m:
        return {"from_class": m.group(1), "to_class": m.group(2)}
    return None


def build_npc_replacement(data: dict) -> str:
    """Build an ``NPCReplacements`` line from a dict."""
    return f'(FromClassName="{data["from_class"]}",ToClassName="{data["to_class"]}")'


def parse_spawn_entry(value: str) -> dict | None:
    """
    Parse a spawn-entries container value (Add/Override/Subtract).

    Returns a summary dict with the container class and entry count.
    The full raw value is preserved for lossless round-tripping.
    """
    m = re.match(r'\(NPCSpawnEntriesContainerClassString="([^"]+)"', value)
    if not m:
        return None
    return {
        "container_class": m.group(1),
        "raw":             value,
        "entries_count":   value.count("AnEntryName="),
    }


# ── Setting group definitions ──────────────────────────────────────────────────

# Each group maps to a set of settings shown in the frontend config editor.
# The metadata drives the control type (float slider, bool toggle, text, …).
SETTING_GROUPS: dict[str, dict] = {
    "general": {
        "label": "Generale", "icon": "Settings",
        "settings": {
            "SessionName":         {"type": "string",   "section": "SessionSettings",             "file": "gus"},
            "MaxPlayers":          {"type": "int",      "section": "/Script/Engine.GameSession",  "file": "gus", "default": 70, "min": 1, "max": 127},
            "ServerPassword":      {"type": "password", "section": "ServerSettings",              "file": "gus"},
            "ServerAdminPassword": {"type": "password", "section": "ServerSettings",              "file": "gus"},
            "Duration":            {"type": "int",      "section": "MessageOfTheDay",             "file": "gus", "default": 20, "min": 0},
            "Message":             {"type": "text",     "section": "MessageOfTheDay",             "file": "gus"},
        },
    },
    "rates": {
        "label": "Rates & Moltiplicatori", "icon": "TrendingUp",
        "settings": {
            "DifficultyOffset":                  {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0, "min": 0.1, "max": 10,  "step": 0.1},
            "OverrideOfficialDifficulty":        {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 0,   "min": 0,   "max": 15,  "step": 0.5},
            "XPMultiplier":                      {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0, "min": 0.01,"max": 100, "step": 0.5},
            "TamingSpeedMultiplier":             {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0, "min": 0.01,"max": 100, "step": 0.5},
            "HarvestAmountMultiplier":           {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0, "min": 0.01,"max": 100, "step": 0.5},
            "HarvestHealthMultiplier":           {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0, "min": 0.01,"max": 100, "step": 0.5},
            "ItemStackSizeMultiplier":           {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0, "min": 0.01,"max": 100, "step": 0.5},
            "PlayerHarvestingDamageMultiplier":  {"type": "float", "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 1.0, "min": 0.01,"max": 100, "step": 0.5},
            "DinoHarvestingDamageMultiplier":    {"type": "float", "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 3.2, "min": 0.01,"max": 100, "step": 0.5},
        },
    },
    "xp": {
        "label": "XP Dettaglio", "icon": "Star",
        "settings": {
            "CraftXPMultiplier":   {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 0.01, "max": 100, "step": 0.5},
            "GenericXPMultiplier": {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 0.01, "max": 100, "step": 0.5},
            "HarvestXPMultiplier": {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 0.01, "max": 100, "step": 0.5},
            "KillXPMultiplier":    {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 0.01, "max": 100, "step": 0.5},
            "SpecialXPMultiplier": {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 0.01, "max": 100, "step": 0.5},
        },
    },
    "day_night": {
        "label": "Giorno / Notte", "icon": "Sun",
        "settings": {
            "DayCycleSpeedScale":  {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0, "min": 0.01, "max": 10, "step": 0.1},
            "DayTimeSpeedScale":   {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0, "min": 0.01, "max": 10, "step": 0.1},
            "NightTimeSpeedScale": {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0, "min": 0.01, "max": 10, "step": 0.1},
        },
    },
    "combat": {
        "label": "Combattimento", "icon": "Swords",
        "settings": {
            "PlayerDamageMultiplier":      {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0},
            "PlayerResistanceMultiplier":  {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0},
            "DinoDamageMultiplier":        {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0},
            "DinoResistanceMultiplier":    {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0},
            "TamedDinoDamageMultiplier":   {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0},
            "TamedDinoResistanceMultiplier":{"type": "float","section": "ServerSettings", "file": "gus", "default": 1.0},
            "StructureDamageMultiplier":   {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0},
            "StructureResistanceMultiplier":{"type": "float","section": "ServerSettings", "file": "gus", "default": 1.0},
        },
    },
    "player": {
        "label": "Giocatore", "icon": "User",
        "settings": {
            "PlayerCharacterFoodDrainMultiplier":    {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "PlayerCharacterWaterDrainMultiplier":   {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "PlayerCharacterStaminaDrainMultiplier": {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "PlayerCharacterHealthRecoveryMultiplier":{"type":"float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "OxygenSwimSpeedStatMultiplier":         {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "MaxNumberOfPlayersInTribe":             {"type": "int",   "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 0, "min": 0},
        },
    },
    "dino": {
        "label": "Creature", "icon": "Bug",
        "settings": {
            "DinoCharacterFoodDrainMultiplier":       {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "DinoCharacterStaminaDrainMultiplier":    {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "DinoCharacterHealthRecoveryMultiplier":  {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "DinoCountMultiplier":                    {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "TamedDinoCharacterFoodDrainMultiplier":  {"type": "float", "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 1.0},
            "TamedDinoTorporDrainMultiplier":         {"type": "float", "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 1.0},
            "WildDinoCharacterFoodDrainMultiplier":   {"type": "float", "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 1.0},
            "WildDinoTorporDrainMultiplier":          {"type": "float", "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 1.0},
            "RaidDinoCharacterFoodDrainMultiplier":   {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "MaxPersonalTamedDinos":                  {"type": "int",   "section": "ServerSettings",                              "file": "gus",  "default": 0, "min": 0},
            "MaxTamedDinos":                          {"type": "int",   "section": "ServerSettings",                              "file": "gus",  "default": 5000, "min": 0},
            "DestroyTamesOverLevelClamp":             {"type": "int",   "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 0, "min": 0},
        },
    },
    "breeding": {
        "label": "Breeding & Imprinting", "icon": "Heart",
        "settings": {
            "BabyMatureSpeedMultiplier":                     {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 0.01, "max": 500},
            "BabyFoodConsumptionSpeedMultiplier":            {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0},
            "BabyImprintingStatScaleMultiplier":             {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0},
            "BabyImprintAmountMultiplier":                   {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0},
            "BabyCuddleIntervalMultiplier":                  {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 0.001, "step": 0.01},
            "BabyCuddleGracePeriodMultiplier":               {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0},
            "BabyCuddleLoseImprintQualitySpeedMultiplier":   {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0},
            "EggHatchSpeedMultiplier":                       {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 0.01, "max": 500},
            "MatingIntervalMultiplier":                      {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 0.001, "step": 0.01},
            "MatingSpeedMultiplier":                         {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0},
            "LayEggIntervalMultiplier":                      {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0},
            "PassiveTameIntervalMultiplier":                 {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0},
            "AllowAnyoneBabyImprintCuddle":                  {"type": "bool",  "section": "ServerSettings",                      "file": "gus",  "default": False},
            "DisableImprintDinoBuff":                        {"type": "bool",  "section": "ServerSettings",                      "file": "gus",  "default": False},
        },
    },
    "structures": {
        "label": "Strutture", "icon": "Building",
        "settings": {
            "TheMaxStructuresInRange":              {"type": "int",   "section": "ServerSettings", "file": "gus", "default": 10500},
            "PerPlatformMaxStructuresMultiplier":   {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0},
            "PlatformSaddleBuildAreaBoundsMultiplier":{"type":"float","section": "ServerSettings", "file": "gus", "default": 1.0},
            "StructurePickupHoldDuration":          {"type": "float", "section": "ServerSettings", "file": "gus", "default": 0.5, "step": 0.1},
            "StructurePickupTimeAfterPlacement":    {"type": "float", "section": "ServerSettings", "file": "gus", "default": 30},
            "AlwaysAllowStructurePickup":           {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "DisableStructureDecayPvE":             {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "EnableExtraStructurePreventionVolumes":{"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "OverrideStructurePlatformPrevention":  {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "StructurePreventResourceRadiusMultiplier":{"type":"float","section":"ServerSettings",  "file": "gus", "default": 1.0},
            "AutoSavePeriodMinutes":                {"type": "float", "section": "ServerSettings", "file": "gus", "default": 15, "min": 0},
            "StructureDamageRepairCooldown":        {"type": "int",   "section": "/script/shootergame.shootergamemode", "file": "game", "default": 180},
        },
    },
    "gameplay": {
        "label": "Regole di Gioco", "icon": "Gamepad2",
        "settings": {
            "ServerPVE":                    {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False, "label": "PvE Mode"},
            "ServerHardcore":               {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "ServerCrosshair":              {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": True},
            "AllowThirdPersonPlayer":       {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": True},
            "ShowMapPlayerLocation":        {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": True},
            "ShowFloatingDamageText":       {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "GlobalVoiceChat":              {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "ProximityChat":                {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "PreventSpawnAnimations":       {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "AllowFlyerCarryPvE":           {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "AllowCaveBuildingPvE":         {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "AllowRaidDinoFeeding":         {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "AdminLogging":                 {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "DisableWeatherFog":            {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "bAllowUnlimitedRespecs":       {"type": "bool",  "section": "/script/shootergame.shootergamemode",         "file": "game", "default": False},
            "bDisableFriendlyFire":         {"type": "bool",  "section": "/script/shootergame.shootergamemode",         "file": "game", "default": False},
            "bUseSingleplayerSettings":     {"type": "bool",  "section": "/script/shootergame.shootergamemode",         "file": "game", "default": False},
            "bAllowFlyerSpeedLeveling":     {"type": "bool",  "section": "/script/shootergame.shootergamemode",         "file": "game", "default": False},
            "bAllowSpeedLeveling":          {"type": "bool",  "section": "/script/shootergame.shootergamemode",         "file": "game", "default": False},
            "bShowCreativeMode":            {"type": "bool",  "section": "/script/shootergame.shootergamemode",         "file": "game", "default": False},
        },
    },
    "pvp_orp": {
        "label": "PvP & ORP", "icon": "ShieldAlert",
        "settings": {
            "PreventOfflinePvP":         {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "PreventOfflinePvPInterval": {"type": "int",   "section": "ServerSettings", "file": "gus", "default": 0},
            "PvPDinoDecay":              {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "PreventTribeAlliances":     {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "PreventDiseases":           {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "NonPermanentDiseases":      {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "PreventMateBoost":          {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "EnablePvPGamma":            {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
            "DisablePvEGamma":           {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": False},
        },
    },
    "cryopod": {
        "label": "Cryopod", "icon": "Snowflake",
        "settings": {
            "DisableCryopodEnemyCheck":         {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
            "DisableCryopodFridgeRequirement":  {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
            "AllowCryoFridgeOnSaddle":          {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
        },
    },
    "decay_spoil": {
        "label": "Decay & Spoilage", "icon": "Timer",
        "settings": {
            "DisableDinoDecayPvE":              {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "PvEDinoDecayPeriodMultiplier":     {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
            "ClampItemSpoilingTimes":           {"type": "bool",  "section": "ServerSettings",                              "file": "gus",  "default": False},
            "GlobalSpoilingTimeMultiplier":     {"type": "float", "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 1.0},
            "GlobalCorpseDecompositionTimeMultiplier":{"type":"float","section":"/script/shootergame.shootergamemode",      "file": "game", "default": 1.0},
            "GlobalItemDecompositionTimeMultiplier":  {"type":"float","section":"/script/shootergame.shootergamemode",      "file": "game", "default": 1.0},
            "CropDecaySpeedMultiplier":         {"type": "float", "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 1.0},
            "CropGrowthSpeedMultiplier":        {"type": "float", "section": "/script/shootergame.shootergamemode",         "file": "game", "default": 1.0},
            "ResourcesRespawnPeriodMultiplier": {"type": "float", "section": "ServerSettings",                              "file": "gus",  "default": 1.0},
        },
    },
    "turrets": {
        "label": "Torrette", "icon": "Crosshair",
        "settings": {
            "bLimitTurretsInRange": {"type": "bool", "section": "/script/shootergame.shootergamemode", "file": "game", "default": True},
            "LimitTurretsNum":      {"type": "int",  "section": "/script/shootergame.shootergamemode", "file": "game", "default": 100, "min": 0},
            "LimitTurretsRange":    {"type": "int",  "section": "/script/shootergame.shootergamemode", "file": "game", "default": 10000, "min": 0},
        },
    },
    "supply_loot": {
        "label": "Supply & Loot", "icon": "Gift",
        "settings": {
            "SupplyCrateLootQualityMultiplier": {"type": "float", "section": "/script/shootergame.shootergamemode", "file": "game", "default": 1.0, "min": 1.0, "max": 5.0},
            "RandomSupplyCratePoints":          {"type": "bool",  "section": "ServerSettings",                      "file": "gus",  "default": False},
            "PvEAllowStructuresAtSupplyDrops":  {"type": "bool",  "section": "ServerSettings",                      "file": "gus",  "default": False},
        },
    },
    "tribe_limits": {
        "label": "Tribe & Limiti", "icon": "Users",
        "settings": {
            "TribeNameChangeCooldown":                            {"type": "int", "section": "ServerSettings", "file": "gus", "default": 15},
            "KickIdlePlayersPeriod":                              {"type": "int", "section": "ServerSettings", "file": "gus", "default": 3600},
            "ImplantSuicideCD":                                   {"type": "int", "section": "ServerSettings", "file": "gus", "default": 28800},
            "MaxTamedDinos_SoftTameLimit":                        {"type": "int", "section": "ServerSettings", "file": "gus", "default": 5000},
            "MaxTamedDinos_SoftTameLimit_CountdownForDeletionDuration":{"type":"int","section":"ServerSettings","file": "gus", "default": 604800},
            "MaxTributeDinos":                                    {"type": "int", "section": "ServerSettings", "file": "gus", "default": 20},
            "MaxTributeItems":                                    {"type": "int", "section": "ServerSettings", "file": "gus", "default": 50},
            "DontAlwaysNotifyPlayerJoined":                       {"type": "bool","section": "ServerSettings", "file": "gus", "default": False},
        },
    },
    "transfer": {
        "label": "Transfer & Cluster", "icon": "ArrowLeftRight",
        "settings": {
            "PreventDownloadSurvivors":        {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
            "PreventDownloadItems":            {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
            "PreventDownloadDinos":            {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
            "PreventUploadSurvivors":          {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
            "PreventUploadItems":              {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
            "PreventUploadDinos":              {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
            "noTributeDownloads":              {"type": "bool", "section": "ServerSettings", "file": "gus", "default": False},
            "CrossARKAllowForeignDinoDownloads":{"type":"bool", "section": "ServerSettings", "file": "gus", "default": False},
        },
    },
    "bunkers": {
        "label": "Bunker", "icon": "Shield",
        "settings": {
            "LimitBunkersPerTribe":              {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": True},
            "LimitBunkersPerTribeNum":           {"type": "int",   "section": "ServerSettings", "file": "gus", "default": 3, "min": 0},
            "AllowRidingDinosInsideBunkers":     {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": True},
            "AllowDinoAIInsideBunkers":          {"type": "bool",  "section": "ServerSettings", "file": "gus", "default": True},
            "MinDistanceBetweenBunkers":         {"type": "float", "section": "ServerSettings", "file": "gus", "default": 3000},
            "EnemyAccessBunkerHPThreshold":      {"type": "float", "section": "ServerSettings", "file": "gus", "default": 0.25, "min": 0, "max": 1, "step": 0.05},
            "BunkerUnderHPThresholdDmgMultiplier":{"type":"float", "section": "ServerSettings", "file": "gus", "default": 0.05},
        },
    },
    "cryo_hospital": {
        "label": "Cryo Hospital", "icon": "Stethoscope",
        "settings": {
            "CryoHospitalHoursToRegenHP":          {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0},
            "CryoHospitalHoursToRegenFood":        {"type": "float", "section": "ServerSettings", "file": "gus", "default": 24.0},
            "CryoHospitalHoursToDrainTorpor":      {"type": "float", "section": "ServerSettings", "file": "gus", "default": 1.0},
            "CryoHospitalMatingCooldownReduction": {"type": "float", "section": "ServerSettings", "file": "gus", "default": 2.0},
        },
    },
}


# ── Public query API ───────────────────────────────────────────────────────────

def get_setting_definitions() -> dict:
    """Return the full :data:`SETTING_GROUPS` dict for the frontend."""
    return SETTING_GROUPS


def get_current_values(gus_ini: IniFile, game_ini: IniFile) -> dict:
    """
    Read the current INI values for every setting defined in :data:`SETTING_GROUPS`.

    Args:
        gus_ini:  Parsed GameUserSettings.ini.
        game_ini: Parsed Game.ini.

    Returns:
        Nested dict: ``{group_id: {key: raw_value_or_None}}``.
    """
    result: dict = {}
    for group_id, group in SETTING_GROUPS.items():
        group_values: dict = {}
        for key, meta in group["settings"].items():
            ini     = gus_ini if meta["file"] == "gus" else game_ini
            section = ini.get_section(meta["section"])
            raw     = section.get(key, "") if section else ""
            group_values[key] = raw if raw else None
        result[group_id] = group_values
    return result


def get_all_overrides(game_ini: IniFile) -> dict:
    """
    Extract all :data:`OVERRIDE_KEYS` entries from Game.ini as parsed structures.

    Each override is parsed into a dict; entries that cannot be parsed are
    preserved as ``{"raw": <original_line>}``.

    Args:
        game_ini: Parsed Game.ini :class:`IniFile`.

    Returns:
        Dict with keys ``stacks``, ``supply_crates``, ``crafting_costs``,
        ``npc_replacements``, and the three spawn-entry keys.
    """
    section = (
        game_ini.get_section("/script/shootergame.shootergamemode")
        or game_ini.get_section("/Script/ShooterGame.ShooterGameMode")
    )
    if not section:
        return {}

    def _parse_list(key: str, parser):
        return [
            (parser(raw) or {"raw": raw})
            for raw in section.get_all(key)
        ]

    result: dict = {
        "stacks":          _parse_list("ConfigOverrideItemMaxQuantity",   parse_stack_override),
        "supply_crates":   _parse_list("ConfigOverrideSupplyCrateItems",  parse_supply_crate_override),
        "crafting_costs":  _parse_list("ConfigOverrideItemCraftingCosts", parse_crafting_override),
        "npc_replacements":_parse_list("NPCReplacements",                 parse_npc_replacement),
    }

    for key in (
        "ConfigAddNPCSpawnEntriesContainer",
        "ConfigOverrideNPCSpawnEntriesContainer",
        "ConfigSubtractNPCSpawnEntriesContainer",
    ):
        result[key] = _parse_list(key, parse_spawn_entry)

    return result
