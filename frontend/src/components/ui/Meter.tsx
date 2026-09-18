import "./Meter.css";

export interface MeterProps {
  value: number;
  /** Default 100. */
  max?: number;
  /** Accessible name, e.g. 'CPU usage vm-01'. */
  label: string;
  /** aria-valuetext, e.g. '42 %' or '18 of 70 players'. */
  valueText?: string;
  /** The caller maps thresholds (e.g. 60 / 85) to a tone. Default 'accent'. */
  tone?: "accent" | "success" | "warning" | "danger";
  /** 'meter' for gauges, 'progress' for running jobs. */
  kind?: "meter" | "progress";
  className?: string;
}

/**
 * Thin gauge / progress bar. The caller always prints the number next to it,
 * so meaning is never carried by colour or length alone.
 */
export function Meter({ value, max = 100, label, valueText, tone = "accent", kind = "meter", className }: MeterProps) {
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  return (
    <div
      className={className ? `ui-meter ui-meter--${tone} ${className}` : `ui-meter ui-meter--${tone}`}
      role={kind === "progress" ? "progressbar" : "meter"}
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuetext={valueText}
    >
      {/* Data-driven width: the one allowed inline style. */}
      <div className="ui-meter__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
