import { useEffect, useRef, useState } from 'react'
import { languageWorkspace, listenLanguage, monaco, MAIN_URI } from '@/lib/pico/language'
import { PROJECT_LIMITS } from '@/lib/pico/profile'
import './PicoPanel.css'
interface Props { sourceSession: number; source: string; onChange: (source: string) => void; onRun: () => void; onStop: () => void; onReset: () => void; onRemove: () => void; serial: string; phase: string; error: string | null; busy: boolean }
export default function PicoPanel(props: Props) {
  const appliedSourceSession = useRef<number | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const latest = useRef(props); useEffect(() => { latest.current = props }, [props])
  const [language, setLanguage] = useState('Starting IntelliSense…')
  const [height, setHeight] = useState(300)
  const [collapsed, setCollapsed] = useState(false)
  const [problems, setProblems] = useState<monaco.editor.IMarker[]>([])
  const [stub, setStub] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<Awaited<ReturnType<typeof languageWorkspace>> | null>(null)
  useEffect(() => listenLanguage(setLanguage), [])
  useEffect(() => {
    let cancelled = false
    const disposables: { dispose(): void }[] = []
    const model = monaco.editor.getModel(MAIN_URI) ?? monaco.editor.createModel(latest.current.source, 'python', MAIN_URI)
    appliedSourceSession.current = latest.current.sourceSession
    if (model.getValue() !== latest.current.source) model.setValue(latest.current.source)
    const instance = monaco.editor.create(container.current!, { model, theme: 'vs-dark', fixedOverflowWidgets: true, editContext: false, automaticLayout: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, ariaLabel: 'Pico main.py editor' })
    editor.current = instance
    disposables.push(instance, model.onDidChangeContent(() => {
      const source = model.getValue()
      if (new TextEncoder().encode(source).length > PROJECT_LIMITS.sourceBytes) { setLanguage('Source exceeds 32 KiB. Undo or shorten the program before saving or running.') }
      latest.current.onChange(source)
    }), monaco.editor.onDidChangeMarkers(() => setProblems(monaco.editor.getModelMarkers({ resource: MAIN_URI }))))
    disposables.push(monaco.editor.registerEditorOpener({ openCodeEditor(_source, resource, selection) {
      const model = monaco.editor.getModel(resource)
      if (!model) return false
      instance.setModel(model)
      instance.updateOptions({ readOnly: resource.toString() !== MAIN_URI.toString() })
      setStub(resource.toString() === MAIN_URI.toString() ? null : resource.path)
      if (selection) { const position = 'startLineNumber' in selection ? { lineNumber: selection.startLineNumber, column: selection.startColumn } : selection; instance.setPosition(position); instance.revealPositionInCenter(position) }
      return true
    } }))
    void languageWorkspace(latest.current.source).then(space => { if (!cancelled) setWorkspace(space) }).catch(error => { if (!cancelled) setLanguage(String(error)) })
    return () => { cancelled = true; disposables.forEach(item => item.dispose()); editor.current = null }
  }, [])
  useEffect(() => {
    if (!workspace || appliedSourceSession.current === props.sourceSession) return
    appliedSourceSession.current = props.sourceSession
    if (workspace.model.getValue() !== props.source) workspace.model.setValue(props.source)
    editor.current?.setModel(workspace.model); editor.current?.updateOptions({ readOnly: false }); setStub(null)
  }, [props.source, props.sourceSession, workspace])
  const showLine = (line: number) => { if (!workspace) return; editor.current?.setModel(workspace.model); editor.current?.updateOptions({ readOnly: false }); setStub(null); setCollapsed(false); editor.current?.setPosition({ lineNumber: line, column: 1 }); editor.current?.revealLineInCenter(line); editor.current?.focus() }
  const tracebackLine = /File "main.py", line (\d+)/.exec(props.error ?? '')
  return <section className="pico-panel" aria-label="Pico programming" onKeyDown={event => event.stopPropagation()}>
    <div className="pico-toolbar"><strong>RASPBERRY PI PICO</strong><span>main.py · MicroPython 1.20</span><button onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}>{collapsed ? 'Expand editor' : 'Collapse editor'}</button><button onClick={props.onRemove}>Remove Pico</button></div>
    <p>Capture the first 100 ms. Outputs only; connect a Pico GND to workbench GND. Edits require Run.</p>
    <div style={{ display: collapsed ? 'none' : 'block' }}>
      {stub && <div className="pico-stub">{stub} · read only <button onClick={() => showLine(1)}>Back to main.py</button></div>}
      <div className="pico-editor" style={{ height }} ref={container} />
      <div className="pico-language"><label>Editor size <input type="range" aria-label="Pico editor height" min={180} max={650} step={10} value={height} onChange={event => setHeight(Number(event.target.value))} /></label><span role="status">{language}</span><button onClick={() => void (workspace?.restart() ?? languageWorkspace(props.source).then(setWorkspace).catch(error => setLanguage(String(error))))}>Retry analysis</button></div>
    </div>
    <div className="pico-toolbar"><button onClick={props.onRun} disabled={props.busy}>Run · 100 ms</button><button onClick={props.onStop} disabled={!props.busy}>Stop</button><button onClick={props.onReset}>Reset</button><span role="status">{props.phase}</span></div>
    {props.error && <div className="pico-error" role="alert">{props.error}{tracebackLine && <button onClick={() => showLine(Number(tracebackLine[1]))}>Go to line {tracebackLine[1]}</button>}</div>}
    <details open={problems.length > 0}><summary>Problems ({problems.length})</summary>{problems.map((problem, index) => <button className="pico-problem" key={index} onClick={() => showLine(problem.startLineNumber)}>Line {problem.startLineNumber}: {problem.message}</button>)}</details>
    <pre className="pico-console" aria-label="Pico serial console">{props.serial || 'Serial output appears after Run.'}</pre>
  </section>
}
