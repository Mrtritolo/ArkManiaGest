/**
 * DiscordSettingsPage.tsx — Settings -> Discord (admin only).
 *
 * Four tabs:
 *   1. Accounts  -- Discord <-> AppUser and Discord <-> ARK player links.
 *   2. Members   -- Live guild member list with per-row moderation actions
 *                   (assign role, remove role, kick, ban, DM).
 *   3. Config    -- READ-ONLY diagnostic of OAuth + bot readiness, the
 *                   live guild probe, the VIP-sync controls and the
 *                   current whitelist contents.
 *   4. Settings  -- WRITE: edit the DISCORD_* keys directly (Client ID,
 *                   secrets, role IDs, whitelists).  Saves to backend's
 *                   .env via PUT /discord/config; restart required for
 *                   the new values to take effect.
 *
 * The selected tab lives in the URL (?tab=), so a tab is linkable. Only the
 * active tab is mounted, so leaving the Settings tab with unsaved edits
 * would silently throw them away: it asks first.
 */
import { useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users as UsersIcon, Sliders, Cog, type LucideIcon } from "lucide-react";
import DiscordIcon from "../components/DiscordIcon";
import { PageHeader, Tabs, useConfirm } from "../components/ui";
import AccountsTab from "./discord/AccountsTab";
import MembersTab from "./discord/MembersTab";
import ConfigTab from "./discord/ConfigTab";
import SettingsTab from "./discord/SettingsTab";
import type { AuthUser } from "../types";

const TAB_KEYS = ["accounts", "members", "config", "settings"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value);
}

/**
 * The brand mark is the page's identity; DiscordIcon draws it with
 * currentColor and takes the primitive's class, but it is not a Lucide
 * component, so the kit's icon slot needs the shape assertion.
 */
const DiscordGlyph = DiscordIcon as unknown as LucideIcon;

interface Props {
  // Nothing to gate here: App.tsx mounts this route for admins only and
  // every /discord endpoint is require_admin server side.
  currentUser?: AuthUser | null;
}

export default function DiscordSettingsPage(_props: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab: TabKey = isTabKey(params.get("tab")) ? (params.get("tab") as TabKey) : "accounts";

  // Written by SettingsTab whenever its form goes dirty or clean. A ref, not
  // state: it is only ever read at the moment a tab switch is requested.
  const settingsDirty = useRef(false);
  const handleDirtyChange = useCallback((dirty: boolean) => {
    settingsDirty.current = dirty;
  }, []);

  const changeTab = useCallback(
    (next: string) => {
      if (!isTabKey(next) || next === tab) return;
      const leavingDirtySettings = tab === "settings" && settingsDirty.current;

      const go = () => {
        settingsDirty.current = false;
        setParams(
          (prev) => {
            const search = new URLSearchParams(prev);
            search.set("tab", next);
            return search;
          },
          { replace: true },
        );
      };

      if (!leavingDirtySettings) {
        go();
        return;
      }
      void confirm({
        title: t("discord.settings.leaveTitle"),
        description: t("discord.settings.leaveBody"),
        confirmLabel: t("discord.settings.leaveConfirm"),
        tone: "danger",
      }).then((ok) => {
        if (ok) go();
      });
    },
    [tab, setParams, confirm, t],
  );

  return (
    <div className="l-page">
      <PageHeader title={t("discord.title")} icon={DiscordGlyph} description={t("discord.subtitle")} />
      <Tabs
        label={t("discord.title")}
        value={tab}
        onChange={changeTab}
        items={[
          { id: "accounts", label: t("discord.tab.accounts"), icon: UsersIcon },
          { id: "members", label: t("discord.tab.members"), icon: DiscordGlyph },
          { id: "config", label: t("discord.tab.config"), icon: Sliders },
          { id: "settings", label: t("discord.tab.settings"), icon: Cog },
        ]}
      >
        {tab === "accounts" && <AccountsTab />}
        {tab === "members" && <MembersTab />}
        {tab === "config" && <ConfigTab />}
        {tab === "settings" && <SettingsTab onDirtyChange={handleDirtyChange} />}
      </Tabs>
    </div>
  );
}
