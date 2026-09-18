/**
 * MapsCopySection — "where is this character" scan and the cross-container
 * copy of the selected .arkprofile.
 *
 * NOTE: lucide-react also exports `Map`. It is imported as `MapIcon` here (and
 * everywhere this page uses `new Map()`), because a bare `Map` import shadows
 * the global constructor and crashes once minified.
 */
import { useTranslation } from "react-i18next";
import { Copy, Map as MapIcon, X } from "lucide-react";
import { Alert, Button, Field, Input, Select } from "../../../components/ui";
import type { SyncContainer } from "../../../services/api";
import type { PlayerMaps } from "../hooks/usePlayerMaps";
import { containerKey } from "../playersUtils";
import styles from "../PlayersPage.module.css";

export interface MapsCopySectionProps {
  canOperate: boolean;
  maps: PlayerMaps;
  syncContainers: SyncContainer[];
}

export function MapsCopySection({ canOperate, maps, syncContainers }: MapsCopySectionProps) {
  const { t } = useTranslation();
  const {
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
    handleFindMaps,
    handleCopyCharacter,
    getDestMaps,
  } = maps;

  return (
    <section className={styles.section} aria-labelledby="players-maps-section">
      <h3 className={styles.sectionTitle} id="players-maps-section">
        <MapIcon aria-hidden="true" /> {t("players.maps.sectionTitle")}
      </h3>

      <Button
        icon={MapIcon}
        loading={mapsLoading}
        loadingLabel={t("players.maps.searching")}
        onClick={handleFindMaps}
      >
        {t("players.maps.searchButton")}
      </Button>

      {mapsSearched && playerMaps.length === 0 && (
        <>
          <p className="u-muted u-text-sm">{t("players.maps.notFound")}</p>
          {mapsDebug.length > 0 && (
            <details className="ui-details">
              <summary>{t("players.maps.debugInfo", { count: mapsDebug.length })}</summary>
              <div className="ui-details__body">
                <pre className="ui-code">{JSON.stringify(mapsDebug, null, 2)}</pre>
              </div>
            </details>
          )}
        </>
      )}

      {mapsErrors.length > 0 && (
        <Alert tone="danger" title={t("players.maps.errorsTitle")}>
          <ul className="l-stack l-stack--sm">
            {mapsErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      {playerMaps.length > 0 && (
        <div className="l-stack l-stack--sm">
          {playerMaps.map((m, i) => {
            const isSource = copySource?.profile_path === m.profile_path;
            return (
              <div key={i} className={isSource ? `${styles.mapItem} ${styles.mapItemSelected}` : styles.mapItem}>
                <div className={styles.mapInfo}>
                  <span>
                    <MapIcon size={14} strokeWidth={1.75} aria-hidden="true" /> {m.map_name}
                  </span>
                  <span className={styles.mapMeta}>
                    {m.container_name} · {m.machine_name}
                  </span>
                  {m.player_name && (
                    <span className={styles.mapMeta}>
                      {t("players.maps.nameLabel")} {m.player_name}
                    </span>
                  )}
                </div>
                {canOperate && (
                  <Button
                    size="sm"
                    icon={isSource ? X : Copy}
                    pressed={isSource}
                    title={isSource ? t("players.maps.sourceTooltipDeselect") : t("players.maps.sourceTooltipSelect")}
                    onClick={() => setCopySource(isSource ? null : m)}
                  >
                    {isSource ? t("players.maps.sourceCancelLabel") : t("players.maps.sourceSelectLabel")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {copySource && (
        <div className="l-stack l-stack--sm">
          <p className="u-text-sm">
            <Copy size={14} strokeWidth={1.75} aria-hidden="true" /> {t("players.copy.fromLabel")}{" "}
            <strong>{copySource.map_name}</strong> ({copySource.container_name})
          </p>
          <Field label={t("players.copy.destContainerLabel")}>
            <Select
              size="sm"
              value={copyDestContainer}
              onChange={e => {
                setCopyDestContainer(e.target.value);
                const destMaps = getDestMaps(e.target.value);
                setCopyDestMap(destMaps.length === 1 ? destMaps[0] : "");
              }}
            >
              <option value="">{t("players.copy.selectPlaceholder")}</option>
              {syncContainers
                .filter(
                  c =>
                    !(
                      c.machine_id === copySource.machine_id &&
                      c.container_name === copySource.container_name &&
                      c.map_name === copySource.map_name
                    ),
                )
                .map((c, i) => (
                  <option key={i} value={containerKey(c)}>
                    {c.container_name} — {c.map_name || c.server_name || "?"} ({c.machine_name})
                  </option>
                ))}
            </Select>
          </Field>
          {copyDestContainer && (
            <Field label={t("players.copy.destMapLabel")}>
              <Input
                size="sm"
                value={copyDestMap}
                placeholder={t("players.copy.destMapPlaceholder")}
                onChange={e => setCopyDestMap(e.target.value)}
              />
            </Field>
          )}
          <Button
            variant="primary"
            icon={Copy}
            loading={copying}
            loadingLabel={t("players.copy.copying")}
            disabled={!copyDestContainer || !copyDestMap}
            onClick={handleCopyCharacter}
          >
            {t("players.copy.copyButton")}
          </Button>
        </div>
      )}
    </section>
  );
}
