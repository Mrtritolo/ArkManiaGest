/**
 * StatusBadge.tsx — Colour-coded indicator for machine / connection status.
 *
 * Renders a small pill with a coloured dot and a short label.
 * Unknown status values fall back to the "unknown" appearance.
 */

import { useTranslation } from "react-i18next";

interface StatusBadgeProps {
  /** One of: "online" | "offline" | "error" | "unknown" | "testing" */
  status: string;
  /** Controls the overall size of the badge (default: "sm"). */
  size?: "sm" | "md";
}

const STATUS_CLASS: Record<string, string> = {
  online: "badge-online",
  offline: "badge-offline",
  error: "badge-error",
  unknown: "badge-unknown",
  testing: "badge-testing",
};

export default function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const { t } = useTranslation();
  const key = STATUS_CLASS[status] ? status : "unknown";

  return (
    <span
      className={`badge ${STATUS_CLASS[key]}${size === "md" ? " badge-md" : ""}`}
    >
      <span className="badge-dot" />
      {t(`machines.status.${key}`)}
    </span>
  );
}
