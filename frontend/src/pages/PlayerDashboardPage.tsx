/**
 * PlayerDashboardPage.tsx — Discord-linked player dashboard (Phase 7 redesign).
 *
 * Lays out the player view as an asymmetric 2-column grid:
 *
 *   ┌──────────────── HERO (full width) ────────────────┐
 *   │  big avatar · greeting · presence + server pulse  │
 *   └────────────────────────────────────────────────────┘
 *   ┌─── HERO CHARACTER (full width) ────────────────────┐
 *   │  name · tribe · last login · VIP / perm group chips│
 *   └────────────────────────────────────────────────────┘
 *   ┌─── shop ───┐ ┌─── leaderboard (with rank bar) ────┐
 *   ├─── decay ──┤ ├─── rare dinos (last 30d feed) ─────┤
 *   ├─── tribe ──┤ ├─── activity feed ──────────────────┤
 *
 * Two render modes (governed by `embedded`):
 *   - standalone: full-canvas wrapper with slim header + logout
 *   - embedded:   slots into the admin layout via pl-page (no logout)
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, AlertCircle, RefreshCw, LogOut,
  User, Users, ShoppingBag, Timer, Shield, Crown,
  Clock, AlertTriangle, CheckCircle2, Activity as ActivityIcon,
  Trophy, Skull, Server, Wifi, WifiOff,
} from "lucide-react";
import {
  meApi, discordAuthApi,
  type DashboardResponse, type DashboardCharacter, type DashboardShop,
  type DashboardDecay, type DashboardDiscord, type DashboardPresence,
  type DashboardServerPulse, type DashboardLeaderboard,
  type DashboardLeaderboardScoreRow, type DashboardTribe,
  type DashboardRareDinos, type DashboardActivity,
} from "../services/api";
import DiscordIcon from "../components/DiscordIcon";

// ── Helpers ─────────────────────────────────────────────────────────────────

function avatarUrl(userId: string, hash: string | null): string | null {
  if (!hash) return null;
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=128`;
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

/** "2h fa", "3g fa", "ora" -- relative time from now. */
function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000)        return "ora";
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)}m fa`;
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)}h fa`;
  if (diff < 86_400_000*30) return `${Math.floor(diff / 86_400_000)}g fa`;
  return d.toLocaleDateString();
}

/** Humanise minutes (login duration) into "Xh YYm" / "Mm". */
function fmtMinutes(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min - h * 60;
  return `${h}h ${m}m`;
}

/** Humanise hours into "Xg Yh" / "Yh" / "<1h" / "scaduto da Xh". */
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
  onLogout?: () => void;
  embedded?: boolean;
}

export default function PlayerDashboardPage({ onLogout, embedded = false }: PlayerDashboardPageProps) {
  const { t } = useTranslation();
  const [data, setData]       = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setErrorStatus(null);
    try {
      const res = await meApi.dashboard();
      setData(res.data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? null;
      setErrorStatus(status);
      setError(extractError(err, t("dashboard.errors.load", { defaultValue: "Failed to load dashboard." })));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  async function handleLogout(): Promise<void> {
    try { await discordAuthApi.logout(); } catch { /* best-effort */ }
    onLogout?.();
    window.location.href = "/";
  }

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
              <RefreshCw size={12} />{" "}{t("common.refresh", { defaultValue: "Refresh" })}
            </button>
          </div>
          {children}
        </div>
      )
    : ({ children }: { children: React.ReactNode }) => (
        <div style={{
          minHeight: "100vh",
          background: "var(--bg, #f5f5f7)",
          padding: "1.5rem",
        }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <PageHeader
              discord={data?.discord ?? null}
              characterName={data?.character.name ?? null}
              presence={data?.presence ?? null}
              pulse={data?.server_pulse ?? null}
              onRefresh={() => load()}
              onLogout={handleLogout}
            />
            <div style={{ marginTop: "1rem" }}>{children}</div>
          </div>
        </div>
      );

  return (
    <Wrapper>
      <>
        {error && (
          <div className="alert alert-error">
            <AlertCircle size={14} /> {error}
            {errorStatus === 403 && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", opacity: 0.85 }}>
                {t("dashboard.hint.notLinked", {
                  defaultValue: "An admin must link your Discord account to an ARK player from Settings -> Discord -> Accounts.",
                })}
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
          <DashboardGrid data={data} embedded={embedded} />
        ) : null}
      </>
    </Wrapper>
  );
}

// ── Standalone slim header (full-canvas mode only) ──────────────────────────

function PageHeader({
  discord, characterName, presence, pulse, onRefresh, onLogout,
}: {
  discord: DashboardDiscord | null;
  characterName: string | null;
  presence: DashboardPresence | null;
  pulse:    DashboardServerPulse | null;
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
      gap: "1rem", padding: "0.8rem 1.1rem",
      background: "linear-gradient(135deg, #5865F2 0%, #4752C4 100%)",
      color: "#fff",
      border: "1px solid #4752C4",
      borderRadius: 12,
      boxShadow: "0 4px 12px rgba(88, 101, 242, 0.25)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
        {av ? (
          <img src={av} alt=""
            style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "3px solid #ffffff66" }}
          />
        ) : (
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "#ffffff22", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1.6rem", fontWeight: 700, border: "3px solid #ffffff66",
          }}>
            {name[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div>
          <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>
            {t("dashboard.greeting", { defaultValue: "Ciao {{n}}", n: name })}
          </div>
          <div style={{ fontSize: "0.78rem", opacity: 0.9, display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <DiscordIcon size={9} color="#fff" />
              {discord?.discord_username ? `@${discord.discord_username}` : (discord?.discord_user_id ?? "")}
            </span>
            {presence?.online_now ? (
              <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <Wifi size={11} color="#16fc77" />
                {t("dashboard.header.onlineOn", {
                  defaultValue: "Online su {{s}} ({{m}})",
                  s: presence.server_name || presence.server_key || "?",
                  m: fmtMinutes(presence.duration_minutes),
                })}
              </span>
            ) : (
              <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", opacity: 0.85 }}>
                <WifiOff size={11} /> {t("dashboard.header.offline", { defaultValue: "Offline" })}
              </span>
            )}
            {pulse && (
              <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", opacity: 0.85 }}>
                <Server size={11} />
                {t("dashboard.header.pulse", {
                  defaultValue: "{{p}} giocatori su {{s}}/{{t}} server online",
                  p: pulse.players_online_total,
                  s: pulse.servers_online,
                  t: pulse.servers_total,
                })}
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button onClick={onRefresh}
          style={{
            background: "#ffffff22", color: "#fff", border: "1px solid #ffffff44",
            padding: "0.45rem 0.6rem", borderRadius: 6, cursor: "pointer",
          }}
          title={t("common.refresh", { defaultValue: "Refresh" })}
        >
          <RefreshCw size={14} />
        </button>
        <button onClick={onLogout}
          style={{
            background: "#ffffff22", color: "#fff", border: "1px solid #ffffff44",
            padding: "0.45rem 0.6rem", borderRadius: 6, cursor: "pointer",
          }}
          title={t("nav.logout", { defaultValue: "Log out" })}
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Grid of cards ───────────────────────────────────────────────────────────

function DashboardGrid({ data, embedded }: { data: DashboardResponse; embedded: boolean }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: embedded ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))",
      gap: "0.85rem",
    }}>
      {/* Hero character spans both columns */}
      <div style={{ gridColumn: "1 / -1" }}>
        <CharacterHero character={data.character} presence={data.presence} />
      </div>

      <ShopCard       data={data.shop} />
      <LeaderboardCard data={data.leaderboard} />
      <DecayCard      data={data.decay} />
      <RareDinosCard  data={data.rare_dinos} />
      <TribeCard      data={data.tribe} />
      <ActivityCard   data={data.activity} />
    </div>
  );
}

// ── Hero character card ─────────────────────────────────────────────────────

function CharacterHero({
  character, presence,
}: {
  character: DashboardCharacter;
  presence:  DashboardPresence;
}) {
  const { t } = useTranslation();
  const activeTimed = character.timed_permission_groups.filter(g => !g.expired);
  const isVip = character.permission_groups.includes("VIP")
    || activeTimed.some(g => g.group === "VIP");
  const vipExpiry = activeTimed.find(g => g.group === "VIP")?.expires_at_iso ?? null;

  return (
    <div className="pl-sync-panel" style={{ padding: 0 }}>
      <div style={{
        padding: "1rem 1.2rem",
        background: isVip
          ? "linear-gradient(135deg, #facc1520 0%, transparent 60%)"
          : "transparent",
        display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap",
      }}>
        <div style={{
          width: 60, height: 60, borderRadius: "50%",
          background: isVip
            ? "linear-gradient(135deg, #facc15, #f97316)"
            : "linear-gradient(135deg, #6b7280, #4b5563)",
          color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1.6rem", fontWeight: 700,
          flexShrink: 0,
          boxShadow: isVip ? "0 0 12px rgba(250, 204, 21, 0.4)" : "none",
        }}>
          {(character.name || "?")[0].toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "1.3rem", fontWeight: 700 }}>
              {character.name || t("dashboard.unknownPlayer", { defaultValue: "?" })}
            </span>
            {isVip && (
              <span className="pl-chip" style={{
                background: "linear-gradient(90deg, #facc15, #f97316)",
                color: "#fff", borderColor: "#f59e0b",
                fontSize: "0.78rem", padding: "0.15rem 0.55rem",
              }}>
                <Crown size={11} /> VIP
                {vipExpiry && (
                  <span style={{ opacity: 0.85, marginLeft: 4 }}>
                    {" · scade " + fmtRelative(vipExpiry)}
                  </span>
                )}
              </span>
            )}
            {presence.online_now && (
              <span className="pl-chip" style={{
                background: "#16a34a15", color: "#16a34a", borderColor: "#16a34a40",
              }}>
                <Wifi size={9} /> {t("dashboard.online", { defaultValue: "Online" })}
              </span>
            )}
          </div>
          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: 4 }}>
            {character.tribe_name ? (
              <>
                <Users size={11} style={{ verticalAlign: "middle" }} /> {character.tribe_name}
                {character.tribe_id ? ` (#${character.tribe_id})` : ""}
              </>
            ) : (
              t("dashboard.character.noTribe", { defaultValue: "Senza tribù" })
            )}
            <span style={{ marginLeft: "0.6rem" }}>
              <Clock size={11} style={{ verticalAlign: "middle" }} />{" "}
              {presence.online_now
                ? t("dashboard.header.connectedFor", {
                    defaultValue: "connesso da {{m}}",
                    m: fmtMinutes(presence.duration_minutes),
                  })
                : t("dashboard.character.lastSeen", {
                    defaultValue: "ultimo accesso {{r}}",
                    r: fmtRelative(character.last_login),
                  })}
            </span>
          </div>
        </div>

        {/* Permanent perm group chips */}
        {character.permission_groups.length > 0 && (
          <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", maxWidth: "40%" }}>
            {character.permission_groups.filter(g => g !== "VIP").map(g => (
              <span key={g} className="pl-chip">
                <Shield size={9} /> {g}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Active timed perm groups */}
      {activeTimed.length > 0 && (
        <div style={{
          padding: "0.55rem 1.2rem",
          borderTop: "1px solid var(--border)",
          display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center",
        }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            {t("dashboard.character.timedShort", { defaultValue: "Permessi a tempo" })}
          </span>
          {activeTimed.map((g, i) => (
            <span key={`${g.group}-${i}`} className="pl-chip" style={{
              background: "#16a34a10", color: "#16a34a", borderColor: "#16a34a40",
            }}>
              <Clock size={9} /> {g.group} · scade {fmtRelative(g.expires_at_iso)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shop card ───────────────────────────────────────────────────────────────

function ShopCard({ data }: { data: DashboardShop }) {
  const { t } = useTranslation();
  return (
    <Card icon={<ShoppingBag size={14} />} title={t("dashboard.shop.title", { defaultValue: "ArkShop" })}>
      <div style={{ display: "flex", justifyContent: "space-around", gap: "0.5rem" }}>
        <BigStat value={data.points.toLocaleString()} label={t("dashboard.shop.points", { defaultValue: "Punti" })} color="#16a34a" />
        <BigStat value={data.total_spent.toLocaleString()} label={t("dashboard.shop.totalSpent", { defaultValue: "Spesi" })} color="#6b7280" />
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
            marginTop: "0.3rem", maxHeight: 160,
          }}>
            {data.kits_raw}
          </pre>
        </details>
      )}
    </Card>
  );
}

// ── Leaderboard card ────────────────────────────────────────────────────────

function LeaderboardCard({ data }: { data: DashboardLeaderboard }) {
  const { t } = useTranslation();
  if (!data.has_scores) {
    return (
      <Card icon={<Trophy size={14} />} title={t("dashboard.leaderboard.title", { defaultValue: "Classifica" })}>
        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {t("dashboard.leaderboard.empty", { defaultValue: "Nessun punto in classifica ancora." })}
        </div>
      </Card>
    );
  }
  return (
    <Card icon={<Trophy size={14} />} title={t("dashboard.leaderboard.title", { defaultValue: "Classifica" })}>
      {data.scores.map((s, i) => <LeaderboardScoreBlock key={i} score={s} />)}
    </Card>
  );
}

function LeaderboardScoreBlock({ score }: { score: DashboardLeaderboardScoreRow }) {
  const { t } = useTranslation();
  const rankPct = (score.rank && score.total_players)
    ? 100 - ((score.rank - 1) / score.total_players * 100)
    : null;
  return (
    <div style={{ marginBottom: "0.6rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.4rem" }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
          {score.server_type ? `#${score.rank} su ${score.total_players} (${score.server_type})` : "—"}
        </span>
        <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
          {score.total_points.toLocaleString()} pt
        </span>
      </div>
      {rankPct !== null && (
        <div style={{
          height: 6, background: "var(--bg-card-muted, #e5e7eb)", borderRadius: 3,
          marginTop: 4, marginBottom: 8, overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${Math.max(2, rankPct)}%`,
            background: rankPct > 75 ? "#16a34a" : rankPct > 25 ? "#f59e0b" : "#dc2626",
            transition: "width 0.4s",
          }} />
        </div>
      )}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.2rem 0.6rem",
        fontSize: "0.75rem",
      }}>
        <Stat icon="⚔" label={t("dashboard.lb.killWild", { defaultValue: "Kill wild" })} value={score.kills_wild} />
        <Stat icon="🦖" label={t("dashboard.lb.tames", { defaultValue: "Tame" })} value={score.tames} />
        <Stat icon="🏹" label={t("dashboard.lb.killPlayer", { defaultValue: "Kill PvP" })} value={score.kills_player} />
        <Stat icon="🔨" label={t("dashboard.lb.crafts", { defaultValue: "Craft" })} value={score.crafts} />
        <Stat icon="🐉" label={t("dashboard.lb.killDino", { defaultValue: "Kill dino enemy" })} value={score.kills_enemy_dino} />
        <Stat icon="🏚" label={t("dashboard.lb.structs", { defaultValue: "Strutture distrutte" })} value={score.structs_destroyed} />
        <Stat icon="💀" label={t("dashboard.lb.deaths", { defaultValue: "Morti" })} value={score.deaths} />
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
      <span>{icon} {label}</span>
      <span style={{ fontWeight: 600, color: "var(--text)" }}>{value.toLocaleString()}</span>
    </div>
  );
}

// ── Decay card ──────────────────────────────────────────────────────────────

function DecayCard({ data }: { data: DashboardDecay }) {
  const { t } = useTranslation();
  if (!data.has_tribe) {
    return (
      <Card icon={<Timer size={14} />} title={t("dashboard.decay.title", { defaultValue: "Decadimento" })}>
        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {t("dashboard.decay.noTribe", { defaultValue: "Non sei in nessuna tribù registrata." })}
        </div>
      </Card>
    );
  }
  const statusColor =
    data.status === "expired"  ? "#dc2626" :
    data.status === "expiring" ? "#d97706" : "#16a34a";
  const StatusIcon =
    data.status === "expired"  ? AlertTriangle :
    data.status === "expiring" ? AlertCircle   : CheckCircle2;
  return (
    <Card icon={<Timer size={14} />} title={t("dashboard.decay.title", { defaultValue: "Decadimento" })}>
      <div style={{
        padding: "0.5rem 0.65rem", borderRadius: 6,
        background: `${statusColor}15`, border: `1px solid ${statusColor}40`,
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
          <div style={{ fontSize: "0.78rem" }}>{fmtCountdown(data.hours_left)}</div>
        </div>
      </div>
      <KV label={t("dashboard.decay.lastRefreshAt", { defaultValue: "Ultimo refresh" })}
          value={data.last_refresh_at
            ? `${fmtRelative(data.last_refresh_at)}${data.last_refresh_name ? ` (${data.last_refresh_name})` : ""}`
            : "—"} />
      {data.scheduled_for_purge && (
        <div style={{
          marginTop: "0.5rem", padding: "0.4rem 0.55rem",
          background: "#dc262615", border: "1px solid #dc262640",
          borderRadius: 6, fontSize: "0.78rem", color: "#dc2626",
        }}>
          <AlertTriangle size={11} style={{ verticalAlign: "middle" }} />{" "}
          {t("dashboard.decay.scheduledPurge", { defaultValue: "Tribù programmata per purge." })}
        </div>
      )}
    </Card>
  );
}

// ── Tribe roster card ───────────────────────────────────────────────────────

function TribeCard({ data }: { data: DashboardTribe }) {
  const { t } = useTranslation();
  if (!data.has_tribe) {
    return (
      <Card icon={<Users size={14} />} title={t("dashboard.tribe.title", { defaultValue: "Tribù" })}>
        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {t("dashboard.tribe.empty", { defaultValue: "Nessuna tribù registrata." })}
        </div>
      </Card>
    );
  }
  const onlineCount = data.members.filter(m => m.online_now).length;
  return (
    <Card
      icon={<Users size={14} />}
      title={t("dashboard.tribe.titleWithCount", {
        defaultValue: "Tribù: {{n}} ({{m}} membri · {{o}} online)",
        n: data.tribe_name || `#${data.tribe_id ?? "?"}`,
        m: data.members.length,
        o: onlineCount,
      })}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", maxHeight: 220, overflowY: "auto" }}>
        {data.members.map(m => (
          <div key={m.eos_id} style={{
            display: "flex", alignItems: "center", gap: "0.5rem",
            padding: "0.3rem 0.4rem", borderRadius: 4,
            background: m.is_self ? "var(--accent-50, #2563eb15)" : "transparent",
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%",
              background: m.online_now ? "#16a34a" : "#9ca3af",
              boxShadow: m.online_now ? "0 0 6px #16a34a" : "none",
              flexShrink: 0,
            }} />
            <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: m.is_self ? 600 : 400 }}>
              {m.name || m.eos_id.slice(0, 8) + "…"}
              {m.is_self && <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "var(--accent)" }}>(tu)</span>}
            </span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              {m.online_now
                ? t("dashboard.tribe.onlineNow", { defaultValue: "ora" })
                : fmtRelative(m.last_login_iso)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Rare dinos card ─────────────────────────────────────────────────────────

function RareDinosCard({ data }: { data: DashboardRareDinos }) {
  const { t } = useTranslation();
  return (
    <Card icon={<Skull size={14} />} title={t("dashboard.rare.title", { defaultValue: "Rare dino (30g)" })}>
      <div style={{ display: "flex", justifyContent: "space-around", marginBottom: "0.5rem" }}>
        <BigStat value={String(data.kills_30d)} label={t("dashboard.rare.kills", { defaultValue: "Kill" })} color="#dc2626" />
        <BigStat value={String(data.tames_30d)} label={t("dashboard.rare.tames", { defaultValue: "Tame" })} color="#16a34a" />
      </div>
      {data.recent.length === 0 ? (
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
          {t("dashboard.rare.empty", { defaultValue: "Nessun rare dino interagito di recente." })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxHeight: 200, overflowY: "auto" }}>
          {data.recent.map(e => (
            <div key={e.id} style={{
              display: "flex", justifyContent: "space-between",
              padding: "0.25rem 0.4rem", borderRadius: 3,
              background: "var(--bg-card-muted, #f5f5f7)",
              fontSize: "0.78rem",
            }}>
              <span>
                <span style={{
                  fontSize: "0.65rem", padding: "0.1rem 0.35rem", borderRadius: 8,
                  background: e.event_type === "KILLED" ? "#dc262615" : "#16a34a15",
                  color: e.event_type === "KILLED" ? "#dc2626" : "#16a34a",
                  marginRight: 6, fontWeight: 600,
                }}>
                  {e.event_type}
                </span>
                {e.dino_name || "?"}
                {e.dino_level !== null ? ` (lvl ${e.dino_level})` : ""}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>{fmtRelative(e.event_at_iso)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Activity feed card ──────────────────────────────────────────────────────

function ActivityCard({ data }: { data: DashboardActivity }) {
  const { t } = useTranslation();
  if (data.items.length === 0) {
    return (
      <Card icon={<ActivityIcon size={14} />} title={t("dashboard.activity.title", { defaultValue: "Attività recente" })}>
        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {t("dashboard.activity.empty", { defaultValue: "Nessuna attività recente." })}
        </div>
      </Card>
    );
  }
  return (
    <Card icon={<ActivityIcon size={14} />} title={t("dashboard.activity.title", { defaultValue: "Attività recente" })}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", maxHeight: 240, overflowY: "auto" }}>
        {data.items.map((e, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", gap: "0.5rem",
            padding: "0.3rem 0.4rem", borderRadius: 3,
            background: e.source === "lb_event" ? "var(--accent-50, #2563eb12)" : "var(--bg-card-muted, #f5f5f7)",
            fontSize: "0.78rem",
          }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                fontSize: "0.65rem", padding: "0.1rem 0.35rem", borderRadius: 8,
                background: e.source === "lb_event" ? "#2563eb15" : "#6b728015",
                color: e.source === "lb_event" ? "#2563eb" : "#6b7280",
                marginRight: 6, fontWeight: 600,
              }}>
                {e.kind}
              </span>
              {e.points !== null && <strong style={{ color: "#16a34a" }}>+{e.points} </strong>}
              {e.detail && (
                <span style={{ color: "var(--text-secondary)" }}>{e.detail}</span>
              )}
            </span>
            <span style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
              {fmtRelative(e.when_iso)}
            </span>
          </div>
        ))}
      </div>
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
      <div className="pl-sync-header" style={{ padding: "0.5rem 0.8rem" }}>
        <span className="pl-sync-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {icon} {title}
        </span>
      </div>
      <div className="pl-sync-body" style={{ padding: "0.7rem 0.8rem" }}>
        {children}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span style={{
        fontSize: "0.72rem", color: "var(--text-secondary)",
        minWidth: 110, textTransform: "uppercase", letterSpacing: 0.4,
      }}>
        {label}
      </span>
      <span style={{ fontSize: "0.85rem", fontWeight: 500, flex: 1 }}>{value}</span>
    </div>
  );
}

function BigStat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ textAlign: "center", padding: "0.4rem 0.6rem" }}>
      <div style={{ fontSize: "1.4rem", fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
    </div>
  );
}
