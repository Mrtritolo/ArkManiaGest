/**
 * errors.ts — Shared API-error extraction.
 *
 * Pulls the FastAPI `detail` string out of an axios error, falling back to
 * the generic Error message, then to the caller-supplied fallback.
 */

export function extractError(err: unknown, fallback: string): string {
  const msg =
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    ?? (err as { message?: string })?.message
    ?? fallback;
  return typeof msg === "string" ? msg : fallback;
}
