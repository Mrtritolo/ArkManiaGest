/**
 * GrantExpiryModal — how many days of grace to grant one pending tribe.
 *
 * Replaces the old native prompt: the same 0-3650 range, but the rejection
 * is now a field error instead of a silent no-op, and the dialog names the
 * server the command will reach.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarPlus } from 'lucide-react'
import type { ServerInstance } from '../../../types'
import { Button, Field, Input, Modal } from '../../../components/ui'
import { instanceLabel } from '../decayModel'

const MAX_DAYS = 3650

interface Props {
  open: boolean
  /** The tribe id shown in the title; null closes the dialog. */
  team: number | null
  target: ServerInstance | null
  busy: boolean
  onClose: () => void
  onSubmit: (days: number) => void
}

export function GrantExpiryModal({ open, team, target, busy, onClose, onSubmit }: Props) {
  const { t } = useTranslation()
  const [days, setDays] = useState('30')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Every opening starts from the same default the prompt used to offer.
  useEffect(() => {
    if (open) { setDays('30'); setError('') }
  }, [open])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const value = Number(days)
    if (days.trim() === '' || !Number.isFinite(value) || value < 0 || value > MAX_DAYS) {
      setError(t('decay.cmd.grantRange', { max: MAX_DAYS }))
      inputRef.current?.focus()
      return
    }
    onSubmit(value)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('decay.cmd.grantTitle')}
      description={team !== null && target
        ? t('decay.cmd.grantSubtitle', { id: team, server: instanceLabel(target) })
        : undefined}
      dismissible={!busy}
      initialFocusRef={inputRef}
      onSubmit={handleSubmit}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" icon={CalendarPlus} loading={busy} loadingLabel={t('decay.cmd.granting')}>
            {t('decay.cmd.grantAction')}
          </Button>
        </>
      }
    >
      <Field label={t('decay.cmd.grantPrompt')} error={error || undefined} hint={t('decay.cmd.grantHint', { max: MAX_DAYS })} required>
        <Input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_DAYS}
          value={days}
          onChange={e => { setDays(e.target.value); setError('') }}
        />
      </Field>
    </Modal>
  )
}
