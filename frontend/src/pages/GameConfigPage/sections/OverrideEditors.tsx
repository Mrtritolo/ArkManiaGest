/**
 * The typed Game.ini override editors: stack sizes, crafting costs and NPC
 * replacements. A line the backend could not parse arrives with `raw` only:
 * it stays read-only here (the Raw tab edits it) and is never resent, so the
 * backend keeps the original line instead of writing a second, broken one.
 */
import { Layers, Package, Plus, Replace, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Button, Card, EmptyState, IconButton, Input, Switch, Table, TableMessageRow,
} from '../../../components/ui'
import type { Row } from '../gameConfigModel'
import type { GameConfigState } from '../hooks/useGameConfig'

interface SectionProps {
  state: GameConfigState
  canOperate: boolean
}

export function StacksEditor({ state, canOperate }: SectionProps) {
  const { t } = useTranslation()
  const { localStacks, setLocalStacks, setHasChanges, stackSearch, setStackSearch } = state
  const readOnlyTitle = canOperate ? undefined : t('gameConfig.readOnlyRole')

  // Keep each row's index in localStacks: looking it up with indexOf per row
  // was quadratic on clusters with thousands of overrides.
  const filtered = localStacks
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !stackSearch || String(row.class ?? '').toLowerCase().includes(stackSearch.toLowerCase()))

  function patch(index: number, changes: Row) {
    setLocalStacks(prev => prev.map((row, i) => (i === index ? { ...row, ...changes } : row)))
    setHasChanges(true)
  }

  return (
    <Card
      title={t('gameConfig.stacks.count', { count: localStacks.length })}
      icon={Layers}
      flush
      actions={
        <>
          <Input
            type="search"
            size="sm"
            aria-label={t('gameConfig.stacks.searchPlaceholder')}
            placeholder={t('gameConfig.stacks.searchPlaceholder')}
            value={stackSearch}
            onChange={event => setStackSearch(event.target.value)}
          />
          {canOperate && (
            <Button
              size="sm"
              icon={Plus}
              onClick={() => {
                setLocalStacks(prev => [...prev, { class: '', max_quantity: 100, ignore_multiplier: true }])
                setHasChanges(true)
              }}
            >
              {t('gameConfig.stacks.add')}
            </Button>
          )}
        </>
      }
    >
      <Table label={t('gameConfig.stacks.tableLabel')} minWidth={640}>
        <thead>
          <tr>
            <th scope="col">{t('gameConfig.stacks.colItemClass')}</th>
            <th scope="col">{t('gameConfig.stacks.colMaxQty')}</th>
            <th scope="col">{t('gameConfig.stacks.colIgnoreMulti')}</th>
            <th scope="col" className="u-text-end">{t('gameConfig.rowActions')}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <TableMessageRow colSpan={4}>
              <EmptyState
                icon={Layers}
                title={stackSearch ? t('gameConfig.stacks.emptyMatching') : t('gameConfig.stacks.empty')}
              />
            </TableMessageRow>
          ) : filtered.map(({ row, index }) => {
            const rawOnly = row.class === undefined
            const name = (row.class as string) || (row.raw as string) || ''
            return (
              <tr key={index} title={rawOnly ? t('gameConfig.rawOnlyHint') : undefined}>
                <td>
                  <Input
                    size="sm"
                    mono
                    aria-label={t('gameConfig.stacks.colItemClass')}
                    placeholder="PrimalItemConsumable_..."
                    value={name}
                    readOnly={rawOnly}
                    disabled={!canOperate}
                    title={rawOnly ? t('gameConfig.rawOnlyHint') : readOnlyTitle}
                    onChange={event => patch(index, { class: event.target.value })}
                  />
                </td>
                <td>
                  <Input
                    size="sm"
                    mono
                    type="number"
                    min={1}
                    aria-label={t('gameConfig.stacks.colMaxQty')}
                    value={(row.max_quantity as number) ?? ''}
                    disabled={rawOnly || !canOperate}
                    title={rawOnly ? t('gameConfig.rawOnlyHint') : readOnlyTitle}
                    onChange={event => patch(index, { max_quantity: parseInt(event.target.value) || 1 })}
                  />
                </td>
                <td>
                  <Switch
                    hideLabel
                    label={t('gameConfig.stacks.ignoreMultiFor', { name: name || t('gameConfig.supply.newLabel') })}
                    checked={Boolean(row.ignore_multiplier)}
                    disabled={rawOnly || !canOperate}
                    onChange={checked => patch(index, { ignore_multiplier: checked })}
                  />
                </td>
                <td>
                  <div className="ui-row-actions">
                    <IconButton
                      size="sm"
                      tone="danger"
                      icon={Trash2}
                      label={t('gameConfig.stacks.deleteRow', { name: name || String(index + 1) })}
                      disabled={rawOnly || !canOperate}
                      onClick={() => {
                        setLocalStacks(prev => prev.filter((_, i) => i !== index))
                        setHasChanges(true)
                      }}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </Card>
  )
}

export function CraftingEditor({ state, canOperate }: SectionProps) {
  const { t } = useTranslation()
  const { localCrafting, setLocalCrafting, setHasChanges } = state
  const readOnlyTitle = canOperate ? undefined : t('gameConfig.readOnlyRole')

  function patchItem(index: number, changes: Row) {
    setLocalCrafting(prev => prev.map((row, i) => (i === index ? { ...row, ...changes } : row)))
    setHasChanges(true)
  }
  function patchResources(index: number, next: Row[]) {
    patchItem(index, { resources: next })
  }

  return (
    <div className="l-stack">
      <div className="l-cluster l-cluster--between">
        <span className="u-secondary">{t('gameConfig.crafting.count', { count: localCrafting.length })}</span>
        {canOperate && (
          <Button
            size="sm"
            icon={Plus}
            onClick={() => {
              setLocalCrafting(prev => [...prev, { item_class: '', resources: [{ resource_class: '', amount: 1, exact_type: false }] }])
              setHasChanges(true)
            }}
          >
            {t('gameConfig.crafting.add')}
          </Button>
        )}
      </div>
      {localCrafting.length === 0 && (
        <Card><EmptyState icon={Package} title={t('gameConfig.crafting.empty')} /></Card>
      )}
      {localCrafting.map((item, index) => {
        const rawOnly = item.item_class === undefined
        const resources = (item.resources as Row[]) || []
        const itemName = rawOnly ? (item.raw as string) || '' : (item.item_class as string) || ''
        return (
          <Card
            key={index}
            title={itemName || t('gameConfig.crafting.newEntry', { num: index + 1 })}
            icon={Package}
            actions={
              <IconButton
                size="sm"
                tone="danger"
                icon={Trash2}
                label={t('gameConfig.crafting.deleteEntry', { name: itemName || String(index + 1) })}
                disabled={rawOnly || !canOperate}
                title={rawOnly ? t('gameConfig.rawOnlyHint') : readOnlyTitle}
                onClick={() => {
                  setLocalCrafting(prev => prev.filter((_, i) => i !== index))
                  setHasChanges(true)
                }}
              />
            }
          >
            <div className="l-stack l-stack--sm">
              <Input
                mono
                aria-label={t('gameConfig.crafting.itemClassPlaceholder')}
                placeholder={t('gameConfig.crafting.itemClassPlaceholder')}
                value={itemName}
                readOnly={rawOnly}
                disabled={!canOperate}
                title={rawOnly ? t('gameConfig.rawOnlyHint') : readOnlyTitle}
                onChange={event => patchItem(index, { item_class: event.target.value })}
              />
              <fieldset className="ui-fieldset">
                <legend>{t('gameConfig.crafting.requiredResources')}</legend>
                {resources.length === 0 && (
                  <p className="u-secondary u-text-sm">{t('gameConfig.crafting.noResources')}</p>
                )}
                {resources.map((resource, ri) => (
                  <div key={ri} className="l-cluster">
                    <Input
                      mono
                      size="sm"
                      aria-label={t('gameConfig.crafting.resourcePlaceholder')}
                      placeholder={t('gameConfig.crafting.resourcePlaceholder')}
                      value={(resource.resource_class as string) || ''}
                      disabled={!canOperate}
                      title={readOnlyTitle}
                      onChange={event => patchResources(index, resources.map((r, j) =>
                        (j === ri ? { ...r, resource_class: event.target.value } : r)))}
                    />
                    <Input
                      mono
                      size="sm"
                      type="number"
                      min={0}
                      step={0.1}
                      aria-label={t('gameConfig.crafting.amountLabel')}
                      value={resource.amount as number}
                      disabled={!canOperate}
                      title={readOnlyTitle}
                      onChange={event => patchResources(index, resources.map((r, j) =>
                        (j === ri ? { ...r, amount: parseFloat(event.target.value) || 0 } : r)))}
                    />
                    <IconButton
                      size="sm"
                      tone="danger"
                      icon={X}
                      label={t('gameConfig.crafting.removeResource', { num: ri + 1 })}
                      disabled={!canOperate}
                      onClick={() => patchResources(index, resources.filter((_, j) => j !== ri))}
                    />
                  </div>
                ))}
                {canOperate && (
                  <Button
                    size="sm"
                    icon={Plus}
                    disabled={rawOnly}
                    title={rawOnly ? t('gameConfig.rawOnlyHint') : undefined}
                    onClick={() => patchResources(index, [...resources, { resource_class: '', amount: 1, exact_type: false }])}
                  >
                    {t('gameConfig.crafting.addResource')}
                  </Button>
                )}
              </fieldset>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

export function NpcEditor({ state, canOperate }: SectionProps) {
  const { t } = useTranslation()
  const { localNpcRepl, setLocalNpcRepl, setHasChanges } = state
  const readOnlyTitle = canOperate ? undefined : t('gameConfig.readOnlyRole')

  function patch(index: number, changes: Row) {
    setLocalNpcRepl(prev => prev.map((row, i) => (i === index ? { ...row, ...changes } : row)))
    setHasChanges(true)
  }

  return (
    <Card
      title={t('gameConfig.npc.count', { count: localNpcRepl.length })}
      icon={Replace}
      flush
      actions={canOperate ? (
        <Button
          size="sm"
          icon={Plus}
          onClick={() => {
            setLocalNpcRepl(prev => [...prev, { from_class: '', to_class: '' }])
            setHasChanges(true)
          }}
        >
          {t('gameConfig.npc.add')}
        </Button>
      ) : undefined}
    >
      <Table label={t('gameConfig.npc.tableLabel')} minWidth={640}>
        <thead>
          <tr>
            <th scope="col">{t('gameConfig.npc.colFrom')}</th>
            <th scope="col">{t('gameConfig.npc.colTo')}</th>
            <th scope="col" className="u-text-end">{t('gameConfig.rowActions')}</th>
          </tr>
        </thead>
        <tbody>
          {localNpcRepl.length === 0 ? (
            <TableMessageRow colSpan={3}>
              <EmptyState icon={Replace} title={t('gameConfig.npc.empty')} />
            </TableMessageRow>
          ) : localNpcRepl.map((row, index) => {
            const rawOnly = row.from_class === undefined
            const fromName = rawOnly ? (row.raw as string) || '' : (row.from_class as string) || ''
            return (
              <tr key={index} title={rawOnly ? t('gameConfig.rawOnlyHint') : undefined}>
                <td>
                  <Input
                    size="sm"
                    mono
                    aria-label={t('gameConfig.npc.colFrom')}
                    placeholder="Pegomastax_Character_BP_C"
                    value={fromName}
                    readOnly={rawOnly}
                    disabled={!canOperate}
                    title={rawOnly ? t('gameConfig.rawOnlyHint') : readOnlyTitle}
                    onChange={event => patch(index, { from_class: event.target.value })}
                  />
                </td>
                <td>
                  <Input
                    size="sm"
                    mono
                    aria-label={t('gameConfig.npc.colTo')}
                    placeholder="Dodo_Character_BP_C"
                    value={(row.to_class as string) || ''}
                    readOnly={rawOnly}
                    disabled={!canOperate}
                    title={rawOnly ? t('gameConfig.rawOnlyHint') : readOnlyTitle}
                    onChange={event => patch(index, { to_class: event.target.value })}
                  />
                </td>
                <td>
                  <div className="ui-row-actions">
                    <IconButton
                      size="sm"
                      tone="danger"
                      icon={Trash2}
                      label={t('gameConfig.npc.deleteRow', { name: fromName || String(index + 1) })}
                      disabled={rawOnly || !canOperate}
                      onClick={() => {
                        setLocalNpcRepl(prev => prev.filter((_, i) => i !== index))
                        setHasChanges(true)
                      }}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </Card>
  )
}
