/**
 * ServersPage -- CRUD for the ARKM_servers table.
 *
 * Every registered ARK game server in one table, with inline editing, the
 * online/offline verdict and the create/delete controls.
 *
 * Role gating mirrors arkmania_config.py: create and edit need an operator,
 * delete needs an admin.
 */
import { useEffect, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, RotateCw, Server, Trash2, Users, Wifi, WifiOff, X } from 'lucide-react'

import { arkmaniaApi } from '../services/api'
import { extractError } from '../utils/errors'
import { usePending } from '../hooks/usePending'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatTile,
  StatusBadge,
  Table,
  TableMessageRow,
  useConfirm,
  useToast,
} from '../components/ui'
import type { AuthUser } from '../types'

interface ServerItem {
  server_key: string
  display_name: string
  map_name: string
  game_mode: string
  server_type: string
  cluster_group: string
  max_players: number
  is_online: boolean
  player_count: number
  last_heartbeat: string | null
}

const EMPTY_NEW: ServerItem = {
  server_key: '', display_name: '', map_name: '', game_mode: 'PvE',
  server_type: 'PvE', cluster_group: 'default', max_players: 70,
  is_online: false, player_count: 0, last_heartbeat: null,
}

// Same bounds as ServerInstanceUpdate.max_players on the instance side.
const validMaxPlayers = (n: number | undefined) =>
  n !== undefined && Number.isInteger(n) && n >= 1 && n <= 500

const COLUMNS = 9

interface Props {
  currentUser?: AuthUser | null
}

export default function ServersPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const isAdmin = currentUser?.role === 'admin'
  const canOperate = isAdmin || currentUser?.role === 'operator'

  const [servers, setServers] = useState<ServerItem[]>([])
  const [loading, setLoading] = useState(true)
  // null = loaded; a string (possibly empty) = the last load failed.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newServer, setNewServer] = useState({ ...EMPTY_NEW })
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<ServerItem>>({})
  const pending = usePending<string>()

  // -- Data loading ---------------------------------------------------------
  async function loadData() {
    setLoading(true)
    try {
      const res = await arkmaniaApi.listServers()
      setServers(res.data.servers)
      setLoadError(null)
    } catch (e) {
      setLoadError(extractError(e, ''))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  // -- CRUD -----------------------------------------------------------------
  async function handleCreate() {
    if (!newServer.server_key || !newServer.display_name || !newServer.map_name) {
      toast.error(t('serversPage.messages.missingRequired'))
      return
    }
    if (!validMaxPlayers(newServer.max_players)) {
      toast.error(t('serversPage.messages.invalidMaxPlayers'))
      return
    }
    try {
      const res = await pending.run('__create__', () => arkmaniaApi.createServer({
        server_key: newServer.server_key,
        display_name: newServer.display_name,
        map_name: newServer.map_name,
        game_mode: newServer.game_mode,
        server_type: newServer.server_type,
        cluster_group: newServer.cluster_group,
        max_players: newServer.max_players,
      }))
      // A second submit while the POST is in flight resolves to undefined:
      // the first call owns the toast and the reload.
      if (res === undefined) return
      setShowAdd(false)
      setNewServer({ ...EMPTY_NEW })
      toast.success(t('serversPage.messages.created'))
      await loadData()
    } catch (e) {
      toast.error(extractError(e, t('serversPage.messages.createFailed')))
    }
  }

  function startEdit(s: ServerItem) {
    setEditingKey(s.server_key)
    setEditData({
      display_name: s.display_name,
      map_name: s.map_name,
      game_mode: s.game_mode,
      server_type: s.server_type,
      cluster_group: s.cluster_group,
      max_players: s.max_players,
    })
  }

  async function saveEdit() {
    if (!editingKey) return
    if (!validMaxPlayers(editData.max_players)) {
      toast.error(t('serversPage.messages.invalidMaxPlayers'))
      return
    }
    const key = editingKey
    try {
      const res = await pending.run(key, () => arkmaniaApi.updateServer(key, editData))
      // Enter repeats reach saveEdit directly, with no Button loading guard in
      // between: a run for a key already in flight resolves to undefined, and
      // closing the editor here would claim a PUT that never ran.
      if (res === undefined) return
      setEditingKey(null)
      toast.success(t('serversPage.messages.updated'))
      await loadData()
    } catch (e) {
      toast.error(extractError(e, t('serversPage.messages.updateFailed')))
    }
  }

  async function handleDelete(s: ServerItem) {
    const ok = await confirm({
      title: t('serversPage.deleteTitle', { name: s.display_name }),
      description: t('serversPage.confirmDelete', { name: s.display_name }),
      confirmLabel: t('serversPage.deleteConfirm'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      // Shares its key with saveEdit, so a delete asked for while a save of the
      // same row runs is skipped -- never reported as a completed delete.
      const res = await pending.run(s.server_key, () => arkmaniaApi.deleteServer(s.server_key))
      if (res === undefined) return
      toast.success(t('serversPage.messages.deleted'))
      await loadData()
    } catch (e) {
      toast.error(extractError(e, t('serversPage.messages.deleteFailed')))
    }
  }

  /** Enter commits an inline edit, Escape abandons it. */
  function onEditKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void saveEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setEditingKey(null)
    }
  }

  // -- Stats ----------------------------------------------------------------
  const online = servers.filter(s => s.is_online).length
  const offline = servers.length - online
  const totalPlayers = servers.reduce((sum, s) => sum + s.player_count, 0)

  return (
    <div className="l-page">
      <PageHeader
        title={t('serversPage.heading')}
        icon={Server}
        description={t('serversPage.subtitle', { total: servers.length, online, players: totalPlayers })}
        actions={
          <>
            {canOperate && (
              <Button variant="primary" icon={Plus} pressed={showAdd} onClick={() => setShowAdd(v => !v)}>
                {t('serversPage.newServer')}
              </Button>
            )}
            <Button icon={RotateCw} loading={loading} loadingLabel={t('serversPage.loading')} onClick={loadData}>
              {t('serversPage.refresh')}
            </Button>
          </>
        }
      />

      {loadError !== null && (
        <Alert
          tone="danger"
          title={t('serversPage.loadError')}
          actions={<Button size="sm" icon={RotateCw} onClick={loadData}>{t('common.retry')}</Button>}
        >
          {loadError || undefined}
        </Alert>
      )}

      <div className="l-grid--stats">
        <StatTile label={t('serversPage.stats.online')} value={online} icon={Wifi} />
        <StatTile
          label={t('serversPage.stats.offline')}
          value={offline}
          icon={WifiOff}
          meta={offline > 0 ? t('serversPage.stats.offlineMeta', { count: offline }) : undefined}
          metaTone={offline > 0 ? 'danger' : undefined}
        />
        <StatTile label={t('serversPage.stats.players')} value={totalPlayers} icon={Users} />
        <StatTile label={t('serversPage.stats.total')} value={servers.length} icon={Server} />
      </div>

      {canOperate && showAdd && (
        <Card title={t('serversPage.form.title')} icon={Plus}>
          <form className="l-stack" noValidate onSubmit={e => { e.preventDefault(); handleCreate() }}>
            <div className="l-grid--form">
              <Field label={t('serversPage.form.serverKey')} required>
                <Input
                  mono
                  value={newServer.server_key}
                  placeholder={t('serversPage.form.keyPlaceholder')}
                  onChange={e => setNewServer({ ...newServer, server_key: e.target.value })}
                />
              </Field>
              <Field label={t('serversPage.form.name')} required>
                <Input
                  value={newServer.display_name}
                  placeholder={t('serversPage.form.namePlaceholder')}
                  onChange={e => setNewServer({ ...newServer, display_name: e.target.value })}
                />
              </Field>
              <Field label={t('serversPage.form.map')} required>
                <Input
                  value={newServer.map_name}
                  placeholder={t('serversPage.form.mapPlaceholder')}
                  onChange={e => setNewServer({ ...newServer, map_name: e.target.value })}
                />
              </Field>
              <Field label={t('serversPage.form.gameMode')}>
                <Select value={newServer.game_mode} onChange={e => setNewServer({ ...newServer, game_mode: e.target.value })}>
                  <option value="PvE">PvE</option>
                  <option value="PvP">PvP</option>
                  <option value="PvPvE">PvPvE</option>
                </Select>
              </Field>
              <Field label={t('serversPage.form.type')}>
                <Select value={newServer.server_type} onChange={e => setNewServer({ ...newServer, server_type: e.target.value })}>
                  <option value="PvE">PvE</option>
                  <option value="PvP">PvP</option>
                </Select>
              </Field>
              <Field label={t('serversPage.form.cluster')}>
                <Input value={newServer.cluster_group} onChange={e => setNewServer({ ...newServer, cluster_group: e.target.value })} />
              </Field>
              <Field label={t('serversPage.form.maxPlayers')} hint={t('serversPage.form.maxPlayersHint')}>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={newServer.max_players}
                  onChange={e => setNewServer({ ...newServer, max_players: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="l-cluster">
              <Button
                type="submit"
                variant="primary"
                loading={pending.isPending('__create__')}
                loadingLabel={t('serversPage.form.creating')}
              >
                {t('serversPage.form.create')}
              </Button>
              <Button variant="ghost" onClick={() => { setShowAdd(false); setNewServer({ ...EMPTY_NEW }) }}>
                {t('serversPage.form.cancel')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={t('serversPage.tableTitle')} flush>
        <Table label={t('serversPage.tableTitle')} minWidth={960}>
          <thead>
            <tr>
              <th scope="col">{t('serversPage.table.status')}</th>
              <th scope="col">{t('serversPage.table.name')}</th>
              <th scope="col">{t('serversPage.table.map')}</th>
              <th scope="col">{t('serversPage.table.mode')}</th>
              <th scope="col">{t('serversPage.table.type')}</th>
              <th scope="col">{t('serversPage.table.cluster')}</th>
              <th scope="col">{t('serversPage.table.players')}</th>
              <th scope="col">{t('serversPage.table.lastSeen')}</th>
              <th scope="col"><span className="u-sr-only">{t('serversPage.table.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && servers.length === 0 ? (
              <TableMessageRow colSpan={COLUMNS}>
                <Spinner block label={t('serversPage.loading')} />
              </TableMessageRow>
            ) : servers.length === 0 ? (
              <TableMessageRow colSpan={COLUMNS}>
                <EmptyState icon={Server} title={t('serversPage.empty')} />
              </TableMessageRow>
            ) : (
              servers.map(s => {
                const isEditing = editingKey === s.server_key
                return (
                  <tr key={s.server_key} onKeyDown={isEditing ? onEditKeyDown : undefined}>
                    <td>
                      <StatusBadge status={s.is_online ? 'online' : 'offline'} />
                    </td>

                    <td>
                      {isEditing ? (
                        <Input
                          size="sm"
                          aria-label={t('serversPage.form.name')}
                          value={editData.display_name || ''}
                          onChange={e => setEditData({ ...editData, display_name: e.target.value })}
                        />
                      ) : (
                        <div className="ui-cell-2">
                          <span>{s.display_name}</span>
                          <span className="u-mono u-muted">{s.server_key}</span>
                        </div>
                      )}
                    </td>

                    <td>
                      {isEditing ? (
                        <Input
                          size="sm"
                          aria-label={t('serversPage.form.map')}
                          value={editData.map_name || ''}
                          onChange={e => setEditData({ ...editData, map_name: e.target.value })}
                        />
                      ) : (
                        <span className="u-secondary">{s.map_name}</span>
                      )}
                    </td>

                    <td>
                      {isEditing ? (
                        <Select
                          size="sm"
                          aria-label={t('serversPage.form.gameMode')}
                          value={editData.game_mode || 'PvE'}
                          onChange={e => setEditData({ ...editData, game_mode: e.target.value })}
                        >
                          <option value="PvE">PvE</option>
                          <option value="PvP">PvP</option>
                          <option value="PvPvE">PvPvE</option>
                        </Select>
                      ) : (
                        <Badge tone={s.game_mode === 'PvP' ? 'danger' : 'success'} dot>
                          {s.game_mode}
                        </Badge>
                      )}
                    </td>

                    <td>
                      {isEditing ? (
                        <Select
                          size="sm"
                          aria-label={t('serversPage.form.type')}
                          value={editData.server_type || 'PvE'}
                          onChange={e => setEditData({ ...editData, server_type: e.target.value })}
                        >
                          <option value="PvE">PvE</option>
                          <option value="PvP">PvP</option>
                        </Select>
                      ) : (
                        <span className="u-muted">{s.server_type}</span>
                      )}
                    </td>

                    <td>
                      {isEditing ? (
                        <Input
                          size="sm"
                          aria-label={t('serversPage.form.cluster')}
                          value={editData.cluster_group || ''}
                          onChange={e => setEditData({ ...editData, cluster_group: e.target.value })}
                        />
                      ) : (
                        <span className="u-muted">{s.cluster_group}</span>
                      )}
                    </td>

                    <td className="u-num">
                      {isEditing ? (
                        <Input
                          size="sm"
                          type="number"
                          min={1}
                          max={500}
                          aria-label={t('serversPage.form.maxPlayers')}
                          value={editData.max_players ?? ''}
                          onChange={e =>
                            setEditData({
                              ...editData,
                              max_players: e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      ) : (
                        <>
                          <span>{s.player_count}</span>
                          <span className="u-muted">/{s.max_players}</span>
                        </>
                      )}
                    </td>

                    <td className="u-num u-muted">
                      {s.last_heartbeat
                        ? new Date(s.last_heartbeat).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                        : t('serversPage.neverSeen')}
                    </td>

                    <td>
                      <div className="ui-row-actions">
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              loading={pending.isPending(s.server_key)}
                              loadingLabel={t('serversPage.tooltip.saving')}
                              onClick={() => void saveEdit()}
                            >
                              {t('serversPage.tooltip.save')}
                            </Button>
                            <IconButton
                              size="sm"
                              icon={X}
                              label={t('serversPage.tooltip.cancel')}
                              onClick={() => setEditingKey(null)}
                            />
                          </>
                        ) : (
                          <>
                            {canOperate && (
                              <IconButton
                                size="sm"
                                icon={Pencil}
                                label={t('serversPage.editNamed', { name: s.display_name })}
                                onClick={() => startEdit(s)}
                              />
                            )}
                            {isAdmin && (
                              <IconButton
                                size="sm"
                                icon={Trash2}
                                tone="danger"
                                label={t('serversPage.deleteNamed', { name: s.display_name })}
                                loading={pending.isPending(s.server_key)}
                                onClick={() => void handleDelete(s)}
                              />
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
