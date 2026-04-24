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
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Users as UsersIcon, Sliders, Cog } from "lucide-react";
import DiscordIcon from "../components/DiscordIcon";
import AccountsTab from "./discord/AccountsTab";
import MembersTab from "./discord/MembersTab";
import ConfigTab from "./discord/ConfigTab";
import SettingsTab from "./discord/SettingsTab";

type TabKey = "accounts" | "members" | "config" | "settings";

export default function DiscordSettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>("accounts");

  return (
    <div className="pl-page">
      {/* Page header */}
      <div className="pl-header">
        <div>
          <h1
            className="pl-title"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <DiscordIcon size={22} color="#5865F2" />
            {t("discord.title", "Discord")}
          </h1>
          <p className="pl-subtitle">
            {t(
              "discord.subtitle",
              "Manage Discord accounts, ARK player links and bot interactions.",
            )}
          </p>
        </div>
      </div>

      {/* Tab switcher */}
      <div
        style={{
          display: "flex",
          gap: "0.4rem",
          marginBottom: "1rem",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "0.4rem",
        }}
      >
        <TabButton
          active={tab === "accounts"}
          onClick={() => setTab("accounts")}
          icon={<UsersIcon size={14} />}
          label={t("discord.tab.accounts", "Accounts")}
        />
        <TabButton
          active={tab === "members"}
          onClick={() => setTab("members")}
          icon={<DiscordIcon size={14} />}
          label={t("discord.tab.members", "Guild members")}
        />
        <TabButton
          active={tab === "config"}
          onClick={() => setTab("config")}
          icon={<Sliders size={14} />}
          label={t("discord.tab.config", "Configuration")}
        />
        <TabButton
          active={tab === "settings"}
          onClick={() => setTab("settings")}
          icon={<Cog size={14} />}
          label={t("discord.tab.settings", { defaultValue: "Modifica" })}
        />
      </div>

      {/* Per-tab panels */}
      {tab === "accounts" && <AccountsTab />}
      {tab === "members"  && <MembersTab />}
      {tab === "config"   && <ConfigTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

// ── Tiny reusable tab button (kept local so the rest of the app keeps
//    using its existing tab styles unchanged).
function TabButton({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={active ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
      style={{
        display: "flex", alignItems: "center", gap: "0.35rem",
        opacity: active ? 1 : 0.85,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
