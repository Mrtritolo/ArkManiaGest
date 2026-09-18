/**
 * PricesTab -- the price desk: the gene matrix (category x tier) and the
 * per-species list of the egg / embryo shops.
 *
 * Any panel role may read it; only an operator may save. A viewer sees the
 * same numbers with every control disabled and a note saying why, rather than
 * a tab that disappears.
 */
import { useTranslation } from "react-i18next";
import { Coins, Save, X } from "lucide-react";
import {
  Alert, Button, Card, Checkbox, EmptyState, IconButton, Input, Select, Table,
} from "../../../components/ui";
import type { WebShopGeneDino } from "../../../services/api";
import type { useAdminPrices } from "../hooks/useAdminPrices";
import styles from "../MarketPage.module.css";

export interface PricesTabProps {
  prices: ReturnType<typeof useAdminPrices>;
  shopGeneDinos: WebShopGeneDino[];
  canOperate: boolean;
}

export function PricesTab({ prices, shopGeneDinos, canOperate }: PricesTabProps) {
  const { t } = useTranslation();
  const readOnlyReason = canOperate ? undefined : t("market.prices.readOnly");

  return (
    <div className="l-stack">
      {!canOperate && <Alert tone="info">{t("market.prices.readOnly")}</Alert>}

      {/* Gene price matrix. An empty cell means "use the price the plugin
          publishes" (shown as the placeholder). */}
      <Card
        title={t("market.prices.geneTitle")}
        icon={Coins}
        footer={
          <Button
            variant="primary"
            icon={Save}
            loading={prices.busy}
            loadingLabel={t("market.prices.saving")}
            disabled={!canOperate || prices.busy}
            title={readOnlyReason}
            onClick={prices.saveGenes}
          >
            {t("market.prices.saveGenes")}
          </Button>
        }
      >
        <p className="u-muted u-text-sm">{t("market.prices.geneHint")}</p>
        {prices.cats.length === 0 ? (
          <EmptyState icon={Coins} title={t("market.prices.noCats")} />
        ) : (
          <Table label={t("market.prices.geneTitle")} minWidth={560}>
            <thead>
              <tr>
                <th scope="col">{t("market.prices.colCategory")}</th>
                <th scope="col">{t("market.shop.tier", { n: 1 })}</th>
                <th scope="col">{t("market.shop.tier", { n: 2 })}</th>
                <th scope="col">{t("market.shop.tier", { n: 3 })}</th>
                <th scope="col" className="u-text-end">{t("market.prices.colTraits")}</th>
              </tr>
            </thead>
            <tbody>
              {prices.cats.map(c => (
                <tr key={c.category}>
                  <th scope="row">{c.category}</th>
                  {[1, 2, 3].map(tier => (
                    <td key={tier}>
                      <Input
                        size="sm" type="number" min={0} inputMode="numeric" mono
                        className={styles.priceCell}
                        aria-label={t("market.prices.cellLabel", { category: c.category, tier })}
                        placeholder={String(c.fallback[String(tier)] ?? 0)}
                        disabled={!canOperate}
                        title={readOnlyReason}
                        value={prices.matrix[`${c.category}:${tier}`] ?? ""}
                        onChange={e => prices.setMatrix(p => ({
                          ...p, [`${c.category}:${tier}`]: e.target.value }))}
                      />
                    </td>
                  ))}
                  <td className="u-num u-text-end u-muted">{c.traits}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Per-species price list of the egg / embryo shops. */}
      <Card
        title={t("market.prices.forgeTitle")}
        icon={Coins}
        footer={
          <>
            <Button
              variant="primary"
              icon={Save}
              loading={prices.busy}
              loadingLabel={t("market.prices.saving")}
              disabled={!canOperate || prices.busy}
              title={readOnlyReason}
              onClick={prices.saveForge}
            >
              {t("market.prices.saveForge")}
            </Button>
            <span className="u-muted u-text-sm">{t("market.prices.saveHint")}</span>
          </>
        }
      >
        <p className="u-muted u-text-sm">{t("market.prices.forgeHint")}</p>
        <div className="l-cluster">
          <Select
            aria-label={t("market.prices.addSpeciesPick")}
            value={prices.speciesPick}
            disabled={!canOperate}
            title={readOnlyReason}
            onChange={e => prices.setSpeciesPick(e.target.value)}
          >
            <option value="">{t("market.prices.addSpeciesPick")}</option>
            {shopGeneDinos
              .filter(d => !prices.forgeRows.some(r => r.blueprint === d.blueprint))
              .map(d => (
                <option key={d.blueprint} value={d.blueprint}>{d.label}</option>
              ))}
          </Select>
          <Button
            disabled={!canOperate || !prices.speciesPick}
            title={readOnlyReason}
            onClick={prices.addSpecies}
          >
            {t("market.prices.addSpecies")}
          </Button>
        </div>

        {prices.forgeRows.length === 0 ? (
          <EmptyState icon={Coins} title={t("market.prices.noSpecies")} />
        ) : (
          <Table label={t("market.prices.forgeTitle")} minWidth={760}>
            <thead>
              <tr>
                <th scope="col">{t("market.prices.colSpecies")}</th>
                <th scope="col">{t("market.prices.colEggPrice")}</th>
                <th scope="col">{t("market.prices.colEggOn")}</th>
                <th scope="col">{t("market.prices.colEmbryoPrice")}</th>
                <th scope="col">{t("market.prices.colEmbryoOn")}</th>
                <th scope="col"><span className="u-sr-only">{t("market.prices.colActions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {prices.forgeRows.map(r => (
                <tr key={r.blueprint}>
                  <th scope="row">{r.label}</th>
                  <td>
                    <Input
                      size="sm" type="number" min={0} inputMode="numeric" mono
                      className={styles.priceCell}
                      aria-label={t("market.prices.eggPriceFor", { name: r.label })}
                      disabled={!canOperate}
                      title={readOnlyReason}
                      value={r.egg_price}
                      onChange={e => prices.patchRow(r.blueprint,
                        { egg_price: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </td>
                  <td>
                    <Checkbox
                      aria-label={t("market.prices.eggOnFor", { name: r.label })}
                      checked={r.egg_enabled}
                      disabled={!canOperate}
                      title={readOnlyReason}
                      onChange={e => prices.patchRow(r.blueprint, { egg_enabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <Input
                      size="sm" type="number" min={0} inputMode="numeric" mono
                      className={styles.priceCell}
                      aria-label={t("market.prices.embryoPriceFor", { name: r.label })}
                      disabled={!canOperate}
                      title={readOnlyReason}
                      value={r.embryo_price}
                      onChange={e => prices.patchRow(r.blueprint,
                        { embryo_price: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </td>
                  <td>
                    <Checkbox
                      aria-label={t("market.prices.embryoOnFor", { name: r.label })}
                      checked={r.embryo_enabled}
                      disabled={!canOperate}
                      title={readOnlyReason}
                      onChange={e => prices.patchRow(r.blueprint, { embryo_enabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <div className="ui-row-actions">
                      <IconButton
                        size="sm"
                        tone="danger"
                        icon={X}
                        label={t("market.prices.removeSpeciesNamed", { name: r.label })}
                        disabled={!canOperate}
                        title={readOnlyReason}
                        onClick={() => prices.removeSpecies(r.blueprint)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
