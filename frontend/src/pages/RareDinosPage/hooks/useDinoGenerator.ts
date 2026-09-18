/**
 * useDinoGenerator — the random-pool generator behind its own dialog.
 *
 * The settings live here, at page level, so closing and reopening the dialog
 * keeps the count, map, preset and exclusion the operator had set. Errors are
 * kept locally and rendered inside the dialog: raised on the page they sat
 * under the panel and a failed Generate looked like a dead button.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { arkRareDinosApi } from '../../../services/api'
import { extractError } from '../../../utils/errors'
import { useToast } from '../../../components/ui'

interface Args {
  loadDinos: () => Promise<void>
}

export function useDinoGenerator({ loadDinos }: Args) {
  const { t } = useTranslation()
  const toast = useToast()
  const [showGenerator, setShowGenerator] = useState(false)
  const [genCount, setGenCount] = useState(10)
  const [genMap, setGenMap] = useState('*')
  const [genPreset, setGenPreset] = useState('balanced')
  const [genExclude, setGenExclude] = useState(true)
  const [genResults, setGenResults] = useState<Record<string, unknown>[]>([])
  const [genLoading, setGenLoading] = useState(false)
  const [genInfo, setGenInfo] = useState<{ available: number; excluded: number } | null>(null)
  const [genError, setGenError] = useState('')

  function open() {
    setShowGenerator(true)
    setGenResults([])
    setGenError('')
  }

  function close() {
    setShowGenerator(false)
  }

  async function handleGenerate() {
    setGenLoading(true); setGenError('')
    try {
      const res = await arkRareDinosApi.generate({
        count: genCount, map_name: genMap, stat_preset: genPreset, exclude_existing: genExclude,
      })
      setGenResults(res.data.generated)
      setGenInfo({ available: res.data.available_dinos, excluded: res.data.excluded_existing })
    } catch (err: unknown) {
      setGenError(extractError(err, t('rareDinos.generator.errorGeneration')))
    } finally { setGenLoading(false) }
  }

  async function handleApplyGenerated(replaceAll: boolean) {
    if (genResults.length === 0) return
    setGenLoading(true); setGenError('')
    try {
      await arkRareDinosApi.bulkUpdate(genResults, replaceAll)
      setShowGenerator(false); setGenResults([])
      toast.success(replaceAll
        ? t('rareDinos.generator.replacedDone', { count: genResults.length })
        : t('rareDinos.generator.addedDone', { count: genResults.length }))
      loadDinos()
    } catch (err: unknown) {
      setGenError(extractError(err, t('rareDinos.generator.errorBulkInsert')))
    } finally { setGenLoading(false) }
  }

  return {
    showGenerator, open, close,
    genCount, setGenCount, genMap, setGenMap, genPreset, setGenPreset,
    genExclude, setGenExclude, genResults, genLoading, genInfo, genError,
    handleGenerate, handleApplyGenerated,
  }
}

export type DinoGenerator = ReturnType<typeof useDinoGenerator>
