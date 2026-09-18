/**
 * The three entry lists: shop items (searchable, filterable, expandable),
 * kits (expandable) and sell items.
 */
import { ChevronDown, Coins, Package, Pencil, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Badge, Button, Card, EmptyState, IconButton, Input, Select, Table, TableMessageRow,
} from '../../../components/ui'
import type { ArkShopEntry } from '../../../services/api'
import { bpName, isCommandLine, type SubItem } from '../arkshopUtils'
import styles from '../ArkShopPage.module.css'

/** The lines of an expanded shop item or kit. */
function EntryLines({ lines }: { lines: SubItem[] }) {
  const { t } = useTranslation()
  if (lines.length === 0) return <p className="u-muted u-text-sm">{t('arkshop.shop.noLines')}</p>
  return (
    <div className={styles.lineList}>
      {lines.map((line, index) => (
        <div key={index} className={styles.line}>
          {isCommandLine(line) ? (
            <>
              <Badge>{t('arkshop.shop.bpCommandTag')}</Badge>
              <span className="u-mono">{line.Command || line.DisplayAs || '?'}</span>
              {line.ExecuteAsAdmin && <Badge tone="warning">{t('arkshop.shop.bpAdminTag')}</Badge>}
            </>
          ) : (
            <>
              <span className="u-num">{line.Amount}x</span>
              <span>{bpName(line.Blueprint ?? '')}</span>
              {(line.Quality ?? 0) > 0 && <Badge>Q{line.Quality}</Badge>}
              {line.ForceBlueprint && <Badge>{t('arkshop.sub.bp')}</Badge>}
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function PermissionBadges({ permissions }: { permissions?: string }) {
  const list = (permissions || '').split(',').map(p => p.trim()).filter(Boolean).slice(0, 3)
  return <>{list.map(p => <Badge key={p}>{p}</Badge>)}</>
}

interface ListProps {
  canOperate: boolean
  expandedItem: string | null
  setExpandedItem: (key: string | null) => void
  onEdit: (entry: ArkShopEntry) => void
  onDelete: (key: string) => void
  onNew: () => void
}

export function ShopItemsTab({
  items, search, onSearch, typeFilter, onTypeFilter,
  canOperate, expandedItem, setExpandedItem, onEdit, onDelete, onNew,
}: ListProps & {
  items: ArkShopEntry[]
  search: string
  onSearch: (value: string) => void
  typeFilter: string
  onTypeFilter: (value: string) => void
}) {
  const { t } = useTranslation()
  // "No shop item configured" is a lie when a filter is what emptied the list.
  const filtered = Boolean(search || typeFilter)

  return (
    <Card
      title={t('arkshop.tabs.shop')}
      icon={ShoppingBag}
      flush
      actions={
        <>
          <Input
            type="search"
            size="sm"
            aria-label={t('arkshop.shop.searchPlaceholder')}
            placeholder={t('arkshop.shop.searchPlaceholder')}
            value={search}
            onChange={event => onSearch(event.target.value)}
          />
          <Select
            size="sm"
            aria-label={t('arkshop.shop.filterLabel')}
            value={typeFilter}
            onChange={event => onTypeFilter(event.target.value)}
          >
            <option value="">{t('arkshop.shop.filterAll')}</option>
            <option value="item">{t('arkshop.shop.filterItem')}</option>
            <option value="command">{t('arkshop.shop.filterCommand')}</option>
            <option value="dino">{t('arkshop.shop.filterDino')}</option>
          </Select>
          {canOperate && (
            <Button size="sm" variant="primary" icon={Plus} onClick={onNew}>{t('arkshop.shop.new')}</Button>
          )}
        </>
      }
    >
      <Table label={t('arkshop.tabs.shop')} minWidth={880}>
        <thead>
          <tr>
            <th scope="col">{t('arkshop.dialog.title')}</th>
            <th scope="col">{t('arkshop.dialog.type')}</th>
            <th scope="col" className="u-text-end">{t('arkshop.dialog.price')}</th>
            <th scope="col">{t('arkshop.dialog.permissions')}</th>
            <th scope="col" className="u-text-end">{t('arkshop.shop.contentColumn')}</th>
            <th scope="col" className="u-text-end">{t('arkshop.rowActions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <TableMessageRow colSpan={6}>
              <EmptyState
                icon={ShoppingBag}
                title={filtered ? t('arkshop.shop.emptyFiltered') : t('arkshop.shop.empty')}
                description={filtered ? t('arkshop.shop.emptyFilteredHint') : undefined}
              />
            </TableMessageRow>
          ) : items.map(item => {
            const expanded = expandedItem === item.key
            const lines = (item.Items ?? []) as SubItem[]
            return (
              <Rows
                key={item.key}
                entryKey={item.key}
                title={item.Title || item.key}
                type={item.Type || t('arkshop.shop.defaultType')}
                price={item.Price}
                permissions={item.Permissions}
                lines={lines}
                lineCountLabel={t('arkshop.shop.objectsShort', { count: lines.length })}
                expanded={expanded}
                setExpanded={setExpandedItem}
                canOperate={canOperate}
                onEdit={() => onEdit(item)}
                onDelete={() => onDelete(item.key)}
              />
            )
          })}
        </tbody>
      </Table>
    </Card>
  )
}

export function KitsTab({
  kits, canOperate, expandedItem, setExpandedItem, onEdit, onDelete, onNew,
}: ListProps & { kits: ArkShopEntry[] }) {
  const { t } = useTranslation()

  return (
    <Card
      title={t('arkshop.tabs.kits')}
      icon={Package}
      flush
      actions={canOperate
        ? <Button size="sm" variant="primary" icon={Plus} onClick={onNew}>{t('arkshop.kits.new')}</Button>
        : undefined}
    >
      <Table label={t('arkshop.tabs.kits')} minWidth={880}>
        <thead>
          <tr>
            <th scope="col">{t('arkshop.dialog.keyId')}</th>
            <th scope="col">{t('arkshop.dialog.type')}</th>
            <th scope="col" className="u-text-end">{t('arkshop.dialog.price')}</th>
            <th scope="col">{t('arkshop.dialog.permissions')}</th>
            <th scope="col" className="u-text-end">{t('arkshop.shop.contentColumn')}</th>
            <th scope="col" className="u-text-end">{t('arkshop.rowActions')}</th>
          </tr>
        </thead>
        <tbody>
          {kits.length === 0 ? (
            <TableMessageRow colSpan={6}>
              <EmptyState icon={Package} title={t('arkshop.kits.empty')} />
            </TableMessageRow>
          ) : kits.map(kit => {
            const lines = (kit.Items ?? []) as SubItem[]
            const meta = [
              kit.DefaultAmount != null ? t('arkshop.kits.qty', { count: kit.DefaultAmount }) : null,
              kit.MaxLevel != null ? t('arkshop.kits.maxLv', { level: kit.MaxLevel }) : null,
              kit.OnlyFromSpawn ? t('arkshop.kits.onlyFromSpawn') : null,
            ].filter(Boolean).join(' · ')
            return (
              <Rows
                key={kit.key}
                entryKey={kit.key}
                title={kit.key}
                type={t('arkshop.kits.kitTypeLabel')}
                price={kit.Price}
                permissions={kit.Permissions}
                lines={lines}
                meta={meta}
                lineCountLabel={t('arkshop.kits.itemsShort', { count: lines.length })}
                expanded={expandedItem === kit.key}
                setExpanded={setExpandedItem}
                canOperate={canOperate}
                onEdit={() => onEdit(kit)}
                onDelete={() => onDelete(kit.key)}
              />
            )
          })}
        </tbody>
      </Table>
    </Card>
  )
}

export function SellTab({
  sellItems, canOperate, onEdit, onDelete, onNew,
}: Omit<ListProps, 'expandedItem' | 'setExpandedItem'> & { sellItems: ArkShopEntry[] }) {
  const { t } = useTranslation()

  return (
    <Card
      title={t('arkshop.tabs.sell')}
      icon={Coins}
      flush
      actions={canOperate
        ? <Button size="sm" variant="primary" icon={Plus} onClick={onNew}>{t('arkshop.sell.new')}</Button>
        : undefined}
    >
      <Table label={t('arkshop.tabs.sell')} minWidth={720}>
        <thead>
          <tr>
            <th scope="col">{t('arkshop.dialog.keyId')}</th>
            <th scope="col">{t('arkshop.dialog.type')}</th>
            <th scope="col" className="u-text-end">{t('arkshop.dialog.pricePts')}</th>
            <th scope="col">{t('arkshop.dialog.blueprint')}</th>
            <th scope="col" className="u-text-end">{t('arkshop.rowActions')}</th>
          </tr>
        </thead>
        <tbody>
          {sellItems.length === 0 ? (
            <TableMessageRow colSpan={5}>
              <EmptyState icon={Coins} title={t('arkshop.sell.empty')} />
            </TableMessageRow>
          ) : sellItems.map(item => (
            <tr key={item.key}>
              <td>{item.key}</td>
              <td>{item.Type || t('arkshop.shop.defaultType')}</td>
              <td className="u-text-end u-num">{t('arkshop.sell.pricePts', { price: item.Price })}</td>
              <td className="ui-cell-wrap">{item.Amount}x {bpName(item.Blueprint ?? '')}</td>
              <td>
                <div className="ui-row-actions">
                  <IconButton
                    size="sm"
                    icon={Pencil}
                    label={t('arkshop.shop.editNamed', { name: item.key })}
                    onClick={() => onEdit(item)}
                  />
                  {canOperate && (
                    <IconButton
                      size="sm"
                      tone="danger"
                      icon={Trash2}
                      label={t('arkshop.shop.deleteNamed', { name: item.key })}
                      onClick={() => onDelete(item.key)}
                    />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  )
}

/** One entry row plus, while expanded, the row that lists its contents. */
function Rows({
  entryKey, title, type, price, permissions, lines, meta, lineCountLabel,
  expanded, setExpanded, canOperate, onEdit, onDelete,
}: {
  entryKey: string
  title: string
  type: string
  price?: number
  permissions?: string
  lines: SubItem[]
  meta?: string
  lineCountLabel: string
  expanded: boolean
  setExpanded: (key: string | null) => void
  canOperate: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const panelId = `arkshop-entry-${entryKey}`

  return (
    <>
      <tr>
        <td className="ui-cell-wrap">{title}</td>
        <td>{type}</td>
        <td className="u-text-end u-num">{price}</td>
        <td>
          <div className="ui-row-actions">
            <PermissionBadges permissions={permissions} />
          </div>
        </td>
        <td className="u-text-end">{lineCountLabel}</td>
        <td>
          <div className="ui-row-actions">
            <IconButton
              size="sm"
              icon={ChevronDown}
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              label={expanded
                ? t('arkshop.shop.collapseNamed', { name: title })
                : t('arkshop.shop.expandNamed', { name: title })}
              onClick={() => setExpanded(expanded ? null : entryKey)}
            />
            <IconButton
              size="sm"
              icon={Pencil}
              label={t('arkshop.shop.editNamed', { name: title })}
              onClick={onEdit}
            />
            {canOperate && (
              <IconButton
                size="sm"
                tone="danger"
                icon={Trash2}
                label={t('arkshop.shop.deleteNamed', { name: title })}
                onClick={onDelete}
              />
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr id={panelId}>
          <td colSpan={6}>
            {meta && <p className="u-secondary u-text-sm">{meta}</p>}
            <EntryLines lines={lines} />
          </td>
        </tr>
      )}
    </>
  )
}
