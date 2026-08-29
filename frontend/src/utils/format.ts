/**
 * format.ts — Shared date-formatting helpers.
 *
 * One export per distinct output format used across pages; the per-site
 * fallback text ("—", "--", localized "never", …) is passed by the caller.
 * Non-parsable input renders the raw string (truncated for the compact
 * variants, matching the original per-page implementations).
 */

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** dd/MM/yyyy (date only). */
export function fmtDate(iso: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const d = parse(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** dd/MM/yyyy HH:mm. */
export function fmtDateTime(iso: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const d = parse(iso);
  if (!d) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** dd/MM HH:mm — compact, no year. */
export function fmtShortDateTime(iso: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const d = parse(iso);
  if (!d) return iso.slice(0, 16);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** dd/MM/yy HH:mm — compact with two-digit year. */
export function fmtCompactDateTime(iso: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const d = parse(iso);
  if (!d) return iso.slice(0, 16);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Locale-default date+time (`new Date(x).toLocaleString()`). */
export function fmtLocaleDateTime(iso: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const d = parse(iso);
  if (!d) return iso;
  return d.toLocaleString(undefined);
}
