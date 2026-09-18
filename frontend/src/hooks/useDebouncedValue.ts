/**
 * useDebouncedValue -- the value, once it has stopped changing for `delayMs`.
 *
 * For server-side filters and typeahead queries. Keep a stale-response guard
 * in the fetching effect:
 *
 *     const q = useDebouncedValue(search)
 *     useEffect(() => {
 *       let alive = true
 *       api.search(q).then(r => { if (alive) setRows(r) })
 *       return () => { alive = false }
 *     }, [q])
 */
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
