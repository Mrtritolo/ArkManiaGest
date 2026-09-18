/**
 * useDashboard -- the single /me/dashboard read behind the player page.
 *
 * `version` counts successful loads. The grid is no longer unmounted on a
 * refresh (that threw the player back to the top of the page and reset every
 * card), so the cards that fetch their own data watch this instead.
 */
import { useCallback, useEffect, useState } from "react";
import { discordAuthApi, meApi, type DashboardResponse } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { TFunc } from "../dashboardFormat";

interface Args {
  onLogout?: () => void;
  t: TFunc;
}

export function useDashboard({ onLogout, t }: Args) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setErrorStatus(null);
    try {
      const res = await meApi.dashboard();
      setData(res.data);
      setVersion(v => v + 1);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? null;
      setErrorStatus(status);
      setError(extractError(err, t("dashboard.errors.load")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleLogout = useCallback(async () => {
    try { await discordAuthApi.logout(); } catch { /* best-effort */ }
    onLogout?.();
    window.location.href = "/";
  }, [onLogout]);

  return { data, loading, error, errorStatus, version, load, handleLogout };
}
