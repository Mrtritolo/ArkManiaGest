/**
 * The three settings forms: General, MySQL and Messages. Each is a real form,
 * so Enter saves; MySQL is admin-only on the backend and its password is not
 * even sent to anyone else.
 */
import { Database, MessageSquare, RotateCw, Save, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, Field, Input, Switch } from '../../../components/ui'
import type { ArkShopGeneral, ArkShopMessages, ArkShopMysql } from '../../../services/api'

/**
 * Footer of a settings form: the unsaved marker and its Save button. The
 * button submits the form, so Enter in a field saves the same way. A block
 * that failed to load shuts its Save: the fields below hold typed fallbacks,
 * and saving them would write defaults over the stored block.
 */
function SaveRow({ dirty, allowed, deniedTitle, failed }: {
  dirty: boolean; allowed: boolean; deniedTitle: string; failed: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="l-cluster">
      {dirty && !failed && (
        <span role="status" className="u-secondary u-text-sm">{t('arkshop.unsaved.marker')}</span>
      )}
      <Button
        className="u-push"
        type="submit"
        variant="primary"
        icon={Save}
        disabled={!allowed || failed}
        title={failed ? t('arkshop.blockLoad.saveBlocked') : allowed ? undefined : deniedTitle}
      >
        {t('arkshop.dialog.save')}
      </Button>
    </div>
  )
}

/** The load failure of one settings block, with its own Retry. */
function BlockLoadAlert({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Alert
      tone="danger"
      title={t('arkshop.blockLoad.error')}
      actions={<Button size="sm" icon={RotateCw} onClick={onRetry}>{t('common.retry')}</Button>}
    >
      {t('arkshop.blockLoad.hint')}
    </Alert>
  )
}

const GENERAL_FLAGS: [keyof ArkShopGeneral & string, string][] = [
  ['GiveDinosInCryopods', 'arkshop.general.optGiveDinosInCryopods'],
  ['CryoLimitedTime', 'arkshop.general.optCryoLimitedTime'],
  ['PreventUseCarried', 'arkshop.general.optPreventUseCarried'],
  ['PreventUseHandcuffed', 'arkshop.general.optPreventUseHandcuffed'],
  ['PreventUseNoglin', 'arkshop.general.optPreventUseNoglin'],
  ['PreventUseUnconscious', 'arkshop.general.optPreventUseUnconscious'],
  ['UseOriginalTradeCommandWithUI', 'arkshop.general.optUseOriginalTradeCommandWithUI'],
]

export function GeneralTab({ general, setGeneral, dirty, canOperate, failed, onRetry, onSave }: {
  general: ArkShopGeneral
  setGeneral: (next: ArkShopGeneral) => void
  dirty: boolean
  canOperate: boolean
  failed: boolean
  onRetry: () => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  const timed = general.TimedPointsReward || {}
  const discord = general.Discord || {}
  // A block that did not load shows defaults, so its controls stay shut too.
  const locked = !canOperate || failed

  return (
    <form
      onSubmit={event => { event.preventDefault(); if (canOperate && !failed) onSave() }}
      noValidate
    >
      <Card title={t('arkshop.general.title')} icon={Settings} footer={
        <SaveRow dirty={dirty} allowed={canOperate} failed={failed} deniedTitle={t('arkshop.roles.operatorRequired')} />
      }>
        <div className="l-stack">
          {failed && <BlockLoadAlert onRetry={onRetry} />}
          <fieldset className="ui-fieldset">
            <legend>{t('arkshop.general.sectionDisplay')}</legend>
            <div className="l-grid--form">
              <Field label={t('arkshop.general.itemsPerPage')}>
                <Input type="number" value={general.ItemsPerPage ?? 10} disabled={locked}
                  onChange={e => setGeneral({ ...general, ItemsPerPage: parseInt(e.target.value) || 10 })} />
              </Field>
              <Field label={t('arkshop.general.shopTextSize')}>
                <Input type="number" step="0.1" value={general.ShopTextSize ?? 1.5} disabled={locked}
                  onChange={e => {
                    const v = parseFloat(e.target.value)
                    if (!Number.isNaN(v)) setGeneral({ ...general, ShopTextSize: v })
                  }} />
              </Field>
              <Field label={t('arkshop.general.shopDisplayTime')}>
                <Input type="number" value={general.ShopDisplayTime ?? 15} disabled={locked}
                  onChange={e => setGeneral({ ...general, ShopDisplayTime: parseInt(e.target.value) || 15 })} />
              </Field>
              <Field label={t('arkshop.general.defaultKit')}>
                <Input value={general.DefaultKit ?? ''} disabled={locked}
                  onChange={e => setGeneral({ ...general, DefaultKit: e.target.value })} />
              </Field>
              <Field label={t('arkshop.general.dbPathOverride')} className="u-span-full">
                <Input mono value={general.DbPathOverride ?? ''} disabled={locked}
                  onChange={e => setGeneral({ ...general, DbPathOverride: e.target.value })} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="ui-fieldset">
            <legend>{t('arkshop.general.sectionOptions')}</legend>
            <div className="l-grid--form">
              {GENERAL_FLAGS.map(([key, labelKey]) => (
                <Switch
                  key={key}
                  label={t(labelKey)}
                  checked={general[key] === true}
                  disabled={locked}
                  onChange={checked => setGeneral({ ...general, [key]: checked })}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="ui-fieldset">
            <legend>{t('arkshop.general.sectionDiscord')}</legend>
            <div className="l-grid--form">
              <Switch
                className="u-span-full"
                label={t('arkshop.general.discordEnabled')}
                checked={discord.Enabled ?? false}
                disabled={locked}
                onChange={checked => setGeneral({ ...general, Discord: { ...discord, Enabled: checked } })}
              />
              <Field label={t('arkshop.general.discordSenderName')}>
                <Input value={discord.SenderName ?? ''} disabled={locked}
                  onChange={e => setGeneral({ ...general, Discord: { ...discord, SenderName: e.target.value } })} />
              </Field>
              <Field label={t('arkshop.general.discordWebhookUrl')} className="u-span-full">
                <Input mono value={discord.URL ?? ''} disabled={locked}
                  onChange={e => setGeneral({ ...general, Discord: { ...discord, URL: e.target.value } })} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="ui-fieldset">
            <legend>{t('arkshop.general.sectionTimedPoints')}</legend>
            <div className="l-grid--form">
              <Switch
                className="u-span-full"
                label={t('arkshop.general.timedEnabled')}
                checked={timed.Enabled ?? false}
                disabled={locked}
                onChange={checked => setGeneral({ ...general, TimedPointsReward: { ...timed, Enabled: checked } })}
              />
              <Field label={t('arkshop.general.timedInterval')}>
                <Input type="number" value={timed.Interval ?? 10} disabled={locked}
                  onChange={e => setGeneral({ ...general, TimedPointsReward: { ...timed, Interval: parseInt(e.target.value) || 10 } })} />
              </Field>
              <Switch
                label={t('arkshop.general.timedAlwaysSend')}
                checked={timed.AlwaysSendNotifications ?? false}
                disabled={locked}
                onChange={checked => setGeneral({ ...general, TimedPointsReward: { ...timed, AlwaysSendNotifications: checked } })}
              />
              <Switch
                label={t('arkshop.general.timedStack')}
                checked={timed.StackRewards ?? false}
                disabled={locked}
                onChange={checked => setGeneral({ ...general, TimedPointsReward: { ...timed, StackRewards: checked } })}
              />
              {Object.entries(timed.Groups ?? {}).map(([group, value]) => (
                <Field key={group} label={t('arkshop.general.timedGroupPoints', { group })}>
                  <Input
                    type="number"
                    value={(value as { Amount?: number })?.Amount ?? 0}
                    disabled={locked}
                    onChange={e => setGeneral({
                      ...general,
                      TimedPointsReward: {
                        ...timed,
                        Groups: { ...(timed.Groups ?? {}), [group]: { Amount: parseInt(e.target.value) || 0 } },
                      },
                    })}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        </div>
      </Card>
    </form>
  )
}

export function MysqlTab({ mysql, setMysql, dirty, isAdmin, failed, onRetry, onSave }: {
  mysql: ArkShopMysql
  setMysql: (next: ArkShopMysql) => void
  dirty: boolean
  isAdmin: boolean
  failed: boolean
  onRetry: () => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  const locked = !isAdmin || failed

  return (
    <form onSubmit={event => { event.preventDefault(); if (isAdmin && !failed) onSave() }} noValidate>
      <Card title={t('arkshop.mysql.title')} icon={Database} footer={
        <SaveRow dirty={dirty} allowed={isAdmin} failed={failed} deniedTitle={t('arkshop.roles.adminRequired')} />
      }>
        <div className="l-stack">
          {failed && <BlockLoadAlert onRetry={onRetry} />}
          {!isAdmin && <Alert tone="info">{t('arkshop.mysql.adminOnly')}</Alert>}
          <div className="l-grid--form">
            <Switch
              className="u-span-full"
              label={t('arkshop.mysql.useMysql')}
              checked={mysql.UseMysql ?? true}
              disabled={locked}
              onChange={checked => setMysql({ ...mysql, UseMysql: checked })}
            />
            <Field label={t('arkshop.mysql.host')}>
              <Input value={mysql.MysqlHost ?? ''} disabled={locked}
                onChange={e => setMysql({ ...mysql, MysqlHost: e.target.value })} />
            </Field>
            <Field label={t('arkshop.mysql.port')}>
              <Input type="number" value={mysql.MysqlPort ?? 3306} disabled={locked}
                onChange={e => setMysql({ ...mysql, MysqlPort: parseInt(e.target.value) || 3306 })} />
            </Field>
            <Field label={t('arkshop.mysql.database')}>
              <Input value={mysql.MysqlDB ?? ''} disabled={locked}
                onChange={e => setMysql({ ...mysql, MysqlDB: e.target.value })} />
            </Field>
            <Field label={t('arkshop.mysql.user')}>
              <Input value={mysql.MysqlUser ?? ''} disabled={locked}
                onChange={e => setMysql({ ...mysql, MysqlUser: e.target.value })} />
            </Field>
            {isAdmin ? (
              <Field label={t('arkshop.mysql.password')}>
                <Input type="password" revealable autoComplete="off" value={mysql.MysqlPass ?? ''}
                  onChange={e => setMysql({ ...mysql, MysqlPass: e.target.value })} />
              </Field>
            ) : (
              // The backend does not send the password to non-admins: an empty
              // box would read as "no password set".
              <Field label={t('arkshop.mysql.password')} hint={t('arkshop.mysql.passwordHiddenHint')}>
                <Input value={t('arkshop.mysql.passwordHidden')} readOnly disabled />
              </Field>
            )}
          </div>
        </div>
      </Card>
    </form>
  )
}

export function MessagesTab({ messages, setMessages, dirty, canOperate, failed, onRetry, onSave }: {
  messages: ArkShopMessages
  setMessages: (next: ArkShopMessages) => void
  dirty: boolean
  canOperate: boolean
  failed: boolean
  onRetry: () => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  const rows = Object.entries(messages).sort(([a], [b]) => a.localeCompare(b))
  const locked = !canOperate || failed

  return (
    <form onSubmit={event => { event.preventDefault(); if (canOperate && !failed) onSave() }} noValidate>
      <Card title={t('arkshop.messages.title')} icon={MessageSquare} footer={
        <SaveRow dirty={dirty} allowed={canOperate} failed={failed} deniedTitle={t('arkshop.roles.operatorRequired')} />
      }>
        <div className="l-stack">
          {failed && <BlockLoadAlert onRetry={onRetry} />}
          {rows.length === 0 ? (
            !failed && <p className="u-muted u-text-sm">{t('arkshop.messages.empty')}</p>
          ) : (
            <div className="l-grid--form">
              {rows.map(([key, value]) => (
                <Field key={key} label={<span className="u-mono">{key}</span>}>
                  <Input
                    value={String(value)}
                    disabled={locked}
                    onChange={e => setMessages({ ...messages, [key]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          )}
        </div>
      </Card>
    </form>
  )
}
