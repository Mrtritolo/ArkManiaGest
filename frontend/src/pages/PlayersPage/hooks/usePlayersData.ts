/**
 * usePlayersData — the page's server state: list, stats, permission groups,
 * sync containers and the Discord link index.
 *
 * `loadPlayers` keeps the committed filter in a ref so a reload triggered by
 * a mutation uses the filter the table is showing, not the one captured in
 * the closure of the render that started the mutation. A request counter
 * makes sure only the most recent list response may write the table.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { discordApi, playersApi, type DiscordAccount, type SyncContainer } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { PermissionGroupItem, PlayerListItem, PlayersStats } from "../../../types";

interface Args {
  /** Page-level load error (rendered as an Alert with Retry). */
  setListError: (message: string) => void;
  t: TFunction;
}

export function usePlayersData({ setListError, t }: Args) {
  const [players, setPlayers] = useState<PlayerListItem[]>([]);
  const [stats, setStats] = useState<PlayersStats | null>(null);
  const [groups, setGroups] = useState<PermissionGroupItem[]>([]);
  // `loading` blanks the table on the very first load only; a refetch keeps
  // the rows visible and raises `refreshing` for the card-header spinner.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncContainers, setSyncContainers] = useState<SyncContainer[]>([]);
  const [discordByEos, setDiscordByEos] = useState<Map<string, DiscordAccount>>(new Map());

  const listFilterRef = useRef({ search: "", group: "" });
  const listReqRef = useRef(0);

  const loadPlayers = useCallback(
    async (s?: string, g?: string) => {
      if (s !== undefined) listFilterRef.current.search = s;
      if (g !== undefined) listFilterRef.current.group = g;
      const { search: qSearch, group: qGroup } = listFilterRef.current;
      const seq = ++listReqRef.current;
      setRefreshing(true);
      try {
        // Backend-side max (500): one batch covers small and medium
        // clusters, and the table says so when it is capped.
        const res = await playersApi.list({ search: qSearch || undefined, group: qGroup || undefined, limit: 500 });
        if (seq === listReqRef.current) {
          setPlayers(res.data);
          setListError("");
        }
      } catch (err) {
        if (seq === listReqRef.current) setListError(extractError(err, t("players.errors.load")));
      } finally {
        if (seq === listReqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [setListError, t],
  );

  const loadStats = useCallback(async () => {
    try {
      const res = await playersApi.stats();
      setStats(res.data);
    } catch {
      /* the KPI tiles simply stay on their last value */
    }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const res = await playersApi.permissionGroups();
      setGroups(res.data);
    } catch {
      /* permission chips fall back to an empty list */
    }
  }, []);

  const loadSyncContainers = useCallback(async () => {
    try {
      const res = await playersApi.syncContainers();
      setSyncContainers(res.data.containers || []);
    } catch {
      /* the sync panel shows its own empty state */
    }
  }, []);

  const loadDiscordLinks = useCallback(async () => {
    try {
      const res = await discordApi.accounts();
      const map = new Map<string, DiscordAccount>();
      for (const a of res.data) {
        if (a.eos_id) map.set(a.eos_id, a);
      }
      setDiscordByEos(map);
    } catch {
      // Non-admin operators get 403 here -- harmless: the chip simply
      // never renders.  We don't surface the error.
    }
  }, []);

  // Mount only: the search box and the group select call loadPlayers themselves.
  useEffect(() => {
    loadPlayers();
    loadGroups();
    loadStats();
    loadSyncContainers();
    loadDiscordLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    players,
    stats,
    groups,
    loading,
    refreshing,
    syncContainers,
    discordByEos,
    loadPlayers,
    loadStats,
    loadGroups,
    loadSyncContainers,
    loadDiscordLinks,
  };
}
