/**
 * useMapCommands — the per-map plugin commands and the instance they target.
 *
 * Every plugin command is scoped to one server, so the operator says WHICH
 * map instead of firing at the whole cluster. The RCON endpoints answer 200
 * even when SSH or RCON failed, so the reply is inspected, not trusted.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { serverInstancesApi } from '../../../services/api'
import { extractError } from '../../../utils/errors'
import type { ServerInstance } from '../../../types'
import { useConfirm, type ConfirmOptions } from '../../../components/ui'

/** What every decay RCON endpoint answers with. */
export interface CmdResponse {
  data?: { status?: string; reply?: string; stderr?: string | null } | null
}

export interface MapCommands {
  instances: ServerInstance[]
  cmdInstance: number | ''
  setCmdInstance: (v: number | '') => void
  cmdBusy: string | null
  setCmdBusy: (v: string | null) => void
  cmdReply: string
  setCmdReply: (v: string) => void
  runCmd: (key: string, fn: () => Promise<CmdResponse>, confirmOptions?: ConfirmOptions) => Promise<void>
}

interface Args {
  loadData: () => Promise<void>
  setError: (v: string) => void
}

export function useMapCommands({ loadData, setError }: Args): MapCommands {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [instances, setInstances] = useState<ServerInstance[]>([])
  const [cmdInstance, setCmdInstance] = useState<number | ''>('')
  const [cmdBusy, setCmdBusy] = useState<string | null>(null)
  const [cmdReply, setCmdReply] = useState<string>('')

  useEffect(() => {
    serverInstancesApi.list({ active_only: true })
      .then(r => {
        setInstances(r.data)
        if (r.data.length > 0) setCmdInstance(r.data[0].id)
      })
      // No silent catch: without instances every command stays greyed out and
      // there is no way to tell that it was the list that failed.
      .catch(e => setError(extractError(e, t('decay.loadFailed'))))
  }, [])

  /**
   * Run one plugin command. The instance travels inside `fn`: the toolbar
   * buttons use the toolbar, the per-row ones the row's own map, so an
   * empty toolbar must not silently swallow the latter.
   */
  async function runCmd(key: string, fn: () => Promise<CmdResponse>, confirmOptions?: ConfirmOptions) {
    if (confirmOptions && !(await confirm(confirmOptions))) return
    setCmdBusy(key); setCmdReply(''); setError('')
    try {
      const res = await fn()
      // The RCON endpoints answer 200 even when SSH or RCON failed.
      if (res.data?.status === 'failed') setError(res.data.stderr || res.data.reply || t('decay.cmd.rconFailed'))
      else setCmdReply(res.data?.reply || res.data?.status || 'ok')
      await loadData()
    } catch (e: unknown) {
      setError(extractError(e, t('decay.cmd.rconFailed')))
    } finally {
      setCmdBusy(null)
    }
  }

  return {
    instances, cmdInstance, setCmdInstance,
    cmdBusy, setCmdBusy, cmdReply, setCmdReply,
    runCmd,
  }
}
