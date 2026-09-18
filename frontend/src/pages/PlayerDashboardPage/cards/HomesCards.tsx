/**
 * HomesCards -- saved homes, one card per map.
 *
 * The /sethome limit is per map and the coordinates only mean anything against
 * a map, so the map is the unit: a flat cluster-wide list forced the player to
 * read a map name off every row to find the two homes on the map they were
 * standing on.
 *
 * homeCards() returns an array so the caller can spread the cards straight
 * into the dashboard grid -- a wrapper element would break grid placement.
 */
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, Server, Trash2 } from "lucide-react";
import { Card, EmptyState, IconButton, useConfirm, useToast } from "../../../components/ui";
import { meApi, type DashboardHomeGroup, type DashboardHomes } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import { fmtDateTime } from "../../../utils/format";
import {
  calibFromWorldSettings, DEFAULT_CALIBRATION, parseCalibOverrides, type MapCalib,
} from "../../../utils/mapCalibration";
import { usePending } from "../../../hooks/usePending";
import { fmtHomePos, fmtRelative } from "../dashboardFormat";
import styles from "../PlayerDashboardPage.module.css";

export function homeCards(data: DashboardHomes, onChanged: () => void): ReactNode[] {
  if (data.groups.length === 0) return [<HomesEmptyCard key="homes-empty" />];
  return data.groups.map(g => (
    <HomeMapCard key={g.server_key || g.map_name || "?"} group={g}
                 overridesRaw={data.calibration_overrides} onChanged={onChanged} />
  ));
}

function HomesEmptyCard() {
  const { t } = useTranslation();
  return (
    <Card title={t("dashboard.homes.title")} icon={MapPin}>
      <EmptyState icon={MapPin} title={t("dashboard.homes.empty")} />
    </Card>
  );
}

function HomeMapCard({ group, overridesRaw, onChanged }: {
  group: DashboardHomeGroup;
  overridesRaw: string | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const pending = usePending<number>();

  // Same resolution order as the admin map page, so a coordinate reads
  // identically in both places: operator override, then what the game itself
  // published, then the built-in table for official maps.
  const calib = useMemo<MapCalib | null>(() => {
    const map = group.map_name || "";
    const overrides = parseCalibOverrides(overridesRaw);
    const fromGame = (group.lat_scale && group.lon_scale)
      ? calibFromWorldSettings({
          lat_origin: group.lat_origin ?? 0, lat_scale: group.lat_scale,
          lon_origin: group.lon_origin ?? 0, lon_scale: group.lon_scale,
        })
      : null;
    return overrides[map] || fromGame || DEFAULT_CALIBRATION[map] || null;
  }, [group, overridesRaw]);

  async function handleDelete(home: { id: number; name: string }): Promise<void> {
    if (!(await askConfirm({
      title: t("dashboard.homes.deleteTitle", { n: home.name }),
      description: t("dashboard.homes.deleteConfirm", { n: home.name }),
      confirmLabel: t("dashboard.homes.deleteButton"),
      tone: "danger",
    }))) return;
    try {
      await pending.run(home.id, () => meApi.deleteHome(home.id));
      // Refetch instead of splicing locally: the dashboard is one endpoint,
      // and a home the player also deleted in game would otherwise linger in
      // the list until the next manual refresh.
      onChanged();
    } catch (err: unknown) {
      toast.error(extractError(err, t("dashboard.homes.deleteError")));
    }
  }

  const mapLabel = group.map_name || group.server_name || group.server_key || "—";

  return (
    <Card
      title={t("dashboard.homes.mapTitle", { map: mapLabel, n: group.entries.length })}
      icon={MapPin}
    >
      <div className={styles.stack}>
        {group.server_name && group.server_name !== mapLabel && (
          <p className={styles.metaLine}>
            <Server size={16} strokeWidth={1.75} aria-hidden="true" />
            {group.server_name}
          </p>
        )}
        {group.entries.map(h => (
          <div key={h.id} className={styles.homeEntry}>
            <div className={styles.homeText}>
              <div className={`${styles.homeName} u-truncate`}>{h.name}</div>
              <div className={styles.gps}>{fmtHomePos(h, calib, t)}</div>
              {h.created_iso && (
                <div className="u-secondary u-text-sm" title={fmtDateTime(h.created_iso)}>
                  {t("dashboard.homes.savedOn", { v: fmtRelative(h.created_iso, t) })}
                </div>
              )}
            </div>
            <IconButton
              icon={Trash2}
              tone="danger"
              size="sm"
              label={t("dashboard.homes.deleteNamed", { n: h.name })}
              loading={pending.isPending(h.id)}
              disabled={pending.anyPending}
              onClick={() => void handleDelete(h)}
            />
          </div>
        ))}
        {!calib && (
          <p className="u-secondary u-text-sm">{t("dashboard.homes.noCalibration")}</p>
        )}
      </div>
    </Card>
  );
}
