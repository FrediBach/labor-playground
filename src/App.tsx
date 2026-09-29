import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Cable, Check, ChevronDown, CircleHelp, CircuitBoard, Crosshair, Hand, Info, Maximize2, Minus, MousePointer2, PanelLeftClose, PanelLeftOpen, Play, Plus, Redo2, RotateCcw, RotateCw, Search, SlidersHorizontal, Undo2, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Breadboard } from '@/components/workbench/Breadboard'
import { Scope } from '@/components/workbench/Scope'
import { PARTS, createEmptyDocument, examples, formatValue, validateDocument, envelopeSettings, type CircuitDocument, type ComponentKind } from '@/lib/circuit'
import { useDocument } from '@/lib/use-document'
import { useSimulation } from '@/lib/simulation'
import { AudioMonitor } from '@/components/workbench/AudioMonitor'
import { BoardViewport, type BoardViewportHandle } from '@/components/workbench/BoardViewport'
import type { LeadEdit } from '@/lib/part-editing'
import { Inspector } from '@/components/workbench/Inspector'
import { PartIcon } from '@/components/workbench/PartIcon'
import { NumberField, FrequencyKnob } from '@/components/workbench/ParameterControls'
import { EnvelopeControls } from '@/components/workbench/EnvelopeControls'
import { OperatingPointPanel } from '@/components/workbench/OperatingPointPanel'
import type { Channel } from '@/lib/simulation-types'

type Tool = 'select' | 'wire' | 'probe1' | 'probe2' | ComponentKind
const WIRE_COLORS = ['#de8564', '#e5bd68', '#91bfad', '#86a8d7', '#b899ce', '#d2d4cd']
const kindList: ComponentKind[] = ['resistor', 'capacitor', 'electrolytic', 'potentiometer', 'diode', 'led', 'switch', 'opamp']

export default function App() {
  const { document, change, undo, redo, canUndo, canRedo, saved } = useDocument()
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
  const [search, setSearch] = useState('')
  const exampleId = examples.find(example => example.document.title === document.title)?.id ?? ''
  const [helpOpen, setHelpOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const guideDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (helpOpen) guideDialog.current?.showModal(); else guideDialog.current?.close() }, [helpOpen])
  const viewport = useRef<BoardViewportHandle>(null)
  const simulation = useSimulation(document, autoUpdate)
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
    const key = (e: KeyboardEvent) => {
      if (helpOpen) return
      if (e.target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (e.key === 'Escape') { setTool('select'); setHelpOpen(false) }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection() }
      if (e.key.toLowerCase() === 'r') setRotation(v => (v + (tool === 'opamp' ? 180 : 90)) % 360)
      if (e.key.toLowerCase() === 'w') setTool('wire')
      if (e.key.toLowerCase() === 'v') setTool('select')
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [deleteSelection, helpOpen, redo, tool, undo, setTool])

  function loadExample(id: string) {
    const example = examples.find(item => item.id === id)
    if (!example) return
    change(structuredClone(example.document)); setSelectedId(example.document.parts.find(p => ['capacitor', 'electrolytic', 'opamp'].includes(p.kind))?.id ?? example.document.parts[0]?.id ?? null); setTool('select')
    message(`${example.name} loaded. Your previous circuit is available with Undo.`)
  }
  function exportDocument() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }))
    const anchor = window.document.createElement('a')
    anchor.href = url; anchor.download = `${document.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'labor-circuit'}.json`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000); message('Circuit exported. Keep this file as your own copy.')
  }
  async function importDocument(file: File | undefined) {
    if (!file) return
    try {
      if (file.size > 100_000) throw new Error('Project files must be smaller than 100 KB.')
      const next = validateDocument(JSON.parse(await file.text()))
      change(next); setSelectedId(null); setTool('select'); message(`Imported ${next.title}.`)
    } catch (error) { message(`Import failed: ${error instanceof Error ? error.message : 'Invalid circuit file.'}`) }
    finally { if (fileInput.current) fileInput.current.value = '' }
  }
  const updateInstrument = <K extends Exclude<keyof typeof document.instruments, 'envelope'>>(key: K, value: typeof document.instruments[K]) => change({ ...document, instruments: { ...document.instruments, [key]: value } })

  const toolHint = editingLead ? `${editingLead.partId}: choose a free hole for lead ${editingLead.pinIndex + 1}. Escape cancels.` : panEnabled ? 'Drag the board to pan. Press Escape to return to selecting parts.' : tool === 'wire' ? 'Click a terminal to start a wire, then click its destination.' : tool === 'probe1' || tool === 'probe2' ? `Click a terminal to attach ${tool === 'probe1' ? 'CH1' : 'CH2'}.` : tool === 'select' ? 'Select a part to inspect it. Drag a part to move it.' : tool === 'opamp' ? 'Place pin 1 on row E at the trench. Press R for a 180° turn to row F.' : `Click a hole to place a ${PARTS[tool].label.toLowerCase()}. Press R to rotate.`

  return <div className="app-shell dark">
    <header className="app-header"><a className="brand" href="#" onClick={e => e.preventDefault()} aria-label="LABOR Playground home"><span className="brand-mark"><i /><i /><i /><i /></span><span>LABOR<span className="brand-light"> / playground</span></span><span className="version-label">EARLY BUILD</span></a><div className="header-right"><span className="local-indicator"><span />LOCAL WORKBENCH</span><button className="icon-button" title="Workbench guide" aria-label="Workbench guide" onClick={() => setHelpOpen(true)}><CircleHelp size={19} /></button><a className="about-link" href="https://www.ericasynths.lv/edu-diy-labor/" target="_blank" rel="noreferrer">Inspired by LABOR ↗</a></div></header>
    <div className="project-toolbar"><div className="project-title"><CircuitBoard size={18} /><div><strong>{document.title}</strong><span>Untitled workspace / experiments</span></div></div><div className="project-actions"><div className="history-actions"><button className="icon-button" aria-label="Undo" title="Undo · ⌘Z" disabled={!canUndo} onClick={undo}><Undo2 size={17} /></button><button className="icon-button" aria-label="Redo" title="Redo · ⇧⌘Z" disabled={!canRedo} onClick={redo}><Redo2 size={17} /></button></div><label className="example-select"><span>Examples</span><select aria-label="Load example" value={exampleId} onChange={e => loadExample(e.target.value)}>{!exampleId && <option value="">Custom circuit</option>}{examples.map(example => <option key={example.id} value={example.id}>{example.name}</option>)}</select><ChevronDown size={13} /></label><button className="subtle-button import-button" onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={14} />Import</button><Button variant="outline" className="export-button" onClick={exportDocument}><ArrowDownToLine size={14} />Export circuit</Button><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => void importDocument(e.target.files?.[0])} /></div></div>
    <main className={`workbench-layout ${!partsOpen ? 'parts-collapsed' : ''} ${!inspectorOpen ? 'inspector-collapsed' : ''}`}>
      {partsOpen && <aside className="parts-tray" aria-label="Parts library">
        <div className="panel-heading"><h2>Parts library</h2><button className="icon-button" aria-label="Collapse parts library" onClick={() => setPartsOpen(false)}><PanelLeftClose size={16} /></button></div>
        <label className="parts-search"><Search size={14} /><input placeholder="Find a component…" aria-label="Find a component" value={search} onChange={e => setSearch(e.target.value)} /></label><div className="tray-category">BASIC COMPONENTS <span>{kindList.length}</span></div>
        <div className="parts-list">{kindList.filter(kind => PARTS[kind].label.toLowerCase().includes(search.toLowerCase())).map(kind => <button key={kind} className={`part-item ${tool === kind ? 'active' : ''}`} aria-pressed={tool === kind} draggable onDragStart={e => { e.dataTransfer.setData('application/labor-part', kind); setTool(kind) }} onClick={() => { setTool(tool === kind ? 'select' : kind); setRotation(0) }}><span className="part-thumbnail"><PartIcon kind={kind} /></span><span><strong>{PARTS[kind].label}</strong><small>{kind === 'diode' || kind === 'led' ? 'Generic model' : kind === 'switch' ? 'SPST · on / off' : formatValue(PARTS[kind].defaultValue, kind)}</small></span><Plus size={13} /></button>)}</div>
        <div className="tray-category tools-label">CONNECTIONS</div><button className={`connection-item ${tool === 'wire' ? 'active' : ''}`} onClick={() => setTool(tool === 'wire' ? 'select' : 'wire')} aria-pressed={tool === 'wire'}><Cable size={18} /><span>Jumper wire</span><kbd>W</kbd></button><div className="wire-palette">{WIRE_COLORS.map(color => <button key={color} aria-label={`Wire color ${color}`} aria-pressed={wireColor === color} style={{ backgroundColor: color }} onClick={() => setWireColor(color)}>{wireColor === color && <Check size={12} />}</button>)}</div>
        <button className={`connection-item ${tool === 'probe1' ? 'active' : ''}`} onClick={() => setTool('probe1')}><Crosshair size={18} className="ch1-text" /><span>Scope probe</span><span className="ch1-text mono">CH1</span></button><button className={`connection-item ${tool === 'probe2' ? 'active' : ''}`} onClick={() => setTool('probe2')}><Crosshair size={18} className="ch2-text" /><span>Scope probe</span><span className="ch2-text mono">CH2</span></button>
        <div className="tray-note"><MousePointer2 size={16} /><p>Pick a part, then click the board to place it.<br /><span>Rotate with <kbd>R</kbd> · Cancel with <kbd>esc</kbd></span></p></div><div className="tray-bottom"><span className="small-status-dot" /><span>{document.parts.length} / 30 parts placed</span><button className="subtle-button" onClick={() => { change(createEmptyDocument()); setSelectedId(null); setTool('select'); message('Board cleared. Undo restores your circuit.') }}>Clear board</button></div>
      </aside>}
      <div className="workspace">
        <div className="workspace-intro"><div><div className="eyebrow">MAKE A CONNECTION. SEE WHAT HAPPENS.</div><h1>Your circuit, in motion.</h1></div><div className="workspace-intro-actions">{!partsOpen && <button className="icon-button" aria-label="Open parts library" onClick={() => setPartsOpen(true)}><PanelLeftOpen size={18} /></button>}<button className={`icon-button ${inspectorOpen ? 'is-on' : ''}`} aria-label="Toggle inspector" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}><SlidersHorizontal size={17} /></button></div></div>
        <div className="experiment-tip"><span className="tip-bulb"><Zap size={15} /></span><span>{exampleId === examples[0].id ? <>Try changing <strong>C1’s capacitance</strong>. Watch the filtered output on <span className="ch2-text">CH2</span>.</> : currentExample?.description ?? 'Start with a part, connect a source and ground, then attach a scope probe.'}</span><button aria-label="Open experiment guide" onClick={() => setHelpOpen(true)}><Info size={14} /></button></div>
        <section className="bench-section" aria-label="Circuit workbench"><div className="board-toolbar"><div className="tool-group"><button className={`icon-button ${tool === 'select' && !panEnabled ? 'active' : ''}`} title="Select · V" aria-label="Select tool" aria-pressed={tool === 'select' && !panEnabled} onClick={() => setTool('select')}><MousePointer2 size={16} /></button><button className={`icon-button ${tool === 'wire' ? 'active' : ''}`} title="Wire · W" aria-label="Wire tool" aria-pressed={tool === 'wire'} onClick={() => setTool('wire')}><Cable size={16} /></button><button className="icon-button" title="Rotate placement · R" aria-label="Rotate placement" onClick={() => setRotation((rotation + (tool === 'opamp' ? 180 : 90)) % 360)}><RotateCw size={15} /></button><button className={`icon-button ${panEnabled ? 'active' : ''}`} title="Pan board · Space-drag" aria-label="Pan tool" aria-pressed={panEnabled} onClick={() => { if (panEnabled) setPanEnabled(false); else { setTool('select'); setPanEnabled(true) } }}><Hand size={15} /></button><span className="toolbar-divider" /><label className="connections-toggle"><input type="checkbox" checked={showConnections} onChange={e => setShowConnections(e.target.checked)} /><span>Show connections</span></label></div><div className="zoom-controls"><button className="icon-button" aria-label="Zoom out" onClick={() => viewport.current?.zoomTo(zoom - 0.15)}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="Zoom in" onClick={() => viewport.current?.zoomTo(zoom + 0.15)}><Plus size={14} /></button><button className="icon-button" aria-label="Fit breadboard" title="Fit breadboard" onClick={() => viewport.current?.fit('breadboard')}><Maximize2 size={14} /></button><button className="fit-workbench" aria-label="Fit workbench" title="Fit the breadboard and source terminals" onClick={() => viewport.current?.fit('workbench')}>All</button></div></div>
          <div className="labor-case"><div className="instrument-panel"><div className="labor-wordmark"><strong>LABOR</strong><span>VIRTUAL WORKBENCH</span><div className="power-status"><i />POWER ON</div></div><div className="oscillator-block"><div className="instrument-label">{document.stimulus === 'step' ? 'INPUT STEP' : 'OSCILLATOR'}</div><FrequencyKnob disabled={document.stimulus === 'step'} value={document.instruments.frequency} onCommit={v => updateInstrument('frequency', v)} /><div className="waveform-buttons">{(['sine', 'triangle', 'square'] as const).map(wave => <button key={wave} disabled={document.stimulus === 'step'} title={wave} aria-label={`${wave} wave`} aria-pressed={document.instruments.waveform === wave} className={document.instruments.waveform === wave ? 'active' : ''} onClick={() => updateInstrument('waveform', wave)}>{wave === 'sine' ? '∿' : wave === 'triangle' ? '⋀' : '⊓'}</button>)}</div></div><div className="source-block"><div className="instrument-label">SOURCE LEVEL</div><NumberField label="Amplitude" value={document.instruments.amplitude} min={0} max={5} unit="V pk" onCommit={v => updateInstrument('amplitude', v)} /><span className="source-caption">100 Ω output</span></div><div className="source-block cv-source"><div className="instrument-label">CONTROL VOLTAGE</div><NumberField label="CV output" value={document.instruments.cv} min={-5} max={5} unit="V" onCommit={v => updateInstrument('cv', v)} /><span className="source-caption">Referenced to GND</span></div><EnvelopeControls settings={envelopeSettings(document)} busy={simulation.status === 'loading' || simulation.status === 'calculating'} onChange={envelope => change({ ...document, instruments: { ...document.instruments, envelope } })} onFire={simulation.captureNow} /></div><BoardViewport ref={viewport} zoom={zoom} onZoomChange={setZoom} panEnabled={panEnabled} onPanEnabledChange={setPanEnabled}><Breadboard document={document} selectedId={selectedId} onSelect={setSelectedId} onChange={change} tool={tool} rotation={rotation} wireColor={wireColor} showConnections={showConnections} highlightTerminal={highlightedChannel ? document.probes[highlightedChannel] : null} zoom={1} onMessage={message} editingLead={editingLead} onStartLeadEdit={startLeadEdit} onFinishLeadEdit={finishLeadEdit} /></BoardViewport><div className="device-footer"><span>VIRTUAL-1 / 30-COLUMN BREADBOARD</span><span>ALL RAILS REQUIRE JUMPERS</span></div></div><div className="board-hint"><MousePointer2 size={12} /><span>{toolHint}</span><span className="board-count">{document.wires.length} wires</span></div>
        </section>
        <div className="capture-toolbar"><label className="auto-update"><input type="checkbox" checked={autoUpdate} onChange={e => setAutoUpdate(e.target.checked)} /><span className="toggle-track" /><span>Auto update</span></label><div className="capture-actions"><select className="stimulus-select" aria-label="Capture stimulus" value={document.stimulus ?? 'periodic'} onChange={event => change({ ...document, stimulus: event.target.value as 'periodic' | 'step' })}><option value="periodic">Periodic input</option><option value="step">Charge / decay step</option></select><button className="subtle-button reset-button" onClick={simulation.reset} title="Reset simulation engine"><RotateCcw size={14} />Reset</button><Button className="capture-button" onClick={simulation.captureNow} disabled={simulation.status === 'calculating' || simulation.status === 'loading'}><Play size={13} fill="currentColor" />Capture</Button></div></div>
        <Scope key={exampleId || document.title} audioControls={<AudioMonitor capture={simulation.status === 'ready' ? simulation.capture : null} onMessage={message} />} defaultTimeScale={exampleId === 'envelope-shaping' ? 10 : undefined} onHighlight={highlightChannel} stimulus={document.stimulus ?? 'periodic'} defaultScale={document.stimulus === 'step' || ['opamp-amplifier', 'voltage-divider', 'envelope-shaping'].includes(exampleId) ? 2 : 1} capture={simulation.status === 'ready' ? simulation.capture : null} status={simulation.status} probes={document.probes} onProbe={channel => { setTool(channel === 'CH1' ? 'probe1' : 'probe2'); message(`Select a terminal for ${channel}.`) }} />
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
    <footer className="app-footer"><span><span className={`small-status-dot ${saved ? '' : 'unsaved'}`} />{saved ? 'Browser recovery copy saved' : 'Browser recovery unavailable'}<span className="footer-separator">·</span>Export a file to keep a separate copy.</span><span>Built for curiosity.<span className="footer-separator">/</span>All simulation stays on your device.</span></footer>
    {notice && <div className="toast" role="status" aria-label="Workbench notification"><Info size={16} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <dialog ref={guideDialog} className="guide-dialog" aria-labelledby="guide-title" onClose={() => setHelpOpen(false)}><button className="icon-button modal-close" aria-label="Close guide" autoFocus onClick={() => setHelpOpen(false)}><X size={18} /></button><span className="eyebrow">WELCOME TO YOUR WORKBENCH</span><h2 id="guide-title">A little curiosity goes a long way.</h2><p>Start with the filter: select C1 and change its capacitance. CH1 measures the input; CH2 shows what makes it through.</p><ol><li><strong>Build.</strong> Choose a part, then click a hole. Rotate with R. Drag existing parts to move them. Select a two-lead part and use Move beside a lead to adjust its spacing.</li><li><strong>Connect.</strong> Choose the wire tool and click two terminals. The five holes in each vertical strip connect internally. The center trench and the rail breaks stay separate.</li><li><strong>Measure.</strong> Choose a CH1 or CH2 probe, then a terminal. Capture runs the circuit from its initial state. Open Measurements under the scope for cursors and waveform statistics. Use Trigger to frame a crossing and DC operating point to inspect the initial state. Click a channel label to highlight its connection. Drag the grip beneath the trace to resize the scope. Choose Steady loop in Monitor to listen to a settled periodic signal; edits stop playback.</li><li><strong>Keep it.</strong> Export your circuit as JSON. Import it anytime; undo also works after loading or clearing a board.</li></ol><div className="guide-note"><Info size={17} /><p>This first build uses a documented virtual breadboard and simplified instrument sources. It is inspired by LABOR, and is not an exact hardware replica. The generic dual op-amp requires visible supply connections. The EG terminal provides a held gate, a short trigger, or a decay envelope; Fire starts a fresh capture. Looping replays the settled part of a completed capture. Calibrated hardware models and live audio simulation remain future work.</p></div><Button onClick={() => setHelpOpen(false)}>Let’s experiment <ChevronDown size={14} /></Button></dialog>
  </div>
}
