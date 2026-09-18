/** Inline form that promotes one discovered container into a managed instance. */
import type { FormEvent } from "react";
import { PackagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert, Button, Card, Field, Input } from "../../../components/ui";
import type { DiscoveredContainer } from "../../../types";
import type { ImportFormState } from "../instanceModel";

interface Props {
  container: DiscoveredContainer;
  machineLabel: string;
  form: ImportFormState;
  setForm: (form: ImportFormState) => void;
  importing: boolean;
  importError: string;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}

export function ImportContainerCard({
  container,
  machineLabel,
  form,
  setForm,
  importing,
  importError,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation();

  return (
    <Card title={t("instances.importTitle", { name: container.name })} icon={PackagePlus}>
      <form className="l-stack" onSubmit={onSubmit}>
        <p className="u-secondary u-text-sm">
          {t("instances.importHint", { machine: machineLabel })}
        </p>
        {importError && <Alert tone="danger">{importError}</Alert>}

        <div className="l-grid--form">
          <Field label={t("instances.form.displayName")} className="u-span-full">
            <Input
              value={form.display_name}
              onChange={e => setForm({ ...form, display_name: e.target.value })}
            />
          </Field>
          <Field label={t("instances.form.map")} className="u-span-full">
            <Input
              value={form.map_name}
              onChange={e => setForm({ ...form, map_name: e.target.value })}
            />
          </Field>
          <Field label={t("instances.form.gamePort")}>
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.game_port}
              onChange={e => setForm({ ...form, game_port: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("instances.form.rconPort")}>
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.rcon_port}
              onChange={e => setForm({ ...form, rcon_port: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("instances.form.adminPassword")} required>
            <Input
              type="password"
              revealable
              autoComplete="new-password"
              minLength={4}
              required
              value={form.admin_password}
              onChange={e => setForm({ ...form, admin_password: e.target.value })}
            />
          </Field>
          <Field label={t("instances.form.serverPassword")}>
            <Input
              type="password"
              revealable
              autoComplete="new-password"
              value={form.server_password}
              onChange={e => setForm({ ...form, server_password: e.target.value })}
            />
          </Field>
        </div>

        <div className="l-cluster">
          <Button
            type="submit"
            variant="primary"
            loading={importing}
            loadingLabel={t("instances.form.saving")}
          >
            {t("instances.importConfirm")}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t("instances.form.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
