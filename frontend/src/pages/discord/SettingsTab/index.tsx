/**
 * SettingsTab — Settings -> Discord -> Edit.
 *
 * Edits the DISCORD_* keys directly from the panel (writes to the backend's
 * `.env` via PUT /api/v1/discord/config) so an admin doesn't have to SSH
 * into the host to rotate a token or change a role ID.
 *
 * Pydantic loads .env once at boot, so any change here only takes effect
 * after a service restart; the banner next to Save carries the command.
 */
import { useEffect } from "react";
import { Bot, KeyRound, RotateCcw, RotateCw, Save, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Field, Input, Spinner } from "../../../components/ui";
import { SecretField } from "./components/FormPrimitives";
import { SaveResultBanner } from "./components/SaveResultBanner";
import { RoleMappingSection } from "./components/RoleMappingSection";
import { useDiscordSettingsForm } from "./hooks/useDiscordSettingsForm";
import styles from "./SettingsTab.module.css";

/** The action bar sits outside the <form>, so Save is bound to it by id. */
const ENV_FORM_ID = "discord-env-form";

interface Props {
  /** The page guards a tab switch away from unsaved edits. */
  onDirtyChange?: (dirty: boolean) => void;
}

export default function SettingsTab({ onDirtyChange }: Props) {
  const { t } = useTranslation();
  const settings = useDiscordSettingsForm();
  const { config, form, hasChanges, setForm } = settings;

  useEffect(() => {
    onDirtyChange?.(hasChanges);
    return () => onDirtyChange?.(false);
  }, [hasChanges, onDirtyChange]);

  const loadError = settings.error ? (
    <Alert
      tone="danger"
      title={t("discord.settings.errors.load")}
      actions={
        <Button size="sm" icon={RotateCw} onClick={() => void settings.load()}>
          {t("common.retry")}
        </Button>
      }
    >
      {settings.error}
    </Alert>
  ) : null;

  if (settings.loading) {
    return <Spinner block label={t("discord.settings.loading")} />;
  }

  // Only a first load with nothing in hand takes over the panel.  A failed
  // Refresh keeps the values that are still in memory on screen and shows
  // the error above them (MASTER 7.3: a refetch keeps stale content visible).
  if (!form || !config) {
    return (
      loadError ?? (
        <Alert tone="danger" title={t("discord.settings.errors.load")}>
          {t("common.pageLoadError")}
        </Alert>
      )
    );
  }

  return (
    <div className="l-stack">
      {loadError}
      <SaveResultBanner success={settings.success} />

      <form
        id={ENV_FORM_ID}
        className="l-stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void settings.save();
        }}
      >
        <Card title={t("discord.settings.section.oauth")} icon={KeyRound}>
          <div className="l-grid--form">
            <Field label={t("discord.settings.field.clientId")}>
              <Input
                mono
                autoComplete="off"
                value={form.client_id}
                onChange={(event) => setForm((f) => ({ ...f, client_id: event.target.value }))}
              />
            </Field>
            <SecretField
              label={t("discord.settings.field.clientSecret")}
              present={config.has_client_secret}
              mode={form.client_secret_mode}
              value={form.client_secret}
              onModeChange={(mode) =>
                setForm((f) => ({
                  ...f,
                  client_secret_mode: mode,
                  client_secret: mode === "set" ? f.client_secret : "",
                }))
              }
              onChange={(value) =>
                setForm((f) => ({ ...f, client_secret: value, client_secret_mode: "set" }))
              }
            />
            <Field label={t("discord.settings.field.publicKey")}>
              <Input
                mono
                autoComplete="off"
                value={form.public_key}
                onChange={(event) => setForm((f) => ({ ...f, public_key: event.target.value }))}
              />
            </Field>
            <Field
              label={t("discord.settings.field.redirectUri")}
              hint={t("discord.settings.hint.redirectUri")}
            >
              <Input
                mono
                autoComplete="off"
                value={form.redirect_uri}
                onChange={(event) => setForm((f) => ({ ...f, redirect_uri: event.target.value }))}
              />
            </Field>
          </div>
        </Card>

        <Card title={t("discord.settings.section.bot")} icon={Bot}>
          <div className="l-grid--form">
            <SecretField
              label={t("discord.settings.field.botToken")}
              present={config.has_bot_token}
              mode={form.bot_token_mode}
              value={form.bot_token}
              onModeChange={(mode) =>
                setForm((f) => ({
                  ...f,
                  bot_token_mode: mode,
                  bot_token: mode === "set" ? f.bot_token : "",
                }))
              }
              onChange={(value) => setForm((f) => ({ ...f, bot_token: value, bot_token_mode: "set" }))}
            />
            <Field label={t("discord.settings.field.guildId")} hint={t("discord.settings.hint.guildId")}>
              <Input
                mono
                autoComplete="off"
                value={form.guild_id}
                onChange={(event) => setForm((f) => ({ ...f, guild_id: event.target.value }))}
              />
            </Field>
          </div>
        </Card>

        <Card title={t("discord.settings.section.vipSync")} icon={Star}>
          <div className="l-grid--form">
            <Field
              label={t("discord.settings.field.vipRoleId")}
              hint={t("discord.settings.hint.vipRoleId")}
            >
              <Input
                mono
                autoComplete="off"
                value={form.vip_role_id}
                onChange={(event) => setForm((f) => ({ ...f, vip_role_id: event.target.value }))}
              />
            </Field>
          </div>
        </Card>
      </form>

      {/* Discord role -> ARK group mapping (Phase 7+). Rendered only after the
          form has loaded, so a Refresh never remounts and re-fetches it.
          Kept OUTSIDE the .env form: its rows save themselves, and Enter in
          one of their inputs must not submit the .env form. */}
      <RoleMappingSection />

      <div className={`ui-actionbar ${styles.actionbar}`}>
        <Button size="sm" icon={RotateCw} onClick={() => void settings.refresh()}>
          {t("common.refresh")}
        </Button>
        <Button
          className="u-push"
          variant="ghost"
          icon={RotateCcw}
          disabled={!hasChanges || settings.saving}
          onClick={() => void settings.reset()}
        >
          {t("discord.settings.reset")}
        </Button>
        <Button
          type="submit"
          form={ENV_FORM_ID}
          variant="primary"
          icon={Save}
          loading={settings.saving}
          loadingLabel={t("discord.settings.saving")}
          disabled={!hasChanges}
          title={hasChanges ? undefined : t("discord.settings.saveDisabledNoChanges")}
        >
          {hasChanges ? t("discord.settings.save") : t("discord.settings.saveNothing")}
        </Button>
      </div>
    </div>
  );
}
