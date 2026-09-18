/**
 * ShopThumb / LineThumb -- catalogue artwork with a fallback that still says
 * something.
 *
 * The wiki has no page for everything (mod items, non-standard names): each
 * candidate is tried in order (boss, first line of the bundle, blueprint,
 * label) and only when they all fail does the kind icon appear -- never a
 * broken box, so the grid stays aligned.
 */
import { useState } from "react";
import { Dna, Package, PawPrint, type LucideIcon } from "lucide-react";
import { shopEntryThumbCandidates } from "../../../utils/shopImage";
import { arkItemThumbUrl } from "../../../utils/arkItem";
import type { WebShopItem } from "../../../services/api";
import styles from "../MarketPage.module.css";

const KIND_ICON: Record<string, LucideIcon> = { dino: PawPrint, gene: Dna };

export function ShopThumb({ entry }: { entry: WebShopItem }) {
  const [idx, setIdx] = useState(0);
  const candidates = shopEntryThumbCandidates(entry);
  const frame = `ui-thumb ui-thumb--square ${styles.shopThumb}`;

  if (idx >= candidates.length) {
    const Icon = KIND_ICON[entry.kind] ?? Package;
    return (
      <span className={frame}>
        <Icon aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={frame}>
      {/* Decorative: the entry label sits next to the frame. */}
      <img src={candidates[idx]} alt="" loading="lazy" onError={() => setIdx(i => i + 1)} />
    </span>
  );
}

/** Icon of one line inside a bundle's contents. */
export function LineThumb({ blueprint }: { blueprint: string }) {
  const [failed, setFailed] = useState(false);
  const url = arkItemThumbUrl(blueprint);
  if (!url || failed) return <span className={styles.lineThumb} aria-hidden="true" />;
  return (
    <img src={url} alt="" loading="lazy" className={styles.lineThumb}
      onError={() => setFailed(true)} />
  );
}
