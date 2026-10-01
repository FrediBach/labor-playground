import { loadPicoAsset } from './assets'
import { overlayMachineStub } from './stub-overlay'
import { PICO_SCOPE_STUB } from './scope-log'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import pyrightUrl from 'browser-basedpyright/dist/pyright.worker.js?url'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
export const MAIN_URI = monaco.Uri.parse('file:///src/main.py')

// The public native client has no dispose method. Keep one client for the page's
// editor lifetime; restart its worker transport on failure, preserving models.
class LanguageWorker extends EventTarget {
  private workers: Worker[] = []
  private foreground!: Worker
  private initializeMessage: any
  private stopped = false
  private reconnecting = false
  private initialized = false
  private startupTimer: ReturnType<typeof setTimeout> | undefined
  private versions = new Map<number | string, number>()
  private files: Record<string, string>
  private status: (text: string) => void
  constructor(files: Record<string, string>, status: (text: string) => void) { super(); this.files = files; this.status = status; this.start() }
  private start() {
    this.stopped = false
    this.startupTimer = setTimeout(() => this.status('Language startup timed out. Retry analysis.'), 30_000)
    const worker = new Worker(pyrightUrl)
    this.workers.push(worker); this.foreground = worker
    worker.onerror = () => this.status('Language analysis failed. Retry analysis.')
    worker.onmessageerror = () => this.status('Language analysis failed. Retry analysis.')
    worker.addEventListener('message', ({ data }) => {
      if (this.stopped || worker !== this.foreground) return
      if (data.type === 'browser/newWorker') {
        const background = new Worker(pyrightUrl)
        this.workers.push(background)
        background.onerror = worker.onerror
        background.postMessage({ type: 'browser/boot', mode: 'background', initialData: data.initialData, port: data.port }, [data.port])
        return
      }
      if (!data.jsonrpc) return
      if (data.method === 'workspace/diagnostic/refresh') { worker.postMessage({ jsonrpc: '2.0', id: data.id, result: null }); return }
      if (data.method === 'workspace/configuration') { worker.postMessage({ jsonrpc: '2.0', id: data.id, result: data.params.items.map(() => ({})) }); return }
      if (data.method === 'textDocument/publishDiagnostics') {
        const model = monaco.editor.getModel(monaco.Uri.parse(data.params.uri))
        if (model && data.params.version !== model.getVersionId()) return
      }
      if (data.id === this.initializeMessage?.id && data.result?.capabilities) {
        clearTimeout(this.startupTimer)
        this.status('IntelliSense ready')
        this.initialized = true
        if (this.reconnecting) {
          this.reconnecting = false
          worker.postMessage({ jsonrpc: '2.0', method: 'initialized', params: {} })
          for (const model of monaco.editor.getModels()) worker.postMessage({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: model.uri.toString(true), version: model.getVersionId(), languageId: 'python', text: model.getValue() } } })
          return
        }
      }
      if (data.id !== undefined && this.versions.has(data.id)) {
        const version = this.versions.get(data.id)
        this.versions.delete(data.id)
        if (version !== monaco.editor.getModel(MAIN_URI)?.getVersionId()) { data.result = null; delete data.error }
      }
      this.dispatchEvent(new MessageEvent('message', { data }))
    })
    worker.postMessage({ type: 'browser/boot', mode: 'foreground' })
  }
  postMessage(data: any) {
    if (this.stopped) return
    if (data.method === 'initialize') {
      data.params.rootUri = 'file:///src/'
      data.params.rootPath = '/src/'
      data.params.initializationOptions = { files: this.files }
      data.params.capabilities.textDocument.publishDiagnostics = { versionSupport: true }
      delete data.params.capabilities.textDocument.diagnostic
      if (data.params.capabilities.workspace) delete data.params.capabilities.workspace.diagnostics
      this.initializeMessage = data
    } else if (data.id !== undefined && data.method) this.versions.set(data.id, monaco.editor.getModel(MAIN_URI)?.getVersionId() ?? 0)
    if (data.method === 'textDocument/didChange' && data.params.textDocument.uri === MAIN_URI.toString()) {
      for (const [id, version] of this.versions) if (version !== data.params.textDocument.version) this.foreground.postMessage({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } })
    }
    this.foreground.postMessage(data)
  }
  restart() {
    for (const id of this.versions.keys()) this.dispatchEvent(new MessageEvent('message', { data: { jsonrpc: '2.0', id, result: null } }))
    this.terminate(); this.reconnecting = this.initialized; this.files['/src/main.py'] = monaco.editor.getModel(MAIN_URI)?.getValue() ?? ''; this.start(); this.foreground.postMessage(this.initializeMessage)
  }
  terminate() { clearTimeout(this.startupTimer); this.stopped = true; this.workers.forEach(worker => worker.terminate()); this.workers = []; this.versions.clear() }
}

let session: Promise<{ model: monaco.editor.ITextModel; restart: () => Promise<void> }> | undefined
const listeners = new Set<(text: string) => void>()
let state = 'Starting IntelliSense…'
export function listenLanguage(listener: (text: string) => void) { listeners.add(listener); listener(state); return () => { listeners.delete(listener) } }
function status(text: string) { state = text; listeners.forEach(listener => listener(text)) }

export function languageWorkspace(source: string) {
  session ??= (async () => {
    const stubs: Record<string, string> = JSON.parse(new TextDecoder().decode(await loadPicoAsset('stubs.json')))
    // Firmware stubs take precedence over the analyzer's fallback stdlib.
    const files: Record<string, string> = Object.fromEntries(Object.entries(stubs).map(([path, value]) => [path.replace('/stubs/', '/src/'), value]))
    files['/src/pyrightconfig.json'] = JSON.stringify({ typeCheckingMode: 'basic', reportArgumentType: 'error', reportCallIssue: 'error', pythonVersion: '3.9', typeshedPath: '/typeshed', reportMissingModuleSource: false, reportUnusedExpression: false, extraPaths: ['/src'], stubPath: '/src', useLibraryCodeForTypes: false })
    files['/src/machine.pyi'] = overlayMachineStub(files['/src/machine.pyi'])
    files['/src/scope.pyi'] = PICO_SCOPE_STUB
    delete files['/src/__builtins__.pyi']
    const model = monaco.editor.getModel(MAIN_URI) ?? monaco.editor.createModel(source, 'python', MAIN_URI)
    for (const [path, text] of Object.entries(files)) if (path.endsWith('.pyi') && !monaco.editor.getModel(monaco.Uri.file(path))) monaco.editor.createModel(text, 'python', monaco.Uri.file(path))
    files['/src/main.py'] = model.getValue()
    const worker = new LanguageWorker(files, status)
    const transport = monaco.lsp.createTransportToWorker(worker as unknown as Worker)
    new monaco.lsp.MonacoLspClient(transport)
    window.addEventListener('pagehide', () => worker.terminate(), { once: true })
    const restart = async () => { status('Starting IntelliSense…'); worker.restart() }
    return { model, restart }
  })().catch(error => { session = undefined; status(String(error)); throw error })
  return session
}
export { monaco }
