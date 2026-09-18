/**
 * shopFallbackIcon.tsx — fallback icon when the wiki has no image.
 *
 * One icon per kind, not a neutral placeholder: it still says something
 * (crate, creature, gene) and keeps the grid aligned, which is the one thing
 * an empty box would not do.
 */
import { Package, PawPrint, Dna } from "lucide-react";

export function ShopFallbackIcon({ kind, size = 20 }: { kind: string; size?: number }) {
  const color = "var(--text-muted)";
  if (kind === "dino") return <PawPrint size={size} color={color} />;
  if (kind === "gene") return <Dna size={size} color={color} />;
  return <Package size={size} color={color} />;
}
