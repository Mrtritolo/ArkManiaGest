/**
 * TransferRulesPage — Transfer rule management (ARKM_transfer_rules).
 *
 * One rule per source/destination pair, with a transfer level from "full"
 * to "blocked". Rules are edited in place: the level select and the note
 * input replace the cells of the row being edited, Enter saves and Escape
 * cancels. Every write is require_operator server side, so viewers see the
 * table without the create/edit/delete controls.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { arkTransferRulesApi, arkmaniaApi } from '../services/api'
import { extractError } from '../utils/errors'
import type { AuthUser } from '../types'
import {
  ArrowRight, ArrowRightLeft, Edit2, Plus, RefreshCw, RotateCw, Save,
  Shield, ShieldAlert, ShieldBan, ShieldCheck, Trash2, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Alert, Badge, Button, Card, EmptyState, Field, IconButton, Input, PageHeader,
  Select, Spinner, StatTile, Table, TableMessageRow, useConfirm, useToast,
  type BadgeTone,
} from '../components/ui'
import { usePending } from '../hooks/usePending'

interface TransferRule {
  id: number; source_server: string; dest_server: string
  transfer_level: number; transfer_level_name: string; notes: string | null
}

interface ServerItem {
  server_key: string; display_name: string; map_name: string
  is_online: boolean
}

/**
 * Levels are a severity ramp, not a category: allowed -> blocked. Each one
 * carries its own icon and its written label, so the tone is never the only
 * thing telling them apart.
 */
const TRANSFER_LEVEL_META: { value: number; tone: BadgeTone; icon: LucideIcon; tkey: string }[] = [
  { value: 0, tone: 'success', icon: ShieldCheck, tkey: 'full' },
  { value: 1, tone: 'info', icon: Shield, tkey: 'survivorInv' },
  { value: 2, tone: 'warning', icon: ShieldAlert, tkey: 'survivorOnly' },
  { value: 3, tone: 'danger', icon: ShieldBan, tkey: 'blocked' },
]

interface Props {
  currentUser?: AuthUser | null
}

export default function TransferRulesPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  // Creating, editing and deleting rules are require_operator server side.
  const canOperate = currentUser?.role === 'admin' || currentUser?.role === 'operator'
  const pending = usePending<number>()

  const TRANSFER_LEVELS = useMemo(() => TRANSFER_LEVEL_META.map(m => ({
    ...m,
    label: t(`transferRules.levels.${m.tkey}.label`),
    desc: t(`transferRules.levels.${m.tkey}.desc`),
  })), [t])

  const [rules, setRules] = useState<TransferRule[]>([])
  const [servers, setServers] = useState<ServerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addError, setAddError] = useState('')
  // Per-picker rejections: the form is noValidate, so nothing else stops an
  // empty or self-referencing rule before the POST.
  const [addFieldErrors, setAddFieldErrors] = useState<{ source?: string; dest?: string }>({})
  const [adding, setAdding] = useState(false)
  const sourceRef = useRef<HTMLSelectElement>(null)
  const destRef = useRef<HTMLSelectElement>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editLevel, setEditLevel] = useState(0)
  const [editNotes, setEditNotes] = useState('')
  const [newRule, setNewRule] = useState({ source_server: '', dest_server: '', transfer_level: 3, notes: '' })

  async function loadData() {
    setLoading(true)
    try {
      const [rulesRes, serversRes] = await Promise.all([
        arkTransferRulesApi.list(),
        arkmaniaApi.listServers(),
      ])
      setRules(rulesRes.data.rules)
      setServers(serversRes.data.servers)
      setLoadError('')
    } catch (e: unknown) {
      setLoadError(extractError(e, t('transferRules.loadFailed')))
    } finally { setLoading(false) }
  }

  useEffect(() => { loadData() }, [])

  const serverOptions = [
    { value: 'PvP', label: t('transferRules.serverTypePrefix', { type: 'PvP' }) },
    { value: 'PvE', label: t('transferRules.serverTypePrefix', { type: 'PvE' }) },
    ...servers.map(s => ({ value: s.server_key, label: s.display_name })),
  ]

  function resolveServerName(key: string): string {
    if (key === 'PvP' || key === 'PvE') return t('transferRules.serverTypePrefix', { type: key })
    const s = servers.find(sv => sv.server_key === key)
    return s?.display_name || key.split('_')[0]
  }

  function getLevelInfo(level: number) {
    return TRANSFER_LEVELS.find(l => l.value === level) || TRANSFER_LEVELS[3]
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    // Both pickers are required and a rule from a server to itself can never
    // fire, but the backend validates only transfer_level: it would store a
    // '' -> '' row and answer {created: true}. Reject both here.
    const errors: { source?: string; dest?: string } = {}
    if (!newRule.source_server) errors.source = t('transferRules.form.errorRequired')
    if (!newRule.dest_server) errors.dest = t('transferRules.form.errorRequired')
    if (!errors.source && !errors.dest && newRule.source_server === newRule.dest_server) {
      errors.dest = t('transferRules.form.errorSameServer')
    }
    setAddFieldErrors(errors)
    if (errors.source) { sourceRef.current?.focus(); return }
    if (errors.dest) { destRef.current?.focus(); return }
    setAddError('')
    setAdding(true)
    try {
      await arkTransferRulesApi.create({
        source_server: newRule.source_server,
        dest_server: newRule.dest_server,
        transfer_level: newRule.transfer_level,
        notes: newRule.notes || undefined,
      })
      setShowAdd(false)
      setNewRule({ source_server: '', dest_server: '', transfer_level: 3, notes: '' })
      setAddFieldErrors({})
      toast.success(t('transferRules.success.created'))
      await loadData()
    } catch (e: unknown) {
      setAddError(extractError(e, t('transferRules.form.createFailed')))
    } finally {
      setAdding(false)
    }
  }

  function startEdit(rule: TransferRule) {
    setEditingId(rule.id)
    setEditLevel(rule.transfer_level)
    setEditNotes(rule.notes || '')
  }

  async function saveEdit() {
    if (editingId == null) return
    const id = editingId
    try {
      // Always send notes: an empty string is how a note gets cleared
      // (the backend skips the column only when notes is omitted).
      await pending.run(id, () => arkTransferRulesApi.update(id, { transfer_level: editLevel, notes: editNotes }))
      setEditingId(null)
      toast.success(t('transferRules.success.updated'))
      await loadData()
    } catch (e: unknown) {
      toast.error(extractError(e, t('transferRules.updateFailed')))
    }
  }

  async function handleDelete(rule: TransferRule) {
    const ok = await confirm({
      title: t('transferRules.confirmDelete'),
      description: t('transferRules.confirmDeletePair', {
        source: resolveServerName(rule.source_server),
        dest: resolveServerName(rule.dest_server),
      }),
      confirmLabel: t('transferRules.confirmDeleteAction'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await pending.run(rule.id, () => arkTransferRulesApi.delete(rule.id))
      toast.success(t('transferRules.success.deleted'))
      await loadData()
    } catch (e: unknown) {
      toast.error(extractError(e, t('transferRules.deleteFailed')))
    }
  }

  /** Enter commits the inline edit, Escape abandons it. */
  function onEditKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter') { e.preventDefault(); void saveEdit() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingId(null) }
  }

  const levelCounts = TRANSFER_LEVELS.map(l => ({
    ...l,
    count: rules.filter(r => r.transfer_level === l.value).length,
  }))

  return (
    <div className="l-page">
      <PageHeader
        title={t('transferRules.heading')}
        icon={ArrowRightLeft}
        description={t('transferRules.subtitle', { count: rules.length })}
        actions={
          <>
            {canOperate && (
              <Button
                variant="primary"
                icon={Plus}
                aria-expanded={showAdd}
                onClick={() => { setShowAdd(v => !v); setAddError(''); setAddFieldErrors({}) }}
              >
                {t('transferRules.newButton')}
              </Button>
            )}
            <IconButton icon={RefreshCw} label={t('common.refresh')} loading={loading} onClick={loadData} />
          </>
        }
      />

      {loadError && (
        <Alert
          tone="danger"
          title={t('transferRules.loadFailed')}
          actions={<Button size="sm" icon={RotateCw} onClick={loadData}>{t('common.retry')}</Button>}
          onDismiss={() => setLoadError('')}
        >
          {loadError}
        </Alert>
      )}

      <div className="l-grid--stats">
        {levelCounts.map(l => (
          <StatTile key={l.value} label={l.label} value={l.count} icon={l.icon} meta={l.desc} loading={loading} />
        ))}
      </div>

      {showAdd && canOperate && (
        <Card title={t('transferRules.form.heading')} icon={Plus}>
          <form className="l-stack" onSubmit={handleAdd} noValidate>
            {addError && <Alert tone="danger">{addError}</Alert>}
            <div className="l-grid--form">
              <Field label={t('transferRules.form.sourceLabel')} error={addFieldErrors.source} required>
                <Select
                  ref={sourceRef}
                  required
                  value={newRule.source_server}
                  onChange={e => {
                    setNewRule({ ...newRule, source_server: e.target.value })
                    setAddFieldErrors({})
                  }}
                >
                  <option value="">{t('transferRules.form.selectPlaceholder')}</option>
                  {serverOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label={t('transferRules.form.destLabel')} error={addFieldErrors.dest} required>
                <Select
                  ref={destRef}
                  required
                  value={newRule.dest_server}
                  onChange={e => {
                    setNewRule({ ...newRule, dest_server: e.target.value })
                    setAddFieldErrors({})
                  }}
                >
                  <option value="">{t('transferRules.form.selectPlaceholder')}</option>
                  {serverOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label={t('transferRules.form.levelLabel')}>
                <Select
                  value={newRule.transfer_level}
                  onChange={e => setNewRule({ ...newRule, transfer_level: Number(e.target.value) })}
                >
                  {TRANSFER_LEVELS.map(l => (
                    <option key={l.value} value={l.value}>{l.label} — {l.desc}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('transferRules.form.notesLabel')} className="u-span-full">
                <Input
                  placeholder={t('transferRules.form.notesPlaceholder')}
                  value={newRule.notes}
                  onChange={e => setNewRule({ ...newRule, notes: e.target.value })}
                />
              </Field>
            </div>
            <div className="l-cluster l-cluster--end">
              <Button variant="ghost" onClick={() => { setShowAdd(false); setAddFieldErrors({}) }}>
                {t('transferRules.form.cancel')}
              </Button>
              <Button type="submit" variant="primary" loading={adding} loadingLabel={t('transferRules.form.creating')}>
                {t('transferRules.form.create')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={t('transferRules.listTitle')} flush>
        <Table label={t('transferRules.listTitle')} minWidth={880}>
          <thead>
            <tr>
              <th scope="col">{t('transferRules.table.source')}</th>
              <th scope="col">{t('transferRules.table.dest')}</th>
              <th scope="col">{t('transferRules.table.level')}</th>
              <th scope="col">{t('transferRules.table.notes')}</th>
              <th scope="col" className="u-text-end">{t('transferRules.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableMessageRow colSpan={5}><Spinner block label={t('transferRules.loading')} /></TableMessageRow>
            ) : rules.length === 0 ? (
              <TableMessageRow colSpan={5}>
                <EmptyState
                  icon={ArrowRightLeft}
                  title={t('transferRules.empty.title')}
                  description={t('transferRules.empty.hint')}
                />
              </TableMessageRow>
            ) : rules.map(rule => {
              const isEditing = editingId === rule.id
              const lvl = getLevelInfo(rule.transfer_level)
              return (
                <tr key={rule.id}>
                  <td>{resolveServerName(rule.source_server)}</td>
                  <td>
                    <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" className="u-muted" />
                    {' '}
                    {resolveServerName(rule.dest_server)}
                  </td>
                  <td>
                    {isEditing ? (
                      <Select
                        size="sm"
                        aria-label={t('transferRules.table.level')}
                        value={editLevel}
                        onChange={e => setEditLevel(Number(e.target.value))}
                        onKeyDown={onEditKeyDown}
                      >
                        {TRANSFER_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                      </Select>
                    ) : (
                      <Badge tone={lvl.tone} icon={lvl.icon}>{lvl.label}</Badge>
                    )}
                  </td>
                  <td className="ui-cell-wrap">
                    {isEditing ? (
                      <Input
                        size="sm"
                        aria-label={t('transferRules.table.notes')}
                        value={editNotes}
                        onChange={e => setEditNotes(e.target.value)}
                        onKeyDown={onEditKeyDown}
                        placeholder={t('transferRules.notesPlaceholder')}
                      />
                    ) : (
                      rule.notes || <span className="u-muted">—</span>
                    )}
                  </td>
                  <td>
                    <div className="ui-row-actions">
                      {isEditing ? (
                        <>
                          <IconButton
                            size="sm"
                            icon={Save}
                            label={t('transferRules.tooltip.save')}
                            loading={pending.isPending(rule.id)}
                            onClick={saveEdit}
                          />
                          <IconButton
                            size="sm"
                            icon={X}
                            label={t('transferRules.tooltip.cancel')}
                            onClick={() => setEditingId(null)}
                          />
                        </>
                      ) : canOperate ? (
                        <>
                          <IconButton
                            size="sm"
                            icon={Edit2}
                            label={t('transferRules.tooltip.editPair', {
                              source: resolveServerName(rule.source_server),
                              dest: resolveServerName(rule.dest_server),
                            })}
                            disabled={editingId !== null}
                            onClick={() => startEdit(rule)}
                          />
                          <IconButton
                            size="sm"
                            icon={Trash2}
                            tone="danger"
                            label={t('transferRules.tooltip.deletePair', {
                              source: resolveServerName(rule.source_server),
                              dest: resolveServerName(rule.dest_server),
                            })}
                            loading={pending.isPending(rule.id)}
                            onClick={() => handleDelete(rule)}
                          />
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
