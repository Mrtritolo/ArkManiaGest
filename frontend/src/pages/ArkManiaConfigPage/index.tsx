/**
 * ArkManiaConfigPage — centralised ArkMania plugin configuration editor.
 *
 * A rail of plugin modules, a scope selector (global or one server) and a
 * dedicated GUI per value: permission-group chips, decay rule tables,
 * blueprint lists, key/value maps and craft limits. Unsaved edits belong to
 * the module and server they were made on, so switching either one, Discard
 * and leaving the tab all ask first.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { RotateCcw, RotateCw, Save, Search } from 'lucide-react'
import { Alert, Button, Card, EmptyState, Spinner } from '../../components/ui'
import type { AuthUser } from '../../types'
import { groupConfigItems } from './configModel'
import { useArkManiaConfig } from './hooks/useArkManiaConfig'
import { ConfigGroupSection } from './components/ConfigGroupSection'
import { ConfigHeader } from './components/ConfigHeader'
import { ConfigToolbar } from './components/ConfigToolbar'
import { ModuleSidebar } from './components/ModuleSidebar'

interface Props {
  currentUser?: AuthUser | null
}

export default function ArkManiaConfigPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const { module: urlModule } = useParams()
  const navigate = useNavigate()
  // PUT /arkmania/modules/{module} is require_operator; viewers only read.
  const canOperate = currentUser?.role === 'admin' || currentUser?.role === 'operator'

  const state = useArkManiaConfig(urlModule, navigate)
  const [expandedJsonKeys, setExpandedJsonKeys] = useState<Set<string>>(new Set())

  const groups = groupConfigItems(state.items, state.searchQuery)
  const visibleCount = groups.reduce((sum, [, groupItems]) => sum + groupItems.length, 0)
  const activeLabel = state.modules.find(m => m.prefix === state.activeModule)?.label
  const editCount = Object.keys(state.editedValues).length

  const saveBlockedReason = !canOperate
    ? t('arkmaniaConfig.readOnlyRole')
    : state.invalidJsonKeys.size > 0
      ? t('arkmaniaConfig.editors.invalidJson')
      : state.duplicateKeys.size > 0
        ? t('arkmaniaConfig.editors.duplicateKey')
        : undefined

  if (state.loading) {
    return (
      <div className="l-page">
        <Card><Spinner block label={t('arkmaniaConfig.loading')} /></Card>
      </div>
    )
  }

  return (
    <div className="l-page">
      <ConfigHeader
        modules={state.modules}
        servers={state.servers}
        selectedServer={state.selectedServer}
        onServerChange={value => void state.handleServerChange(value)}
        onExport={state.handleExportJSON}
      />

      {state.error && (
        <Alert
          tone="danger"
          title={state.error}
          onDismiss={() => state.setError('')}
          actions={<Button size="sm" icon={RotateCw} onClick={() => void state.retry()}>{t('common.retry')}</Button>}
        />
      )}

      {!canOperate && <Alert tone="info">{t('arkmaniaConfig.readOnlyRole')}</Alert>}

      <div className="l-split--rail">
        <ModuleSidebar
          modules={state.modules}
          activeModule={state.activeModule}
          onSelect={prefix => void state.handleTabClick(prefix)}
        />
        <Card
          title={activeLabel ?? t('arkmaniaConfig.heading')}
          actions={
            <ConfigToolbar
              moduleLabel={activeLabel}
              selectedServer={state.selectedServer}
              servers={state.servers}
              count={visibleCount}
              searchQuery={state.searchQuery}
              onSearchChange={state.setSearchQuery}
            />
          }
        >
          {state.moduleLoading ? (
            <Spinner block label={t('arkmaniaConfig.loadingModule')} />
          ) : groups.length === 0 ? (
            <EmptyState
              icon={Search}
              title={state.searchQuery ? t('arkmaniaConfig.empty.noResults') : t('arkmaniaConfig.empty.noSettings')}
              description={state.searchQuery ? t('arkmaniaConfig.empty.noResultsHint') : undefined}
            />
          ) : (
            <div className="l-stack l-stack--lg">
              {groups.map(([group, groupItems]) => (
                <ConfigGroupSection
                  key={group}
                  group={group}
                  items={groupItems}
                  editedValues={state.editedValues}
                  invalidJsonKeys={state.invalidJsonKeys}
                  permGroups={state.permGroups}
                  discardSeq={state.discardSeq}
                  expandedJsonKeys={expandedJsonKeys}
                  setExpandedJsonKeys={setExpandedJsonKeys}
                  canOperate={canOperate}
                  onChange={state.handleValueChange}
                  onDuplicatesChange={state.handleDuplicatesChange}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {state.hasChanges && (
        <div className="ui-actionbar">
          <span role="status" className="u-secondary u-text-sm">
            {t('arkmaniaConfig.unsavedCount', { count: editCount })}
          </span>
          <Button variant="ghost" className="u-push" icon={RotateCcw} onClick={() => void state.handleDiscard()}>
            {t('arkmaniaConfig.actions.discard')}
          </Button>
          <Button
            variant="primary"
            icon={Save}
            loading={state.saving}
            loadingLabel={t('arkmaniaConfig.actions.saving')}
            disabled={Boolean(saveBlockedReason) || editCount === 0 || state.moduleLoading}
            title={saveBlockedReason}
            onClick={() => void state.handleSave()}
          >
            {t('arkmaniaConfig.actions.save', { count: editCount })}
          </Button>
        </div>
      )}
    </div>
  )
}
