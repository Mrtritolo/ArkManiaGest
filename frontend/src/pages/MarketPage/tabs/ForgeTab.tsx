/**
 * ForgeTab -- the egg / embryo shop.
 *
 * Pick the species from the operator price list, then the options that cost
 * extra: colour regions, a chosen gender, gene traits. The level is fixed and
 * the wild stats are rolled by the server, exactly as in the wild.
 */
import { useTranslation } from "react-i18next";
import { Egg, ShoppingBag, X } from "lucide-react";
import {
  Alert, Badge, Button, Card, EmptyState, Field, IconButton, Input,
  SegmentedControl, Select,
} from "../../../components/ui";
import type { WebShopForgeConfig, WebShopGene } from "../../../services/api";
import type { ForgeMode, useForgeConfigurator } from "../hooks/useForgeConfigurator";
import { Points } from "../components/Points";
import styles from "../MarketPage.module.css";

export interface ForgeTabProps {
  forge: ReturnType<typeof useForgeConfigurator>;
  eggShopCfg: WebShopForgeConfig | null;
  embryoShopCfg: WebShopForgeConfig | null;
  shopGenes: WebShopGene[];
  shopBusy: string | null;
}

export function ForgeTab({ forge, eggShopCfg, embryoShopCfg, shopGenes, shopBusy }: ForgeTabProps) {
  const { t } = useTranslation();
  const { cfg, speciesRows, selected } = forge;
  const bothShops = Boolean(eggShopCfg?.enabled && embryoShopCfg?.enabled);
  const modeLabel = t(forge.mode === "egg" ? "market.forge.eggMode" : "market.forge.embryoMode");

  /** "Rex T2" rather than the raw "GeneKey[1]" the API speaks. */
  function traitLabel(entry: string): string {
    const m = /^(.+)\[([0-2])\]$/.exec(entry);
    if (!m) return entry;
    const gene = shopGenes.find(g => g.key === m[1]);
    return t("market.shop.geneTierLabel", {
      name: gene?.label ?? m[1], tier: Number(m[2]) + 1,
    });
  }

  return (
    <div className="l-stack">
      {bothShops ? (
        <SegmentedControl<ForgeMode>
          label={t("market.forge.modeLabel")}
          value={forge.mode}
          onChange={forge.switchMode}
          options={[
            { value: "egg", label: t("market.forge.eggMode") },
            { value: "embryo", label: t("market.forge.embryoMode") },
          ]}
        />
      ) : (
        /* One shop enabled: a switch with a single option is not a choice,
           but the section still has to say which shop this is. */
        <div className="l-cluster u-text-sm">
          <span className="u-muted">{t("market.forge.modeLabel")}</span>
          <Badge>{modeLabel}</Badge>
        </div>
      )}

      {!cfg?.enabled ? (
        <Alert tone="info">{t("market.forge.disabled")}</Alert>
      ) : speciesRows.length === 0 ? (
        <EmptyState icon={Egg} title={t("market.forge.emptyList")} />
      ) : (
        <Card className={styles.forgeCard}>
          <div className="l-stack">
            <Field label={t("market.forge.species")} hint={
              t("market.forge.levelNote", { lvl: cfg.egg_level })
              + (forge.mode === "embryo" ? ` ${t("market.forge.embryoHint")}` : "")
            }>
              <Select value={forge.species} onChange={e => forge.setSpecies(e.target.value)}>
                <option value="">{t("market.forge.speciesPick")}</option>
                {speciesRows.map(r => (
                  <option key={r.blueprint} value={r.blueprint}>
                    {t("market.forge.speciesOption", {
                      label: r.label,
                      price: forge.mode === "egg" ? r.egg_price : r.embryo_price,
                    })}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="ui-fieldset">
              <legend>
                {t("market.forge.colors")} — {t("market.forge.colorsHint")}
              </legend>
              <div className={styles.colorRow}>
                {forge.colors.map((c, i) => (
                  <Field key={i} label={t("market.forge.colorRegion", { n: i })}>
                    <Input
                      type="number" min={0} max={255} inputMode="numeric" mono
                      value={c}
                      onChange={e => forge.setColor(i, Number(e.target.value))}
                    />
                  </Field>
                ))}
              </div>
            </fieldset>

            <Field label={t("market.forge.gender")}>
              <Select value={forge.gender} onChange={e => forge.setGender(Number(e.target.value))}>
                <option value={-1}>{t("market.forge.genderAny")}</option>
                <option value={1}>{t("market.forge.genderMale")}</option>
                <option value={2}>{t("market.forge.genderFemale")}</option>
              </Select>
            </Field>

            <fieldset className="ui-fieldset">
              <legend>
                {t("market.forge.traits")} — {t("market.forge.traitsMax", { n: cfg.max_traits })}
              </legend>
              <div className="l-cluster">
                <Field label={t("market.forge.traitPickLabel")}>
                  <Select value={forge.traitPick} onChange={e => forge.setTraitPick(e.target.value)}>
                    <option value="">{t("market.forge.traitPick")}</option>
                    {shopGenes.map(g => (
                      <option key={g.key} value={g.key}>{g.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("market.forge.traitTierLabel")}>
                  <Select value={forge.traitTier} onChange={e => forge.setTraitTier(Number(e.target.value))}>
                    {[0, 1, 2].map(tier => (
                      <option key={tier} value={tier}>{t("market.shop.tier", { n: tier + 1 })}</option>
                    ))}
                  </Select>
                </Field>
                <Button
                  disabled={!forge.traitPick || forge.traits.length >= cfg.max_traits}
                  onClick={forge.addTrait}
                >
                  {t("market.forge.traitAdd")}
                </Button>
              </div>
              {forge.traits.length > 0 && (
                <div className={styles.traitChips}>
                  {forge.traits.map(tr => (
                    <span key={tr} className={styles.traitChip}>
                      {traitLabel(tr)}
                      <IconButton
                        size="sm"
                        icon={X}
                        label={t("market.forge.traitRemove", { n: traitLabel(tr) })}
                        onClick={() => forge.removeTrait(tr)}
                      />
                    </span>
                  ))}
                </div>
              )}
            </fieldset>

            <div className={styles.cardFooter}>
              <Points value={forge.price} size="lg" />
              <Button
                variant="primary"
                icon={ShoppingBag}
                loading={shopBusy === "__forge"}
                loadingLabel={t("market.buyModal.buying")}
                disabled={shopBusy !== null || !selected}
                aria-label={selected
                  ? t("market.buyAria", { item: selected.label, price: forge.price.toLocaleString() })
                  : undefined}
                onClick={forge.buy}
              >
                {t("market.forge.buy")}
              </Button>
              {!selected && <span className={styles.buyNote}>{t("market.forge.speciesPick")}</span>}
            </div>
            <p className="u-muted u-text-sm">{t("market.forge.claimHint")}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
