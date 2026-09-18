/**
 * ArkShopPage — ArkShop plugin configuration editor.
 *
 * Six tabs over the stored config (shop items, kits, sell items, General,
 * MySQL, Messages), a version history and a deploy panel that pushes the
 * saved config to the stopped containers.
 *
 * Roles follow the backend: entry / General / Messages edits, pull, deploy and
 * version save-restore are operator; replacing or clearing the whole config,
 * the MySQL block and deleting a version are admin.
 */
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Coins, CloudUpload, Database, Download, MessageSquare, Package, RotateCcw,
  ShoppingBag, Settings, Upload,
} from 'lucide-react'
import { Alert, Button, Card, PageHeader, Spinner, Tabs } from '../../components/ui'
import type { AuthUser } from '../../types'
import type { Tab } from './arkshopUtils'
import { useArkShopConfig } from './hooks/useArkShopConfig'
import { useArkShopDeploy } from './hooks/useArkShopDeploy'
import { useEntryDialog } from './hooks/useEntryDialog'
import { DeployPanel } from './components/DeployPanel'
import { EntryDialog } from './components/EntryDialog'
import { NoConfigView } from './components/NoConfigView'
import { KitsTab, SellTab, ShopItemsTab } from './tabs/EntryTabs'
import { GeneralTab, MessagesTab, MysqlTab } from './tabs/SettingsTabs'

interface Props {
  currentUser?: AuthUser | null
}

export default function ArkShopPage({ currentUser }: Props) {
  const { t } = useTranslation()
  const isAdmin = currentUser?.role === 'admin'
  const canOperate = isAdmin || currentUser?.role === 'operator'

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('shop')
  // One expansion for the shop and the kit list, as before: a key that exists
  // in both expands in both.
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [shopSearch, setShopSearch] = useState('')
  const [shopTypeFilter, setShopTypeFilter] = useState('')

  // Order matters: the deploy hook pulls and restores through the config hook,
  // and its mount effect must run after the config-status request.
  const config = useArkShopConfig(fileInputRef)
  const deploy = useArkShopDeploy(config)
  const dialog = useEntryDialog(config)

  const filteredShop = useMemo(() => config.shopItems.filter(item => {
    if (shopSearch
      && !item.Title?.toLowerCase().includes(shopSearch.toLowerCase())
      && !item.key?.toLowerCase().includes(shopSearch.toLowerCase())) return false
    if (shopTypeFilter && item.Type !== shopTypeFilter) return false
    return true
  }), [config.shopItems, shopSearch, shopTypeFilter])

  const hiddenUpload = (
    <input ref={fileInputRef} type="file" accept=".json" hidden onChange={config.handleFileUpload} />
  )

  if (config.statusLoading) {
    return (
      <div className="l-page">
        <PageHeader title={t('arkshop.heading')} icon={ShoppingBag} />
        <Card><Spinner block label={t('common.loading')} /></Card>
      </div>
    )
  }

  if (!config.configLoaded) {
    return (
      <NoConfigView
        isAdmin={isAdmin}
        canOperate={canOperate}
        statusError={config.statusError}
        onRetryStatus={() => void config.retryStatus()}
        loadingServers={deploy.loadingServers}
        arkServers={deploy.arkServers}
        pulling={deploy.pulling}
        onPull={(machineId, container) => void deploy.handlePull(machineId, container)}
        uploading={config.loading}
        onUploadClick={() => void config.handleUploadClick()}
      >
        {hiddenUpload}
      </NoConfigView>
    )
  }

  return (
    <div className="l-page">
      <PageHeader
        title={t('arkshop.heading')}
        icon={ShoppingBag}
        description={t('arkshop.subtitleStats', {
          items: config.shopItems.length, kits: config.kits.length, sell: config.sellItems.length,
        })}
        actions={
          <>
            {isAdmin && (
              <Button size="sm" variant="danger" icon={RotateCcw} onClick={() => void config.handleReset()}>
                {t('arkshop.actions.reset')}
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" icon={Upload} onClick={() => void config.handleUploadClick()}>
                {t('arkshop.actions.reload')}
              </Button>
            )}
            <Button
              size="sm"
              icon={Download}
              title={isAdmin ? undefined : t('arkshop.actions.exportMaskedTitle')}
              onClick={() => void config.handleExport()}
            >
              {t('arkshop.actions.export')}
            </Button>
            {canOperate && (
              <Button
                size="sm"
                variant="primary"
                icon={CloudUpload}
                aria-expanded={deploy.showDeploy}
                loading={deploy.pushing}
                loadingLabel={t('arkshop.actions.deploy')}
                onClick={() => deploy.setShowDeploy(!deploy.showDeploy)}
              >
                {t('arkshop.actions.deploy')}
              </Button>
            )}
          </>
        }
      />
      {hiddenUpload}

      {/* The export is masked for anyone but an admin, so it is not a backup. */}
      {!isAdmin && <Alert tone="info">{t('arkshop.actions.exportMaskedHint')}</Alert>}

      {deploy.showDeploy && canOperate && (
        <DeployPanel deploy={deploy} isAdmin={isAdmin} onClose={() => deploy.setShowDeploy(false)} />
      )}

      <Tabs
        label={t('arkshop.tabsLabel')}
        value={tab}
        onChange={id => setTab(id as Tab)}
        items={[
          { id: 'shop', label: t('arkshop.tabs.shop'), icon: ShoppingBag, count: config.shopItems.length },
          { id: 'kits', label: t('arkshop.tabs.kits'), icon: Package, count: config.kits.length },
          { id: 'sell', label: t('arkshop.tabs.sell'), icon: Coins, count: config.sellItems.length },
          { id: 'general', label: t('arkshop.tabs.general'), icon: Settings },
          { id: 'mysql', label: t('arkshop.tabs.mysql'), icon: Database },
          { id: 'messages', label: t('arkshop.tabs.messages'), icon: MessageSquare },
        ]}
      >
        {tab === 'shop' && (
          <ShopItemsTab
            items={filteredShop}
            search={shopSearch}
            onSearch={setShopSearch}
            typeFilter={shopTypeFilter}
            onTypeFilter={setShopTypeFilter}
            canOperate={canOperate}
            expandedItem={expandedItem}
            setExpandedItem={setExpandedItem}
            onNew={() => dialog.openShopDialog()}
            onEdit={dialog.openShopDialog}
            onDelete={key => void dialog.handleDelete('shop', key)}
          />
        )}
        {tab === 'kits' && (
          <KitsTab
            kits={config.kits}
            canOperate={canOperate}
            expandedItem={expandedItem}
            setExpandedItem={setExpandedItem}
            onNew={() => dialog.openKitDialog()}
            onEdit={dialog.openKitDialog}
            onDelete={key => void dialog.handleDelete('kit', key)}
          />
        )}
        {tab === 'sell' && (
          <SellTab
            sellItems={config.sellItems}
            canOperate={canOperate}
            onNew={() => dialog.openSellDialog()}
            onEdit={dialog.openSellDialog}
            onDelete={key => void dialog.handleDelete('sell', key)}
          />
        )}
        {tab === 'general' && (
          <GeneralTab
            general={config.general}
            setGeneral={config.setGeneral}
            dirty={config.dirtyGeneral}
            canOperate={canOperate}
            failed={config.blockFailed.general}
            onRetry={() => void config.reloadBlock('general')}
            onSave={() => void config.saveGeneral()}
          />
        )}
        {tab === 'mysql' && (
          <MysqlTab
            mysql={config.mysql}
            setMysql={config.setMysql}
            dirty={config.dirtyMysql}
            isAdmin={isAdmin}
            failed={config.blockFailed.mysql}
            onRetry={() => void config.reloadBlock('mysql')}
            onSave={() => void config.saveMysql()}
          />
        )}
        {tab === 'messages' && (
          <MessagesTab
            messages={config.messages}
            setMessages={config.setMessages}
            dirty={config.dirtyMessages}
            canOperate={canOperate}
            failed={config.blockFailed.messages}
            onRetry={() => void config.reloadBlock('messages')}
            onSave={() => void config.saveMessages()}
          />
        )}
      </Tabs>

      <EntryDialog dialog={dialog} canOperate={canOperate} />
    </div>
  )
}
