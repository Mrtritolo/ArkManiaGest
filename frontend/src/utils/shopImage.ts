/**
 * shopImage.ts — which image a shop entry shows.
 *
 * There is one main rule: the image is a STATIC file in
 * `public/shop-thumbs/<ArkShop entry key>.png`, produced once by
 * `deploy/maintainer/fetch-shop-thumbs.py`. No wiki at runtime, no chain of
 * names to guess while the player is looking.
 *
 * The rules below remain only as a fallback for a new entry, added to the
 * catalogue after the script last ran:
 *
 *  1. `[BOSS] X` — the title names the boss, and the right image is the
 *     boss's, not that of the first tribute needed to summon it. The
 *     `[BOSS] ` convention already exists in the ArkShop catalogue titles.
 *  2. Bundle — the image of the FIRST item in the list. It is arbitrary
 *     (an armour set will show the boots) but always available, and it
 *     does not require guessing which piece represents the bundle.
 *  3. Single entry / dino — the image of its blueprint.
 *
 * The fallback also goes through the panel cache (`/market/thumb/...`),
 * not the wiki: the CSP stays `img-src 'self'` and a slug change on the
 * wiki side does not break dozens of cards at once.
 */
import { arkItemThumbUrl } from "./arkItem";
import type { WebShopItem } from "../services/api";

/** Prefix the catalogue uses to mark boss entries. */
const BOSS_PREFIX = "[BOSS]";

/** Title prefixes that are not part of the name to look up on the wiki. */
const TITLE_TAGS = [BOSS_PREFIX, "[BP]", "[KIT]"];

function stripTags(title: string): string {
  let out = title.trim();
  for (const tag of TITLE_TAGS)
    if (out.toUpperCase().startsWith(tag)) out = out.slice(tag.length).trim();
  return out;
}

/**
 * Suffixes that mark a BUNDLE, not the item: the wiki has "Manticore",
 * not "Manticore Arena"; "Rhyniognatha", not "Rhyniognatha Kit".
 */
const BUNDLE_SUFFIXES = [
  " Taming Kit", " Boss Pack", " Arena", " Kit", " Pack", " Set",
];

/**
 * Title variants to try when the full title is not a wiki page. Two rules,
 * both seen in the real catalogue:
 *
 *  - `A / B` — the title lists the boss of two maps ("Broodmother
 *    Lysrix / Natrix"): the wiki has one page for each, not for the pair.
 *    The first one is tried.
 *  - bundle suffix — "Manticore Arena" -> "Manticore".
 *
 * Variants compose: "Megapithecus / Thodes" -> "Megapithecus".
 */
function labelVariants(label: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim();
    if (v && v !== label && !out.includes(v)) out.push(v);
  };

  const bases = [label];
  if (label.includes("/")) bases.push(label.split("/")[0]);

  for (const base of bases) {
    push(base);
    for (const suffix of BUNDLE_SUFFIXES)
      if (base.toLowerCase().endsWith(suffix.toLowerCase()))
        push(base.slice(0, -suffix.length));
  }
  return out;
}

/** True when the entry is a boss kit. */
export function isBossEntry(entry: { label: string }): boolean {
  return entry.label.trim().toUpperCase().startsWith(BOSS_PREFIX);
}

/**
 * Image candidates for a catalogue entry, in order of preference.
 *
 * The first candidate is the STATIC image, downloaded from the wiki once by
 * `deploy/maintainer/fetch-shop-thumbs.py` and served from
 * `frontend/public/shop-thumbs/<key>.png`. It must always win: the runtime
 * chain that came before got the name wrong for a dozen entries, and for all
 * the others fired ~50 parallel requests at the wiki, which answered 429 and
 * left half the storefront without images.
 *
 * The rest of the chain stays as a safety net for an entry added to the
 * catalogue after the script last ran: each failed candidate triggers the
 * next one via <img onError>. Order: boss name, first item of the bundle,
 * the entry's blueprint, the label as is (many catalogue entries use the
 * exact wiki name as their title).
 */
export function shopEntryThumbCandidates(entry: WebShopItem): string[] {
  const urls: (string | null)[] = [];
  if (entry.key) urls.push(`/shop-thumbs/${encodeURIComponent(entry.key)}.png`);
  if (isBossEntry(entry)) {
    const name = stripTags(entry.label);
    if (name) urls.push(`/api/v1/market/thumb/${encodeURIComponent(name)}`);
  }
  const first = entry.lines?.[0]?.blueprint;
  if (first) urls.push(arkItemThumbUrl(first));
  if (entry.blueprint) urls.push(arkItemThumbUrl(entry.blueprint));
  const label = stripTags(entry.label);
  if (label) {
    urls.push(`/api/v1/market/thumb/${encodeURIComponent(label)}`);
    for (const v of labelVariants(label))
      urls.push(`/api/v1/market/thumb/${encodeURIComponent(v)}`);
  }
  return [...new Set(urls.filter((u): u is string => !!u))];
}
