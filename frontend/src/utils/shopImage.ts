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

/**
 * Suffissi che marcano un PACCHETTO, non l'oggetto: la wiki ha
 * "Manticore", non "Manticore Arena"; "Rhyniognatha", non
 * "Rhyniognatha Kit".
 */
const BUNDLE_SUFFIXES = [
  " Taming Kit", " Boss Pack", " Arena", " Kit", " Pack", " Set",
];

/**
 * Varianti del titolo da provare quando il titolo intero non e' una
 * pagina wiki. Due regole, entrambe viste nel catalogo reale:
 *
 *  - `A / B` — il titolo elenca il boss di due mappe ("Broodmother
 *    Lysrix / Natrix"): la wiki ha una pagina per ciascuno, non per la
 *    coppia. Si prova il primo.
 *  - suffisso di pacchetto — "Manticore Arena" -> "Manticore".
 *
 * Le varianti si compongono: "Megapithecus / Thodes" -> "Megapithecus".
 */
function labelVariants(label: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim();
    if (v && v !== label && !out.includes(v)) out.push(v);
  };

  const bases = [label];
  if (label.includes("/")) bases.push(label.split("/")[0]);

  for (const base of bases) {
    push(base);
    for (const suffix of BUNDLE_SUFFIXES)
      if (base.toLowerCase().endsWith(suffix.toLowerCase()))
        push(base.slice(0, -suffix.length));
  }
  return out;
}

/** True quando la voce e' un kit boss. */
export function isBossEntry(entry: { label: string }): boolean {
  return entry.label.trim().toUpperCase().startsWith(BOSS_PREFIX);
}

/**
 * Candidati d'immagine per una voce di catalogo, in ordine di preferenza.
 *
 * Non un solo URL ma una catena: la wiki non ha una pagina per tutto
 * (oggetti mod, kit custom) e ogni candidato fallito fa scattare il
 * successivo lato <img onError>. Ordine: nome boss, primo oggetto del
 * pacchetto, blueprint della voce, etichetta cosi' com'e' (molte voci di
 * catalogo usano il nome wiki esatto come titolo).
 */
export function shopEntryThumbCandidates(entry: WebShopItem): string[] {
  const urls: (string | null)[] = [];
  if (isBossEntry(entry)) {
    const name = stripTags(entry.label);
    if (name) urls.push(`/api/v1/market/thumb/${encodeURIComponent(name)}`);
  }
  const first = entry.lines?.[0]?.blueprint;
  if (first) urls.push(arkItemThumbUrl(first));
  if (entry.blueprint) urls.push(arkItemThumbUrl(entry.blueprint));
  const label = stripTags(entry.label);
  if (label) {
    urls.push(`/api/v1/market/thumb/${encodeURIComponent(label)}`);
    for (const v of labelVariants(label))
      urls.push(`/api/v1/market/thumb/${encodeURIComponent(v)}`);
  }
  return [...new Set(urls.filter((u): u is string => !!u))];
}
