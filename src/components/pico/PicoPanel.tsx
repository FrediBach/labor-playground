import { useEffect, useRef, useState } from 'react'
import { languageWorkspace, listenLanguage, monaco, MAIN_URI } from '@/lib/pico/language'
import { PROJECT_LIMITS } from '@/lib/pico/profile'
import { PicoTransfer } from './PicoTransfer'
import './PicoPanel.css'
interface Props { sourceSession: number; source: string; durationSeconds?: number; onChange: (source: string) => void; onRun: () => void; onStop: () => void; onReset: () => void; onRemove: () => void; serial: string; phase: string; error: string | null; busy: boolean }
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
    const instance = monaco.editor.create(container.current!, { model, theme: 'vs-dark', fixedOverflowWidgets: true, editContext: false, automaticLayout: true, minimap: { enabled: false }, fontSize: 14, lineHeight: 22, padding: { top: 10, bottom: 10 }, scrollBeyondLastLine: false, ariaLabel: 'Pico main.py editor' })
    editor.current = instance
    disposables.push(instance, instance.onDidChangeModel(() => {
      const resource = instance.getModel()?.uri
      setStub(resource && resource.toString() !== MAIN_URI.toString() ? resource.path : null)
    }), model.onDidChangeContent(() => {
      const source = model.getValue()
      if (new TextEncoder().encode(source).length > PROJECT_LIMITS.sourceBytes) { setLanguage('Source exceeds 32 KiB. Undo or shorten the program before saving or running.') }
      latest.current.onChange(source)
    }), monaco.editor.onDidChangeMarkers(() => setProblems(monaco.editor.getModelMarkers({ resource: MAIN_URI }))))
    disposables.push(monaco.editor.registerEditorOpener({ openCodeEditor(_source, resource, selection) {
      const model = monaco.editor.getModel(resource)
      if (!model || model.getLanguageId() !== 'python') return false
      instance.setModel(model)
      instance.updateOptions({ readOnly: resource.toString() !== MAIN_URI.toString() })
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
    editor.current?.setModel(workspace.model); editor.current?.updateOptions({ readOnly: false })
  }, [props.source, props.sourceSession, workspace])
  const showLine = (line: number) => { if (!workspace) return; editor.current?.setModel(workspace.model); editor.current?.updateOptions({ readOnly: false }); setCollapsed(false); editor.current?.setPosition({ lineNumber: line, column: 1 }); editor.current?.revealLineInCenter(line); editor.current?.focus() }
  const tracebackLine = /File "main.py", line (\d+)/.exec(props.error ?? '')
  const duration = props.durationSeconds ?? 0.1
  const durationLabel = duration < 1 ? `${duration * 1000} ms` : `${duration} s`
  return <section className="pico-panel" aria-label="Pico programming" onKeyDown={event => event.stopPropagation()}>
    <div className="pico-toolbar"><strong>RASPBERRY PI PICO</strong><span>main.py · MicroPython 1.20</span><button onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed} aria-controls="pico-editor-content">{collapsed ? 'Expand editor' : 'Collapse editor'}</button><button className="pico-remove" onClick={props.onRemove}>Remove Pico</button></div>
    <p>Connect a Pico GND to workbench GND. Simulate runs your code and captures the first {durationLabel}. GPIO/PWM outputs and SSD1306 hardware I²C.</p>
    <details className="pico-scope-help"><summary>Inspect variables after a run</summary><p>Global variables in <code>main.py</code> are captured automatically. Run the code, open Results, then scrub the recording to see their sampled values in Pico variables. Expand containers, filter by name, or jump to the next recorded change.</p><p>Values are sampled with the simulation clock; brief changes between samples can be missed. Function-local variables are not captured. Use <code>scope.log()</code> below when you need to record a particular value at a specific point in your code.</p></details>
    <details className="pico-scope-help"><summary>Plot code values on the oscilloscope</summary><p>Import <code>scope</code>, then log a number wherever it changes. Open Results after Simulate to compare it with the circuit. Each name becomes a trace; units are optional.</p><pre>{'import scope\n\nscope.log("target", 2.5, unit="V")\nscope.log("duty", 50, unit="%")'}</pre><p>The scope holds each value until its next log. Use Show Pico logs or the trace buttons to hide readings. This helper is provided by the simulator.</p></details>
    <div id="pico-editor-content" style={{ display: collapsed ? 'none' : 'block' }}>
      {stub && <div className="pico-stub">{stub} · read only <button onClick={() => showLine(1)}>Back to main.py</button></div>}
      <div className="pico-editor" style={{ height }} ref={container} />
      <div className="pico-language"><label>Editor size <input type="range" aria-label="Pico editor height" min={180} max={650} step={10} value={height} onChange={event => setHeight(Number(event.target.value))} /></label><span role="status">{language}</span><button onClick={() => void (workspace?.restart() ?? languageWorkspace(props.source).then(setWorkspace).catch(error => setLanguage(String(error))))}>Retry analysis</button></div>
    </div>
    <div className="pico-toolbar"><button onClick={props.onRun} disabled={props.busy}>Run · {durationLabel}</button><button onClick={props.onStop} disabled={!props.busy}>Stop</button><button onClick={props.onReset}>Reset</button><span role="status">{props.phase}</span></div>
    <PicoTransfer key={props.sourceSession} source={props.source} />
    {props.error && <div className="pico-error" role="alert">{props.error}{tracebackLine && <button onClick={() => showLine(Number(tracebackLine[1]))}>Go to line {tracebackLine[1]}</button>}</div>}
    <details open={problems.length > 0}><summary>Problems ({problems.length})</summary>{problems.map(problem => <button className="pico-problem" key={JSON.stringify([problem.owner, problem.resource.toString(), problem.startLineNumber, problem.startColumn, problem.endLineNumber, problem.endColumn, problem.severity, problem.message, typeof problem.code === 'object' ? problem.code.value : problem.code])} onClick={() => showLine(problem.startLineNumber)}>Line {problem.startLineNumber}: {problem.message}</button>)}</details>
    <pre className="pico-console" aria-label="Pico serial console">{props.serial || 'Use print() in your code, then Simulate to see serial output here.'}</pre>
  </section>
}
