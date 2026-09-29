import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Cable, Check, ChevronDown, CircleHelp, CircuitBoard, Crosshair, Headphones, Info, Maximize2, Minus, MousePointer2, PanelLeftClose, PanelLeftOpen, Play, Plus, Redo2, RotateCcw, RotateCw, Search, SlidersHorizontal, Trash2, Undo2, VolumeX, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Breadboard } from '@/components/workbench/Breadboard'
import { Scope } from '@/components/workbench/Scope'
import { PARTS, createEmptyDocument, examples, formatValue, validateDocument, type ComponentKind } from '@/lib/circuit'
import { useDocument } from '@/lib/use-document'
import { useSimulation } from '@/lib/simulation'
import { playCapture } from '@/lib/audio'

type Tool = 'select' | 'wire' | 'probe1' | 'probe2' | ComponentKind
const WIRE_COLORS = ['#de8564', '#e5bd68', '#91bfad', '#86a8d7', '#b899ce', '#d2d4cd']
const kindList: ComponentKind[] = ['resistor', 'capacitor', 'diode', 'led', 'switch']

function PartIcon({ kind, large = false }: { kind: ComponentKind; large?: boolean }) {
  return <svg viewBox="0 0 64 36" width={large ? 88 : 54} height={large ? 50 : 32} aria-hidden="true">
    <path d="M3 18H61" stroke="#a7aaa0" strokeWidth="2" />
    {kind === 'resistor' && <><rect x="17" y="10" width="30" height="16" rx="5" fill="#cfb58b" stroke="#ac926d" /><path d="M23 10V26M29 10V26" stroke="#7c5240" strokeWidth="3" /><path d="M36 10V26" stroke="#cd773f" strokeWidth="3" /><path d="M42 10V26" stroke="#a89048" strokeWidth="2" /></>}
    {kind === 'capacitor' && <><rect x="23" y="3" width="18" height="30" rx="5" fill="#b6874e" /><path d="M29 8H36M29 11H36" stroke="#e1bd8a" strokeWidth="1" /></>}
    {(kind === 'diode' || kind === 'led') && <><rect x="20" y="10" width="25" height="16" rx={kind === 'led' ? 8 : 3} fill={kind === 'led' ? '#bd6f59' : '#545859'} /><path d="M39 11V25" stroke="#bec1b9" strokeWidth="3" />{kind === 'led' && <path d="M27 7L30 3M35 7L38 3" stroke="#d1967e" strokeWidth="1.5" />}</>}
    {kind === 'switch' && <><rect x="15" y="8" width="35" height="21" rx="3" fill="#484e4a" stroke="#7a8079" /><rect x="23" y="4" width="13" height="18" rx="2" fill="#bfc1b9" /></>}
  </svg>
}

function NumberField({ label, value, min, max, unit, onCommit }: { label: string; value: number; min: number; max: number; unit: string; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState({ source: value, text: String(value) })
  const draft = editing.source === value ? editing.text : String(value)
  const setDraft = (text: string) => setEditing({ source: value, text })
  const commit = () => {
    const parsed = Number(draft)
    if (draft.trim() && Number.isFinite(parsed) && parsed >= min && parsed <= max) onCommit(parsed)
    else setDraft(String(value))
  }
  return <label className="number-field"><span>{label}</span><div><input aria-label={label} type="number" min={min} max={max} step="any" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur() } }} /><span>{unit}</span></div></label>
}

function FrequencyKnob({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [editing, setEditing] = useState({ source: value, value })
  const draft = editing.source === value ? editing.value : value
  const setDraft = (next: number) => setEditing({ source: value, value: next })
  return <div className="frequency-knob">
    <div className="knob-ring"><div className="knob-face" style={{ transform: `rotate(${-130 + (Math.log10(Math.max(20, draft)) - Math.log10(20)) / 2 * 260}deg)` }}><i /></div></div>
    <input type="range" aria-label="Oscillator frequency" min="20" max="2000" step="1" value={draft} onChange={e => setDraft(Number(e.target.value))} onPointerUp={() => onCommit(draft)} onKeyUp={() => onCommit(draft)} onBlur={() => onCommit(draft)} />
    <span>{draft >= 1000 ? `${(draft / 1000).toFixed(2)} kHz` : `${draft} Hz`}</span>
  </div>
}

export default function App() {
  const { document, change, undo, redo, canUndo, canRedo, saved } = useDocument()
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>('C1')
  const [rotation, setRotation] = useState(0)
  const [wireColor, setWireColor] = useState(WIRE_COLORS[0])
  const [showConnections, setShowConnections] = useState(false)
  const [partsOpen, setPartsOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [search, setSearch] = useState('')
  const exampleId = examples.find(example => example.document.title === document.title)?.id ?? ''
  const [helpOpen, setHelpOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [listening, setListening] = useState(false)
  const [listenChannel, setListenChannel] = useState<'CH1' | 'CH2'>('CH2')
  const fileInput = useRef<HTMLInputElement>(null)
  const guideDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (helpOpen) guideDialog.current?.showModal(); else guideDialog.current?.close() }, [helpOpen])
  const stopAudio = useRef<(() => void) | null>(null)
  const audioGeneration = useRef(0)
  const simulation = useSimulation(document, autoUpdate)
  const selectedPart = document.parts.find(part => part.id === selectedId)
  const selectedWire = document.wires.find(wire => wire.id === selectedId)
  const currentExample = examples.find(example => example.id === exampleId)
  const message = useCallback((text: string) => setNotice(text), [])

  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 5500); return () => clearTimeout(timeout) }, [notice])
  const mute = useCallback(() => { audioGeneration.current++; stopAudio.current?.(); stopAudio.current = null; setListening(false) }, [])
  // Audio is an external system; its visible playback state follows document changes.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { mute() }, [document, mute])
  // oxlint-disable-next-line react/set-state-in-effect -- Reflect externally invalidated playback.
  useEffect(() => { if (simulation.status !== 'ready') mute() }, [simulation.status, mute])
  useEffect(() => () => { stopAudio.current?.() }, [])
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
      if (e.key.toLowerCase() === 'r') setRotation(v => (v + 90) % 360)
      if (e.key.toLowerCase() === 'w') setTool('wire')
      if (e.key.toLowerCase() === 'v') setTool('select')
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [deleteSelection, helpOpen, redo, undo])

  function loadExample(id: string) {
    const example = examples.find(item => item.id === id)
    if (!example) return
    change(structuredClone(example.document)); setSelectedId(example.document.parts.find(p => p.kind === 'capacitor')?.id ?? example.document.parts[0]?.id ?? null); setTool('select')
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
  async function listen() {
    if (listening) { mute(); return }
    if (!simulation.capture || simulation.status !== 'ready') return
    const generation = ++audioGeneration.current
    try {
      const stop = await playCapture(simulation.capture, listenChannel)
      if (audioGeneration.current !== generation) { stop(); return }
      stopAudio.current = stop; setListening(true)
      setTimeout(() => { if (audioGeneration.current === generation) setListening(false) }, simulation.capture.duration * 1000 + 120)
    } catch (error) { message(error instanceof Error ? error.message : 'Audio preview could not start.'); mute() }
  }
  const updateInstrument = (key: keyof typeof document.instruments, value: number | string) => change({ ...document, instruments: { ...document.instruments, [key]: value } })
  const setPartValue = (value: number) => { if (selectedPart) change({ ...document, parts: document.parts.map(part => part.id === selectedPart.id ? { ...part, value } : part) }) }
  const toolHint = tool === 'wire' ? 'Click a terminal to start a wire, then click its destination.' : tool === 'probe1' || tool === 'probe2' ? `Click a terminal to attach ${tool === 'probe1' ? 'CH1' : 'CH2'}.` : tool === 'select' ? 'Select a part to inspect it. Drag a part to move it.' : `Click a hole to place a ${PARTS[tool].label.toLowerCase()}. Press R to rotate.`

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
        <section className="bench-section" aria-label="Circuit workbench"><div className="board-toolbar"><div className="tool-group"><button className={`icon-button ${tool === 'select' ? 'active' : ''}`} title="Select · V" aria-label="Select tool" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={16} /></button><button className={`icon-button ${tool === 'wire' ? 'active' : ''}`} title="Wire · W" aria-label="Wire tool" aria-pressed={tool === 'wire'} onClick={() => setTool('wire')}><Cable size={16} /></button><button className="icon-button" title="Rotate placement · R" aria-label="Rotate placement" onClick={() => setRotation((rotation + 90) % 360)}><RotateCw size={15} /></button><span className="toolbar-divider" /><label className="connections-toggle"><input type="checkbox" checked={showConnections} onChange={e => setShowConnections(e.target.checked)} /><span>Show connections</span></label></div><div className="zoom-controls"><button className="icon-button" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.6, zoom - 0.15))}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="Zoom in" onClick={() => setZoom(Math.min(2, zoom + 0.15))}><Plus size={14} /></button><button className="icon-button" aria-label="Fit breadboard" title="Fit breadboard" onClick={() => setZoom(1)}><Maximize2 size={14} /></button></div></div>
          <div className="labor-case"><div className="instrument-panel"><div className="labor-wordmark"><strong>LABOR</strong><span>VIRTUAL WORKBENCH</span><div className="power-status"><i />POWER ON</div></div><div className="oscillator-block"><div className="instrument-label">OSCILLATOR</div><FrequencyKnob value={document.instruments.frequency} onCommit={v => updateInstrument('frequency', v)} /><div className="waveform-buttons">{(['sine', 'triangle', 'square'] as const).map(wave => <button key={wave} title={wave} aria-label={`${wave} wave`} aria-pressed={document.instruments.waveform === wave} className={document.instruments.waveform === wave ? 'active' : ''} onClick={() => updateInstrument('waveform', wave)}>{wave === 'sine' ? '∿' : wave === 'triangle' ? '⋀' : '⊓'}</button>)}</div></div><div className="source-block"><div className="instrument-label">SOURCE LEVEL</div><NumberField label="Amplitude" value={document.instruments.amplitude} min={0} max={5} unit="V pk" onCommit={v => updateInstrument('amplitude', v)} /><span className="source-caption">100 Ω output</span></div><div className="source-block cv-source"><div className="instrument-label">CONTROL VOLTAGE</div><NumberField label="CV output" value={document.instruments.cv} min={-5} max={5} unit="V" onCommit={v => updateInstrument('cv', v)} /><span className="source-caption">Referenced to GND</span></div><div className="panel-number">01<span>PATCH<br />& EXPLORE</span></div></div><div className="breadboard-viewport"><Breadboard document={document} selectedId={selectedId} onSelect={setSelectedId} onChange={change} tool={tool} rotation={rotation} wireColor={wireColor} showConnections={showConnections} zoom={zoom} onMessage={message} /></div><div className="device-footer"><span>VIRTUAL-1 / 30-COLUMN BREADBOARD</span><span>ALL RAILS REQUIRE JUMPERS</span></div></div><div className="board-hint"><MousePointer2 size={12} /><span>{toolHint}</span><span className="board-count">{document.wires.length} wires</span></div>
        </section>
        <div className="capture-toolbar"><label className="auto-update"><input type="checkbox" checked={autoUpdate} onChange={e => setAutoUpdate(e.target.checked)} /><span className="toggle-track" /><span>Auto update</span></label><div className="capture-actions"><button className="subtle-button reset-button" onClick={simulation.reset} title="Reset simulation engine"><RotateCcw size={14} />Reset</button><Button className="capture-button" onClick={simulation.captureNow} disabled={simulation.status === 'calculating' || simulation.status === 'loading'}><Play size={13} fill="currentColor" />Capture</Button><span className="toolbar-divider" /><select className="listen-channel" aria-label="Audio preview channel" value={listenChannel} onChange={e => { mute(); setListenChannel(e.target.value as 'CH1' | 'CH2') }}><option>CH1</option><option>CH2</option></select><button className={`subtle-button ${listening ? 'listening' : ''}`} disabled={simulation.status !== 'ready' || !document.probes[listenChannel]} onClick={() => void listen()}><Headphones size={15} />{listening ? 'Listening' : 'Listen'}</button><button className="icon-button" aria-label="Mute audio" title="Mute audio" onClick={mute}><VolumeX size={15} /></button></div></div>
        <Scope capture={simulation.status === 'ready' ? simulation.capture : null} status={simulation.status} probes={document.probes} onProbe={channel => { setTool(channel === 'CH1' ? 'probe1' : 'probe2'); message(`Select a terminal for ${channel}.`) }} />
      </div>
      {inspectorOpen && <aside className="inspector" aria-label="Inspector"><div className="panel-heading"><h2>Inspector</h2><span className="tiny-tag">{selectedPart ? selectedPart.id : selectedWire ? 'WIRE' : 'WORKBENCH'}</span></div>
        {selectedPart ? <><div className="selected-part-summary"><div className="selected-part-art"><PartIcon kind={selectedPart.kind} large /></div><span className="eyebrow">{selectedPart.id} · {selectedPart.kind === 'capacitor' ? 'NON-POLARIZED' : 'COMPONENT'}</span><h2>{PARTS[selectedPart.kind].label}</h2><p>{PARTS[selectedPart.kind].description}</p></div><div className="inspector-section"><div className="section-overline">COMPONENT VALUE</div>{selectedPart.kind === 'switch' ? <label className="switch-value"><input type="checkbox" checked={!!selectedPart.value} onChange={e => setPartValue(e.target.checked ? 1 : 0)} />{selectedPart.value ? 'Closed (on)' : 'Open (off)'}</label> : selectedPart.kind === 'resistor' || selectedPart.kind === 'capacitor' ? <><NumberField key={selectedPart.id} label={selectedPart.kind === 'resistor' ? 'Resistance' : 'Capacitance'} value={selectedPart.value * (selectedPart.kind === 'capacitor' ? 1e9 : 1e-3)} min={PARTS[selectedPart.kind].min * (selectedPart.kind === 'capacitor' ? 1e9 : 1e-3)} max={PARTS[selectedPart.kind].max * (selectedPart.kind === 'capacitor' ? 1e9 : 1e-3)} unit={selectedPart.kind === 'capacitor' ? 'nF' : 'kΩ'} onCommit={v => setPartValue(v * (selectedPart.kind === 'capacitor' ? 1e-9 : 1e3))} /><div className="value-presets">{(selectedPart.kind === 'capacitor' ? [10, 47, 100, 220, 470] : [1, 4.7, 10, 22, 100]).map(v => <button key={v} className={Math.abs(selectedPart.value - v * (selectedPart.kind === 'capacitor' ? 1e-9 : 1e3)) < 1e-15 ? 'active' : ''} onClick={() => setPartValue(v * (selectedPart.kind === 'capacitor' ? 1e-9 : 1e3))}>{v}</button>)}</div></> : <p className="muted-copy">Fixed generic {selectedPart.kind} model.</p>}</div><div className="inspector-section"><div className="section-overline">CONNECTIONS</div>{selectedPart.pins.map((pin, index) => <div className="pin-row" key={index}><span><i />{selectedPart.kind === 'diode' || selectedPart.kind === 'led' ? index ? 'Cathode −' : 'Anode +' : `Lead ${index + 1}`}</span><code>{pin.toUpperCase()}</code></div>)}<p className="micro-copy">Drag the component to move it. Jumper wires stay attached to their holes.</p></div><div className="inspector-section"><details className="model-details"><summary>Model details <Info size={13} /></summary><p>{PARTS[selectedPart.kind].model}</p></details></div><button className="delete-part" onClick={deleteSelection}><Trash2 size={14} />Remove component<kbd>⌫</kbd></button></> : selectedWire ? <><div className="selected-part-summary"><Cable size={42} style={{ color: selectedWire.color }} /><h2>Jumper wire</h2><p>A direct electrical connection between two terminals.</p></div><div className="inspector-section"><div className="section-overline">ENDPOINTS</div><div className="pin-row"><span>From</span><code>{selectedWire.from.toUpperCase()}</code></div><div className="pin-row"><span>To</span><code>{selectedWire.to.toUpperCase()}</code></div></div><div className="inspector-section"><div className="section-overline">WIRE COLOR</div><div className="wire-palette">{WIRE_COLORS.map(color => <button key={color} style={{ backgroundColor: color }} aria-label={`Change wire color to ${color}`} onClick={() => change({ ...document, wires: document.wires.map(w => w.id === selectedWire.id ? { ...w, color } : w) })}>{selectedWire.color === color && <Check size={12} />}</button>)}</div></div><button className="delete-part" onClick={deleteSelection}><Trash2 size={14} />Remove wire<kbd>⌫</kbd></button></> : <div className="inspector-empty"><MousePointer2 size={28} /><h2>A closer look.</h2><p>Select a component or a wire to inspect its values and connections.</p><NumberField label="Frequency" value={document.instruments.frequency} min={20} max={2000} unit="Hz" onCommit={v => updateInstrument('frequency', v)} /></div>}
        <div className="experiment-card"><span className="eyebrow"><Zap size={12} /> THE EXPERIMENT</span><h3>{currentExample?.name ?? 'A blank canvas'}</h3><p>{currentExample?.description ?? 'Add components, wire them to a source and ground, and measure what you build.'}</p>{exampleId === examples[0].id && <><div className="experiment-formula">f<sub>c</sub> = 1 / (2πRC)</div><p>A larger capacitor lowers the cutoff frequency, smoothing the output.</p></>}{currentExample && <button className="subtle-button" onClick={() => loadExample(currentExample.id)}><RotateCcw size={12} />Restore example</button>}</div>
        <div className="diagnostics"><div className="section-overline">CIRCUIT STATUS</div>{simulation.error ? <p className="error-copy">{simulation.error}</p> : simulation.diagnostics.length ? simulation.diagnostics.map((diagnostic, i) => <button key={i} className={`diagnostic ${diagnostic.severity}`} onClick={() => { if (diagnostic.partId) setSelectedId(diagnostic.partId) }}><Info size={13} />{diagnostic.message}</button>) : <p className="healthy-status"><span />{simulation.status === 'ready' ? 'Capture complete' : simulation.status === 'loading' ? 'Starting simulation engine…' : simulation.status === 'calculating' ? 'Calculating your circuit…' : 'Ready to capture'}</p>}<details className="debug-details"><summary>View generated netlist</summary><pre>{simulation.netlist}</pre></details></div>
      </aside>}
    </main>
    <footer className="app-footer"><span><span className={`small-status-dot ${saved ? '' : 'unsaved'}`} />{saved ? 'Browser recovery copy saved' : 'Browser recovery unavailable'}<span className="footer-separator">·</span>Export a file to keep a separate copy.</span><span>Built for curiosity.<span className="footer-separator">/</span>All simulation stays on your device.</span></footer>
    {notice && <div className="toast" role="status"><Info size={16} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <dialog ref={guideDialog} className="guide-dialog" aria-labelledby="guide-title" onClose={() => setHelpOpen(false)}><button className="icon-button modal-close" aria-label="Close guide" autoFocus onClick={() => setHelpOpen(false)}><X size={18} /></button><span className="eyebrow">WELCOME TO YOUR WORKBENCH</span><h2 id="guide-title">A little curiosity goes a long way.</h2><p>Start with the filter: select C1 and change its capacitance. CH1 measures the input; CH2 shows what makes it through.</p><ol><li><strong>Build.</strong> Choose a part, then click a hole. Rotate with R. Drag existing parts to move them.</li><li><strong>Connect.</strong> Choose the wire tool and click two terminals. The five holes in each vertical strip connect internally. The center trench and the rail breaks stay separate.</li><li><strong>Measure.</strong> Choose a CH1 or CH2 probe, then a terminal. Capture runs the circuit from its initial state. Hover over the scope to read a voltage.</li><li><strong>Keep it.</strong> Export your circuit as JSON. Import it anytime; undo also works after loading or clearing a board.</li></ol><div className="guide-note"><Info size={17} /><p>This first build uses a documented virtual breadboard and simplified instrument sources. It is inspired by LABOR, and is not an exact hardware replica. ICs, the envelope generator, advanced scope tools, and calibrated hardware models are planned next.</p></div><Button onClick={() => setHelpOpen(false)}>Let’s experiment <ChevronDown size={14} /></Button></dialog>
  </div>
}
