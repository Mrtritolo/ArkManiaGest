/**
 * PlayerDashboardPage -- the view a Discord-linked player gets of their own
 * character: presence, ArkShop points, leaderboard standing, decay timers,
 * tribe, saved homes, self-service tools and the GDPR footer.
 *
 * Two render modes:
 *   - standalone: own <main>, player density, Discord header with logout.
 *   - embedded: a block inside the admin shell (no logout, no privacy footer:
 *     an admin manages links from Settings instead).
 *
 * Decay and homes are per MAP, not per player: a cluster player has a separate
 * tribe and a separate home limit on every map they play.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, RotateCw, ShoppingBag, User } from "lucide-react";
import { Link } from "react-router-dom";
import { Alert, Button, buttonClass, PageHeader, Spinner } from "../../components/ui";
import type { AuthUser } from "../../types";
import { useDashboard } from "./hooks/useDashboard";
import { PlayerHeader } from "./components/PlayerHeader";
import { PrivacyFooter } from "./components/PrivacyFooter";
import { DashboardGrid } from "./components/DashboardGrid";

interface PlayerDashboardPageProps {
  onLogout?: () => void;
  embedded?: boolean;
  /**
   * Accepted because App.tsx hands it to every page; unused on purpose:
   * every action here is authorised by the viewer's own Discord session
   * (/me/*), not by a panel role, so there is nothing to gate.
   */
  currentUser?: AuthUser | null;
}

export default function PlayerDashboardPage({ onLogout, embedded = false }: PlayerDashboardPageProps) {
  const { t } = useTranslation();
  const { data, loading, error, errorStatus, version, load, handleLogout } =
    useDashboard({ onLogout, t });

  // Player density for the standalone page, on <body> so the confirms and
  // toasts portaled there inherit it too (MASTER section 5).
  useEffect(() => {
    if (embedded) return;
    document.body.classList.add("ui-scope-player");
    return () => document.body.classList.remove("ui-scope-player");
  }, [embedded]);

  const body = (
    <>
      {error && (
        <Alert
          tone="danger"
          title={t("dashboard.errors.load")}
          actions={
            <Button size="sm" icon={RotateCw} onClick={() => void load()}>
              {t("common.retry")}
            </Button>
          }
        >
          {error}
          {errorStatus === 403 && <div>{t("dashboard.hint.notLinked")}</div>}
        </Alert>
      )}

      {/* The spinner replaces the page only on the very first load. A refresh
          keeps the cards on screen (the page used to collapse to a spinner,
          jump to the top and reset every card's own state). */}
      {data ? (
        <DashboardGrid data={data} reloadToken={version} onChanged={() => void load()} />
      ) : loading ? (
        <Spinner block label={t("dashboard.loading")} />
      ) : null}

      {/* GDPR self-service: policy link, data export, account erasure. Shown
          in the standalone view, where the data subject is the logged-in
          player. */}
      {!embedded && (data !== null || !loading) && (
        <PrivacyFooter onDeleted={() => void handleLogout()} />
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="l-page">
        <PageHeader
          title={t("dashboard.embeddedTitle")}
          icon={User}
          description={t("dashboard.embeddedSubtitle")}
          actions={
            <>
              <Link to="/market" className={buttonClass({ variant: "secondary" })}>
                <ShoppingBag aria-hidden="true" />
                {t("nav.market")}
              </Link>
              <Button icon={RefreshCw} loading={loading} loadingLabel={t("common.loading")}
                onClick={() => void load()}>
                {t("common.refresh")}
              </Button>
            </>
          }
        />
        {body}
      </div>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="l-page">
      <PlayerHeader
        discord={data?.discord ?? null}
        characterName={data?.character.name ?? null}
        presence={data?.presence ?? null}
        pulse={data?.server_pulse ?? null}
        refreshing={loading}
        onRefresh={() => void load()}
        onLogout={() => void handleLogout()}
      />
      {body}
    </main>
  );
}
