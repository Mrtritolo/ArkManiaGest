/**
 * DiscordSettingsPage.tsx — Settings -> Discord (admin only).
 *
 * Three tabs:
 *   1. Accounts  -- Discord <-> AppUser and Discord <-> ARK player links.
 *   2. Members   -- Live guild member list with per-row moderation actions
 *                   (assign role, remove role, kick, ban, DM).
 *   3. Config    -- Diagnostic of which DISCORD_* .env keys are still
 *                   missing, plus the whitelist editor for auto-promoting
 *                   Discord IDs to admin / operator / viewer.
 *
 * The first commit ships the page shell + tab switcher; the per-tab
 * panels land in subsequent commits so each piece is reviewable
 * standalone.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings as SettingsIcon, Users as UsersIcon, Sliders } from "lucide-react";
import DiscordIcon from "../components/DiscordIcon";

type TabKey = "accounts" | "members" | "config";

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
      </div>

      {/* Per-tab panel placeholders -- implementations land in
          commits 5/6/7 of this Phase-3 series. */}
      {tab === "accounts" && (
        <div className="pl-loading" style={{ textAlign: "left" }}>
          <SettingsIcon size={14} />{" "}
          {t("discord.tab.accountsPlaceholder", "Accounts tab — coming up next.")}
        </div>
      )}
      {tab === "members" && (
        <div className="pl-loading" style={{ textAlign: "left" }}>
          <SettingsIcon size={14} />{" "}
          {t("discord.tab.membersPlaceholder", "Members tab — coming up next.")}
        </div>
      )}
      {tab === "config" && (
        <div className="pl-loading" style={{ textAlign: "left" }}>
          <SettingsIcon size={14} />{" "}
          {t("discord.tab.configPlaceholder", "Config tab — coming up next.")}
        </div>
      )}
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
