import { useLayoutEffect, useRef, useState } from 'react'
import { validateDocument, type CircuitDocument } from './circuit'
import { PROJECT_LIMITS } from './project-limits'

type DirectoryPicker = (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>
const filename = 'circuit.json'
const serialize = (document: CircuitDocument) => JSON.stringify(document, null, 2)
async function read(directory: FileSystemDirectoryHandle) {
  try {
    const file = await (await directory.getFileHandle(filename)).getFile()
    if (file.size > PROJECT_LIMITS.bytes) throw new Error('Project files must be smaller than 200 kB.')
    return serialize(validateDocument(JSON.parse(await file.text())))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}
async function write(directory: FileSystemDirectoryHandle, content: string) {
  if (new TextEncoder().encode(content).length > PROJECT_LIMITS.bytes) throw new Error('Project files must be smaller than 200 kB.')
  validateDocument(JSON.parse(content))
  const stream = await (await directory.getFileHandle(filename, { create: true })).createWritable()
  try { await stream.write(content); await stream.close() }
  catch (error) { await stream.abort().catch(() => {}); throw error }
}

/** Explicit, bidirectional sync. No writes occur on connection or in the background. */
export function useDirectorySync(document: CircuitDocument, replace: (next: CircuitDocument) => void) {
  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  const latest = useRef(document)
  useLayoutEffect(() => { latest.current = document }, [document])
  const directory = useRef<FileSystemDirectoryHandle | null>(null)
  const baseline = useRef<string | null>(null)
  const locked = useRef(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [conflict, setConflict] = useState(false)
  const [synced, setSynced] = useState<string | null>(null)
  async function run(action: () => Promise<void>) {
    if (locked.current) return
    locked.current = true; setBusy(true)
    try { await action() }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus(`Sync failed: ${error instanceof Error ? error.message : 'Unable to access folder.'}`)
    } finally { locked.current = false; setBusy(false) }
  }
  const connect = () => run(async () => {
    if (!picker) return
    const handle = await picker.call(window, { mode: 'readwrite' })
    const disk = await read(handle)
    directory.current = handle; baseline.current = disk; setName(handle.name)
    const equal = disk === serialize(latest.current)
    setSynced(equal ? disk : null)
    setConflict(disk !== null && !equal)
    setStatus(disk === null ? 'Folder connected. Sync now to create circuit.json.' : equal ? 'Folder is up to date.' : 'This folder contains a different project. Choose which version to keep.')
  })
  const sync = (resolution?: 'local' | 'disk') => run(async () => {
    const handle = directory.current
    if (!handle) return
    const local = serialize(latest.current)
    const disk = await read(handle)
    if (serialize(latest.current) !== local) { setStatus('Project changed while reading. Sync again.'); return }
    if (!resolution && disk === null && baseline.current !== null) {
      setConflict(true); setStatus('circuit.json was removed from the folder. Keep the workbench version to recreate it, or disconnect.'); return
    }
    if (!resolution && disk !== local && disk !== baseline.current && local !== synced) {
      setConflict(true); setStatus('The folder and workbench both changed. Choose which version to keep.'); return
    }
    if (!resolution && conflict) return
    if (resolution === 'disk' || (!resolution && disk !== baseline.current)) {
      if (disk === null) throw new Error('circuit.json was removed. Keep the workbench version to recreate it.')
      replace(validateDocument(JSON.parse(disk))); baseline.current = disk; setSynced(disk)
      setStatus('Loaded circuit.json from folder. Undo restores the previous workbench.')
    } else {
      // Recheck before writing to catch edits made during the initial read.
      if (await read(handle) !== disk) { setConflict(true); setStatus('The file changed again. Review the conflict and retry.'); return }
      if (disk !== local) await write(handle, local)
      baseline.current = local; setSynced(local); setStatus('Synced circuit.json with folder.')
    }
    setConflict(false)
  })
  function disconnect() {
    if (locked.current) return
    directory.current = null; baseline.current = null; setName(''); setSynced(null); setConflict(false); setStatus('')
  }
  return { supported: !!picker && window.isSecureContext, name, busy, status, conflict, dirty: !!name && serialize(document) !== synced, connect, sync, disconnect }
}
