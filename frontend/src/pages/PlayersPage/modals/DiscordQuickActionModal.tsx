/**
 * DiscordQuickActionModal — DM a linked Discord account, or jump to the full
 * Discord settings page. Opens from the Discord chip on a player row.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Field, Modal, Textarea, buttonClass } from "../../../components/ui";
import DiscordIcon from "../../../components/DiscordIcon";
import { discordApi, type DiscordAccount } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { PlayerListItem } from "../../../types";

const DM_MAX = 2000;

export interface DiscordQuickActionTarget {
  player: PlayerListItem;
  account: DiscordAccount;
}

export interface DiscordQuickActionModalProps {
  target: DiscordQuickActionTarget | null;
  onClose: () => void;
  onSent: (message: string) => void;
  onError: (message: string) => void;
}

export function DiscordQuickActionModal({ target, onClose, onSent, onError }: DiscordQuickActionModalProps) {
  const { t } = useTranslation();
  const [dmContent, setDmContent] = useState("");
  const [dmSending, setDmSending] = useState(false);

  // A new target always starts from an empty draft.
  useEffect(() => {
    setDmContent("");
  }, [target]);

  async function send() {
    const content = dmContent.trim();
    if (!content || !target) return;
    setDmSending(true);
    try {
      await discordApi.dmUser(target.account.discord_user_id, content);
      onSent(t("players.discord.dmSent"));
      onClose();
    } catch (err) {
      onError(extractError(err, t("players.discord.dmFailed")));
    } finally {
      setDmSending(false);
    }
  }

  const title = target
    ? target.account.discord_global_name ?? target.account.discord_username ?? target.account.discord_user_id
    : "";

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      dismissible={!dmSending}
      title={title}
      description={
        target ? t("players.discord.linkedTo", { p: target.player.name || target.player.eos_id }) : undefined
      }
      size="md"
      onSubmit={send}
      footer={
        <>
          <Link to="/settings/discord" className={buttonClass({ variant: "secondary" })}>
            {t("players.discord.openSettings")}
          </Link>
          <Button className="u-push" onClick={onClose} disabled={dmSending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!dmContent.trim()}
            loading={dmSending}
            loadingLabel={t("players.discord.dmSending")}
          >
            <DiscordIcon size={14} /> {t("players.discord.dmSend")}
          </Button>
        </>
      }
    >
      <Field
        label={t("players.discord.dmLabel")}
        hint={t("players.discord.dmRemaining", { n: DM_MAX - dmContent.length, max: DM_MAX })}
      >
        <Textarea
          rows={5}
          value={dmContent}
          placeholder={t("players.discord.dmPh")}
          onChange={e => setDmContent(e.target.value.slice(0, DM_MAX))}
        />
      </Field>
    </Modal>
  );
}
