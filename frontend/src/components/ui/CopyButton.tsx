import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyText } from "../../utils/clipboard";
import { IconButton } from "./IconButton";
import { useToast } from "./Toast";

export interface CopyButtonProps {
  value: string;
  /** The action, e.g. t('bans.copyEos'). Stays the accessible name after copying. */
  label: string;
  size?: "sm" | "md";
}

const COPIED_MS = 1500;

/** Copies IDs, paths, commands and coordinates, always with feedback. */
export function CopyButton({ value, label, size = "sm" }: CopyButtonProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    const ok = await copyText(value);
    if (!ok) {
      toast.error(t("ui.copyFailed"));
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <span className="ui-copy">
      <IconButton size={size} icon={copied ? Check : Copy} label={label} onClick={copy} />
      <span className="u-sr-only" role="status">
        {copied ? t("ui.copied") : ""}
      </span>
    </span>
  );
}
