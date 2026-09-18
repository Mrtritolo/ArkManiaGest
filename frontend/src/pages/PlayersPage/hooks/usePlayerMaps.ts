/**
 * usePlayerMaps — "where does this character exist" search and the
 * cross-container character copy.
 *
 * Both calls capture the player id they started for and re-check
 * `shownPlayerRef` before touching panel state, so a slow SSH scan for player
 * A never writes into the panel after the operator moved to B.
 */
import { useCallback, useState, type MutableRefObject } from "react";
import type { TFunction } from "i18next";
import { playersApi, type SyncContainer } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { ToastApi } from "../../../components/ui";
import type { PlayerFull, PlayerMapResult } from "../../../types";
import { containerKey } from "../playersUtils";

interface Args {
  selectedPlayer: PlayerFull | null;
  shownPlayerRef: MutableRefObject<number | null>;
  syncContainers: SyncContainer[];
  toast: ToastApi;
  t: TFunction;
}

export function usePlayerMaps({ selectedPlayer, shownPlayerRef, syncContainers, toast, t }: Args) {
  const [playerMaps, setPlayerMaps] = useState<PlayerMapResult[]>([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapsSearched, setMapsSearched] = useState(false);
  const [mapsErrors, setMapsErrors] = useState<string[]>([]);
  const [mapsDebug, setMapsDebug] = useState<Record<string, unknown>[]>([]);
  const [copying, setCopying] = useState(false);
  const [copySource, setCopySource] = useState<PlayerMapResult | null>(null);
  const [copyDestContainer, setCopyDestContainer] = useState("");
  const [copyDestMap, setCopyDestMap] = useState("");

  /** Called by openDetail before a new player is swapped into the panel. */
  const reset = useCallback(() => {
    setPlayerMaps([]);
    setMapsSearched(false);
    setMapsErrors([]);
    setCopySource(null);
    setCopyDestContainer("");
    setCopyDestMap("");
  }, []);

  async function handleFindMaps() {
    if (!selectedPlayer) return;
    const id = selectedPlayer.id;
    setMapsLoading(true);
    setMapsErrors([]);
    setMapsSearched(false);
    setMapsDebug([]);
    try {
      const res = await playersApi.findPlayerMaps(selectedPlayer.eos_id);
      if (shownPlayerRef.current !== id) return;
      setPlayerMaps(res.data.maps || []);
      setMapsErrors(res.data.errors || []);
      setMapsDebug(res.data.debug || []);
      setMapsSearched(true);
    } catch (err) {
      if (shownPlayerRef.current === id) toast.error(extractError(err, t("players.errors.mapSearch")));
    } finally {
      setMapsLoading(false);
    }
  }

  /** Maps offered for a destination container (its own map, if it has one). */
  function getDestMaps(key: string): string[] {
    const c = syncContainers.find(sc => containerKey(sc) === key);
    if (!c) return [];
    return c.map_name ? [c.map_name] : [];
  }

  async function handleCopyCharacter() {
    if (!selectedPlayer || !copySource || !copyDestContainer || !copyDestMap) return;
    const id = selectedPlayer.id;
    setCopying(true);
    const destC = syncContainers.find(c => containerKey(c) === copyDestContainer);
    if (!destC) {
      toast.error(t("players.errors.destContainerNotFound"));
      setCopying(false);
      return;
    }
    try {
      const res = await playersApi.copyCharacter({
        source_machine_id: copySource.machine_id,
        source_container: copySource.container_name,
        source_profile_path: copySource.profile_path,
        dest_machine_id: destC.machine_id,
        dest_container: destC.container_name,
        dest_map_name: copyDestMap,
      });
      if (res.data.success) {
        toast.success(
          res.data.overwritten
            ? t("players.copy.successOverwritten", { map: copyDestMap })
            : t("players.copy.success", { map: copyDestMap }),
        );
        if (shownPlayerRef.current === id) {
          setCopySource(null);
          setCopyDestContainer("");
          setCopyDestMap("");
          handleFindMaps(); // Reload maps
        }
      }
    } catch (err) {
      toast.error(extractError(err, t("players.errors.copyCharacter")));
    } finally {
      setCopying(false);
    }
  }

  return {
    playerMaps,
    mapsLoading,
    mapsSearched,
    mapsErrors,
    mapsDebug,
    copying,
    copySource,
    setCopySource,
    copyDestContainer,
    setCopyDestContainer,
    copyDestMap,
    setCopyDestMap,
    reset,
    handleFindMaps,
    handleCopyCharacter,
    getDestMaps,
  };
}

export type PlayerMaps = ReturnType<typeof usePlayerMaps>;
