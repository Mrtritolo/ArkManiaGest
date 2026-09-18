/**
 * PlayerRow — one row of the players table.
 *
 * The name is a real <button> (`.ui-row-button`), so the detail panel opens
 * from the keyboard too; the row click is only a mouse shortcut on top of it.
 */
import { useTranslation } from "react-i18next";
import { Calendar, CircleOff, Clock, Home, Star } from "lucide-react";
import { Avatar, Badge, Button, Checkbox } from "../../../components/ui";
import DiscordIcon from "../../../components/DiscordIcon";
import { fmtDate } from "../../../utils/format";
import type { DiscordAccount } from "../../../services/api";
import type { PlayerListItem } from "../../../types";
import { fmtLoginAgo, parseFixedGroups, parseTimedChips } from "../playersUtils";
import styles from "../PlayersPage.module.css";

export interface PlayerRowProps {
  player: PlayerListItem;
  selected: boolean;
  active: boolean;
  discordAccount?: DiscordAccount;
  onToggleSelected: () => void;
  onOpen: () => void;
  onOpenDiscordChip: (account: DiscordAccount) => void;
}

export function PlayerRow({
  player,
  selected,
  active,
  discordAccount,
  onToggleSelected,
  onOpen,
  onOpenDiscordChip,
}: PlayerRowProps) {
  const { t } = useTranslation();
  const name = player.name || t("players.unknownPlayer");
  const fixed = parseFixedGroups(player.permission_groups);
  const timed = parseTimedChips(player.timed_permission_groups);
  const ago = fmtLoginAgo(player.last_login, t);
  const discordName =
    discordAccount?.discord_global_name ?? discordAccount?.discord_username ?? t("players.discord.linked");

  return (
    <tr
      data-selected={selected || undefined}
      className={active ? `ui-row-clickable ${styles.rowActive}` : "ui-row-clickable"}
      onClick={onOpen}
    >
      <td onClick={e => e.stopPropagation()}>
        <Checkbox
          aria-label={t("players.bulkPerm.selectRowAria", { name })}
          checked={selected}
          onChange={onToggleSelected}
        />
      </td>
      <td>
        <div className={styles.nameCell}>
          <Avatar name={name} size="sm" />
          <button
            type="button"
            className="ui-row-button"
            aria-current={active || undefined}
            onClick={e => {
              e.stopPropagation();
              onOpen();
            }}
          >
            {name}
          </button>
          {discordAccount && (
            <Button
              size="sm"
              aria-label={t("players.discord.chipAria", { name: discordName })}
              title={t("players.discord.chipTitle")}
              onClick={e => {
                e.stopPropagation();
                onOpenDiscordChip(discordAccount);
              }}
            >
              <DiscordIcon size={12} />
              {discordName}
            </Button>
          )}
        </div>
      </td>
      <td>
        {player.tribe_name ? (
          <span className={styles.chipRow}>
            <Home size={14} strokeWidth={1.75} aria-hidden="true" /> {player.tribe_name}
          </span>
        ) : (
          <span className={`${styles.chipRow} u-muted`}>
            <Home size={14} strokeWidth={1.75} aria-hidden="true" /> {t("players.unknownTribe")}
          </span>
        )}
      </td>
      <td className="u-num">
        <span className={styles.chipRow}>
          <Star size={14} strokeWidth={1.75} aria-hidden="true" />
          {player.points?.toLocaleString(undefined) ?? "--"}
        </span>
      </td>
      <td>
        <div className={styles.chipRow}>
          {fixed.map(g => (
            <Badge key={g}>{g}</Badge>
          ))}
        </div>
      </td>
      <td>
        <div className={styles.chipRow}>
          {timed.map((tg, i) => (
            <span
              key={i}
              title={
                tg.ts
                  ? tg.expired
                    ? t("players.chipTimed.expired")
                    : t("players.chipTimed.expiresOn", { date: new Date(tg.ts * 1000).toLocaleDateString(undefined) })
                  : undefined
              }
            >
              <Badge tone={tg.expired ? "neutral" : "success"} icon={tg.expired ? CircleOff : Clock}>
                {tg.group}
                <span className="u-sr-only">
                  {" "}
                  {tg.expired ? t("players.perms.expired") : t("players.perms.active")}
                </span>
              </Badge>
            </span>
          ))}
          {timed.length === 0 && <span className="u-muted">--</span>}
        </div>
      </td>
      <td>
        <span className={styles.chipRow}>
          <Calendar size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="u-num">{fmtDate(player.last_login, "--")}</span>
          {ago && <span className="u-muted u-text-sm">{ago}</span>}
        </span>
      </td>
    </tr>
  );
}
