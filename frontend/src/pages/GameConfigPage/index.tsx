/**
 * GameConfigPage — INI configuration editor for ASA containers.
 *
 * Container picker, a rail of setting groups with typed controls, dedicated
 * editors for stack sizes, supply crates, crafting costs, NPC replacements and
 * spawn entries, the mod / extra-key listings and the two raw INI files.
 * Saving backs each file up once, writes every edited category (not just the
 * open tab) and reloads. Unsaved edits are guarded on container switch, on
 * reload, on Discard and when leaving the tab.
 */
import { useTranslation } from 'react-i18next'
import { Code, FileText, Layers, Package, RefreshCw, Replace, Save, Settings, Bug, Gift, Undo2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Alert, Button, Card, EmptyState, Field, IconButton, PageHeader, Select, Spinner } from '../../components/ui'
import type { AuthUser } from '../../types'
import { ICONS } from './gameConfigModel'
import { useGameConfig } from './hooks/useGameConfig'
import { SettingsGroup } from './sections/SettingsGroup'
import { CraftingEditor, NpcEditor, StacksEditor } from './sections/OverrideEditors'
import { ModsView, RawIniEditor, SpawnEntriesEditor, SupplyCratesEditor, UncategorizedView } from './sections/RawEditors'

interface Props {
  currentUser?: AuthUser | null
}

interface NavItem { id: string; label: string; icon: LucideIcon }

export default function GameConfigPage({ currentUser }: Props) {
  const { t } = useTranslation()
  // INI writes are require_operator on the backend; viewers only read.
  const isAdmin = currentUser?.role === 'admin'
  const canOperate = isAdmin || currentUser?.role === 'operator'
  const state = useGameConfig()
  const {
    containers, sel, groups, configData, activeTab, setActiveTab,
    loading, loadingConfig, saving, error, hasChanges, changeCount,
  } = state

  const groupTabs: NavItem[] = Object.entries(groups).map(([id, g]) => ({
    id,
    label: t(`gameConfig.groups.${id}`, { defaultValue: g.label }),
    icon: ICONS[g.icon] || Settings,
  }))
  const overrideTabs: NavItem[] = [
    { id: 'stacks', label: t('gameConfig.tabs.stacks'), icon: Layers },
    { id: 'supply_crates', label: t('gameConfig.tabs.supply_crates'), icon: Gift },
    { id: 'crafting', label: t('gameConfig.tabs.crafting'), icon: Package },
    { id: 'npc_replace', label: t('gameConfig.tabs.npc_replace'), icon: Replace },
    { id: 'spawn_entries', label: t('gameConfig.tabs.spawn_entries'), icon: Bug },
  ]
  const extraTabs: NavItem[] = [
    { id: 'mods', label: t('gameConfig.tabs.mods'), icon: Package },
    { id: 'uncategorized', label: t('gameConfig.tabs.uncategorized'), icon: FileText },
    { id: 'raw', label: t('gameConfig.tabs.raw'), icon: Code },
  ]

  function renderNavGroup(title: string, items: NavItem[]) {
    if (items.length === 0) return null
    return (
      <>
        <li className="ui-nav-group-label" role="presentation">{title}</li>
        {items.map(item => (
          <li key={item.id}>
            <button
              type="button"
              className="ui-nav-item"
              aria-current={activeTab === item.id ? 'true' : undefined}
              onClick={() => setActiveTab(item.id)}
            >
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </>
    )
  }

  function renderSection() {
    if (groups[activeTab]) {
      return (
        <Card title={t(`gameConfig.groups.${activeTab}`, { defaultValue: groups[activeTab].label })}>
          <SettingsGroup
            gid={activeTab}
            group={groups[activeTab]}
            localValues={state.localValues}
            loadedValues={configData?.values}
            canOperate={canOperate}
            isAdmin={isAdmin}
            onChange={state.updateValue}
            onReset={state.resetValue}
          />
        </Card>
      )
    }
    switch (activeTab) {
      case 'stacks': return <StacksEditor state={state} canOperate={canOperate} />
      case 'supply_crates': return <SupplyCratesEditor state={state} canOperate={canOperate} />
      case 'crafting': return <CraftingEditor state={state} canOperate={canOperate} />
      case 'npc_replace': return <NpcEditor state={state} canOperate={canOperate} />
      case 'spawn_entries': return <SpawnEntriesEditor state={state} canOperate={canOperate} />
      case 'mods': return <ModsView state={state} />
      case 'uncategorized': return <UncategorizedView state={state} />
      case 'raw': return <RawIniEditor state={state} canOperate={canOperate} />
      default: return null
    }
  }

  if (loading) {
    return (
      <div className="l-page">
        <PageHeader title={t('gameConfig.topbarTitle')} icon={Settings} />
        <Card><Spinner block label={t('gameConfig.loadingContainers')} /></Card>
      </div>
    )
  }

  if (containers.length === 0) {
    return (
      <div className="l-page">
        <PageHeader title={t('gameConfig.topbarTitle')} icon={Settings} />
        {error && (
          <Alert
            tone="danger"
            title={error}
            actions={<Button size="sm" icon={RefreshCw} onClick={state.retryContainers}>{t('common.retry')}</Button>}
          />
        )}
        <Card>
          <EmptyState
            icon={Settings}
            title={t('gameConfig.noContainersTitle')}
            description={t('gameConfig.noContainersHint')}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="l-page">
      {/* The page title is the PageHeader's h1; this card only holds the
          container picker, so it carries no heading of its own. */}
      <PageHeader title={t('gameConfig.topbarTitle')} icon={Settings} />

      <Card>
        <div className="l-cluster">
          <Field label={t('gameConfig.containerLabel')}>
            <Select
              value={sel ? `${sel.machine_id}|${sel.name}` : ''}
              disabled={saving}
              onChange={event => void state.selectContainer(event.target.value)}
            >
              <option value="">{t('gameConfig.selectPlaceholder')}</option>
              {containers.map(c => (
                <option key={`${c.machine_id}|${c.name}`} value={`${c.machine_id}|${c.name}`}>
                  {c.map_name || c.name} — {c.hostname}
                </option>
              ))}
            </Select>
          </Field>
          {sel && (
            <IconButton
              icon={RefreshCw}
              label={t('gameConfig.reloadTooltip')}
              disabled={saving || loadingConfig}
              onClick={() => void state.reload()}
            />
          )}
        </div>
      </Card>

      {error && (
        <Alert
          tone="danger"
          title={error}
          onDismiss={() => state.setError('')}
          actions={sel
            ? <Button size="sm" icon={RefreshCw} onClick={() => void state.reload()}>{t('common.retry')}</Button>
            : undefined}
        />
      )}

      {!canOperate && sel && <Alert tone="info">{t('gameConfig.readOnlyRole')}</Alert>}

      {sel && !configData && loadingConfig && (
        <Card><Spinner block label={t('gameConfig.loadingConfig')} /></Card>
      )}

      {sel && configData && (
        <div className="l-split--rail">
          <nav aria-label={t('gameConfig.navLabel')}>
            <ul className="l-rail">
              {renderNavGroup(t('gameConfig.navSettings'), groupTabs)}
              {renderNavGroup(t('gameConfig.navOverrides'), overrideTabs)}
              {renderNavGroup(t('gameConfig.navAdvanced'), extraTabs)}
            </ul>
          </nav>
          <div className="l-stack">
            {loadingConfig
              ? <Card><Spinner block label={t('gameConfig.loadingConfig')} /></Card>
              : renderSection()}
          </div>
        </div>
      )}

      {hasChanges && (
        <div className="ui-actionbar">
          <span role="status" className="u-secondary u-text-sm">
            {changeCount > 0 ? t('gameConfig.unsavedMulti', { count: changeCount }) : t('gameConfig.unsavedSingle')}
          </span>
          <Button variant="ghost" className="u-push" icon={Undo2} onClick={() => void state.discard()}>
            {t('gameConfig.discard')}
          </Button>
          <Button
            variant="primary"
            icon={Save}
            loading={saving}
            loadingLabel={t('gameConfig.saving')}
            disabled={!canOperate || loadingConfig || !sel}
            title={canOperate ? undefined : t('gameConfig.readOnlyRole')}
            onClick={() => void state.handleSave()}
          >
            {t('gameConfig.save')}
          </Button>
        </div>
      )}
    </div>
  )
}
