import { createPico, PROJECT_LIMITS } from '@/lib/pico/profile'
const PicoPanel = lazy(() => import('@/components/pico/PicoPanel'))
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Cable, ChevronDown, CircleHelp, CircuitBoard, Hand, Info, LoaderCircle, Maximize2, Minus, MousePointer2, PanelLeftOpen, Play, Plus, Redo2, RotateCcw, RotateCw, SlidersHorizontal, Undo2, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Breadboard } from '@/components/workbench/Breadboard'
import { Scope } from '@/components/workbench/Scope'
import { PARTS, createEmptyDocument, examples, validateDocument, envelopeSettings, type CircuitDocument, type ComponentKind } from '@/lib/circuit'
import { useDocument } from '@/lib/use-document'
import { useSimulation } from '@/lib/simulation'
import { AudioMonitor } from '@/components/workbench/AudioMonitor'
import { BoardViewport, type BoardViewportHandle } from '@/components/workbench/BoardViewport'
import type { LeadEdit } from '@/lib/part-editing'
import { Inspector } from '@/components/workbench/Inspector'
import { PartsLibrary } from '@/components/workbench/PartsLibrary'
import { RotaryControl, FrequencyKnob } from '@/components/workbench/ParameterControls'
import { EnvelopeControls } from '@/components/workbench/EnvelopeControls'
import { OperatingPointPanel } from '@/components/workbench/OperatingPointPanel'
import type { Channel } from '@/lib/simulation-types'
import { ScopeModule } from '@/components/workbench/ScopeModule'
import { ControlCarrier } from '@/components/workbench/ControlCarrier'
import './LaborHardware.css'
import './WorkbenchUX.css'

type Tool = 'select' | 'wire' | 'probe1' | 'probe2' | ComponentKind
const isDipTool = (tool: Tool) => tool in PARTS && !!PARTS[tool as ComponentKind].package
const WIRE_COLORS = ['#de8564', '#e5bd68', '#91bfad', '#86a8d7', '#b899ce', '#d2d4cd']

export default function App() {
  const { document, sourceSession, change, replace, changeSource, undo, redo, canUndo, canRedo, saved } = useDocument()
  const [tool, setToolState] = useState<Tool>('select')
  const [panEnabled, setPanEnabled] = useState(false)
  const [leadEdit, setLeadEdit] = useState<(LeadEdit & { document: CircuitDocument }) | null>(null)
  const setTool = useCallback((next: Tool) => { setToolState(next); setPanEnabled(false); setLeadEdit(null) }, [])
  const [selectedId, setSelectedId] = useState<string | null>('C1')
  const [rotation, setRotation] = useState(0)
  const [wireColor, setWireColor] = useState(WIRE_COLORS[0])
  const [showConnections, setShowConnections] = useState(false)
  const [highlightedChannel, setHighlightedChannel] = useState<Channel | null>(null)
  const [partsOpen, setPartsOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const exampleId = examples.find(example => example.document.title === document.title)?.id ?? ''
  const [helpOpen, setHelpOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const projectToolbar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const toolbar = projectToolbar.current
    if (!toolbar) return
    const measure = () => toolbar.parentElement?.style.setProperty('--project-toolbar-height', `${toolbar.getBoundingClientRect().height}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])
  const fileInput = useRef<HTMLInputElement>(null)
  const guideDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (helpOpen) guideDialog.current?.showModal(); else guideDialog.current?.close() }, [helpOpen])
  const viewport = useRef<BoardViewportHandle>(null)
  const simulation = useSimulation(document, autoUpdate)
  const captureNow = simulation.captureNow
  const simulationBusy = simulation.status === 'loading' || simulation.status === 'calculating'
  const simulationBlocked = simulation.status === 'invalid'
  const simulationIssue = simulation.error ?? simulation.diagnostics.find(item => item.severity === 'error')?.message
  const simulationLabel = simulationBusy ? 'Simulating circuit…'
    : simulation.status === 'ready' ? 'Results up to date'
    : simulation.status === 'invalid' ? 'Check circuit connections'
    : simulation.status === 'error' ? 'Simulation failed'
    : simulation.capture ? 'Changes need simulation' : 'Ready to simulate'
  const currentExample = examples.find(example => example.id === exampleId)
  const message = useCallback((text: string) => setNotice(text), [])
  const highlightChannel = (channel: Channel) => {
    setHighlightedChannel(channel)
    message(`${channel} connection highlighted on the breadboard.`)
  }
  const editingLead = leadEdit && leadEdit.document === document && leadEdit.partId === selectedId && tool === 'select' && !panEnabled ? leadEdit : null
  if (leadEdit && !editingLead) setLeadEdit(null)
  const finishLeadEdit = useCallback(() => setLeadEdit(null), [])
  const startLeadEdit = useCallback((edit: LeadEdit) => {
    setToolState('select'); setPanEnabled(false); setLeadEdit({ ...edit, document })
  }, [document])
  const operatingPoint = simulation.status === 'ready' ? simulation.capture?.operatingPoint : undefined

  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 5500); return () => clearTimeout(timeout) }, [notice])
  const deleteSelection = useCallback(() => {
    if (!selectedId) return
    change({ ...document, parts: document.parts.filter(p => p.id !== selectedId), wires: document.wires.filter(w => w.id !== selectedId) }); setSelectedId(null)
  }, [change, document, selectedId])
  useEffect(() => {
    const simulateKey = (e: KeyboardEvent) => {
      if (helpOpen || !(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return
      e.preventDefault()
      e.stopPropagation()
      if (!simulationBusy && !simulationBlocked && !e.repeat) {
        if (e.target instanceof HTMLInputElement) e.target.blur()
        captureNow()
      }
    }
    // Capture the command before Monaco handles Enter; editing shortcuts stay local.
    window.addEventListener('keydown', simulateKey, true)
    return () => window.removeEventListener('keydown', simulateKey, true)
  }, [captureNow, helpOpen, simulationBusy, simulationBlocked])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (helpOpen) return
      if (e.target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || e.target.closest('.pico-panel'))) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') { setTool('select'); setHelpOpen(false) }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection() }
      if (e.key.toLowerCase() === 'r') setRotation(v => (v + (isDipTool(tool) ? 180 : 90)) % 360)
      if (e.key.toLowerCase() === 'w') setTool('wire')
      if (e.key.toLowerCase() === 'v') setTool('select')
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [deleteSelection, helpOpen, redo, tool, undo, setTool])

  function loadExample(id: string) {
    const example = examples.find(item => item.id === id)
    if (!example) return
    replace(structuredClone(example.document)); setSelectedId(example.document.parts.find(p => ['capacitor', 'electrolytic', 'opamp', 'quadopamp', 'timer555'].includes(p.kind))?.id ?? example.document.parts[0]?.id ?? null); setTool('select')
    message(`${example.name} loaded. Your previous circuit is available with Undo.`)
  }
  function exportDocument() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }))
    const anchor = window.document.createElement('a')
    anchor.href = url; anchor.download = `${document.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'pico-labor-circuit'}.json`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000); message('Circuit exported. Keep this file as your own copy.')
  }
  async function importDocument(file: File | undefined) {
    if (!file) return
    try {
      if (file.size > PROJECT_LIMITS.bytes) throw new Error('Project files must be smaller than 200 kB.')
      const next = validateDocument(JSON.parse(await file.text()))
      replace(next); setSelectedId(null); setTool('select'); message(`Imported ${next.title}.`)
    } catch (error) { message(`Import failed: ${error instanceof Error ? error.message : 'Invalid circuit file.'}`) }
    finally { if (fileInput.current) fileInput.current.value = '' }
  }
  const updateInstrument = <K extends Exclude<keyof typeof document.instruments, 'envelope'>>(key: K, value: typeof document.instruments[K]) => change({ ...document, instruments: { ...document.instruments, [key]: value } })

  const toolHint = editingLead ? `${editingLead.partId}: choose a free hole for lead ${editingLead.pinIndex + 1}. Escape cancels.` : panEnabled ? 'Drag the board to pan. Press Escape to return to selecting parts.' : tool === 'wire' ? 'Click a terminal to start a wire, then click its destination.' : tool === 'probe1' || tool === 'probe2' ? `Click a terminal to attach ${tool === 'probe1' ? 'CH1' : 'CH2'}.` : tool === 'select' ? 'Select a part to inspect it. Drag a part to move it.' : isDipTool(tool) ? 'Place pin 1 on row E at the trench. Press R for a 180° turn to row F.' : `Click a hole to place a ${PARTS[tool].label.toLowerCase()}. Press R to rotate.`

  return <div className="app-shell dark">
    <header className="app-header"><div className="header-branding"><a className="brand" href="#" onClick={e => e.preventDefault()} aria-label="Pico Labor home"><span className="brand-mark"><i /><i /><i /><i /></span><span>Pico<span className="brand-light"> Labor</span></span></a><span className="brand-slogan">Circuit simulation &amp; Pico programming, inspired by the Erica Synths EDU Labor</span></div><div className="header-right"><span className="local-indicator"><span />LOCAL WORKBENCH</span><button className="icon-button" title="Workbench guide" aria-label="Workbench guide" onClick={() => setHelpOpen(true)}><CircleHelp size={19} /></button><a className="about-link" href="https://www.ericasynths.lv/edu-diy-labor/" target="_blank" rel="noreferrer">Inspired by LABOR ↗</a></div></header>
    <div ref={projectToolbar} className="project-toolbar" aria-label="Project controls">
      <div className="project-title"><CircuitBoard size={20} /><div><strong>{document.title}</strong><span>CIRCUIT EXPERIMENT</span></div></div>
      <div className="project-actions">
        <div className="history-actions"><button className="icon-button" aria-label="Undo" title="Undo · ⌘Z / Ctrl+Z" disabled={!canUndo} onClick={undo}><Undo2 size={18} /></button><button className="icon-button" aria-label="Redo" title="Redo · ⇧⌘Z / Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}><Redo2 size={18} /></button></div>
        <label className="example-select"><span>Examples</span><select aria-label="Load example" value={exampleId} onChange={e => loadExample(e.target.value)}>{!exampleId && <option value="">Custom circuit</option>}{(['Basic', 'Intermediate', 'Advanced'] as const).map(level => <optgroup key={level} label={level}>{examples.filter(example => example.level === level).map(example => <option key={example.id} value={example.id}>{example.name}</option>)}</optgroup>)}</select><ChevronDown size={14} /></label>
        <button className="subtle-button import-button" aria-label="Import circuit" title="Import circuit" onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={16} /><span>Import</span></button>
        <Button variant="outline" className="export-button" aria-label="Export circuit" title="Export circuit" onClick={exportDocument}><ArrowDownToLine size={16} /><span>Export circuit</span></Button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => void importDocument(e.target.files?.[0])} />
      </div>
      <div className="simulation-actions">
        <div className="simulation-feedback">
          <span className={`simulation-status ${simulation.status}`} role="status" aria-label="Simulation status" data-state={simulation.status}><span className="simulation-status-dot" />{simulationLabel}</span>
          {simulation.status === 'ready' ? <a href="#simulation-results" className="simulation-results-link">View results ↓</a> : <span className="simulation-shortcut">{document.pico ? 'Pico + circuit · 100 ms' : '⌘ / Ctrl + Enter'}</span>}
        </div>
        <Button className="simulate-button" aria-label="Simulate" aria-keyshortcuts="Meta+Enter Control+Enter" title={simulationBlocked ? 'Fix the circuit errors before simulating' : 'Simulate circuit · ⌘Enter / Ctrl+Enter'} onClick={simulation.captureNow} disabled={simulationBusy || simulationBlocked}>
          {simulationBusy ? <LoaderCircle size={18} className="simulation-spinner" /> : <Play size={17} fill="currentColor" />}<span>{simulationBusy ? 'Simulating…' : 'Simulate'}</span>
        </Button>
      </div>
    </div>
    <main className={`workbench-layout ${!partsOpen ? 'parts-collapsed' : ''} ${!inspectorOpen ? 'inspector-collapsed' : ''}`}>
      {partsOpen && <PartsLibrary tool={tool} onToolChange={setTool} onPlace={kind => { setTool(kind); setRotation(0) }} hasPico={!!document.pico} onAddPico={() => change({ ...document, schemaVersion: 2, pico: createPico() })} wireColor={wireColor} wireColors={WIRE_COLORS} onWireColorChange={setWireColor} partCount={document.parts.length} onCollapse={() => setPartsOpen(false)} onClear={() => { change({ ...createEmptyDocument(), ...(document.pico ? { schemaVersion: 2 as const, pico: document.pico } : {}) }); setSelectedId(null); setTool('select'); message('Board cleared. Undo restores your circuit.') }} />}
      <div className="workspace">
        {simulationIssue && <div className="simulation-error" role="alert"><Info size={18} /><div><strong>Simulation needs your attention</strong><p>{simulationIssue}</p><button className="subtle-button" onClick={() => { setInspectorOpen(true); requestAnimationFrame(() => window.document.querySelector('.diagnostics')?.scrollIntoView({ block: 'center' })) }}>View circuit details</button></div></div>}
        <div className="workspace-intro"><div><div className="eyebrow">ELECTRONICS LEARNING LAB</div><h1>A familiar place to experiment.</h1></div><div className="workspace-intro-actions">{!partsOpen && <button className="icon-button" aria-label="Open parts library" onClick={() => setPartsOpen(true)}><PanelLeftOpen size={18} /></button>}<button className={`icon-button ${inspectorOpen ? 'is-on' : ''}`} aria-label="Toggle inspector" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}><SlidersHorizontal size={17} /></button></div></div>
        <div className="experiment-tip"><span className="tip-bulb"><Zap size={15} /></span><span>{exampleId === examples[0].id ? <>Try changing <strong>C1’s capacitance</strong>. Watch the filtered output on <span className="ch2-text">CH2</span>.</> : currentExample?.description ?? 'Start with a part, connect a source and ground, then attach a scope probe.'}</span><button aria-label="Open experiment guide" onClick={() => setHelpOpen(true)}><Info size={14} /></button></div>
        <section className="bench-section" aria-label="Circuit workbench"><div className="board-toolbar"><div className="tool-group"><button className={`icon-button ${tool === 'select' && !panEnabled ? 'active' : ''}`} title="Select · V" aria-label="Select tool" aria-pressed={tool === 'select' && !panEnabled} onClick={() => setTool('select')}><MousePointer2 size={16} /></button><button className={`icon-button ${tool === 'wire' ? 'active' : ''}`} title="Wire · W" aria-label="Wire tool" aria-pressed={tool === 'wire'} onClick={() => setTool('wire')}><Cable size={16} /></button><button className="icon-button" title="Rotate placement · R" aria-label="Rotate placement" onClick={() => setRotation((rotation + (isDipTool(tool) ? 180 : 90)) % 360)}><RotateCw size={15} /></button><button className={`icon-button ${panEnabled ? 'active' : ''}`} title="Pan board · Space-drag" aria-label="Pan tool" aria-pressed={panEnabled} onClick={() => { if (panEnabled) setPanEnabled(false); else { setTool('select'); setPanEnabled(true) } }}><Hand size={15} /></button><span className="toolbar-divider" /><label className="connections-toggle"><input type="checkbox" checked={showConnections} onChange={e => setShowConnections(e.target.checked)} /><span>Show connections</span></label></div><div className="zoom-controls"><button className="icon-button" aria-label="Zoom out" onClick={() => viewport.current?.zoomTo(zoom - 0.15)}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="Zoom in" onClick={() => viewport.current?.zoomTo(zoom + 0.15)}><Plus size={14} /></button><button className="icon-button" aria-label="Fit breadboard" title="Fit breadboard" onClick={() => viewport.current?.fit('breadboard')}><Maximize2 size={14} /></button><button className="fit-workbench" aria-label="Fit workbench" title="Fit the breadboard and source terminals" onClick={() => viewport.current?.fit('workbench')}>All</button></div></div>
          <div className="labor-case">
            <div className="chassis-brand"><div className="labor-wordmark"><strong>PICO LABOR</strong><span>EDU / VIRTUAL WORKBENCH</span></div><span className="chassis-description">PATCH. EXPERIMENT. LEARN.</span><span className="chassis-revision">WORKBENCH / 01</span></div>
            <div className="instrument-panel">
              <ScopeModule windowSeconds={document.pico ? 0.1 : document.stimulus === 'step' || ['envelope-shaping', '555-monostable'].includes(exampleId) ? 0.1 : Math.min(0.1, 3 / document.instruments.frequency)} capture={simulation.status === 'ready' ? simulation.capture : null} status={simulation.status} probes={document.probes} onProbe={channel => { setTool(channel === 'CH1' ? 'probe1' : 'probe2'); message(`Select a terminal for ${channel}.`) }} />
              <div className="source-module hardware-panel">
                <div className="module-heading"><span>SIGNAL GENERATOR</span><span>01</span></div>
                <div className="generator-controls">
                  <div className="oscillator-block"><div className="instrument-label">{document.stimulus === 'step' ? 'INPUT STEP' : 'FREQUENCY'}</div><FrequencyKnob disabled={document.stimulus === 'step'} value={document.instruments.frequency} onCommit={v => updateInstrument('frequency', v)} /><span className="source-caption">20 Hz — 2 kHz</span></div>
                  <div className="shape-block"><div className="instrument-label">SHAPE</div><div className="waveform-buttons">{(['sine', 'triangle', 'square'] as const).map(wave => <button key={wave} disabled={document.stimulus === 'step'} title={wave} aria-label={`${wave} wave`} aria-pressed={document.instruments.waveform === wave} className={document.instruments.waveform === wave ? 'active' : ''} onClick={() => updateInstrument('waveform', wave)}><svg viewBox="0 0 30 16" aria-hidden="true"><path d={wave === 'sine' ? 'M2 8 C6 -1 10 -1 15 8 S24 17 28 8' : wave === 'triangle' ? 'M2 12 L8 3 L20 13 L27 4' : 'M2 12 H7 V3 H18 V12 H28'} /></svg></button>)}</div></div>
                  <div className="source-block"><div className="instrument-label">SIGNAL LEVEL</div><RotaryControl label="Amplitude" value={document.instruments.amplitude} min={0} max={5} step={0.1} unit="V pk" onCommit={v => updateInstrument('amplitude', v)} /><span className="source-caption">SIGNAL OUT ↓</span></div>
                  <div className="source-block cv-source"><div className="instrument-label">CV SOURCE</div><RotaryControl label="CV output" value={document.instruments.cv} min={-5} max={5} step={0.1} unit="V" onCommit={v => updateInstrument('cv', v)} /><span className="source-caption">CV OUT ↓</span></div>
                </div>
                <EnvelopeControls settings={envelopeSettings(document)} busy={simulation.status === 'loading' || simulation.status === 'calculating'} onChange={envelope => change({ ...document, instruments: { ...document.instruments, envelope } })} onFire={simulation.captureNow} />
              </div>
              <div className="output-module hardware-panel"><div className="module-heading"><span>AUDIO / POWER</span><span>02</span></div><AudioMonitor capture={simulation.status === 'ready' ? simulation.capture : null} onMessage={message} /><div className="supply-indicators" aria-label="Power supplies: plus 12 volts and minus 12 volts available"><span><i />+12 V</span><span><i />−12 V</span><span className="supply-label">DC SUPPLY</span></div></div>
            </div>
            <div className="breadboard-panel"><div className="board-silkscreen"><span>BREADBOARD / PATCH FIELD</span><span>30 COLUMNS · SPLIT RAILS</span></div><BoardViewport workbenchWidth={document.pico ? 1110 : 920} ref={viewport} zoom={zoom} onZoomChange={setZoom} panEnabled={panEnabled} onPanEnabledChange={setPanEnabled}><Breadboard document={document} selectedId={selectedId} onSelect={setSelectedId} onChange={change} tool={tool} rotation={rotation} wireColor={wireColor} showConnections={showConnections} highlightTerminal={highlightedChannel ? document.probes[highlightedChannel] : null} zoom={1} onMessage={message} editingLead={editingLead} onStartLeadEdit={startLeadEdit} onFinishLeadEdit={finishLeadEdit} /></BoardViewport></div>
            <ControlCarrier document={document} onChange={change} onSelect={id => { setSelectedId(id); setTool('select'); setInspectorOpen(true) }} onPlace={kind => { setTool(kind); setRotation(0); message(`Choose free breadboard holes for your ${kind}.`) }} />
            <div className="device-footer"><span>PICO LABOR / VIRTUAL-1</span><span>PATCH SUPPLIES TO RAILS WITH JUMPERS</span><span>EDU</span></div></div><div className="board-hint"><MousePointer2 size={12} /><span>{toolHint}</span><span className="board-count">{document.wires.length} wires</span></div>
        </section>
        {document.pico && <Suspense fallback={<p>Loading Pico editor…</p>}><PicoPanel sourceSession={sourceSession} source={document.pico.source} onChange={changeSource} onRun={simulation.captureNow} onStop={simulation.stop} onReset={simulation.reset} busy={simulation.status === 'calculating' || simulation.status === 'loading'} serial={simulation.serial} phase={simulation.picoPhase} error={simulation.error} onRemove={() => { const { pico: _pico, ...circuit } = document; change({ ...circuit, wires: circuit.wires.filter(wire => !wire.from.startsWith('pico:') && !wire.to.startsWith('pico:')), probes: { CH1: circuit.probes.CH1?.startsWith('pico:') ? null : circuit.probes.CH1, CH2: circuit.probes.CH2?.startsWith('pico:') ? null : circuit.probes.CH2 } }); message('Pico removed. Undo restores the board, wiring and source.') }} /></Suspense>}
        <div id="simulation-results" className="capture-toolbar"><label className="auto-update"><input type="checkbox" disabled={!!document.pico} checked={autoUpdate && !document.pico} onChange={e => setAutoUpdate(e.target.checked)} /><span className="toggle-track" /><span>Auto update</span></label>{document.pico && <span className="capture-mode-note">Pico captures run with Simulate.</span>}<div className="capture-actions"><select className="stimulus-select" aria-label="Capture stimulus" value={document.stimulus ?? 'periodic'} onChange={event => change({ ...document, stimulus: event.target.value as 'periodic' | 'step' })}><option value="periodic">Periodic input</option><option value="step">Charge / decay step</option></select><button className="subtle-button reset-button" onClick={simulation.reset} title="Reset simulation engine"><RotateCcw size={14} />Reset</button><Button className="capture-button" onClick={simulation.captureNow} disabled={simulationBusy || simulationBlocked} title="Simulate and capture a new waveform"><Play size={13} fill="currentColor" />Capture</Button></div></div>
        <Scope key={exampleId || document.title} defaultTimeScale={document.pico || ['envelope-shaping', '555-monostable'].includes(exampleId) ? 10 : undefined} onHighlight={highlightChannel} stimulus={document.stimulus ?? 'periodic'} defaultScale={exampleId === '555-astable' ? 5 : document.stimulus === 'step' || ['opamp-amplifier', 'voltage-divider', 'envelope-shaping', '555-astable', '555-monostable', 'quad-buffer'].includes(exampleId) ? 2 : 1} capture={simulation.status === 'ready' ? simulation.capture : null} status={simulation.status} probes={document.probes} onProbe={channel => { setTool(channel === 'CH1' ? 'probe1' : 'probe2'); message(`Select a terminal for ${channel}.`) }} />
        <OperatingPointPanel operatingPoint={operatingPoint} probes={document.probes} nodeByTerminal={simulation.nodeByTerminal} onHighlight={highlightChannel} />
      </div>
      {inspectorOpen && (
        <Inspector
          document={document} selectedId={selectedId} onChange={change} onSelect={setSelectedId}
          onDelete={deleteSelection} example={currentExample} onRestore={loadExample}
          colors={WIRE_COLORS} status={simulation.status} error={simulation.error}
          diagnostics={simulation.diagnostics} netlist={simulation.netlist} operatingPoint={operatingPoint}
          editingLead={editingLead} onStartLeadEdit={startLeadEdit} onFinishLeadEdit={finishLeadEdit}
        />
      )}
    </main>
    <footer className="app-footer"><span><span className={`small-status-dot ${saved ? '' : 'unsaved'}`} />{saved ? 'Browser recovery copy saved' : 'Browser recovery unavailable'}<span className="footer-separator">·</span>Export a file to keep a separate copy.</span><span className="copyright">© 2026 <a href="https://fredibach.com">Fredi Bach</a></span><span>Built for curiosity.<span className="footer-separator">/</span>All simulation stays on your device.</span></footer>
    {notice && <div className="toast" role="status" aria-label="Workbench notification"><Info size={16} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <dialog ref={guideDialog} className="guide-dialog" aria-labelledby="guide-title" onClose={() => setHelpOpen(false)}><button className="icon-button modal-close" aria-label="Close guide" autoFocus onClick={() => setHelpOpen(false)}><X size={18} /></button><span className="eyebrow">WELCOME TO YOUR WORKBENCH</span><h2 id="guide-title">A little curiosity goes a long way.</h2><p>{document.pico ? 'Edit main.py, then select Simulate. The first 100 ms of GPIO output drive your circuit; the scope and serial console show the results.' : exampleId === examples[0].id ? 'Start with the filter: select C1 and change its capacitance. CH1 measures the input; CH2 shows what makes it through.' : 'Load an example to explore a working circuit, or build your own. Connect a source and ground, attach a probe, and select Simulate to see the result.'}</p><ol><li><strong>Build.</strong> Choose a part, then click a hole. Rotate with R. Drag existing parts to move them. Select a two-lead part and use Move beside a lead to adjust its spacing.</li><li><strong>Connect.</strong> Choose the wire tool and click two terminals. The five holes in each vertical strip connect internally. The center trench and the rail breaks stay separate.</li><li><strong>Measure.</strong> Choose a CH1 or CH2 probe, then a terminal. Simulate in the top bar runs the circuit from its initial state. Use ⌘Enter or Ctrl+Enter from anywhere, including the Pico editor. View results opens the full oscilloscope; Capture there repeats the same simulation. Open Measurements under the scope for cursors and waveform statistics. Use Trigger to frame a crossing and DC operating point to inspect the initial state. Click a channel label to highlight its connection. Drag the grip beneath the trace to resize the scope. Choose Steady loop in Audio / Power to listen to a settled periodic signal; edits stop playback.</li><li><strong>Keep it.</strong> Export your circuit as JSON. Import it anytime; undo also works after loading or clearing a board.</li></ol><div className="guide-note"><Info size={17} /><p>This first build uses a documented virtual breadboard and simplified instrument sources. It is inspired by LABOR, and is not an exact hardware replica. The generic dual op-amp requires visible supply connections. The control board operates potentiometers and switches placed on the breadboard. The EG terminal provides a held gate, a short trigger, or a decay envelope; Fire starts a fresh capture. Looping replays the settled part of a completed capture. Calibrated hardware models and live audio simulation remain future work.</p></div><Button onClick={() => setHelpOpen(false)}>Let’s experiment <ChevronDown size={14} /></Button></dialog>
  </div>
}
