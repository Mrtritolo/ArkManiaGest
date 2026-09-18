/**
 * Add / edit dialog for a shop item, a kit or a sell item, with the editor for
 * the lines an entry gives out (items or console commands). Failures render
 * inside the dialog and keep what was typed.
 */
import { Plus, Save, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Field, IconButton, Input, Modal, Select, Switch } from '../../../components/ui'
import type { ArkShopEntry } from '../../../services/api'
import { isCommandLine, type SubItem } from '../arkshopUtils'
import type { EntryDialogState } from '../hooks/useEntryDialog'
import { BlueprintSearch } from './BlueprintSearch'
import styles from '../ArkShopPage.module.css'

function SubItemEditor({ items, onChange, disabled }: {
  items: SubItem[]
  onChange: (items: SubItem[]) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const update = (index: number, patch: SubItem) =>
    onChange(items.map((line, i) => (i === index ? { ...line, ...patch } : line)))

  return (
    <div className="l-stack l-stack--sm">
      {items.map((line, index) => (
        <div key={index} className={styles.subRow}>
          {isCommandLine(line) ? (
            <>
              <Field label={t('arkshop.sub.command')} className="u-span-full">
                <Input mono value={line.Command ?? ''} disabled={disabled}
                  onChange={e => update(index, { Command: e.target.value })} />
              </Field>
              <Field label={t('arkshop.sub.displayAs')}>
                <Input value={line.DisplayAs ?? ''} disabled={disabled}
                  onChange={e => update(index, { DisplayAs: e.target.value })} />
              </Field>
              <Switch
                label={t('arkshop.sub.admin')}
                checked={Boolean(line.ExecuteAsAdmin)}
                disabled={disabled}
                onChange={checked => update(index, { ExecuteAsAdmin: checked })}
              />
            </>
          ) : (
            <>
              <Field label={t('arkshop.sub.blueprint')} className="u-span-full">
                <BlueprintSearch
                  value={line.Blueprint ?? ''}
                  disabled={disabled}
                  onChange={value => update(index, { Blueprint: value })}
                />
              </Field>
              <Field label={t('arkshop.sub.qty')}>
                <Input type="number" value={line.Amount ?? 1} disabled={disabled}
                  onChange={e => update(index, { Amount: parseInt(e.target.value) || 1 })} />
              </Field>
              <Field label={t('arkshop.sub.quality')}>
                <Input type="number" value={line.Quality ?? 0} disabled={disabled}
                  onChange={e => update(index, { Quality: parseInt(e.target.value) || 0 })} />
              </Field>
              <Switch
                label={t('arkshop.sub.bp')}
                checked={Boolean(line.ForceBlueprint)}
                disabled={disabled}
                onChange={checked => update(index, { ForceBlueprint: checked })}
              />
            </>
          )}
          <div className="l-cluster l-cluster--end u-span-full">
            <IconButton
              size="sm"
              tone="danger"
              icon={Trash2}
              disabled={disabled}
              label={t('arkshop.sub.removeLine', { num: index + 1 })}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            />
          </div>
        </div>
      ))}
      {!disabled && (
        <div className="l-cluster">
          <Button size="sm" icon={Plus}
            onClick={() => onChange([...items, { Amount: 1, Blueprint: '', ForceBlueprint: false, Quality: 0 }])}>
            {t('arkshop.sub.addItem')}
          </Button>
          <Button size="sm" variant="ghost" icon={Plus}
            onClick={() => onChange([...items, { Command: '', DisplayAs: '', ExecuteAsAdmin: false }])}>
            {t('arkshop.sub.addCmd')}
          </Button>
        </div>
      )}
    </div>
  )
}

export function EntryDialog({ dialog, canOperate }: { dialog: EntryDialogState; canOperate: boolean }) {
  const { t } = useTranslation()
  const { dialogData, dialogType, dialogIsNew, dialogError, saving } = dialog
  if (!dialogData) return null

  const set = (patch: Partial<ArkShopEntry>) => dialog.setDialogData({ ...dialogData, ...patch })
  const lines = (dialogData.Items ?? []) as SubItem[]
  const readOnly = !canOperate

  const title = dialogIsNew
    ? dialogType === 'shop' ? t('arkshop.dialog.newShop')
      : dialogType === 'kit' ? t('arkshop.dialog.newKit') : t('arkshop.dialog.newSell')
    : t('arkshop.dialog.editPrefix', { key: dialogData.key })

  return (
    <Modal
      open={dialog.dialogOpen}
      onClose={() => void dialog.requestClose()}
      dismissible={!saving}
      title={title}
      size="lg"
      onSubmit={() => { if (canOperate) void dialog.handleDialogSave() }}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => void dialog.requestClose()}>
            {t('arkshop.dialog.cancel')}
          </Button>
          {canOperate && (
            <Button
              type="submit"
              variant="primary"
              icon={Save}
              loading={saving}
              loadingLabel={t('arkshop.dialog.save')}
            >
              {t('arkshop.dialog.save')}
            </Button>
          )}
          {!dialogIsNew && canOperate && (
            <Button
              className="u-push"
              variant="danger"
              icon={Trash2}
              disabled={saving}
              onClick={() => void dialog.handleDelete(dialogType, dialogData.key)}
            >
              {t('arkshop.dialog.delete')}
            </Button>
          )}
        </>
      }
    >
      <div className="l-stack">
        {dialogError && <Alert tone="danger">{dialogError}</Alert>}
        {readOnly && <Alert tone="info">{t('arkshop.roles.operatorRequired')}</Alert>}

        <div className={styles.dialogGrid}>
          <Field label={t('arkshop.dialog.keyId')} required>
            <Input mono value={dialogData.key} disabled={!dialogIsNew || readOnly}
              onChange={e => set({ key: e.target.value })} />
          </Field>

          {dialogType === 'shop' && (
            <Field label={t('arkshop.dialog.title')}>
              <Input value={dialogData.Title ?? ''} disabled={readOnly}
                onChange={e => set({ Title: e.target.value })} />
            </Field>
          )}

          <Field label={t('arkshop.dialog.description')} className="u-span-full">
            <Input value={dialogData.Description ?? ''} disabled={readOnly}
              onChange={e => set({ Description: e.target.value })} />
          </Field>

          <Field label={dialogType === 'sell' ? t('arkshop.dialog.pricePts') : t('arkshop.dialog.price')}>
            <Input type="number" value={dialogData.Price ?? 0} disabled={readOnly}
              onChange={e => set({ Price: parseInt(e.target.value) || 0 })} />
          </Field>

          {dialogType !== 'kit' && (
            <Field label={t('arkshop.dialog.type')}>
              <Select value={dialogData.Type ?? 'item'} disabled={readOnly}
                onChange={e => set({ Type: e.target.value })}>
                <option value="item">{t('arkshop.dialog.optItem')}</option>
                {dialogType === 'shop' && <option value="command">{t('arkshop.dialog.optCommand')}</option>}
                <option value="dino">{t('arkshop.dialog.optDino')}</option>
              </Select>
            </Field>
          )}

          {dialogType === 'kit' && (
            <>
              <Field label={t('arkshop.dialog.defaultAmount')}>
                <Input type="number" value={dialogData.DefaultAmount ?? 1} disabled={readOnly}
                  onChange={e => set({ DefaultAmount: parseInt(e.target.value) || 1 })} />
              </Field>
              <Field label={t('arkshop.dialog.maxLevel')}>
                <Input type="number" value={dialogData.MaxLevel ?? 0} disabled={readOnly}
                  onChange={e => set({ MaxLevel: parseInt(e.target.value) || 0 })} />
              </Field>
              <Switch
                label={t('arkshop.dialog.onlyFromSpawn')}
                checked={Boolean(dialogData.OnlyFromSpawn)}
                disabled={readOnly}
                onChange={checked => set({ OnlyFromSpawn: checked })}
              />
            </>
          )}

          {dialogType === 'sell' && (
            <>
              <Field label={t('arkshop.dialog.amount')}>
                <Input type="number" value={dialogData.Amount ?? 1} disabled={readOnly}
                  onChange={e => set({ Amount: parseInt(e.target.value) || 1 })} />
              </Field>
              <Field label={t('arkshop.dialog.blueprint')} className="u-span-full">
                <BlueprintSearch
                  value={dialogData.Blueprint ?? ''}
                  disabled={readOnly}
                  onChange={value => set({ Blueprint: value })}
                />
              </Field>
            </>
          )}

          {dialogType !== 'sell' && (
            <Field label={t('arkshop.dialog.permissions')} className="u-span-full">
              <Input value={dialogData.Permissions ?? ''} disabled={readOnly}
                placeholder={t('arkshop.dialog.permissionsPlaceholder')}
                onChange={e => set({ Permissions: e.target.value })} />
            </Field>
          )}
        </div>

        {dialogType !== 'sell' && (
          <fieldset className="ui-fieldset">
            <legend>
              {dialogType === 'shop'
                ? t('arkshop.dialog.contentCount', { count: lines.length })
                : t('arkshop.dialog.itemsCount', { count: lines.length })}
            </legend>
            <SubItemEditor items={lines} disabled={readOnly} onChange={items => set({ Items: items })} />
          </fieldset>
        )}
      </div>
    </Modal>
  )
}
