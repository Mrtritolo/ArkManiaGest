/**
 * usePending -- per-key in-flight tracking for row and card actions.
 *
 * Only the row being acted on shows loading, and a second `run` for a key that
 * is still pending is ignored (double-submit guard; it resolves to undefined).
 * Errors are not swallowed: `run` rejects like the task, so the caller keeps
 * its own try/catch and error toast.
 *
 *     const pending = usePending<number>()
 *     <IconButton loading={pending.isPending(row.id)} onClick={() =>
 *       pending.run(row.id, () => api.restart(row.id)).catch(showError)} … />
 */
import { useCallback, useRef, useState } from "react";

export interface Pending<K> {
  isPending(key: K): boolean;
  anyPending: boolean;
  run<T>(key: K, task: () => Promise<T>): Promise<T | undefined>;
}

export function usePending<K = string>(): Pending<K> {
  const [pending, setPending] = useState<ReadonlySet<K>>(() => new Set<K>());
  // Synchronous mirror: two clicks in the same tick must not both start.
  const inflight = useRef(new Set<K>());

  const run = useCallback(async <T,>(key: K, task: () => Promise<T>): Promise<T | undefined> => {
    if (inflight.current.has(key)) return undefined;
    inflight.current.add(key);
    setPending(prev => new Set(prev).add(key));
    try {
      return await task();
    } finally {
      inflight.current.delete(key);
      setPending(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const isPending = useCallback((key: K) => pending.has(key), [pending]);

  return { isPending, anyPending: pending.size > 0, run };
}
