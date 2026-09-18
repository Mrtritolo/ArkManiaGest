/** Join class names, skipping falsy parts. Internal to the UI kit. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
