import { useEffect, useState } from "react";
import "./Avatar.css";

export interface AvatarProps {
  /** Source of the fallback initial; empty or whitespace -> '?'. */
  name: string;
  /** e.g. the Discord CDN; a load error falls back to the initial. */
  src?: string | null;
  /** 24 / 32 / 56px. Default 'md'. */
  size?: "sm" | "md" | "lg";
}

/** Decorative avatar: the name is always rendered next to it. */
export function Avatar({ name, src, size = "md" }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  // Code-point safe (emoji names) and never crashes on an empty name.
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";

  return (
    <span className={`ui-avatar ui-avatar--${size}`} aria-hidden="true">
      {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : initial}
    </span>
  );
}
