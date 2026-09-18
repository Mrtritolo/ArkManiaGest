/**
 * useDiscordSettingsForm -- loads /discord/config, tracks the edits and
 * writes them back.
 *
 * Nothing is refetched after a save: Pydantic loads .env only at boot, so a
 * refetch would return the OLD in-memory values and visually revert the form
 * (see save() for the full reasoning).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { discordApi, type DiscordConfigStatus } from "../../../../services/api";
import { extractError } from "../../../../utils/errors";
import { useConfirm, useToast } from "../../../../components/ui";
import {
  buildUpdateBody,
  makeInitialForm,
  secretPresentAfterSave,
  type FormState,
} from "../settingsForm";

export interface SaveResult {
  updatedKeys: string[];
  hint: string;
}

export interface DiscordSettingsForm {
  config: DiscordConfigStatus | null;
  form: FormState | null;
  loading: boolean;
  saving: boolean;
  /** Load failure only: action results are toasts. */
  error: string;
  success: SaveResult | null;
  hasChanges: boolean;
  setForm: (updater: (current: FormState) => FormState) => void;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  save: () => Promise<void>;
  reset: () => Promise<void>;
}

export function useDiscordSettingsForm(): DiscordSettingsForm {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();

  const [config, setConfig] = useState<DiscordConfigStatus | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [form, setFormState] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<SaveResult | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    setSuccess(null);
    try {
      const res = await discordApi.config();
      setConfig(res.data);
      const init = makeInitialForm(res.data);
      setInitial(init);
      setFormState(init);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.settings.errors.load")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasChanges = useMemo(() => {
    if (!form || !initial) return false;
    return Object.keys(buildUpdateBody(form, initial)).length > 0;
  }, [form, initial]);

  const setForm = useCallback((updater: (current: FormState) => FormState) => {
    setFormState((current) => (current ? updater(current) : current));
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (!form || !initial) return;
    const body = buildUpdateBody(form, initial);
    if (Object.keys(body).length === 0) {
      // Nothing to do is information, not a failure.
      toast.info(t("discord.settings.noChanges"));
      return;
    }

    // Clearing a secret cannot be undone from the panel: the value is not
    // stored anywhere else, so it has to be pasted again.
    const cleared = [
      form.client_secret_mode === "clear" ? t("discord.settings.field.clientSecret") : null,
      form.bot_token_mode === "clear" ? t("discord.settings.field.botToken") : null,
    ].filter((label): label is string => label !== null);
    if (cleared.length > 0) {
      const ok = await confirm({
        title: t("discord.settings.confirmClearTitle"),
        description: t("discord.settings.confirmClearBody", { fields: cleared.join(", ") }),
        confirmLabel: t("discord.settings.confirmClearConfirm"),
        tone: "danger",
      });
      if (!ok) return;
    }

    setSaving(true);
    setSuccess(null);
    try {
      const res = await discordApi.updateConfig(body);
      setSuccess({ updatedKeys: res.data.updated_keys, hint: res.data.restart_hint });
      toast.success(
        t("discord.settings.savedKeys", {
          n: res.data.updated_keys.length,
          keys: res.data.updated_keys.join(", "),
        }),
      );
      // IMPORTANT: do NOT re-fetch /discord/config here.  Pydantic loads
      // .env only at boot, so a re-fetch right now would return the OLD
      // in-memory values (the server hasn't restarted yet) and would
      // VISUALLY revert the form to its pre-save state -- making the
      // operator think 'nothing happened' even though the file IS
      // correctly updated.  Instead, update the local 'initial' baseline
      // to match what we just sent, so the form stays consistent and
      // hasChanges flips to false (the 'restart required' banner is the
      // visible signal that more is needed).  Secret fields are also reset
      // to 'keep' mode so the password inputs clear without looking like
      // they got wiped.
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              // The Set / Not set label and the Clear action must reflect
              // what was just written, not the value loaded at mount.
              has_client_secret: secretPresentAfterSave(
                form.client_secret_mode,
                form.client_secret,
                prev.has_client_secret,
              ),
              has_bot_token: secretPresentAfterSave(
                form.bot_token_mode,
                form.bot_token,
                prev.has_bot_token,
              ),
            }
          : prev,
      );
      const newInitial: FormState = {
        ...form,
        client_secret: "",
        client_secret_mode: "keep",
        bot_token: "",
        bot_token_mode: "keep",
      };
      setFormState(newInitial);
      setInitial(newInitial);
    } catch (err: unknown) {
      toast.error(extractError(err, t("discord.settings.errors.save")));
    } finally {
      setSaving(false);
    }
  }, [form, initial, t, toast, confirm]);

  const reset = useCallback(async (): Promise<void> => {
    if (!initial) return;
    if (hasChanges) {
      const ok = await confirm({
        title: t("discord.settings.discardTitle"),
        description: t("discord.settings.discardBody"),
        confirmLabel: t("discord.settings.discardConfirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    setFormState(initial);
    setSuccess(null);
  }, [initial, hasChanges, confirm, t]);

  const refresh = useCallback(async (): Promise<void> => {
    if (hasChanges) {
      const ok = await confirm({
        title: t("discord.settings.refreshTitle"),
        description: t("discord.settings.refreshBody"),
        confirmLabel: t("discord.settings.refreshConfirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    await load();
  }, [hasChanges, confirm, t, load]);

  return {
    config,
    form,
    loading,
    saving,
    error,
    success,
    hasChanges,
    setForm,
    load,
    refresh,
    save,
    reset,
  };
}
