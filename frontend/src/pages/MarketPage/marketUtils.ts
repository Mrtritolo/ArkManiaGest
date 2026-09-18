/**
 * marketUtils.ts -- pure helpers shared by the Market shell, its tabs and cards.
 *
 * Nothing here renders: keeping the error mapping and the category order out
 * of the components is what lets the tabs be split without duplicating them.
 */

/**
 * Order the catalogue categories are read in.
 *
 * The slugs are written by the ArkShop import (SHOP_CATEGORIES in
 * web_shop.py); only the reading order lives here -- first what you buy to do
 * something (boss, gear, dino), then what you buy to own it. "other" always
 * closes the list: it is the signal that a new catalogue entry is waiting for
 * a category.
 */
export const SHOP_CATEGORY_ORDER = [
  "boss", "armor", "dino", "resources", "tools", "structures", "other",
];

/** Listings fetched per Browse page (GET /market/listed caps limit at 200). */
export const LISTED_PAGE = 100;

export type TabKey =
  | "browse" | "mine" | "history"
  | "shop" | "genes" | "forge" | "orders" | "prices";

/** The `t` from `useTranslation()`, narrowed to what the helpers below need. */
export type TFunc = (key: string, opts?: Record<string, unknown>) => string;

/** Relative time through the shared time.* keys (same as PlayerDashboardPage). */
export function fmtRelative(iso: string | null, t: TFunc): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  let label: string;
  if (abs < 60_000)             label = t("time.underMinute");
  else if (abs < 3_600_000)     label = t("time.minutes", { n: Math.floor(abs / 60_000) });
  else if (abs < 86_400_000)    label = t("time.hours",   { n: Math.floor(abs / 3_600_000) });
  else if (abs < 86_400_000*30) label = t("time.days",    { n: Math.floor(abs / 86_400_000) });
  else return d.toLocaleDateString();
  return diff >= 0 ? t("time.ago", { v: label }) : t("time.in", { v: label });
}

/**
 * Error text for a market or shop call.  Both routers answer with stable
 * machine codes (INSUFFICIENT_FUNDS, SHOP_DISABLED, ...) that are translated
 * here; any other detail (e.g. "No Discord session.") is shown as-is.
 */
export function extractError(err: unknown, fallback: string, t: TFunc): string {
  const code = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof code === "string") {
    return /^[A-Z_]+$/.test(code)
      ? t(`market.errors.codes.${code}`, { defaultValue: code })
      : code;
  }
  return (err as { message?: string })?.message ?? fallback;
}

/** HTTP status of an axios failure, or null when there is no response. */
export function statusOf(err: unknown): number | null {
  return (err as { response?: { status?: number } })?.response?.status ?? null;
}

/**
 * Why the browse list could not be read.
 *
 * GET /market/listed answers 401 without a panel JWT or a Discord session and
 * 403 when the Discord account is not linked to an ARK character: both used to
 * surface as the generic "failed to load" line, which told the player nothing
 * about what to do next.
 */
export function listedError(err: unknown, t: TFunc): string {
  const status = statusOf(err);
  if (status === 401) return t("market.errors.notSignedIn");
  if (status === 403) return t("market.errors.notLinked");
  return extractError(err, t("market.errors.loadListed"), t);
}
