/**
 * Row thumbnail for one blueprint.
 *
 * Asks `/api/v1/market/thumb/{name}` (the proxy the marketplace uses) and
 * prefers the row's display name: for blueprints whose path carries mod or
 * variant prefixes (S-Allo_Character_BP, ...) the wiki page is keyed on the
 * human-readable creature name, not the class. Falls back to a Package icon
 * when the type has no wiki icon (commands, emotes) or when a previous
 * request for the same URL already failed.
 */
import { useState } from 'react'
import { Package } from 'lucide-react'
import { arkItemThumbUrl } from '../../../utils/arkItem'
import styles from '../BlueprintsPage.module.css'

// Module-level cache of thumb URLs that already answered 404/429. Shared
// across renders so paging back to a visited row does not re-hammer the wiki
// proxy: the catalogue can hold hundreds of command rows with no wiki page.
// It must exist exactly once, so it lives in this module only.
const thumbFailures = new Set<string>()

/** Admin commands have no icon, and "..." emote entries resolve to no page. */
function shouldSkipThumb(type: string, name: string): boolean {
  if (type === 'command') return true
  if (name.startsWith('"') || name.startsWith('“')) return true
  return false
}

export function BpThumb({ name, blueprint, type }: { name: string; blueprint: string; type: string }) {
  const fromName = name && name !== '?' ? `/api/v1/market/thumb/${encodeURIComponent(name)}` : null
  const url = fromName ?? arkItemThumbUrl(blueprint)

  const skip = shouldSkipThumb(type, name)
  const [errored, setErrored] = useState(url ? thumbFailures.has(url) : false)

  if (!url || skip || errored) {
    return (
      <span className={`ui-thumb ui-thumb--square ${styles.thumb}`} aria-hidden="true">
        <Package />
      </span>
    )
  }
  return (
    <span className={`ui-thumb ui-thumb--square ${styles.thumb}`}>
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => {
          thumbFailures.add(url)
          setErrored(true)
        }}
      />
    </span>
  )
}
