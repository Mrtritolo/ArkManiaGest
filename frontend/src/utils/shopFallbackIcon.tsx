/**
 * shopFallbackIcon.tsx — icona di ripiego quando la wiki non ha l'immagine.
 *
 * Un'icona per tipo, non un segnaposto neutro: dice comunque qualcosa
 * (cassa, creatura, gene) e tiene la griglia allineata, che e' l'unica cosa
 * che un riquadro vuoto non farebbe.
 */
import { Package, PawPrint, Dna } from "lucide-react";

export function ShopFallbackIcon({ kind, size = 20 }: { kind: string; size?: number }) {
  const color = "var(--text-muted)";
  if (kind === "dino") return <PawPrint size={size} color={color} />;
  if (kind === "gene") return <Dna size={size} color={color} />;
  return <Package size={size} color={color} />;
}
