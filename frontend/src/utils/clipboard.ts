/**
 * clipboard.ts — Best-effort clipboard write.
 *
 * Returns whether the copy succeeded; any toast/feedback stays at the
 * call site.
 */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
