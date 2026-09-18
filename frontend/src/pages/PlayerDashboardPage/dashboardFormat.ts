/**
 * dashboardFormat.ts -- the value formatting of the player dashboard.
 *
 * Plain functions, not hooks: they are called from render bodies, so `t` is a
 * parameter. The units and the "ago"/"in" framing used to be hardcoded
 * Italian, which an EN player saw untranslated.
 */
import { gpsOf, type MapCalib } from "../../utils/mapCalibration";

/** The `t` from `useTranslation()`, narrowed to what the helpers need. */
export type TFunc = (key: string, opts?: Record<string, unknown>) => string;

export function avatarUrl(userId: string, hash: string | null): string | null {
  if (!hash) return null;
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=128`;
}

/**
 * Bidirectional relative time:
 *   * past   -> "2h ago", "3d ago", "< 1m ago"
 *   * future -> "in 2h", "in 3d"
 *
 * The one-way version returned "now" for every future timestamp (diff was
 * negative and below 60_000), so a VIP expiring in 12 days read "expires now".
 */
export function fmtRelative(iso: string | null, t: TFunc): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const abs  = Math.abs(diff);
  let label: string;
  if (abs < 60_000)             label = t("time.underMinute");
  else if (abs < 3_600_000)     label = t("time.minutes", { n: Math.floor(abs / 60_000) });
  else if (abs < 86_400_000)    label = t("time.hours",   { n: Math.floor(abs / 3_600_000) });
  else if (abs < 86_400_000*30) label = t("time.days",    { n: Math.floor(abs / 86_400_000) });
  else return d.toLocaleDateString();
  return diff >= 0 ? t("time.ago", { v: label }) : t("time.in", { v: label });
}

/** Humanise minutes (login duration) into "Xh YYm" / "Mm". */
export function fmtMinutes(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min - h * 60;
  return `${h}h ${m}m`;
}

/** Humanise hours into "Xd Yh" / "Yh" / "< 1h" / "expired Xh ago". */
export function fmtCountdown(hours: number | null, t: TFunc): string {
  if (hours === null) return "—";
  const abs  = Math.abs(hours);
  const days = Math.floor(abs / 24);
  const rest = abs - days * 24;
  const span = days > 0
    ? t("time.dayHour", { d: days, h: rest })
    : (abs < 1 ? t("time.underHour") : t("time.hours", { n: rest }));
  return hours < 0 ? t("dashboard.decay.expiredSince", { v: span }) : span;
}

/**
 * A home's position the way the player reads it in game: GPS lat/lon.
 *
 * Falls back to raw world units when the map has no calibration at all --
 * a wrong GPS pair is worse than an honest UU pair, because the player
 * would fly to it.
 */
export function fmtHomePos(
  home: { x: number | null; y: number | null },
  calib: MapCalib | null,
  t: TFunc,
): string {
  if (home.x === null || home.y === null) return "—";
  if (!calib) return t("dashboard.homes.rawUnits", { x: Math.round(home.x), y: Math.round(home.y) });
  const g = gpsOf(calib, home.x, home.y);
  return t("dashboard.homes.gps", { lat: g.lat.toFixed(1), lon: g.lon.toFixed(1) });
}
