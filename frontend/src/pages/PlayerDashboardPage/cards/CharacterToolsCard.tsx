/**
 * CharacterToolsCard -- self-service rename and kick, plus the recent
 * requests.
 *
 * The card loads its own list. It used to be remounted (and so reloaded) by
 * every dashboard refresh; now that the grid survives a refresh, it watches
 * `reloadToken` instead, which the page bumps after each successful load.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PenLine, UserX, Wrench } from "lucide-react";
import {
  Badge, Button, Card, Field, Input, useConfirm, useToast, type BadgeTone,
} from "../../../components/ui";
import { meApi, type DashboardPresence, type PlayerRequestRow } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import { fmtRelative } from "../dashboardFormat";
import styles from "../PlayerDashboardPage.module.css";

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "warning",
  done: "success",
  rejected: "danger",
  expired: "neutral",
  superseded: "neutral",
};

const MIN_NAME = 2;

export function CharacterToolsCard({ presence, reloadToken }: {
  presence: DashboardPresence;
  /** Bumped by the page after every successful dashboard load. */
  reloadToken: number;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const [requests, setRequests] = useState<PlayerRequestRow[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRequests = useCallback(async () => {
    try {
      const res = await meApi.requests();
      setRequests(res.data);
    } catch {
      // Silent: the card stays usable, the list just doesn't render.
    }
  }, []);

  useEffect(() => { void loadRequests(); }, [loadRequests, reloadToken]);

  async function run(action: () => Promise<unknown>, okMsg: string): Promise<void> {
    setBusy(true);
    try {
      await action();
      toast.success(okMsg);
      await loadRequests();
    } catch (err: unknown) {
      toast.error(extractError(err, t("dashboard.tools.genericError")));
    } finally {
      setBusy(false);
    }
  }

  async function handleKick(): Promise<void> {
    if (!(await askConfirm({
      title: t("dashboard.tools.kickTitle"),
      description: t("dashboard.tools.kickConfirm"),
      confirmLabel: t("dashboard.tools.kickButton"),
      tone: "danger",
    }))) return;
    await run(() => meApi.requestKick(), t("dashboard.tools.kickQueued"));
  }

  async function handleRename(): Promise<void> {
    const name = newName.trim();
    if (name.length < MIN_NAME) return;
    await run(async () => {
      await meApi.requestRename(name);
      setNewName("");
    }, t("dashboard.tools.renameQueued"));
  }

  return (
    <Card title={t("dashboard.tools.title")} icon={Wrench}>
      <div className={styles.stack}>
        <div className={styles.inlineForm}>
          <Field label={t("dashboard.tools.renameLabel")} hint={t("dashboard.tools.renameHint")}>
            <Input
              type="text"
              maxLength={48}
              placeholder={t("dashboard.tools.renamePlaceholder")}
              value={newName}
              disabled={busy}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void handleRename(); }}
            />
          </Field>
          <Button
            variant="primary"
            icon={PenLine}
            loading={busy}
            loadingLabel={t("dashboard.tools.sending")}
            disabled={busy || newName.trim().length < MIN_NAME}
            onClick={() => void handleRename()}
          >
            {t("dashboard.tools.renameButton")}
          </Button>
        </div>

        <div className="l-cluster">
          <Button
            variant="danger"
            icon={UserX}
            disabled={busy || !presence.online_now}
            title={presence.online_now ? undefined : t("dashboard.tools.kickOffline")}
            onClick={() => void handleKick()}
          >
            {t("dashboard.tools.kickButton")}
          </Button>
          <span className="u-secondary u-text-sm">
            {presence.online_now
              ? t("dashboard.tools.kickHint")
              : t("dashboard.tools.kickOffline")}
          </span>
        </div>

        {requests.length > 0 && (
          <div className={styles.list} tabIndex={0} role="group"
               aria-label={t("dashboard.tools.requestsLabel")}>
            {requests.map(r => (
              <div key={r.id} className={styles.row}>
                <span className={`${styles.rowMain} u-truncate`}>
                  {r.action === "kick"
                    ? t("dashboard.tools.entryKick")
                    : t("dashboard.tools.entryRename", { n: r.payload })}
                  {r.status === "rejected" && r.result ? ` — ${r.result}` : ""}
                </span>
                <span className={`${styles.rowMeta} l-cluster`}>
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"} dot>
                    {t(`dashboard.tools.status.${r.status}`, { defaultValue: r.status })}
                  </Badge>
                  {fmtRelative(r.requested_at, t)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
