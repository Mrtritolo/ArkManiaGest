/**
 * settingsForm.ts -- the editable shape of the DISCORD_* keys and the
 * per-field semantics the backend expects.
 *
 *   - non-secret fields (client_id, public_key, guild_id, redirect_uri,
 *     vip_role_id):  current value pre-filled from /discord/config; an
 *     empty input clears the value, a non-empty input writes it.
 *   - secret fields (client_secret, bot_token):  the current value is NEVER
 *     returned by the backend; an empty input MEANS 'leave unchanged' (NOT
 *     'clear').  An explicit 'Clear' action flips the field into clear-mode.
 */
import type { DiscordConfigStatus, DiscordConfigUpdate } from "../../../services/api";

export type SecretMode = "keep" | "set" | "clear";

export interface FormState {
  client_id: string;
  /** Empty + client_secret_mode 'keep' = leave alone. */
  client_secret: string;
  client_secret_mode: SecretMode;
  bot_token: string;
  bot_token_mode: SecretMode;
  public_key: string;
  guild_id: string;
  redirect_uri: string;
  vip_role_id: string;
}

export function makeInitialForm(cfg: DiscordConfigStatus): FormState {
  return {
    client_id: cfg.client_id || "",
    client_secret: "",
    client_secret_mode: "keep",
    bot_token: "",
    bot_token_mode: "keep",
    public_key: cfg.public_key || "",
    guild_id: cfg.guild_id || "",
    redirect_uri: cfg.redirect_uri || "",
    vip_role_id: cfg.vip_role_id || "",
  };
}

export function buildUpdateBody(form: FormState, initial: FormState): DiscordConfigUpdate {
  const body: DiscordConfigUpdate = {};

  // String fields: send only when changed.
  function maybe<K extends "client_id" | "public_key" | "guild_id" | "redirect_uri" | "vip_role_id">(
    key: K,
  ): void {
    if (form[key] !== initial[key]) body[key] = form[key];
  }
  maybe("client_id");
  maybe("public_key");
  maybe("guild_id");
  maybe("redirect_uri");
  maybe("vip_role_id");

  // Secret fields: governed by mode.
  if (form.client_secret_mode === "set" && form.client_secret.length > 0) {
    body.client_secret = form.client_secret;
  } else if (form.client_secret_mode === "clear") {
    body.client_secret = "";
  }
  if (form.bot_token_mode === "set" && form.bot_token.length > 0) {
    body.bot_token = form.bot_token;
  } else if (form.bot_token_mode === "clear") {
    body.bot_token = "";
  }

  // The OAuth admin/operator/viewer whitelists were removed in Phase 7+.
  // The body now never carries them, so the backend leaves whatever it had
  // in .env untouched (the per-key 'null = leave alone' semantics).
  return body;
}

/**
 * The stored flag a secret field must show after a save: true once a value
 * was written, false once it was cleared, unchanged while in keep mode.
 */
export function secretPresentAfterSave(mode: SecretMode, value: string, present: boolean): boolean {
  if (mode === "set" && value.length > 0) return true;
  if (mode === "clear") return false;
  return present;
}
