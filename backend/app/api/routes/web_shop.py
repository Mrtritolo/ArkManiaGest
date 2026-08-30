"""
api/routes/web_shop.py — acquisto dal web con i punti di gioco.

Il pannello vende, il plugin consegna. Qui vive solo la parte che il web puo'
fare da solo: mostrare il catalogo, scalare i punti ArkShop e mettere in coda
l'ordine in ``ARKM_shop_orders``. La consegna e' del plugin
(ARKM-Marketplace, ``/ritiro``), perche' un oggetto entra in un inventario e
un inventario esiste solo mentre il giocatore e' in gioco.

Due cataloghi, due sorgenti, entrambe autorevoli lato server:
  * item / dino — ``ARKM_web_shop_items``, popolata importando la config di
    ArkShop (rotta admin sotto). L'import esplicito e' voluto: la config di
    ArkShop contiene anche tipi che dal web non vendiamo (beacon,
    experience, unlockengram, command), e passare da una tabella dedicata
    permette di scegliere cosa esporre invece di riversare tutto.
  * gene — ``ARKM_gene_traits``, pubblicata dal plugin ARKM-GeneShop, che e'
    l'unico posto dove i tratti esistono davvero.

Sui punti: ArkShop rilegge ``ArkShopPlayers.Points`` dal DB a ogni
operazione e non tiene cache in memoria, quindi lo scalo fatto qui e' visto
dal gioco immediatamente. Lo scalo e' condizionale (``WHERE Points >= :p``)
in modo che due acquisti simultanei non possano portare il saldo sotto zero.
"""
from __future__ import annotations

import json
import logging
import random
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.db.session import get_db, get_plugin_db
from app.api.routes.blueprints import is_official_or_s_variant_dino
from app.api.routes.me import get_current_player, _PlayerSession

log = logging.getLogger("arkmaniagest.web_shop")

router = APIRouter()

# I soli tipi consegnabili dal web. 'command' e' escluso per scelta: la voce
# 'command' di ArkShop esegue console command arbitrari definiti in config, e
# dietro un bottone web significherebbe che una sessione del pannello puo'
# farli eseguire sul server. In gioco il rischio e' minore perche' il comando
# parte comunque da un giocatore presente.
WEB_KINDS = ("item", "dino", "gene", "egg", "embryo")

# ── Shop uova / embrioni ──────────────────────────────────────────────────────
#
# Il prezzo e' PER SPECIE, dal listino admin arkmaniagest_forge_prices (tab
# "Prezzi" del Mercato): l'uovo/embrione esce a livello fisso (EggLevel, da
# ARKM_config WebShop.<Shop>.EggLevel) con le stat selvatiche rollate qui,
# distribuite a caso come farebbe il gioco. Gli extra (colori, sesso, tratti)
# restano add-on a prezzo config; i tratti riusano il listino geni (matrice
# admin con fallback ai costi pubblicati dal plugin). La consegna la fa
# ARKM-Marketplace >= 7.5.0: l'item della specie lo ricava il plugin dal CDO
# del dino, qui viaggiano solo specie e parametri.

_FORGE_DEFAULTS = {
    "Enabled":           "true",
    "EggLevel":          "224",
    "PricePerColor":     "50",
    "PriceGenderChoice": "100",
    "MaxTraits":         "3",
}

# Slot dell'array Egg* su cui vengono distribuiti i punti selvatici rollati:
# Health, Stamina, Oxygen, Food, Weight, Melee. Torpidity/Speed e gli slot
# non usati restano a zero: un punto li' sarebbe un punto buttato per chi
# compra, non "regole di gioco".
_FORGE_ROLL_SLOTS = (0, 1, 3, 4, 7, 8)


async def _forge_config(db: AsyncSession, shop: str) -> dict:
    """Config di uno dei due shop ('Egg' | 'Embryo') con i default."""
    cfg = dict(_FORGE_DEFAULTS)
    try:
        rows = await db.execute(text(
            "SELECT config_key, config_value FROM ARKM_config "
            "WHERE server_key = '*' AND config_key LIKE :p"),
            {"p": f"WebShop.{shop}.%"})
        prefix_len = len(f"WebShop.{shop}.")
        for k, v in rows.fetchall():
            cfg[k[prefix_len:]] = v
    except Exception:
        log.info("web_shop: ARKM_config non leggibile, default forge in uso")

    def _i(name: str) -> int:
        try:
            return int(cfg[name])
        except Exception:
            return int(_FORGE_DEFAULTS[name])

    return {
        "enabled": str(cfg["Enabled"]).strip().lower() in ("true", "1", "yes"),
        "egg_level": max(2, min(500, _i("EggLevel"))),
        "price_per_color": _i("PricePerColor"),
        "price_gender_choice": _i("PriceGenderChoice"),
        "max_traits": _i("MaxTraits"),
    }


def _roll_wild_stats(level: int) -> list[int]:
    """
    Distribuisce i (level-1) punti selvatici a caso sugli slot utili,
    come farebbe il gioco per un selvatico di quel livello.
    """
    stats = [0] * 12
    for _ in range(max(0, level - 1)):
        stats[random.choice(_FORGE_ROLL_SLOTS)] += 1
    return stats


async def _gene_price_matrix(panel_db: AsyncSession) -> dict[tuple[str, int], int]:
    """Matrice admin (categoria, tier) -> prezzo. Vuota se mai configurata."""
    try:
        rows = await panel_db.execute(text(
            "SELECT category, tier, price FROM arkmaniagest_gene_prices"))
        return {(r[0], int(r[1])): int(r[2]) for r in rows.fetchall()}
    except Exception:
        return {}


def _gene_price(matrix: dict, category: str, tier: int, fallback: int) -> int:
    """Prezzo effettivo di un tratto: matrice admin, o costo del plugin."""
    return matrix.get((category, tier), fallback)


_forge_columns_ok: Optional[bool] = None


async def _forge_supported(db: AsyncSession) -> bool:
    """
    True se ARKM_shop_orders ha le colonne egg_* (plugin >= 7.5.0).

    Controllo PRIMA di scalare i punti: su un plugin vecchio la INSERT
    fallirebbe dopo l'addebito, cioe' il giocatore paga e non riceve.
    Cache per-processo: le colonne compaiono con un deploy, non spariscono.
    """
    global _forge_columns_ok
    if _forge_columns_ok:
        return True
    try:
        row = (await db.execute(text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_name = 'ARKM_shop_orders' "
            "AND column_name = 'egg_stats'"))).fetchone()
        _forge_columns_ok = bool(row and row[0])
    except Exception:
        _forge_columns_ok = False
    return bool(_forge_columns_ok)


def _lines_of(items_json: Optional[str]) -> list[dict]:
    """
    Righe che compongono una voce di catalogo.

    Una voce ArkShop non e' un oggetto: e' un pacchetto di 1..N righe
    (``Items``), ed e' normale che ne abbia cinque, come un set di armatura.
    Ogni riga porta il proprio blueprint, quantita', qualita' e flag
    blueprint.
    """
    if not items_json:
        return []
    try:
        parsed = json.loads(items_json)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


# ── Catalogo ──────────────────────────────────────────────────────────────────

@router.get("/catalog")
async def catalog(
    kind: Optional[str] = Query(None, description="item | dino | gene | egg | embryo"),
    db: AsyncSession = Depends(get_plugin_db),
    panel_db: AsyncSession = Depends(get_db),
):
    """
    Catalogo acquistabile dal web: oggetti e dino importati da ArkShop, piu'
    i tratti genetici pubblicati da ARKM-GeneShop.

    Rotta PUBBLICA, senza autenticazione: e' una vetrina e non contiene dati
    di nessun giocatore. Deve restare raggiungibile sia col JWT del pannello
    sia con la sola sessione Discord del giocatore, che JWT non ne ha; un
    gate a livello di router escluderebbe i secondi.
    """
    if kind and kind not in WEB_KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {WEB_KINDS}")

    items: list[dict] = []
    if kind in (None, "item", "dino"):
        where = "WHERE enabled = 1"
        params: dict = {}
        if kind:
            where += " AND kind = :k"
            params["k"] = kind
        rows = await db.execute(text(
            "SELECT item_key, label, kind, category, blueprint, quantity, "
            "quality, is_blueprint, dino_level, price, items_json "
            f"FROM ARKM_web_shop_items {where} ORDER BY category, label"), params)
        for r in rows.fetchall():
            lines = _lines_of(r[10])
            items.append({
                "key": r[0], "label": r[1], "kind": r[2], "category": r[3],
                "blueprint": r[4], "quantity": r[5], "quality": r[6],
                "is_blueprint": bool(r[7]), "dino_level": r[8], "price": r[9],
                # Le righe che compongono la voce. Vanno nel catalogo e non
                # dietro una seconda chiamata: sono poche decine di byte
                # ciascuna e servono per aprire il dettaglio senza attese.
                "lines": [
                    {
                        "blueprint": str(ln.get("Blueprint", "")),
                        "amount": int(ln.get("Amount", 1) or 1),
                        "quality": int(ln.get("Quality", 0) or 0),
                        "is_blueprint": bool(ln.get("ForceBlueprint", False)),
                    }
                    for ln in lines if isinstance(ln, dict)
                ],
                "line_count": len(lines) if lines else 1,
            })

    genes: list[dict] = []
    if kind in (None, "gene", "egg", "embryo"):
        # La matrice prezzi admin (categoria x tier) sovrascrive i costi
        # uniformi che il plugin ripubblica a ogni boot; la cella mancante
        # lascia il costo del plugin.
        matrix = await _gene_price_matrix(panel_db)
        try:
            rows = await db.execute(text(
                "SELECT internal_name, display_name, category, description, "
                "cost_t1, cost_t2, cost_t3 FROM ARKM_gene_traits "
                "ORDER BY category, display_name"))
            for r in rows.fetchall():
                genes.append({
                    "key": r[0], "label": r[1], "category": r[2],
                    "description": r[3],
                    "prices": {
                        "1": _gene_price(matrix, r[2], 1, r[4]),
                        "2": _gene_price(matrix, r[2], 2, r[5]),
                        "3": _gene_price(matrix, r[2], 3, r[6]),
                    },
                })
        except Exception:
            # Tabella assente = nessun server ha ancora avviato il GeneShop
            # con la versione che la pubblica. Vetrina vuota, non un errore.
            log.info("web_shop: ARKM_gene_traits non disponibile")

    # Specie selezionabili per un gene. Servono al plugin solo per ricavare la
    # DinoEntry da scrivere nello scanner (dal CDO del dino), quindi qui basta
    # il path del blueprint. Sorgente: il catalogo blueprint del pannello, lo
    # stesso che alimenta il picker dei rare dino — nessuna lista a mano da
    # tenere allineata.
    gene_dinos: list[dict] = []
    if kind in (None, "gene", "egg", "embryo"):
        try:
            rows = await panel_db.execute(text(
                "SELECT name, blueprint FROM ARKM_blueprints "
                "WHERE type = 'dino' ORDER BY name"))
            # type='dino' also tags item blueprints that live under Dinos/
            # paths (eggs, costumes, chibis). Keep real creatures only:
            # same official/S-variant filter as the rare-dino picker, plus
            # the Character_BP fragment every actual creature BP carries.
            gene_dinos = [
                {"label": r[0], "blueprint": r[1]}
                for r in rows.fetchall()
                if "character_bp" in (r[1] or "").lower()
                and is_official_or_s_variant_dino(
                    {"name": r[0], "blueprint": r[1]})
            ]
        except Exception:
            log.info("web_shop: ARKM_blueprints non disponibile")

    # Shop uova / embrioni: config add-on + listino per specie (admin).
    egg_shop = None
    embryo_shop = None
    forge_prices: list[dict] = []
    if kind in (None, "egg"):
        egg_shop = await _forge_config(db, "Egg")
    if kind in (None, "embryo"):
        embryo_shop = await _forge_config(db, "Embryo")
    if kind in (None, "egg", "embryo"):
        try:
            rows = await panel_db.execute(text(
                "SELECT blueprint, label, egg_price, embryo_price, "
                "egg_enabled, embryo_enabled FROM arkmaniagest_forge_prices "
                "ORDER BY label"))
            forge_prices = [
                {"blueprint": r[0], "label": r[1], "egg_price": r[2],
                 "embryo_price": r[3], "egg_enabled": bool(r[4]),
                 "embryo_enabled": bool(r[5])}
                for r in rows.fetchall()
            ]
        except Exception:
            log.info("web_shop: arkmaniagest_forge_prices non disponibile")

    return {"items": items, "genes": genes, "gene_dinos": gene_dinos,
            "egg_shop": egg_shop, "embryo_shop": embryo_shop,
            "forge_prices": forge_prices}


# ── Acquisto ──────────────────────────────────────────────────────────────────

class BuyRequest(BaseModel):
    kind: str
    # Chiave di catalogo per item/dino/gene; per egg/embryo non c'e' un
    # catalogo e il campo porta un'etichetta libera (finisce in item_key
    # dell'ordine, solo per leggibilita' nello storico).
    key: str = ""
    quantity: int = Field(1, ge=1, le=100)
    gene_tier: int = Field(1, ge=1, le=3)
    # Path del blueprint del dino. Per kind='gene' e' la specie da cui il
    # tratto risulta prelevato (vuoto = scanner senza specie); per
    # kind='egg'/'embryo' e' la specie da forgiare ed e' OBBLIGATORIO.
    gene_species: str = Field("", max_length=512)
    # Parametri di forgiatura, solo per kind='egg'/'embryo' (campi Egg*
    # dell'item, vedi ARKM-Marketplace/EggForge). Indici stat: 0=Health
    # 1=Stamina 2=Torpidity 3=Oxygen 4=Food 5=Water 6=Temperature 7=Weight
    # 8=Melee 9=Speed 10=Fortitude 11=Crafting.
    egg_stats:  list[int] = Field(default_factory=list, max_length=12)
    egg_muts:   list[int] = Field(default_factory=list, max_length=12)
    egg_colors: list[int] = Field(default_factory=list, max_length=6)
    egg_traits: list[str] = Field(default_factory=list, max_length=12)
    egg_gender: int = Field(-1, ge=-1, le=2)   # -1=casuale, 1=maschio, 2=femmina


@router.post("/buy")
async def buy(
    data: BuyRequest,
    player: _PlayerSession = Depends(get_current_player),
    db: AsyncSession = Depends(get_plugin_db),
    panel_db: AsyncSession = Depends(get_db),
):
    """
    Compra con i punti ArkShop e mette l'ordine in coda per il ritiro.

    L'ordine di esecuzione conta: prima si scala, poi si accoda. Al
    contrario, un errore fra i due passi regalerebbe l'oggetto; cosi' il
    caso peggiore e' un addebito senza ordine, che resta nel log e si
    rimborsa a mano — molto piu' raro e molto meno costoso.
    """
    eos = player.eos_id
    if data.kind not in WEB_KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {WEB_KINDS}")

    # 1. Risolvi la voce di catalogo e il prezzo, dal DB e mai dal client:
    #    il prezzo arrivato dal browser sarebbe il prezzo scelto dal browser.
    lines: list[dict] = []
    order: dict = {
        "kind": data.kind, "item_key": data.key, "blueprint": "",
        "quantity": data.quantity, "quality": 0, "is_blueprint": 0,
        "dino_level": 1, "gene_trait": "", "gene_tier": data.gene_tier,
        "gene_species": "", "source": "arkshop",
    }

    if data.kind == "gene":
        row = (await db.execute(text(
            "SELECT internal_name, cost_t1, cost_t2, cost_t3, category "
            "FROM ARKM_gene_traits WHERE internal_name = :k"),
            {"k": data.key})).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Trait not found.")
        matrix = await _gene_price_matrix(panel_db)
        unit = _gene_price(matrix, row[4], data.gene_tier,
                           {1: row[1], 2: row[2], 3: row[3]}[data.gene_tier])
        order["source"] = "geneshop"
        order["gene_trait"] = row[0]
        # Il path NON viene validato contro ARKM_blueprints: quella tabella e'
        # solo la vetrina del picker, e un path che non risolve lato server
        # produce uno scanner senza specie, non un errore. Validarlo qui
        # vorrebbe dire rifiutare l'acquisto per una voce di catalogo
        # disallineata, cioe' rompere la vendita per un dettaglio estetico.
        order["gene_species"] = data.gene_species
        # I geni si consegnano uno per oggetto: la quantita' diventa il
        # numero di ordini, non un campo dentro l'ordine.
        total = unit * data.quantity
    elif data.kind in ("egg", "embryo"):
        # Capability check PRIMA dell'addebito: su un plugin senza colonne
        # egg_* la INSERT fallirebbe a punti gia' scalati.
        if not await _forge_supported(db):
            raise HTTPException(
                status_code=503,
                detail="Shop uova/embrioni non ancora attivo: i server di "
                       "gioco non sono aggiornati (ARKM-Marketplace >= 7.5.0).")

        shop = "Egg" if data.kind == "egg" else "Embryo"
        cfg = await _forge_config(db, shop)
        if not cfg["enabled"]:
            raise HTTPException(status_code=403, detail="Shop disabilitato.")
        if not data.gene_species.strip():
            raise HTTPException(status_code=422, detail="Scegli una specie.")

        # Prezzo PER SPECIE dal listino admin: una specie fuori listino (o
        # disabilitata per questo shop, o senza prezzo) non e' in vendita.
        prow = (await panel_db.execute(text(
            "SELECT label, egg_price, embryo_price, egg_enabled, "
            "embryo_enabled FROM arkmaniagest_forge_prices "
            "WHERE blueprint = :b"),
            {"b": data.gene_species.strip()})).fetchone()
        species_price = 0
        if prow:
            species_price = prow[1] if data.kind == "egg" else prow[2]
            sp_enabled = bool(prow[3] if data.kind == "egg" else prow[4])
        if not prow or not sp_enabled or species_price <= 0:
            raise HTTPException(status_code=404,
                detail="Questa specie non e' in vendita in questo shop.")

        colors = [max(0, min(255, int(v))) for v in data.egg_colors]
        if len(data.egg_traits) > cfg["max_traits"]:
            raise HTTPException(status_code=422,
                detail=f"Max {cfg['max_traits']} tratti.")

        # Tratti "Nome[tier]": validati e prezzati sul listino geni effettivo
        # (matrice admin con fallback ai costi del plugin).
        matrix = await _gene_price_matrix(panel_db)
        traits_price = 0
        for t in data.egg_traits:
            m = re.fullmatch(r"([A-Za-z0-9_]+)\[([0-2])\]", t.strip())
            if not m:
                raise HTTPException(status_code=422,
                    detail=f"Tratto malformato: {t} (atteso Nome[0..2]).")
            trow = (await db.execute(text(
                "SELECT cost_t1, cost_t2, cost_t3, category "
                "FROM ARKM_gene_traits WHERE internal_name = :n"),
                {"n": m.group(1)})).fetchone()
            if not trow:
                raise HTTPException(status_code=422,
                    detail=f"Tratto sconosciuto: {m.group(1)}.")
            tier = int(m.group(2)) + 1
            traits_price += _gene_price(matrix, trow[3], tier, trow[tier - 1])

        unit = (species_price
                + sum(1 for c in colors if c > 0) * cfg["price_per_color"]
                + (cfg["price_gender_choice"] if data.egg_gender >= 0 else 0)
                + traits_price)

        # Livello fisso, stat rollate come in natura: i punti (EggLevel-1)
        # si distribuiscono a caso sugli slot utili. Le stat/mutazioni
        # eventualmente arrivate dal client si IGNORANO: il roll e' del
        # server, come il prezzo.
        rolled = _roll_wild_stats(cfg["egg_level"])

        order["source"] = "eggshop" if data.kind == "egg" else "embryoshop"
        order["gene_species"] = data.gene_species.strip()
        order["egg_stats"]  = ",".join(str(v) for v in rolled)
        order["egg_muts"]   = ""
        order["egg_colors"] = ",".join(str(v) for v in colors)
        order["egg_traits"] = ",".join(t.strip() for t in data.egg_traits)
        order["egg_gender"] = data.egg_gender if data.egg_gender >= 0 else -1
        # Un uovo per ordine, come dino e geni. NB: il roll qui sopra e'
        # dell'ordine-tipo; per quantita' > 1 ogni riga accodata sotto
        # riceve un roll suo, cosi' due uova non sono mai gemelle.
        total = unit * data.quantity
    else:
        row = (await db.execute(text(
            "SELECT item_key, kind, blueprint, quantity, quality, "
            "is_blueprint, dino_level, price, items_json "
            "FROM ARKM_web_shop_items "
            "WHERE item_key = :k AND enabled = 1"), {"k": data.key})).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found.")
        if row[1] != data.kind:
            raise HTTPException(status_code=422, detail="Wrong kind for this item.")
        order["blueprint"] = row[2]
        order["quality"] = row[4]
        order["is_blueprint"] = 1 if row[5] else 0
        order["dino_level"] = row[6]
        unit = row[7]
        lines = _lines_of(row[8])
        if data.kind == "dino":
            # Un dino per pod: come i geni, la quantita' e' il numero di ordini.
            order["quantity"] = 1
            total = unit * data.quantity
        else:
            order["quantity"] = row[3] * data.quantity
            total = unit * data.quantity

    if total <= 0:
        raise HTTPException(status_code=422, detail="This entry has no price set.")

    # 2. Scala i punti in modo condizionale: se il saldo e' cambiato fra la
    #    lettura e la scrittura, la UPDATE non tocca nessuna riga e non c'e'
    #    nessun addebito da annullare.
    res = await db.execute(text(
        "UPDATE ArkShopPlayers SET Points = Points - :p, "
        "TotalSpent = TotalSpent + :p WHERE EosId = :e AND Points >= :p"),
        {"p": total, "e": eos})
    if res.rowcount != 1:
        await db.rollback()
        cur = (await db.execute(text(
            "SELECT Points FROM ArkShopPlayers WHERE EosId = :e"),
            {"e": eos})).fetchone()
        raise HTTPException(
            status_code=400,
            detail=f"Punti insufficienti: servono {total}, "
                   f"disponibili {cur[0] if cur else 0}.")

    # 3. Accoda: un ordine per ogni riga consegnabile. Una voce ArkShop puo'
    #    essere un pacchetto (il set di armatura sono cinque pezzi) e il
    #    plugin consegna un blueprint per ordine, quindi e' qui che il
    #    pacchetto si apre.
    #
    #    Da questo punto i punti sono GIA' scalati: tutto cio' che segue sta
    #    dentro il try, compresa la costruzione dei parametri. Un errore
    #    lasciato fuori dal try non verrebbe rimborsato dal nostro ramo di
    #    errore, e la sessione lo salverebbe solo per fortuna.
    rows_to_queue: list[dict] = []
    try:
        base = {
            "eos": eos,
            # _PlayerSession porta i nomi Discord, non un generico "name".
            "name": (player.discord_global_name
                     or player.discord_username or "")[:64],
            "src": order["source"], "key": order["item_key"],
            "kind": order["kind"], "lvl": order["dino_level"],
            "trait": order["gene_trait"], "tier": order["gene_tier"],
            "species": order["gene_species"],
        }
        if data.kind == "item" and lines:
            for _ in range(data.quantity):
                for ln in lines:
                    rows_to_queue.append({**base,
                        "bp": str(ln.get("Blueprint", ""))[:512],
                        "qty": int(ln.get("Amount", 1) or 1),
                        "qual": int(ln.get("Quality", 0) or 0),
                        "isbp": 1 if ln.get("ForceBlueprint", False) else 0})
        else:
            n = (data.quantity
                 if data.kind in ("dino", "gene", "egg", "embryo") else 1)
            for _ in range(n):
                rows_to_queue.append({**base,
                    "bp": order["blueprint"], "qty": order["quantity"],
                    "qual": order["quality"], "isbp": order["is_blueprint"]})

        if not rows_to_queue:
            # Nessuna riga consegnabile: annulla l'addebito, non c'e' niente
            # da consegnare e tenere i punti sarebbe un furto.
            await db.rollback()
            raise HTTPException(status_code=422,
                                detail="Questa voce non ha nulla da consegnare.")

        n_orders = len(rows_to_queue)
        for r in rows_to_queue:
            if data.kind in ("egg", "embryo"):
                # INSERT esteso con i parametri di forgiatura. Solo per
                # questi kind: cosi' i kind classici continuano a funzionare
                # anche su un plugin non ancora aggiornato alle colonne egg_*.
                await db.execute(text(
                    "INSERT INTO ARKM_shop_orders "
                    "(eos_id, player_name, source, item_key, kind, blueprint, "
                    " quantity, quality, is_blueprint, dino_level, gene_trait, "
                    " gene_tier, gene_species, egg_stats, egg_muts, "
                    " egg_colors, egg_traits, egg_gender, price, status) "
                    "VALUES (:eos, :name, :src, :key, :kind, :bp, :qty, "
                    "        :qual, :isbp, :lvl, :trait, :tier, :species, "
                    "        :estats, :emuts, :ecolors, :etraits, :egender, "
                    "        :price, 'pending')"),
                    {**r, "price": total // n_orders,
                     # Roll indipendente per riga: due uova dello stesso
                     # acquisto non devono mai essere gemelle.
                     "estats": ",".join(
                         str(v) for v in _roll_wild_stats(cfg["egg_level"])),
                     "emuts": order["egg_muts"],
                     "ecolors": order["egg_colors"],
                     "etraits": order["egg_traits"],
                     "egender": order["egg_gender"]})
            else:
                await db.execute(text(
                    "INSERT INTO ARKM_shop_orders "
                    "(eos_id, player_name, source, item_key, kind, blueprint, "
                    " quantity, quality, is_blueprint, dino_level, gene_trait, "
                    " gene_tier, gene_species, price, status) "
                    "VALUES (:eos, :name, :src, :key, :kind, :bp, :qty, :qual, "
                    "        :isbp, :lvl, :trait, :tier, :species, :price, "
                    "        'pending')"),
                    {**r, "price": total // n_orders})
        await db.commit()
    except HTTPException:
        # Gia' gestita sopra (rollback incluso): non e' un errore da
        # trasformare nel messaggio generico di addebito senza ordine.
        raise
    except Exception as exc:
        await db.rollback()
        # I punti sono gia' stati scalati e la INSERT e' fallita: e' il caso
        # che va reso rumoroso, perche' e' l'unico in cui il giocatore paga
        # senza ricevere.
        log.error("web_shop: ordine non accodato dopo l'addebito "
                  "eos=%s totale=%s: %s", eos, total, exc)
        raise HTTPException(
            status_code=500,
            detail="Punti scalati ma ordine non registrato: contatta un admin.")

    return {"status": "ok", "orders": n_orders, "spent": total}


@router.get("/orders")
async def my_orders(
    player: _PlayerSession = Depends(get_current_player),
    db: AsyncSession = Depends(get_plugin_db),
):
    """I miei ordini: cosa aspetta il ritiro e cosa ho gia' ritirato."""
    rows = await db.execute(text(
        "SELECT id, source, item_key, kind, blueprint, quantity, gene_trait, "
        "gene_tier, price, status, server_key, last_error, created_at, "
        "claimed_at FROM ARKM_shop_orders WHERE eos_id = :e "
        "ORDER BY created_at DESC LIMIT 200"), {"e": player.eos_id})
    out = []
    for r in rows.fetchall():
        out.append({
            "id": r[0], "source": r[1], "item_key": r[2], "kind": r[3],
            "blueprint": r[4], "quantity": r[5], "gene_trait": r[6],
            "gene_tier": r[7], "price": r[8], "status": r[9],
            "server_key": r[10], "last_error": r[11] or None,
            "created_at": str(r[12]) if r[12] else None,
            "claimed_at": str(r[13]) if r[13] else None,
        })
    pending = sum(1 for o in out if o["status"] == "pending")
    return {"orders": out, "pending": pending}


# ── Amministrazione prezzi ────────────────────────────────────────────────────
#
# Tab "Prezzi" del Mercato (solo admin). Le tabelle sono del pannello:
# arkmaniagest_gene_prices (matrice categoria x tier, override dei costi che
# il plugin ripubblica uniformi a ogni boot) e arkmaniagest_forge_prices
# (listino per specie degli shop uova/embrioni).


class GenePriceEntry(BaseModel):
    category: str = Field(..., max_length=32)
    tier: int = Field(..., ge=1, le=3)
    price: int = Field(..., ge=0)


class ForgePriceRow(BaseModel):
    blueprint: str = Field(..., max_length=512)
    label: str = Field("", max_length=128)
    egg_price: int = Field(0, ge=0)
    embryo_price: int = Field(0, ge=0)
    egg_enabled: bool = True
    embryo_enabled: bool = True


@router.get("/admin/prices", dependencies=[Depends(require_admin)])
async def admin_prices(
    db: AsyncSession = Depends(get_plugin_db),
    panel_db: AsyncSession = Depends(get_db),
):
    """
    Stato corrente del pricing: categorie tratti con i costi di fallback
    pubblicati dal plugin, celle della matrice admin, listino specie.
    """
    categories: list[dict] = []
    try:
        rows = await db.execute(text(
            "SELECT category, MIN(cost_t1), MIN(cost_t2), MIN(cost_t3), "
            "COUNT(*) FROM ARKM_gene_traits GROUP BY category "
            "ORDER BY category"))
        categories = [
            {"category": r[0], "fallback": {"1": r[1], "2": r[2], "3": r[3]},
             "traits": r[4]}
            for r in rows.fetchall()
        ]
    except Exception:
        log.info("web_shop: ARKM_gene_traits non disponibile (admin/prices)")

    matrix = await _gene_price_matrix(panel_db)
    forge_rows: list[dict] = []
    try:
        rows = await panel_db.execute(text(
            "SELECT blueprint, label, egg_price, embryo_price, egg_enabled, "
            "embryo_enabled FROM arkmaniagest_forge_prices ORDER BY label"))
        forge_rows = [
            {"blueprint": r[0], "label": r[1], "egg_price": r[2],
             "embryo_price": r[3], "egg_enabled": bool(r[4]),
             "embryo_enabled": bool(r[5])}
            for r in rows.fetchall()
        ]
    except Exception:
        pass

    return {
        "gene_categories": categories,
        "gene_matrix": [
            {"category": c, "tier": t, "price": p}
            for (c, t), p in sorted(matrix.items())
        ],
        "forge_prices": forge_rows,
    }


@router.put("/admin/gene-prices", dependencies=[Depends(require_admin)])
async def save_gene_prices(
    entries: list[GenePriceEntry],
    panel_db: AsyncSession = Depends(get_db),
):
    """
    Sostituisce l'intera matrice prezzi geni. Una cella assente torna al
    costo pubblicato dal plugin (fallback), quindi inviare [] azzera ogni
    override.
    """
    await panel_db.execute(text("DELETE FROM arkmaniagest_gene_prices"))
    for e in entries:
        await panel_db.execute(text(
            "INSERT INTO arkmaniagest_gene_prices (category, tier, price) "
            "VALUES (:c, :t, :p)"),
            {"c": e.category.strip(), "t": e.tier, "p": e.price})
    await panel_db.commit()
    return {"ok": True, "cells": len(entries)}


@router.put("/admin/forge-prices", dependencies=[Depends(require_admin)])
async def save_forge_prices(
    rows: list[ForgePriceRow],
    panel_db: AsyncSession = Depends(get_db),
):
    """Sostituisce l'intero listino specie degli shop uova/embrioni."""
    seen: set[str] = set()
    await panel_db.execute(text("DELETE FROM arkmaniagest_forge_prices"))
    for r in rows:
        bp = r.blueprint.strip()
        if not bp or bp in seen:
            continue
        seen.add(bp)
        await panel_db.execute(text(
            "INSERT INTO arkmaniagest_forge_prices "
            "(blueprint, label, egg_price, embryo_price, egg_enabled, "
            " embryo_enabled) VALUES (:b, :l, :ep, :mp, :ee, :me)"),
            {"b": bp, "l": r.label.strip()[:128], "ep": r.egg_price,
             "mp": r.embryo_price, "ee": int(r.egg_enabled),
             "me": int(r.embryo_enabled)})
    await panel_db.commit()
    return {"ok": True, "rows": len(seen)}


# ── Amministrazione del catalogo ──────────────────────────────────────────────

@router.post("/admin/import-arkshop", dependencies=[Depends(require_admin)])
async def import_from_arkshop(db: AsyncSession = Depends(get_plugin_db)):
    """
    Importa in ``ARKM_web_shop_items`` le voci item/dino della config ArkShop.

    Le voci gia' presenti mantengono ``enabled`` e ``price``: l'import
    aggiorna la definizione tecnica (blueprint, quantita', livello) senza
    ributtare online qualcosa che era stato tolto a mano dalla vetrina.
    """
    from app.api.routes.arkshop import _require_vault, _get_config

    _require_vault()
    shop_items = _get_config().get("ShopItems", {})

    imported = 0
    skipped_kinds: dict[str, int] = {}
    for key, val in shop_items.items():
        kind = str(val.get("Type", "")).lower()
        if kind not in ("item", "dino"):
            skipped_kinds[kind or "?"] = skipped_kinds.get(kind or "?", 0) + 1
            continue

        # Una voce ArkShop di tipo item porta il suo contenuto in "Items",
        # una lista di righe con blueprint/quantita'/qualita' — anche quando
        # la riga e' una sola. La voce dino ha invece Blueprint e Level in
        # cima. Il primo import leggeva solo la forma dino e finiva per
        # saltare l'intero catalogo.
        lines = val.get("Items") or []
        if kind == "item" and not isinstance(lines, list):
            lines = []

        if kind == "item":
            if not lines:
                skipped_kinds["item-empty"] = skipped_kinds.get("item-empty", 0) + 1
                continue
            first = lines[0] if isinstance(lines[0], dict) else {}
            blueprint = str(first.get("Blueprint", ""))
            quantity = int(first.get("Amount", 1) or 1)
            quality = int(first.get("Quality", 0) or 0)
            is_bp = 1 if first.get("ForceBlueprint", False) else 0
            dino_level = 1
            items_json = json.dumps(lines)
        else:
            blueprint = str(val.get("Blueprint", ""))
            if not blueprint:
                skipped_kinds["dino-noblueprint"] = \
                    skipped_kinds.get("dino-noblueprint", 0) + 1
                continue
            quantity, quality, is_bp = 1, 0, 0
            dino_level = int(val.get("Level", 1) or 1)
            items_json = None

        await db.execute(text(
            "INSERT INTO ARKM_web_shop_items "
            "(item_key, label, kind, category, blueprint, quantity, quality, "
            " is_blueprint, dino_level, price, enabled, items_json) "
            "VALUES (:k, :lbl, :kind, :cat, :bp, :qty, :qual, :isbp, :lvl, "
            "        :price, 1, :ij) "
            "ON DUPLICATE KEY UPDATE label=VALUES(label), kind=VALUES(kind), "
            "blueprint=VALUES(blueprint), quantity=VALUES(quantity), "
            "quality=VALUES(quality), is_blueprint=VALUES(is_blueprint), "
            "dino_level=VALUES(dino_level), items_json=VALUES(items_json)"),
            {
                "k": key[:128],
                "lbl": str(val.get("Title", key))[:128],
                "kind": kind,
                "cat": str(val.get("Permissions", ""))[:64],
                "bp": blueprint[:512],
                "qty": quantity,
                "qual": quality,
                "isbp": is_bp,
                "lvl": dino_level,
                "price": int(val.get("Price", 0) or 0),
                "ij": items_json,
            })
        imported += 1
    await db.commit()
    return {"imported": imported, "skipped": skipped_kinds}


class CatalogEntryUpdate(BaseModel):
    price: Optional[int] = Field(None, ge=0)
    enabled: Optional[bool] = None
    label: Optional[str] = None


@router.put("/admin/catalog/{item_key}", dependencies=[Depends(require_admin)])
async def update_catalog_entry(
    item_key: str,
    data: CatalogEntryUpdate,
    db: AsyncSession = Depends(get_plugin_db),
):
    """Ritocca prezzo, etichetta o visibilita' di una voce della vetrina."""
    sets, params = [], {"k": item_key}
    if data.price is not None:
        sets.append("price = :p"); params["p"] = data.price
    if data.enabled is not None:
        sets.append("enabled = :e"); params["e"] = 1 if data.enabled else 0
    if data.label is not None:
        sets.append("label = :l"); params["l"] = data.label[:128]
    if not sets:
        raise HTTPException(status_code=422, detail="Nothing to update.")
    res = await db.execute(text(
        f"UPDATE ARKM_web_shop_items SET {', '.join(sets)} WHERE item_key = :k"),
        params)
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Entry not found.")
    return {"status": "ok"}
