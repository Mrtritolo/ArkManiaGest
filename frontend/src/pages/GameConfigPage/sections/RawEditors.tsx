/**
 * The sections that edit or show INI text as it is: supply crates and spawn
 * entries (one raw entry per row), the read-only mod and uncategorised key
 * listings, and the two full-file editors.
 */
import { Fragment } from 'react'
import { CircleCheck, FileText, Gift, Package, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, EmptyState, Field, IconButton, Textarea } from '../../../components/ui'
import type { Row } from '../gameConfigModel'
import type { GameConfigState } from '../hooks/useGameConfig'
import styles from '../GameConfigPage.module.css'

interface SectionProps {
  state: GameConfigState
  canOperate: boolean
}

export function SupplyCratesEditor({ state, canOperate }: SectionProps) {
  const { t } = useTranslation()
  const { localSupplyCrates, setLocalSupplyCrates, setHasChanges } = state

  return (
    <div className="l-stack">
      <div className="l-cluster l-cluster--between">
        <span className="u-secondary">{t('gameConfig.supply.count', { count: localSupplyCrates.length })}</span>
        {canOperate && (
          <Button
            size="sm"
            icon={Plus}
            onClick={() => {
              setLocalSupplyCrates(prev => [...prev, { crate_class: 'NEW', raw: '', item_sets_count: 0, item_entries_count: 0 }])
              setHasChanges(true)
            }}
          >
            {t('gameConfig.supply.add')}
          </Button>
        )}
      </div>
      <Alert tone="warning">{t('gameConfig.supply.warn')}</Alert>
      {localSupplyCrates.length === 0 && (
        <Card><EmptyState icon={Gift} title={t('gameConfig.supply.empty')} /></Card>
      )}
      {localSupplyCrates.map((crate: Row, index: number) => {
        const name = (crate.crate_class as string) || t('gameConfig.supply.newLabel')
        return (
          <Card
            key={index}
            title={name}
            icon={Gift}
            actions={
              <>
                <span className="u-muted u-text-sm">
                  {t('gameConfig.supply.metaCounts', {
                    sets: (crate.item_sets_count as number) || 0,
                    entries: (crate.item_entries_count as number) || 0,
                  })}
                </span>
                {canOperate && (
                  <IconButton
                    size="sm"
                    tone="danger"
                    icon={Trash2}
                    label={t('gameConfig.supply.deleteEntry', { name })}
                    onClick={() => {
                      setLocalSupplyCrates(prev => prev.filter((_, i) => i !== index))
                      setHasChanges(true)
                    }}
                  />
                )}
              </>
            }
          >
            <Field label={t('gameConfig.supply.rawLabel', { name })}>
              <Textarea
                mono
                rows={4}
                className={styles.entryEditor}
                value={(crate.raw as string) || ''}
                disabled={!canOperate}
                title={canOperate ? undefined : t('gameConfig.readOnlyRole')}
                onChange={event => {
                  const value = event.target.value
                  setLocalSupplyCrates(prev => prev.map((row, i) => (i === index ? { ...row, raw: value } : row)))
                  setHasChanges(true)
                }}
              />
            </Field>
          </Card>
        )
      })}
    </div>
  )
}

export function SpawnEntriesEditor({ state, canOperate }: SectionProps) {
  const { t } = useTranslation()
  const { localSpawnEntries, setLocalSpawnEntries, setHasChanges } = state

  const types = [
    { key: 'add', label: 'ConfigAddNPCSpawnEntriesContainer', desc: t('gameConfig.spawn.addDesc') },
    { key: 'override', label: 'ConfigOverrideNPCSpawnEntriesContainer', desc: t('gameConfig.spawn.overrideDesc') },
    { key: 'subtract', label: 'ConfigSubtractNPCSpawnEntriesContainer', desc: t('gameConfig.spawn.subtractDesc') },
  ]

  return (
    <div className="l-stack">
      <Alert tone="warning">{t('gameConfig.spawn.warn')}</Alert>
      {types.map(type => {
        const entries = localSpawnEntries[type.key] || []
        return (
          <Card
            key={type.key}
            title={<span className="u-mono">{type.label}</span>}
            actions={<span className="ui-count">{entries.length}</span>}
          >
            <div className="l-stack l-stack--sm">
              <p className="u-secondary u-text-sm">{type.desc}</p>
              {entries.length === 0 && (
                <p className="u-muted u-text-sm">{t('gameConfig.spawn.noEntries')}</p>
              )}
              {entries.map((entry: Row, index: number) => {
                const name = (entry.container_class as string) || t('gameConfig.spawn.entryTitle', { num: index + 1 })
                return (
                  <div key={index} className="l-stack l-stack--sm">
                    <div className="l-cluster l-cluster--between">
                      <span className="u-mono u-text-sm">{name}</span>
                      {canOperate && (
                        <IconButton
                          size="sm"
                          tone="danger"
                          icon={Trash2}
                          label={t('gameConfig.spawn.deleteEntry', { name })}
                          onClick={() => {
                            setLocalSpawnEntries(prev => ({
                              ...prev,
                              [type.key]: (prev[type.key] || []).filter((_, i) => i !== index),
                            }))
                            setHasChanges(true)
                          }}
                        />
                      )}
                    </div>
                    <Field label={t('gameConfig.spawn.rawLabel', { name })}>
                      <Textarea
                        mono
                        rows={3}
                        className={styles.entryEditor}
                        value={(entry.raw as string) || ''}
                        disabled={!canOperate}
                        title={canOperate ? undefined : t('gameConfig.readOnlyRole')}
                        onChange={event => {
                          const value = event.target.value
                          setLocalSpawnEntries(prev => ({
                            ...prev,
                            [type.key]: (prev[type.key] || []).map((row, i) => (i === index ? { ...row, raw: value } : row)),
                          }))
                          setHasChanges(true)
                        }}
                      />
                    </Field>
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

export function ModsView({ state }: { state: GameConfigState }) {
  const { t } = useTranslation()
  const { configData } = state
  if (!configData) return null
  const allMods = { ...configData.mod_sections.gus, ...configData.mod_sections.game }
  if (Object.keys(allMods).length === 0) {
    return <Card><EmptyState icon={Package} title={t('gameConfig.mods.empty')} /></Card>
  }
  return (
    <div className="l-stack">
      {Object.entries(allMods).map(([name, data]) => (
        <Card key={name} icon={Package} title={<span className="u-mono">[{name}]</span>}>
          <dl className={styles.kvList}>
            {Object.entries(data).map(([key, value]) => (
              <Fragment key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </Fragment>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  )
}

export function UncategorizedView({ state }: { state: GameConfigState }) {
  const { t } = useTranslation()
  const { configData } = state
  if (!configData) return null
  const { gus, game } = configData.uncategorized
  if (!Object.keys(gus).length && !Object.keys(game).length) {
    return <Card><EmptyState icon={CircleCheck} title={t('gameConfig.uncategorized.empty')} /></Card>
  }
  const blocks: { id: string; title: string; entries: { key: string; value: string }[] }[] = [
    ...Object.entries(gus).map(([section, entries]) => ({
      id: `gus-${section}`, title: t('gameConfig.uncategorized.gusLabel', { section }), entries,
    })),
    ...Object.entries(game).map(([section, entries]) => ({
      id: `game-${section}`, title: t('gameConfig.uncategorized.gameLabel', { section }), entries,
    })),
  ]
  return (
    <div className="l-stack">
      {blocks.map(block => (
        <Card key={block.id} icon={FileText} title={block.title}>
          <dl className={styles.kvList}>
            {block.entries.map((entry, i) => (
              <Fragment key={`${entry.key}-${i}`}>
                <dt>{entry.key}</dt>
                <dd>{entry.value}</dd>
              </Fragment>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  )
}

export function RawIniEditor({ state, canOperate }: SectionProps) {
  const { t } = useTranslation()
  const { rawGus, setRawGus, rawGame, setRawGame, setHasChanges } = state
  const readOnlyTitle = canOperate ? undefined : t('gameConfig.readOnlyRole')

  return (
    <div className="l-stack">
      <Alert tone="warning">{t('gameConfig.raw.warn')}</Alert>
      <div className={styles.rawGrid}>
        <Field
          label={t('gameConfig.raw.gusLabel')}
          hint={t('gameConfig.raw.chars', { count: rawGus.length.toLocaleString() })}
        >
          <Textarea
            mono
            className={styles.rawEditor}
            value={rawGus}
            disabled={!canOperate}
            title={readOnlyTitle}
            onChange={event => { setRawGus(event.target.value); setHasChanges(true) }}
          />
        </Field>
        <Field
          label={t('gameConfig.raw.gameLabel')}
          hint={t('gameConfig.raw.chars', { count: rawGame.length.toLocaleString() })}
        >
          <Textarea
            mono
            className={styles.rawEditor}
            value={rawGame}
            disabled={!canOperate}
            title={readOnlyTitle}
            onChange={event => { setRawGame(event.target.value); setHasChanges(true) }}
          />
        </Field>
      </div>
    </div>
  )
}
