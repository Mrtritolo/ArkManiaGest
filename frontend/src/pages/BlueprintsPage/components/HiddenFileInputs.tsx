/**
 * The two hidden file pickers (JSON export, Beacon archive). Rendered in both
 * the empty and the filled view: the refs follow whichever branch is mounted.
 */
import type { ChangeEvent, RefObject } from 'react'

interface Props {
  fileInputRef: RefObject<HTMLInputElement>
  beaconInputRef: RefObject<HTMLInputElement>
  onJsonSelected: (event: ChangeEvent<HTMLInputElement>) => void
  onBeaconFile: (file: File) => void
}

export function HiddenFileInputs({ fileInputRef, beaconInputRef, onJsonSelected, onBeaconFile }: Props) {
  return (
    <>
      <input ref={fileInputRef} type="file" accept=".json" hidden onChange={onJsonSelected} />
      <input
        ref={beaconInputRef}
        type="file"
        accept=".beacondata,application/gzip,application/x-tar"
        hidden
        onChange={event => {
          const file = event.target.files?.[0]
          if (file) { onBeaconFile(file); event.target.value = '' }
        }}
      />
    </>
  )
}
