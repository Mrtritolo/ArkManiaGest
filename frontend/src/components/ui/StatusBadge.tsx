import { CircleAlert, CircleCheck, CircleHelp, CircleOff, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, type BadgeTone } from "./Badge";

export type RuntimeStatus = "online" | "offline" | "updating" | "crashed" | "error" | "degraded" | "testing" | "unknown";

export interface StatusBadgeProps {
  /** Pages map raw API strings (running / stopped / restarting…) in their model file. */
  status: RuntimeStatus;
  /** Default t(`ui.status.${status}`). */
  label?: string;
}

const MAP: Record<RuntimeStatus, { tone: BadgeTone; icon: LucideIcon }> = {
  online: { tone: "success", icon: CircleCheck },
  offline: { tone: "neutral", icon: CircleOff },
  // Updating is info, so it never looks like Crashed or Mastercraft.
  updating: { tone: "info", icon: RefreshCw },
  testing: { tone: "info", icon: RefreshCw },
  crashed: { tone: "danger", icon: CircleAlert },
  error: { tone: "danger", icon: CircleAlert },
  degraded: { tone: "warning", icon: TriangleAlert },
  unknown: { tone: "neutral", icon: CircleHelp },
};

/** Runtime status of machines, instances, containers and servers. */
export function StatusBadge({ status, label }: StatusBadgeProps) {
  const { t } = useTranslation();
  const { tone, icon } = MAP[status];
  return (
    <Badge tone={tone} icon={icon}>
      {label ?? t(`ui.status.${status}`)}
    </Badge>
  );
}
