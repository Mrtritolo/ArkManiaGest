/**
 * arkItem.ts — helpers to derive a human-friendly item name + a
 * wiki image URL from an ARK blueprint path.
 *
 * Blueprint paths look like:
 *
 *   /Game/PrimalEarth/CoreBlueprints/Items/Resources/PrimalItemResource_Wood.PrimalItemResource_Wood
 *   /Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponPike.PrimalItem_WeaponPike
 *   /Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_RawMeat.PrimalItemConsumable_RawMeat
 *   /Game/PrimalEarth/CoreBlueprints/Items/Saddle/PrimalItemArmor_RexSaddle.PrimalItemArmor_RexSaddle
 *
 * Strategy:
 *   1. Take the class name after the last `.` (or the last segment).
 *   2. Strip every known `PrimalItem*_` prefix.
 *   3. Insert spaces before each capital letter ('RexSaddle' -> 'Rex Saddle').
 *   4. Special-case a handful of well-known oddities.
 *
 * For the image URL we use ARK Wiki's `Special:FilePath/<name>.png` --
 * a MediaWiki utility URL that 302-redirects to the real CDN image,
 * so browsers can use it as an `<img src=...>` directly.
 */

const _PREFIX_PATTERNS = [
  /^PrimalItemResource_/i,
  /^PrimalItemConsumable_/i,
  /^PrimalItemConsumableEatable_/i,
  /^PrimalItemConsumableEat_/i,
  /^PrimalItemArmor_/i,
  /^PrimalItemAmmo_/i,
  /^PrimalItemStructure_/i,
  /^PrimalItemDye_/i,
  /^PrimalItemSkin_/i,
  /^PrimalItemCostume_/i,
  /^PrimalItem_Weapon/i,    // becomes 'Pike' from 'PrimalItem_WeaponPike'
  /^PrimalItem_/i,          // generic fallback
];

/**
 * Manual overrides for blueprint names whose computed wiki name
 * doesn't match the actual ark.wiki.gg page name.  Keep this list
 * SHORT -- the algorithmic path covers ~95% of vanilla items.
 */
const _NAME_OVERRIDES: Record<string, string> = {
  // raw -> wiki page name
  "Raw Meat":       "Raw Meat",
  "Cooked Meat":    "Cooked Meat",
  "Wood":           "Wood",
  "Stone":          "Stone",
  "Thatch":         "Thatch",
  "Fiber":          "Fibers",                // wiki uses plural
  "Hide":           "Hide",
  "Cementing Paste":"Chitin or Keratin",     // approximation
  // add more as the operator reports broken images
};

/**
 * Extract the bare class name from a UE blueprint path.
 *
 * The C++ plugin uses ItemSerializer which captures the
 * `BlueprintGeneratedClass*->GetPathName()` in the form:
 *
 *   Blueprint'/Game/PrimalEarth/.../PrimalItemResource_Wood.PrimalItemResource_Wood'
 *
 * Some legacy code paths emit without the wrapper.  Both must be
 * accepted.
 *
 * Input  : Blueprint'/Game/.../PrimalItemResource_Wood.PrimalItemResource_Wood'
 * Output : PrimalItemResource_Wood
 */
function classNameFromBlueprint(bp: string): string {
  if (!bp) return "";
  // 1. Strip the optional Blueprint'...' wrapper
  let s = bp.trim();
  if (s.startsWith("Blueprint'") && s.endsWith("'")) {
    s = s.slice("Blueprint'".length, -1);
  }
  // 2. Take the class name after the last `.`
  const tail = s.split(".").pop() || s;
  // 3. Strip the `_C` Blueprint Class suffix when present
  const cls = tail.split("/").pop() || tail;
  return cls.endsWith("_C") ? cls.slice(0, -2) : cls;
}

/**
 * Strip every known PrimalItem* prefix from a class name.
 *
 * Input  : PrimalItemResource_Wood
 * Output : Wood
 */
function stripPrefix(className: string): string {
  let out = className;
  for (const pat of _PREFIX_PATTERNS) {
    if (pat.test(out)) {
      out = out.replace(pat, "");
      break;
    }
  }
  return out;
}

/**
 * Insert a space before every uppercase letter that follows a
 * lowercase letter ('RexSaddle' -> 'Rex Saddle').  Leaves single-word
 * lowercase names ('wood') unchanged.  Acronyms like 'GPS' stay
 * intact ('SmallGPS' -> 'Small GPS').
 */
function spaceCamelCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * After-prefix sub-prefixes that are categories rather than the item
 * itself: the wiki page is named after the part AFTER this fragment.
 *
 * Example: PrimalItemConsumable_Berry_Mejoberry
 *   step 1 strip 'PrimalItemConsumable_'  -> 'Berry_Mejoberry'
 *   step 2 strip 'Berry_'                 -> 'Mejoberry'   (wiki name)
 */
const _CATEGORY_SUBPREFIXES = [
  /^Berry_/i,
  /^Egg_/i,
  /^Kibble_/i,
  /^Soup_/i,
  /^Veggie_/i,
];

/**
 * Compute the human-friendly display name for an ARK item from its
 * blueprint path.  Returns the original blueprint when the path is
 * empty or doesn't look like an ARK item.
 */
export function arkItemDisplayName(blueprint: string): string {
  const cls = classNameFromBlueprint(blueprint);
  if (!cls) return blueprint || "?";
  let stripped = stripPrefix(cls);
  // Drill into categorical subprefixes (Berry_X -> X, Egg_X -> X, ...)
  for (const sub of _CATEGORY_SUBPREFIXES) {
    if (sub.test(stripped)) {
      const next = stripped.replace(sub, "");
      if (next.length >= 2) {
        stripped = next;
        break;
      }
    }
  }
  const spaced = spaceCamelCase(stripped);
  return _NAME_OVERRIDES[spaced] ?? spaced ?? cls;
}

/**
 * Build the same-origin URL for the cached PNG thumbnail of an ARK
 * item.  Returns null if we can't derive a usable name.
 *
 * The actual fetch is proxied through the panel backend
 * (``GET /api/v1/market/thumb/{name}``), which on first call grabs
 * the image from ark.wiki.gg's Special:FilePath redirect and writes
 * it to ``backend/data/market_thumbs/<name>.png`` on disk.  Every
 * subsequent request is served by the local cache with a 1-year
 * browser-cache header.
 *
 * Why proxy: keeps the panel's CSP locked to ``img-src 'self' data:
 * https://cdn.discordapp.com`` (no need to also whitelist
 * ark.wiki.gg), and shields us from any wiki-side URL drift.
 */
export function arkItemThumbUrl(blueprint: string): string | null {
  const name = arkItemDisplayName(blueprint);
  if (!name || name === "?") return null;
  return `/api/v1/market/thumb/${encodeURIComponent(name)}`;
}

/**
 * @deprecated Use arkItemThumbUrl instead -- same-origin cached.
 * Kept temporarily so any in-flight code that still imports this
 * compiles; will be removed in v3.6.0.
 */
export function arkWikiImageUrl(blueprint: string, size = 96): string | null {
  void size;
  return arkItemThumbUrl(blueprint);
}
