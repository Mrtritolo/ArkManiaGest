/**
 * PrivacyFooter -- GDPR self-service for the data subject: read the policy,
 * export everything the panel holds, erase the account.
 *
 * Shown in the standalone (Discord-only) view only; the embedded admin view
 * manages links from Settings instead.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, Trash2 } from "lucide-react";
import { Button, buttonClass, useConfirm, useToast } from "../../../components/ui";
import { meApi } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import styles from "../PlayerDashboardPage.module.css";

export function PrivacyFooter({ onDeleted }: { onDeleted: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      const res = await meApi.privacyExport();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "arkmaniagest-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("privacy.exportDone"));
    } catch (err: unknown) {
      toast.error(extractError(err, t("privacy.exportError")));
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(): Promise<void> {
    // Irreversible and account-wide: typed confirmation, not a yes/no.
    if (!(await askConfirm({
      title: t("privacy.deleteTitle"),
      description: t("privacy.deleteConfirm"),
      confirmLabel: t("privacy.deleteButton"),
      tone: "danger",
      confirmText: t("privacy.deleteWord"),
    }))) return;
    setDeleting(true);
    try {
      await meApi.privacyDeleteAccount();
      onDeleted();
    } catch (err: unknown) {
      toast.error(extractError(err, t("privacy.deleteError")));
      setDeleting(false);
    }
  }

  return (
    <div className={styles.privacy}>
      <a href="/privacy" className={buttonClass({ variant: "ghost", size: "sm" })}>
        <FileText aria-hidden="true" />
        {t("privacy.policyLink")}
      </a>
      <Button
        size="sm"
        icon={Download}
        loading={exporting}
        loadingLabel={t("privacy.exporting")}
        disabled={exporting || deleting}
        onClick={handleExport}
      >
        {t("privacy.exportButton")}
      </Button>
      <Button
        size="sm"
        variant="danger"
        icon={Trash2}
        className="u-push"
        loading={deleting}
        loadingLabel={t("privacy.deleting")}
        disabled={exporting || deleting}
        onClick={handleDelete}
      >
        {t("privacy.deleteButton")}
      </Button>
    </div>
  );
}
