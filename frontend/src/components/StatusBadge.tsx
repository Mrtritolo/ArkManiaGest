/**
 * StatusBadge.tsx — Colour-coded indicator for machine / connection status.
 *
 * Renders a small pill with a coloured dot and a short label.
 * Unknown status values fall back to the "unknown" appearance.
 */

interface StatusBadgeProps {
  /** One of: "online" | "offline" | "error" | "unknown" | "testing" */
  status: string;
  /** Controls the overall size of the badge (default: "sm"). */
  size?: "sm" | "md";
}

interface BadgeAppearance {
  label: string;
  className: string;
}

const STATUS_MAP: Record<string, BadgeAppearance> = {
  online:  { label: "Online",   className: "badge-online" },
  offline: { label: "Offline",  className: "badge-offline" },
  error:   { label: "Error",    className: "badge-error" },
  unknown: { label: "N/A",      className: "badge-unknown" },
  testing: { label: "Testing…", className: "badge-testing" },
};

export default function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const appearance = STATUS_MAP[status] ?? STATUS_MAP.unknown;

  return (
    <span
      className={`badge ${appearance.className}${size === "md" ? " badge-md" : ""}`}
    >
      <span className="badge-dot" />
      {appearance.label}
    </span>
  );
}
