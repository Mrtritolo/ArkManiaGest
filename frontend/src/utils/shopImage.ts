/**
 * shopImage.ts — quale immagine mostra una voce del negozio.
 *
 * Le regole, in ordine:
 *
 *  1. `[BOSS] X` — il titolo nomina il boss, e l'immagine giusta e' quella
 *     del boss, non quella del primo tributo che serve per evocarlo. La
 *     convenzione `[BOSS] ` esiste gia' nei titoli del catalogo ArkShop.
 *  2. Pacchetto — l'immagine del PRIMO oggetto della lista. E' arbitraria
 *     (un set di armatura mostrera' gli stivali) ma e' sempre disponibile e
 *     non richiede di indovinare quale pezzo rappresenti il pacchetto.
 *  3. Voce singola / dino — l'immagine del suo blueprint.
 *
 * Le immagini passano tutte dalla cache del pannello (`/market/thumb/...`),
 * non dalla wiki: la CSP resta `img-src 'self'` e un cambio di slug lato
 * wiki non rompe decine di schede insieme.
 */
import { arkItemThumbUrl } from "./arkItem";
import type { WebShopItem } from "../services/api";

/** Prefisso con cui il catalogo marca le voci dei boss. */
const BOSS_PREFIX = "[BOSS]";

/** Prefissi di titolo che non fanno parte del nome da cercare sulla wiki. */
const TITLE_TAGS = [BOSS_PREFIX, "[BP]", "[KIT]"];

function stripTags(title: string): string {
  let out = title.trim();
  for (const tag of TITLE_TAGS)
    if (out.toUpperCase().startsWith(tag)) out = out.slice(tag.length).trim();
  return out;
}

/** True quando la voce e' un kit boss. */
export function isBossEntry(entry: { label: string }): boolean {
  return entry.label.trim().toUpperCase().startsWith(BOSS_PREFIX);
}

/**
 * URL dell'immagine per una voce di catalogo, o null quando non c'e' nulla
 * di sensato da chiedere. Il chiamante ripiega sull'icona del tipo.
 */
export function shopEntryThumbUrl(entry: WebShopItem): string | null {
  if (isBossEntry(entry)) {
    const name = stripTags(entry.label);
    if (name) return `/api/v1/market/thumb/${encodeURIComponent(name)}`;
  }
  const first = entry.lines?.[0]?.blueprint || entry.blueprint;
  return first ? arkItemThumbUrl(first) : null;
}
