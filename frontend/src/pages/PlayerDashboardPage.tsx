/**
 * PlayerDashboardPage.tsx — Discord-linked player dashboard.
 *
 * Self-service view for a player who has signed in via Discord and whose
 * Discord identity is bound to an EOS player by an admin.  Three cards:
 *
 *   - Character: name, tribe, last login, permission groups (perm + timed)
 *   - Shop:      points, total spent, raw kit string from the plugin
 *   - Decay:     status (safe / expiring / expired), expiry countdown,
 *                last refresh metadata, scheduled-purge flag
 *
 * Auth model: the page calls `/api/v1/me/dashboard` which authenticates
 * via the disc_session cookie (NOT the panel JWT).  401 -> session gone,
 * 403 -> Discord identity not yet linked to an EOS by an admin, 404 ->
 * linked EOS no longer present in the live plugin DB.
 *
 * Layout: NO admin sidebar.  Just a slim header with the player's avatar
 * + name + a logout button, then the three cards stacked vertically.
 * Mounted by App.tsx when auth-state resolves to "player".
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, AlertCircle, RefreshCw, LogOut,
  User, Users, ShoppingBag, Timer, Shield,
  Clock, AlertTriangle, CheckCircle2,
} from "lucide-react";
import {
  meApi, discordAuthApi,
  type DashboardResponse, type DashboardCharacter,
  type DashboardShop, type DashboardDecay, type DashboardDiscord,
} from "../services/api";
import DiscordIcon from "../components/DiscordIcon";

// ── Helpers ─────────────────────────────────────────────────────────────────

function avatarUrl(userId: string, hash: string | null): string | null {
  if (!hash) return null;
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=64`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Humanise a positive hour count into "Xg Yh" / "Yh" / "<1h". */
function fmtCountdown(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 0) {
    const abs = Math.abs(hours);
    const d = Math.floor(abs / 24);
    const h = abs - d * 24;
    return d > 0 ? `scaduto da ${d}g ${h}h` : `scaduto da ${h}h`;
  }
  if (hours < 1) return "< 1h";
  const d = Math.floor(hours / 24);
  const h = hours - d * 24;
  return d > 0 ? `${d}g ${h}h` : `${h}h`;
}

function extractError(err: unknown, fallback: string): string {
  const msg =
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    ?? (err as { message?: string })?.message
    ?? fallback;
  return typeof msg === "string" ? msg : fallback;
}

// ── Top-level page ──────────────────────────────────────────────────────────

interface PlayerDashboardPageProps {
  /** Optional callback the host can wire to its auth-state machine
   *  (e.g. App.tsx wants to flip back to the login screen on logout).
   *  Ignored when `embedded` is true. */
  onLogout?: () => void;

  /**
   * When true, the page renders WITHOUT its own slim header / logout /
   * full-canvas wrapper -- it's been mounted inside the admin layout
   * (sidebar already provides identity + logout).  Use this when an admin
   * navigates to /me from within the panel to peek at their player view.
   */
  embedded?: boolean;
}

export default function PlayerDashboardPage({ onLogout, embedded = false }: PlayerDashboardPageProps) {
  const { t } = useTranslation();
  const [data, setData]       = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    setErrorStatus(null);
    try {
      const res = await meApi.dashboard();
      setData(res.data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? null;
      setErrorStatus(status);
      setError(extractError(err, t(
        "dashboard.errors.load",
        { defaultValue: "Failed to load dashboard." },
      )));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  async function handleLogout(): Promise<void> {
    try {
      await discordAuthApi.logout();
    } catch { /* clearing the cookie is best-effort */ }
    onLogout?.();
    // Hard reload so the SPA re-runs its auth probe in a clean slate.
    // Avoids leftover cached state when the operator is then handed back
    // to the login screen.
    window.location.href = "/";
  }

  // Standalone uses a full-canvas wrapper with a slim header (the player
  // is the only thing on screen).  Embedded uses the admin's pl-page so
  // it slots into the existing sidebar+main layout.
  const Wrapper = embedded
    ? ({ children }: { children: React.ReactNode }) => (
        <div className="pl-page">
          <div className="pl-header">
            <div>
              <h1 className="pl-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <User size={20} />{" "}
                {t("dashboard.embeddedTitle", { defaultValue: "La mia dashboard" })}
              </h1>
              <p className="pl-subtitle">
                {t("dashboard.embeddedSubtitle", {
                  defaultValue: "Anteprima della view che il tuo personaggio vede via Discord.",
                })}
              </p>
            </div>
            <button onClick={() => load()} className="btn btn-secondary btn-sm">
              <RefreshCw size={12} />{" "}
              {t("common.refresh", { defaultValue: "Refresh" })}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {children}
          </div>
        </div>
      )
    : ({ children }: { children: React.ReactNode }) => (
        <div style={{
          minHeight: "100vh",
          background: "var(--bg, #f5f5f7)",
          padding: "1.5rem",
        }}>
          <div style={{
            maxWidth: 880, margin: "0 auto",
            display: "flex", flexDirection: "column", gap: "1rem",
          }}>
            <PageHeader
              discord={data?.discord ?? null}
              characterName={data?.character.name ?? null}
              onRefresh={() => load()}
              onLogout={handleLogout}
            />
            {children}
          </div>
        </div>
      );

  return (
    <Wrapper>
      <>
        {error && (
          <div className="alert alert-error">
            <AlertCircle size={14} />
            {" "}{error}
            {errorStatus === 403 && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", opacity: 0.85 }}>
                {t(
                  "dashboard.hint.notLinked",
                  {
                    defaultValue: "An admin must link your Discord account to an ARK player from Settings -> Discord -> Accounts.",
                  },
                )}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="pl-loading" style={{ background: "transparent" }}>
            <Loader2 size={20} className="pl-spin" />{" "}
            {t("dashboard.loading", { defaultValue: "Loading dashboard…" })}
          </div>
        ) : data ? (
          <>
            <CharacterCard data={data.character} />
            <ShopCard      data={data.shop} />
            <DecayCard     data={data.decay} />
          </>
        ) : null}
      </>
    </Wrapper>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function PageHeader({
  discord, characterName, onRefresh, onLogout,
}: {
  discord: DashboardDiscord | null;
  characterName: string | null;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const av = discord ? avatarUrl(discord.discord_user_id, discord.discord_avatar) : null;
  const name = characterName
    || discord?.discord_global_name
    || discord?.discord_username
    || t("dashboard.player", { defaultValue: "Player" });

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0.7rem 1rem",
      background: "var(--surface, #fff)",
      border: "1px solid var(--border)",
      borderRadius: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
        {av ? (
          <img
            src={av} alt=""
            style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <div className="pl-avatar" style={{ width: 38, height: 38, background: "#5865F2" }}>
            {name[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div>
          <div style={{ fontWeight: 600 }}>
            {t("dashboard.greeting", { defaultValue: "Hi {{n}}", n: name })}
          </div>
          {discord && (
            <div style={{
              fontSize: "0.72rem", color: "var(--text-secondary)",
              display: "flex", alignItems: "center", gap: "0.3rem",
            }}>
              <DiscordIcon size={9} color="#5865F2" />
              {discord.discord_username
                ? `@${discord.discord_username}`
                : discord.discord_user_id}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button
          onClick={onRefresh}
          className="btn btn-secondary btn-sm"
          title={t("common.refresh", { defaultValue: "Refresh" })}
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={onLogout}
          className="btn btn-secondary btn-sm"
          title={t("nav.logout", { defaultValue: "Log out" })}
        >
          <LogOut size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Character ───────────────────────────────────────────────────────────────

function CharacterCard({ data }: { data: DashboardCharacter }) {
  const { t } = useTranslation();
  const activeTimed = data.timed_permission_groups.filter(g => !g.expired);

  return (
    <Card icon={<User size={14} />} title={t("dashboard.character.title", { defaultValue: "Personaggio" })}>
      <KV label={t("dashboard.character.name", { defaultValue: "Nome" })}
          value={data.name || "—"} />
      <KV label={t("dashboard.character.tribe", { defaultValue: "Tribù" })}
          value={data.tribe_name || (data.tribe_id ? `#${data.tribe_id}` : "—")}
          icon={<Users size={11} />} />
      <KV label={t("dashboard.character.lastLogin", { defaultValue: "Ultimo login" })}
          value={fmtDateTime(data.last_login)} />
      <KV label={t("dashboard.character.eos", { defaultValue: "EOS_Id" })}
          value={data.eos_id}
          monospace />
      {data.permission_groups.length > 0 && (
        <div style={{ marginTop: "0.4rem" }}>
          <Subhead>{t("dashboard.character.groups", { defaultValue: "Gruppi permanenti" })}</Subhead>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            {data.permission_groups.map(g => (
              <span key={g} className="pl-chip">
                <Shield size={9} /> {g}
              </span>
            ))}
          </div>
        </div>
      )}
      {activeTimed.length > 0 && (
        <div style={{ marginTop: "0.4rem" }}>
          <Subhead>{t("dashboard.character.timed", { defaultValue: "Gruppi a tempo (attivi)" })}</Subhead>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            {activeTimed.map((g, i) => (
              <div key={`${g.group}-${i}`}
                style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
                <span className="pl-chip" style={{
                  background: "#16a34a15", color: "#16a34a", borderColor: "#16a34a30",
                }}>
                  <Clock size={9} /> {g.group}
                </span>
                <span style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>
                  {t("dashboard.character.expiresOn", {
                    defaultValue: "scade il {{d}}",
                    d: fmtDateTime(g.expires_at_iso),
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Shop ────────────────────────────────────────────────────────────────────

function ShopCard({ data }: { data: DashboardShop }) {
  const { t } = useTranslation();
  return (
    <Card icon={<ShoppingBag size={14} />} title={t("dashboard.shop.title", { defaultValue: "ArkShop" })}>
      <div style={{
        display: "flex", justifyContent: "space-around",
        gap: "0.5rem", marginBottom: "0.4rem",
      }}>
        <BigStat
          value={data.points.toLocaleString()}
          label={t("dashboard.shop.points", { defaultValue: "Punti" })}
          color="#16a34a"
        />
        <BigStat
          value={data.total_spent.toLocaleString()}
          label={t("dashboard.shop.totalSpent", { defaultValue: "Totale speso" })}
          color="#6b7280"
        />
      </div>
      {data.kits_raw && (
        <details style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
          <summary style={{ cursor: "pointer", color: "var(--text-secondary)" }}>
            {t("dashboard.shop.kitsRawToggle", { defaultValue: "Mostra kit (raw)" })}
          </summary>
          <pre style={{
            background: "var(--bg-card-muted, #f5f5f7)",
            padding: "0.4rem 0.55rem", borderRadius: 4,
            fontSize: "0.7rem", overflowX: "auto",
            marginTop: "0.3rem",
            maxHeight: 200,
          }}>
            {data.kits_raw}
          </pre>
        </details>
      )}
    </Card>
  );
}

// ── Decay ───────────────────────────────────────────────────────────────────

function DecayCard({ data }: { data: DashboardDecay }) {
  const { t } = useTranslation();

  if (!data.has_tribe) {
    return (
      <Card icon={<Timer size={14} />} title={t("dashboard.decay.title", { defaultValue: "Decadimento" })}>
        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {t("dashboard.decay.noTribe", {
            defaultValue: "Non sei in nessuna tribù registrata: nessun timer di decadimento.",
          })}
        </div>
      </Card>
    );
  }

  const statusColor =
    data.status === "expired"  ? "#dc2626" :
    data.status === "expiring" ? "#d97706" :
                                 "#16a34a";
  const StatusIcon =
    data.status === "expired"  ? AlertTriangle :
    data.status === "expiring" ? AlertCircle   :
                                 CheckCircle2;

  return (
    <Card icon={<Timer size={14} />} title={t("dashboard.decay.title", { defaultValue: "Decadimento" })}>
      <div style={{
        padding: "0.5rem 0.65rem", borderRadius: 6,
        background: `${statusColor}15`,
        border: `1px solid ${statusColor}40`,
        display: "flex", alignItems: "center", gap: "0.55rem",
        marginBottom: "0.5rem",
      }}>
        <StatusIcon size={16} color={statusColor} />
        <div>
          <div style={{ fontWeight: 600, color: statusColor }}>
            {data.status === "expired" && t("dashboard.decay.statusExpired", { defaultValue: "Scaduto" })}
            {data.status === "expiring" && t("dashboard.decay.statusExpiring", { defaultValue: "In scadenza" })}
            {data.status === "safe" && t("dashboard.decay.statusSafe", { defaultValue: "OK" })}
          </div>
          <div style={{ fontSize: "0.78rem" }}>
            {data.status === "expired"
              ? t("dashboard.decay.scaduto", {
                  defaultValue: "Decay {{c}}",
                  c: fmtCountdown(data.hours_left),
                })
              : t("dashboard.decay.expiresIn", {
                  defaultValue: "scade tra {{c}}",
                  c: fmtCountdown(data.hours_left),
                })}
          </div>
        </div>
      </div>
      <KV label={t("dashboard.decay.tribe", { defaultValue: "Tribù" })}
          value={data.tribe_name || (data.tribe_id ? `#${data.tribe_id}` : "—")} />
      <KV label={t("dashboard.decay.expireAt", { defaultValue: "Scadenza" })}
          value={fmtDateTime(data.expire_at)} />
      <KV label={t("dashboard.decay.lastRefreshAt", { defaultValue: "Ultimo refresh" })}
          value={
            data.last_refresh_at
              ? `${fmtDateTime(data.last_refresh_at)}${data.last_refresh_name ? ` (${data.last_refresh_name})` : ""}`
              : "—"
          } />
      {data.scheduled_for_purge && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.4rem 0.55rem",
          background: "#dc262615",
          border: "1px solid #dc262640",
          borderRadius: 6,
          fontSize: "0.78rem",
          color: "#dc2626",
        }}>
          <AlertTriangle size={11} style={{ verticalAlign: "middle" }} />
          {" "}
          {t("dashboard.decay.scheduledPurge", {
            defaultValue: "La tua tribù è programmata per la rimozione (purge).",
          })}
        </div>
      )}
    </Card>
  );
}

// ── Layout primitives ───────────────────────────────────────────────────────

function Card({
  icon, title, children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pl-sync-panel" style={{ padding: 0 }}>
      <div className="pl-sync-header" style={{ padding: "0.6rem 0.8rem" }}>
        <span className="pl-sync-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {icon} {title}
        </span>
      </div>
      <div className="pl-sync-body" style={{
        padding: "0.7rem 0.8rem",
        display: "flex", flexDirection: "column", gap: "0.3rem",
      }}>
        {children}
      </div>
    </div>
  );
}

function KV({
  label, value, icon, monospace,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  monospace?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span style={{
        fontSize: "0.72rem", color: "var(--text-secondary)",
        minWidth: 110, textTransform: "uppercase", letterSpacing: 0.4,
        display: "flex", alignItems: "center", gap: "0.25rem",
      }}>
        {icon} {label}
      </span>
      <span style={{
        fontSize: "0.85rem", fontWeight: 500, flex: 1,
        fontFamily: monospace ? "monospace" : undefined,
        wordBreak: monospace ? "break-all" : undefined,
      }}>
        {value}
      </span>
    </div>
  );
}

function Subhead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.4,
      color: "var(--text-secondary)", marginBottom: "0.2rem",
    }}>
      {children}
    </div>
  );
}

function BigStat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ textAlign: "center", padding: "0.4rem 0.7rem" }}>
      <div style={{ fontSize: "1.4rem", fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
    </div>
  );
}
