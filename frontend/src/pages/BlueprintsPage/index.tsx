/**
 * BlueprintsPage — ARK blueprint catalogue.
 *
 * Sync from Dododex + ARK Wiki or a Beacon archive, search and filter, manage
 * categories, import/export JSON and bulk-delete. Every write is
 * require_operator on the backend; viewers browse and export.
 */
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Download, RefreshCw, Upload } from 'lucide-react'
import { Button, Card, Pagination, PageHeader, Spinner } from '../../components/ui'
import { useSelection } from '../../hooks/useSelection'
import { fmtLocaleDateTime } from '../../utils/format'
import type { AuthUser } from '../../types'
import { LIMIT } from './blueprintsModel'
import { useBlueprintCatalog } from './hooks/useBlueprintCatalog'
import { useBlueprintImport } from './hooks/useBlueprintImport'
import { useBlueprintMutations } from './hooks/useBlueprintMutations'
import { BlueprintFilters } from './components/BlueprintFilters'
import { BlueprintTable } from './components/BlueprintTable'
import { BulkActionBar, SourcesBar } from './components/BulkActions'
import { HiddenFileInputs } from './components/HiddenFileInputs'
import { ImportDialog } from './components/ImportDialog'
import { NoDataView } from './components/NoDataView'

interface Props {
  currentUser?: AuthUser | null
}

export default function BlueprintsPage({ currentUser }: Props) {
  const { t } = useTranslation()
  // Every catalogue write (sync, imports, category edits, deletes) is
  // require_operator on the backend; viewers only browse and export.
  const canOperate = currentUser?.role === 'admin' || currentUser?.role === 'operator'

  const fileInputRef = useRef<HTMLInputElement>(null)
  // A separate input for Beacon uploads, so its accept filter and change
  // handler never clash with the JSON import.
  const beaconInputRef = useRef<HTMLInputElement>(null)

  const catalog = useBlueprintCatalog()
  const visibleIds = useMemo(() => catalog.items.map(i => i.id), [catalog.items])
  // Keys that leave the page are dropped, so a bulk action never reaches a
  // row the operator can no longer see.
  const selection = useSelection<number>(visibleIds)
  const mutations = useBlueprintMutations(catalog, selection)
  const importer = useBlueprintImport(catalog)

  const totalPages = Math.max(1, Math.ceil(catalog.total / LIMIT))

  const dialogs = (
    <>
      <HiddenFileInputs
        fileInputRef={fileInputRef}
        beaconInputRef={beaconInputRef}
        onJsonSelected={importer.handleFileSelected}
        onBeaconFile={importer.handleBeaconUpload}
      />
      <ImportDialog
        preview={importer.importPreview}
        mode={importer.importMode}
        setMode={importer.setImportMode}
        importing={importer.importing}
        onCancel={() => importer.setImportPreview(null)}
        onConfirm={importer.confirmImport}
      />
    </>
  )

  if (catalog.loading && !catalog.hasData) {
    return (
      <div className="l-page">
        <PageHeader title={t('blueprints.heading')} icon={Database} />
        <Card>
          <Spinner block label={t('common.loading')} />
        </Card>
      </div>
    )
  }

  if (!catalog.hasData) {
    return (
      <NoDataView
        canOperate={canOperate}
        syncing={importer.syncing}
        loadError={catalog.loadError}
        onRetry={() => void catalog.loadStatus()}
        onBeaconClick={() => beaconInputRef.current?.click()}
        onSync={importer.handleSync}
        onJsonClick={() => fileInputRef.current?.click()}
      >
        {dialogs}
      </NoDataView>
    )
  }

  return (
    <div className="l-page">
      <PageHeader
        title={t('blueprints.heading')}
        icon={Database}
        description={t('blueprints.subtitleFilled', {
          count: catalog.totalBp.toLocaleString(undefined),
          date: fmtLocaleDateTime(catalog.lastSync, t('blueprints.never')),
        })}
        actions={
          <>
            <Button size="sm" icon={Download} title={t('blueprints.actions.exportTitle')} onClick={importer.handleExport}>
              {t('blueprints.actions.export')}
            </Button>
            {canOperate && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Upload}
                  title={t('blueprints.actions.importTitle')}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('blueprints.actions.import')}
                </Button>
                <Button
                  size="sm"
                  icon={Upload}
                  loading={importer.syncing}
                  loadingLabel={t('blueprints.beacon.importing')}
                  title={t('blueprints.beacon.importTitle')}
                  onClick={() => beaconInputRef.current?.click()}
                >
                  {t('blueprints.beacon.importShort')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={RefreshCw}
                  loading={importer.syncing}
                  loadingLabel={t('blueprints.actions.syncing')}
                  onClick={importer.handleSync}
                >
                  {t('blueprints.actions.sync')}
                </Button>
              </>
            )}
          </>
        }
      />

      <BlueprintFilters
        types={catalog.types}
        typeFilter={catalog.typeFilter}
        onTypeChange={catalog.handleTypeChange}
        categories={catalog.categories}
        catFilter={catalog.catFilter}
        onCatChange={catalog.handleCatChange}
        sourcesList={catalog.sourcesList}
        sourceFilter={catalog.sourceFilter}
        onSourceChange={catalog.handleSourceChange}
        search={catalog.search}
        setSearch={catalog.setSearch}
        onSearch={catalog.doSearch}
      />

      <SourcesBar
        sourcesList={catalog.sourcesList}
        total={catalog.total}
        deleting={mutations.deleting}
        canOperate={canOperate}
        onDeleteSource={mutations.handleDeleteSource}
        onDeleteFiltered={mutations.handleDeleteFiltered}
        onPrune={mutations.handlePruneNonOfficial}
      />

      <Card
        title={t('blueprints.results.title')}
        flush
        actions={
          <>
            {catalog.listLoading && <Spinner />}
            <span role="status" className="u-secondary u-text-sm">
              {t('blueprints.results.count', { count: catalog.total.toLocaleString(undefined) })}
            </span>
          </>
        }
        // A single page of results gets no footer: two dead buttons and a
        // second "Page 1 of 1" status next to the count in the header.
        footer={totalPages > 1 ? (
          <Pagination
            label={t('blueprints.results.pagination')}
            page={catalog.page}
            pageCount={totalPages}
            onPageChange={catalog.handlePage}
          />
        ) : undefined}
      >
        <BlueprintTable
          items={catalog.items}
          loading={catalog.listLoading}
          loadError={catalog.loadError}
          hasFilters={catalog.hasFilters}
          canOperate={canOperate}
          selection={selection}
          editingCat={mutations.editingCat}
          editCatValue={mutations.editCatValue}
          setEditCatValue={mutations.setEditCatValue}
          onStartEdit={mutations.startCategoryEdit}
          onSaveEdit={mutations.saveCategoryEdit}
          onCancelEdit={() => mutations.setEditingCat(null)}
          allCategories={catalog.allCategories}
          onDeleteOne={mutations.handleDeleteOne}
          onRetry={() => catalog.loadData()}
        />
      </Card>

      {canOperate && selection.count > 0 && (
        <BulkActionBar
          selectedCount={selection.count}
          bulkCat={mutations.bulkCat}
          setBulkCat={mutations.setBulkCat}
          allCategories={catalog.allCategories}
          deleting={mutations.deleting}
          onApplyCategory={mutations.handleBulkCategory}
          onDeleteSelected={mutations.handleDeleteSelected}
          onClear={selection.clear}
        />
      )}

      {dialogs}
    </div>
  )
}
