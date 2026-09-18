/**
 * Blueprint field with autocomplete from the local catalogue.
 *
 * The field holds the blueprint path itself; the query sent to the catalogue
 * is the readable name when the field already holds a path, so editing or
 * pasting over a stored path still offers matches (what the old magnifier
 * button did by hand) without a second control. Nothing is fetched until the
 * operator types.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { blueprintsApi, type BlueprintRow } from '../../../services/api'
import { Combobox } from '../../../components/ui'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { bpName } from '../arkshopUtils'

interface Option { name: string; blueprint: string; type: string; category?: string }

interface Props {
  value: string
  onChange: (blueprint: string) => void
  label?: string
  disabled?: boolean
}

export function BlueprintSearch({ value, onChange, label, disabled }: Props) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const debounced = useDebouncedValue(value)
  // Only what the operator typed is a query. The value the field was mounted
  // with (and the path just picked from the list) is not: opening a 20-line
  // kit must not fire 20 catalogue requests for paths nobody asked about.
  const typed = useRef(false)

  useEffect(() => {
    if (!typed.current) { setOptions([]); setLoading(false); return }
    // A full blueprint path finds nothing: search its readable name instead.
    const query = (debounced.includes('/') || debounced.includes('.') ? bpName(debounced) : debounced).trim()
    if (query.length < 2) { setOptions([]); setLoading(false); return }
    let alive = true
    setLoading(true)
    blueprintsApi.list({ search: query, limit: 15 })
      .then(res => {
        if (!alive) return
        setOptions(res.data.items.map((b: BlueprintRow) => ({
          name: b.name, blueprint: b.blueprint, type: b.type ?? 'item', category: b.category ?? undefined,
        })))
      })
      .catch(() => { if (alive) setOptions([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [debounced])

  return (
    <Combobox<Option>
      label={label}
      mono
      disabled={disabled}
      inputValue={value}
      onInputChange={next => { typed.current = true; onChange(next) }}
      options={options}
      loading={loading}
      placeholder={t('arkshop.bpSearch.placeholder')}
      getKey={option => option.blueprint}
      renderOption={option => (
        <>
          <span>{option.name}</span>
          <span className="u-muted u-text-sm"> {option.type}{option.category ? ` · ${option.category}` : ''}</span>
        </>
      )}
      onSelect={option => {
        // The picked path is not a new query: searching it again would only
        // re-fetch the list the operator just chose from.
        typed.current = false
        setOptions([])
        onChange(option.blueprint)
      }}
    />
  )
}
