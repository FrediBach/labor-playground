import { RecordingExpectationButton, SeekTestEvidence, type RecordingSeed } from '@/components/workbench/tests/RecordingExpectation'
import { PROJECT_LIMITS } from '@/lib/project-limits'
import { CustomComponentEditor } from '@/components/workbench/CustomComponentEditor'
import { customTemplate, duplicateCustomComponent, deleteCustomComponent, type CustomComponent, type PartPlacement } from '@/lib/custom-components'
import { createPico, type PicoCaptureMs } from '@/lib/pico/profile'
const PicoPanel = lazy(() => import('@/components/pico/PicoPanel'))
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Cable, ChevronDown, CircleHelp, CircuitBoard, FolderOpen, Hand, Info, LoaderCircle, Maximize2, Minus, MousePointer2, PanelLeftOpen, Play, Plus, Redo2, RotateCcw, RotateCw, SlidersHorizontal, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Breadboard } from '@/components/workbench/Breadboard'
import { RecordingProvider, RecordingScope, RecordingTransport } from '@/components/workbench/Recording'
import { PicoStateInspector } from '@/components/workbench/PicoStateInspector'
import { PARTS, createEmptyDocument, examples, validateDocument, envelopeSettings, type CircuitDocument, type ComponentKind } from '@/lib/circuit'
import { useDocument } from '@/lib/use-document'
import { useSimulation } from '@/lib/simulation'
import { AudioMonitor } from '@/components/workbench/AudioMonitor'
import { BoardViewport, type BoardViewportHandle } from '@/components/workbench/BoardViewport'
import type { LeadEdit } from '@/lib/part-editing'
import { Inspector } from '@/components/workbench/Inspector'
import { OverviewPanel } from '@/components/workbench/OverviewPanel'
import { SchemaPanel } from '@/components/workbench/SchemaPanel'
import { PartsLibrary } from '@/components/workbench/PartsLibrary'
import { RotaryControl, FrequencyKnob } from '@/components/workbench/ParameterControls'
import { EnvelopeControls } from '@/components/workbench/EnvelopeControls'
import { OperatingPointPanel } from '@/components/workbench/OperatingPointPanel'
import type { Channel } from '@/lib/simulation-types'
import { ScopeModule } from '@/components/workbench/ScopeModule'
import { InstrumentRack } from '@/components/workbench/InstrumentRack'
import { ControlCarrier } from '@/components/workbench/ControlCarrier'
import { AutomationWorkspace } from '@/components/workbench/automations/AutomationWorkspace'
import { useCircuitTests } from '@/lib/use-circuit-tests'
import type { TestReport } from '@/lib/circuit-tests'
import { programFor } from '@/lib/automation-migration'
import { simpleRows } from '@/lib/automation-editing'
import { RecordedAutomationValue } from '@/components/workbench/AutomationPlayback'
import { WorkspaceTabs, type WorkspaceTab } from '@/components/workbench/WorkspaceTabs'
import { DocumentationPanel } from '@/components/workbench/DocumentationPanel'
import { HelpDialog } from '@/components/workbench/HelpDialog'
import { useDirectorySync } from '@/lib/use-directory-sync'
import './LaborHardware.css'
import './WorkbenchUX.css'
import './components/workbench/InstrumentRack.css'

type Tool = 'select' | 'wire' | 'probe1' | 'probe2' | ComponentKind
const isDipTool = (tool: Tool) => tool in PARTS && !!PARTS[tool as ComponentKind].package
const WIRE_COLORS = ['#de8564', '#e5bd68', '#91bfad', '#86a8d7', '#b899ce', '#d2d4cd']

export default function App() {
  const { document, sourceSession, change, replace, changeSource, undo, redo, canUndo, canRedo, saved } = useDocument()
  const folder = useDirectorySync(document, replace)
  const folderDescription = folder.supported
    ? 'Keep a project in sync with circuit.json on your computer.'
    : 'Folder access is unavailable in this browser. Use Import and Export, or desktop Chrome / Edge.'
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('circuit')
  const workspaceTab = activeTab === 'code' && !document.pico ? 'circuit' : activeTab
  const workspaceHeader = useRef<HTMLDivElement>(null)
  const openTab = useCallback((tab: WorkspaceTab, reveal = false) => {
    const focusedPanel = window.document.activeElement?.closest('[role="tabpanel"]')
    const restoreFocus = focusedPanel && focusedPanel.id !== `workspace-panel-${tab}`
    setActiveTab(tab)
    requestAnimationFrame(() => {
      if (restoreFocus) window.document.getElementById(`workspace-tab-${tab}`)?.focus({ preventScroll: true })
      if (reveal || tab !== workspaceTab) workspaceHeader.current?.scrollIntoView({ block: 'nearest' })
    })
  }, [workspaceTab])
  const [placementState, setPlacement] = useState<PartPlacement | undefined>()
  const [modelEditor, setModelEditor] = useState<{ initial: CustomComponent; editing: boolean } | null>(null)
  const [tool, setToolState] = useState<Tool>('select')
  const [panEnabled, setPanEnabled] = useState(false)
  const [leadEdit, setLeadEdit] = useState<(LeadEdit & { document: CircuitDocument }) | null>(null)
  const setTool = useCallback((next: Tool) => { setToolState(next); setPlacement(undefined); setPanEnabled(false); setLeadEdit(null); openTab('circuit') }, [openTab])
  const placement = placementState && tool === placementState.kind && (!placementState.customModelId || document.customComponents?.some(m => m.id === placementState.customModelId)) ? placementState : undefined
  if (placementState?.customModelId && !placement) { setPlacement(undefined); setToolState('select') }
  const placeModel = (selection: PartPlacement) => { setTool(selection.kind); setPlacement(selection); setRotation(0) }
  const modelAction = (action: () => CircuitDocument) => { try { change(action()) } catch (e) { setNotice((e as Error).message) } }
  const [selectedId, setSelectedId] = useState<string | null>('C1')
  const [rotation, setRotation] = useState(0)
  const [wireColor, setWireColor] = useState(WIRE_COLORS[0])
  const [showConnections, setShowConnections] = useState(false)
  const [highlightedChannel, setHighlightedChannel] = useState<Channel | null>(null)
  const [partsOpen, setPartsOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [resultsExpanded, setResultsExpanded] = useState(false)
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
  const viewport = useRef<BoardViewportHandle>(null)
  const [analogDuration, setAnalogDuration] = useState(0.1)
  const durationSeconds = document.pico ? document.pico.captureMs / 1000 : analogDuration
  const tests = useCircuitTests(document)
  const [recordingSeed, setRecordingSeed] = useState<RecordingSeed | undefined>()
  const [inspectedTest, setInspectedTest] = useState<TestReport | null>(null)
  const simulation = useSimulation(document, autoUpdate, durationSeconds, tests.busy)
  const resultCapture = inspectedTest?.capture ?? (simulation.status === 'ready' ? simulation.capture : null)
  const resultStatus = inspectedTest?.capture ? 'ready' as const : simulation.status
  const captureAutomations = document.automationProgram ? simpleRows(programFor(document)).map(r => r.automation) : document.automations
  const captureNow = simulation.captureNow
  const simulationBusy = tests.busy || simulation.status === 'loading' || simulation.status === 'calculating'
  const simulationBlocked = simulation.status === 'invalid'
  const circuitIssues = simulation.error && !simulation.diagnostics.some(item => item.message === simulation.error)
    ? [{ severity: 'error' as const, message: simulation.error }, ...simulation.diagnostics]
    : simulation.diagnostics
  const simulationIssue = circuitIssues.find(item => item.severity === 'error')?.message
  const simulationLabel = simulationBusy ? 'Simulating circuit…'
    : simulation.status === 'ready' ? 'Results up to date'
    : simulation.status === 'invalid' ? 'Check circuit connections'
    : simulation.status === 'error' ? 'Simulation failed'
    : simulation.capture ? 'Changes need simulation' : 'Ready to simulate'
  const currentExample = examples.find(example => example.id === exampleId)
  const message = useCallback((text: string) => setNotice(text), [])
  const highlightChannel = (channel: Channel) => {
    openTab('circuit')
    setHighlightedChannel(channel)
    message(`${channel} connection highlighted on the breadboard.`)
  }
  const editingLead = leadEdit && leadEdit.document === document && leadEdit.partId === selectedId && tool === 'select' && !panEnabled ? leadEdit : null
  if (leadEdit && !editingLead) setLeadEdit(null)
  const finishLeadEdit = useCallback(() => setLeadEdit(null), [])
  const startLeadEdit = useCallback((edit: LeadEdit) => {
    setToolState('select'); setPanEnabled(false); setLeadEdit({ ...edit, document }); openTab('circuit')
  }, [document, openTab])
  const operatingPoint = resultCapture?.operatingPoint

  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 5500); return () => clearTimeout(timeout) }, [notice])
  const deleteSelection = useCallback(() => {
    if (!selectedId) return
    change({ ...document, parts: document.parts.filter(p => p.id !== selectedId), wires: document.wires.filter(w => w.id !== selectedId) }); setSelectedId(null)
  }, [change, document, selectedId])
  useEffect(() => {
    const simulateKey = (e: KeyboardEvent) => {
      if (helpOpen || window.document.querySelector('dialog[open]') || (e.target instanceof HTMLElement && e.target.closest('.automation-dialog')) || !(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return
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
      if (e.defaultPrevented || e.isComposing || helpOpen || window.document.querySelector('dialog[open]')) return
      const editable = e.target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || !!e.target.closest('.pico-panel'))
      if ((e.metaKey || e.ctrlKey) && !e.altKey && ['s', 'o'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) {
          if (e.key.toLowerCase() === 'o') fileInput.current?.click()
          else if (folder.name) void folder.sync()
          else exportDocument()
        }
        return
      }
      if (editable) return
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setHelpOpen(true); return }
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-7]$/.test(e.code)) {
        const tab = (['circuit', 'code', 'automations', 'results', 'overview', 'schema', 'documentation'] as const)[Number(e.code.slice(-1)) - 1]
        if (tab !== 'code' || document.pico) { e.preventDefault(); openTab(tab) }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (e.metaKey || e.ctrlKey || e.altKey || workspaceTab !== 'circuit' || (e.target instanceof HTMLElement && e.target.closest('[role="tablist"]'))) return
      if (e.target instanceof HTMLElement && e.target.closest('.automations-panel, .automation-workspace')) return
      if (e.key === 'Escape') { setTool('select'); setHelpOpen(false) }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection() }
      if (e.key.toLowerCase() === 'r') setRotation(v => (v + (isDipTool(tool) || tool === 'ssd1306' ? 180 : 90)) % 360)
      if (e.key.toLowerCase() === 'w') setTool('wire')
      if (e.key.toLowerCase() === 'v') setTool('select')
      if (e.key.toLowerCase() === 'h') { setTool('select'); setPanEnabled(true) }
      if (e.key === '1' || e.key === '2') setTool(e.key === '1' ? 'probe1' : 'probe2')
      if (e.key === '+' || e.key === '=') { e.preventDefault(); viewport.current?.zoomTo(zoom + 0.15) }
      if (e.key === '-') { e.preventDefault(); viewport.current?.zoomTo(zoom - 0.15) }
      if (e.key === '0') viewport.current?.fit('breadboard')
      if (e.key.toLowerCase() === 'f') viewport.current?.fit('workbench')
      if (!e.repeat && e.key.toLowerCase() === 'c') setShowConnections(value => !value)
      if (!e.repeat && e.key === '[') setPartsOpen(value => !value)
      if (!e.repeat && e.key === ']') setInspectorOpen(value => !value)
    }
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true)
  })

  function inspectComponent(id: string) {
    setSelectedId(id)
    setInspectorOpen(true)
    setTool('select')
    requestAnimationFrame(() => {
      const part = window.document.querySelector<HTMLElement>(`[data-part="${CSS.escape(id)}"], [data-wire="${CSS.escape(id)}"]`)
      part?.scrollIntoView({ block: 'center', inline: 'nearest' })
      part?.focus({ preventScroll: true })
    })
  }

  function loadExample(id: string) {
    const example = examples.find(item => item.id === id)
    if (!example) return
    replace(structuredClone(example.document)); setSelectedId(example.document.parts.find(p => ['capacitor', 'electrolytic', 'opamp', 'quadopamp', 'timer555'].includes(p.kind))?.id ?? example.document.parts[0]?.id ?? null); setTool('select')
    openTab(example.document.pico ? 'code' : 'circuit')
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
      replace(next); setSelectedId(null); setTool('select'); openTab(next.pico ? 'code' : 'circuit'); message(`Imported ${next.title}.`)
    } catch (error) { message(`Import failed: ${error instanceof Error ? error.message : 'Invalid circuit file.'}`) }
    finally { if (fileInput.current) fileInput.current.value = '' }
  }
  const updateInstrument = <K extends Exclude<keyof typeof document.instruments, 'envelope'>>(key: K, value: typeof document.instruments[K]) => change({ ...document, instruments: { ...document.instruments, [key]: value } })

  const toolHint = editingLead ? `${editingLead.partId}: choose a free hole for lead ${editingLead.pinIndex + 1}. Escape cancels.` : panEnabled ? 'Drag the board to pan. Press Escape to return to selecting parts.' : tool === 'wire' ? 'Click a terminal to start a wire, then click its destination.' : tool === 'probe1' || tool === 'probe2' ? `Click a terminal to attach ${tool === 'probe1' ? 'CH1' : 'CH2'}.` : tool === 'select' ? 'Select a part to inspect it. Drag a part to move it.' : tool === 'ssd1306' ? 'Place four pins in adjacent columns. Press R for a 180° turn.' : isDipTool(tool) ? 'Place pin 1 on row E at the trench. Press R for a 180° turn to row F.' : `Click a hole to place ${placement?.customModelId ? document.customComponents?.find(m => m.id === placement.customModelId)?.name : `a ${PARTS[tool].label.toLowerCase()}`}. Press R to rotate.`

  return <RecordingProvider capture={resultCapture}><div className="app-shell dark">
    {modelEditor && <CustomComponentEditor key={modelEditor.initial.id} initial={modelEditor.initial} editing={modelEditor.editing} document={document} onCancel={() => setModelEditor(null)} onSave={(next, model) => { change(next); setModelEditor(null); if (!modelEditor.editing) placeModel({ kind: model.baseKind, customModelId: model.id }) }} />}
    <header className="app-header">
      <div className="header-branding"><div className="brand"><span className="brand-mark"><i /><i /><i /><i /></span><span>Pico<span className="brand-light"> Labor</span></span></div><span className="brand-slogan">Circuit simulation &amp; Pico programming, inspired by the Erica Synths EDU Labor</span></div>
      <div className="header-right">
        {!folder.name && <span className="folder-connect" title={folderDescription}><button className="subtle-button" aria-describedby="folder-description" disabled={!folder.supported || folder.busy} onClick={() => void folder.connect()}><FolderOpen size={15} /><span>{folder.busy ? 'Connecting…' : 'Connect folder'}</span></button><span id="folder-description" className="sr-only">{folderDescription}</span></span>}
        <button className="icon-button" title="Workbench guide · ?" aria-label="Workbench guide" onClick={() => setHelpOpen(true)}><CircleHelp size={18} /></button>
        <a className="about-link" href="https://www.ericasynths.lv/edu-diy-labor/" target="_blank" rel="noreferrer">Inspired by LABOR ↗</a>
      </div>
    </header>
    <div ref={projectToolbar} className="project-toolbar" aria-label="Project controls">
      <div className="project-title"><CircuitBoard size={18} /><div><strong title={document.title}>{document.title}</strong></div></div>
      <div className="project-actions">
        <div className="history-actions"><button className="icon-button" aria-label="Undo" title="Undo · ⌘Z / Ctrl+Z" disabled={!canUndo} onClick={undo}><Undo2 size={18} /></button><button className="icon-button" aria-label="Redo" title="Redo · ⇧⌘Z / Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}><Redo2 size={18} /></button></div>
        <label className="example-select"><span>Examples</span><select aria-label="Load example" value={exampleId} onChange={e => loadExample(e.target.value)}>{!exampleId && <option value="">Custom circuit</option>}{(['Basic', 'Intermediate', 'Advanced'] as const).map(level => <optgroup key={level} label={level}>{examples.filter(example => example.level === level).map(example => <option key={example.id} value={example.id}>{example.name}</option>)}</optgroup>)}</select><ChevronDown size={14} /></label>
        <button className="subtle-button import-button" aria-label="Import circuit" title="Import circuit · ⌘O / Ctrl+O" onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={16} /><span>Import</span></button>
        <Button variant="outline" className="export-button" aria-label="Export circuit" title="Export circuit" onClick={exportDocument}><ArrowDownToLine size={16} /><span>Export circuit</span></Button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => void importDocument(e.target.files?.[0])} />
      </div>
      <div className="simulation-actions">
        <div className="simulation-feedback">
          <span className={`simulation-status ${simulation.status}`} role="status" aria-label="Simulation status" data-state={simulation.status}><span className="simulation-status-dot" />{simulationLabel}</span>
          {simulation.status === 'ready' ? <a href="#simulation-results" className="simulation-results-link" onClick={event => { event.preventDefault(); openTab('results', true) }}>View results</a> : <span className="simulation-shortcut">{document.pico ? `Pico + circuit · ${durationSeconds * 1000} ms` : '⌘ / Ctrl + Enter'}</span>}
        </div>
        <Button className="simulate-button" aria-label="Simulate" aria-keyshortcuts="Meta+Enter Control+Enter" title={simulationBlocked ? 'Fix the circuit errors before simulating' : 'Simulate circuit · ⌘Enter / Ctrl+Enter'} onClick={simulation.captureNow} disabled={simulationBusy || simulationBlocked}>
          {simulationBusy ? <LoaderCircle size={18} className="simulation-spinner" /> : <Play size={17} fill="currentColor" />}<span>{simulationBusy ? 'Simulating…' : 'Simulate'}</span>
        </Button>
      </div>
    </div>
    {(folder.name || folder.status) && <div className="folder-toolbar" aria-label="Local folder sync">
      <div><strong>{folder.name ? `Folder: ${folder.name}` : 'Local project folder'}</strong><span role="status">{folder.status}{folder.name && folder.dirty && !folder.conflict ? ' Workbench changes pending.' : ''}</span></div>
      <div className="folder-actions">{folder.name && <><button className="subtle-button" disabled={folder.busy || folder.conflict} onClick={() => void folder.sync()}>{folder.busy ? 'Syncing…' : 'Sync now'}</button><button className="subtle-button" disabled={folder.busy} onClick={() => { folder.disconnect(); message('Folder disconnected. Files remain on disk.') }}>Disconnect</button></>}</div>
      {folder.conflict && <div className="folder-conflict" role="alert"><span>Choose a version for circuit.json. Keeping the workbench overwrites the folder file; loading the folder replaces the workbench and can be undone.</span><button className="subtle-button" disabled={folder.busy} onClick={() => void folder.sync('local')}>Keep workbench</button><button className="subtle-button" disabled={folder.busy} onClick={() => void folder.sync('disk')}>Load folder version</button></div>}
    </div>}
    <main data-workspace={workspaceTab} className={`workbench-layout ${!partsOpen ? 'parts-collapsed' : ''} ${!inspectorOpen ? 'inspector-collapsed' : ''} ${workspaceTab === 'results' && resultsExpanded ? 'results-expanded' : ''}`}>
      {partsOpen && <PartsLibrary tool={tool} placement={placement} customComponents={document.customComponents ?? []} onToolChange={setTool} onPlace={placeModel} onCreate={() => setModelEditor({ initial: customTemplate('resistor'), editing: false })} onEdit={initial => setModelEditor({ initial, editing: true })} onDuplicate={model => modelAction(() => duplicateCustomComponent(document, model.id).document)} onDeleteModel={model => modelAction(() => deleteCustomComponent(document, model.id))} modelInstances={id => document.parts.filter(p => p.customModelId === id).map(p => p.id)} hasPico={!!document.pico} onAddPico={() => { change({ ...document, schemaVersion: document.schemaVersion >= 3 ? document.schemaVersion : 2, pico: createPico() }); openTab('code') }} wireColor={wireColor} wireColors={WIRE_COLORS} onWireColorChange={setWireColor} partCount={document.parts.length} onCollapse={() => setPartsOpen(false)} onClear={() => { change({ ...createEmptyDocument(), schemaVersion: document.schemaVersion, ...(document.automationProgram ? { automationProgram: programFor(createEmptyDocument()) } : {}), ...(document.customComponents ? { customComponents: document.customComponents } : {}), ...(document.pico ? { pico: document.pico } : {}) }); setSelectedId(null); setTool('select'); message('Board cleared. Undo restores your circuit.') }} />}
      <div className="workspace">
        {simulationIssue && workspaceTab !== 'overview' && <div className="simulation-error" role="alert"><Info size={18} /><div><strong>Simulation needs your attention</strong><p>{simulationIssue}</p><button className="subtle-button" onClick={() => { openTab('overview', true); requestAnimationFrame(() => window.document.getElementById('workspace-tab-overview')?.focus({ preventScroll: true })) }}>View circuit details</button></div></div>}
        <div className="workspace-header" ref={workspaceHeader}>
          <h1 className="sr-only">Circuit workspace</h1>
          <WorkspaceTabs active={workspaceTab} onChange={openTab} hasPico={!!document.pico} automationCount={captureAutomations?.filter(item => item.enabled).length ?? 0} issueCount={circuitIssues.length} />
          <div className="workspace-actions">{!partsOpen && <button className="icon-button" title="Open parts library" aria-label="Open parts library" onClick={() => setPartsOpen(true)}><PanelLeftOpen size={17} /></button>}<button className={`icon-button ${inspectorOpen ? 'is-on' : ''}`} title="Toggle inspector · ]" aria-label="Toggle inspector" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}><SlidersHorizontal size={17} /></button></div>
        </div>
        <div className="workspace-panel" id="workspace-panel-circuit" role="tabpanel" aria-labelledby="workspace-tab-circuit" hidden={workspaceTab !== 'circuit'}>
        <section className="bench-section" aria-label="Circuit workbench"><div className="board-toolbar"><div className="tool-group"><button className={`icon-button ${tool === 'select' && !panEnabled ? 'active' : ''}`} title="Select · V" aria-label="Select tool" aria-pressed={tool === 'select' && !panEnabled} onClick={() => setTool('select')}><MousePointer2 size={16} /></button><button className={`icon-button ${tool === 'wire' ? 'active' : ''}`} title="Wire · W" aria-label="Wire tool" aria-pressed={tool === 'wire'} onClick={() => setTool('wire')}><Cable size={16} /></button><button className="icon-button" title="Rotate placement · R" aria-label="Rotate placement" onClick={() => setRotation((rotation + (isDipTool(tool) || tool === 'ssd1306' ? 180 : 90)) % 360)}><RotateCw size={15} /></button><button className={`icon-button ${panEnabled ? 'active' : ''}`} title="Pan board · H / Space-drag" aria-label="Pan tool" aria-pressed={panEnabled} onClick={() => { if (panEnabled) setPanEnabled(false); else { setTool('select'); setPanEnabled(true) } }}><Hand size={15} /></button><span className="toolbar-divider" /><label className="connections-toggle"><input type="checkbox" aria-label="Show connections" checked={showConnections} onChange={e => setShowConnections(e.target.checked)} /><span>Connections</span></label></div><div className="zoom-controls"><button className="icon-button" aria-label="Zoom out" onClick={() => viewport.current?.zoomTo(zoom - 0.15)}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="Zoom in" onClick={() => viewport.current?.zoomTo(zoom + 0.15)}><Plus size={14} /></button><button className="icon-button" aria-label="Fit breadboard" title="Fit breadboard · 0" onClick={() => viewport.current?.fit('breadboard')}><Maximize2 size={14} /></button><button className="fit-workbench" aria-label="Fit workbench" title="Fit the breadboard and source terminals · F" onClick={() => viewport.current?.fit('workbench')}>Fit all</button></div></div>
          <div className="labor-case">
            <InstrumentRack>
              <ScopeModule windowSeconds={captureAutomations?.some(item => item.enabled) ? durationSeconds : document.pico ? 0.1 : document.stimulus === 'step' || ['envelope-shaping', '555-monostable', 'ripple-divider', 'nand-oscillator'].includes(exampleId) ? 0.1 : Math.min(0.1, 3 / document.instruments.frequency)} capture={simulation.status === 'ready' ? simulation.capture : null} status={simulation.status} probes={document.probes} onProbe={channel => { setTool(channel === 'CH1' ? 'probe1' : 'probe2'); message(`Select a terminal for ${channel}.`) }} />
              <div className="source-module hardware-panel">
                <div className="module-heading"><span>SIGNAL GENERATOR</span><span>01</span></div>
                <div className="generator-controls">
                  <div className="oscillator-block"><div className="instrument-label">{document.stimulus === 'step' ? 'INPUT STEP' : 'FREQUENCY'}</div><FrequencyKnob disabled={document.stimulus === 'step'} value={document.instruments.frequency} onCommit={v => updateInstrument('frequency', v)} /><RecordedAutomationValue document={document} target="frequency" /><span className="source-caption">20 Hz — 2 kHz</span></div>
                  <div className="shape-block"><div className="instrument-label">SHAPE</div><div className="waveform-buttons">{(['sine', 'triangle', 'square'] as const).map(wave => <button key={wave} disabled={document.stimulus === 'step'} title={wave} aria-label={`${wave} wave`} aria-pressed={document.instruments.waveform === wave} className={document.instruments.waveform === wave ? 'active' : ''} onClick={() => updateInstrument('waveform', wave)}><svg viewBox="0 0 30 16" aria-hidden="true"><path d={wave === 'sine' ? 'M2 8 C6 -1 10 -1 15 8 S24 17 28 8' : wave === 'triangle' ? 'M2 12 L8 3 L20 13 L27 4' : 'M2 12 H7 V3 H18 V12 H28'} /></svg></button>)}</div></div>
                  <div className="source-block"><div className="instrument-label">SIGNAL LEVEL</div><RotaryControl label="Amplitude" value={document.instruments.amplitude} min={0} max={5} step={0.1} unit="V pk" onCommit={v => updateInstrument('amplitude', v)} /><RecordedAutomationValue document={document} target="amplitude" /><span className="source-caption">SIGNAL OUT ↓</span></div>
                  <div className="source-block cv-source"><div className="instrument-label">CV SOURCE</div><RotaryControl label="CV output" value={document.instruments.cv} min={-5} max={5} step={0.1} unit="V" onCommit={v => updateInstrument('cv', v)} /><RecordedAutomationValue document={document} target="cv" /><span className="source-caption">CV OUT ↓</span></div>
                </div>
                <EnvelopeControls settings={envelopeSettings(document)} busy={simulation.status === 'loading' || simulation.status === 'calculating'} onChange={envelope => change({ ...document, instruments: { ...document.instruments, envelope } })} onFire={simulation.captureNow} /><RecordedAutomationValue document={document} target="gate" />
              </div>
              <div className="output-module hardware-panel"><div className="module-heading"><span>AUDIO / POWER</span><span>02</span></div><AudioMonitor capture={simulation.status === 'ready' ? simulation.capture : null} onMessage={message} /><div className="supply-indicators" aria-label="Power supplies: plus 12 volts and minus 12 volts available"><span><i />+12 V</span><span><i />−12 V</span><span className="supply-label">DC SUPPLY</span></div></div>
            </InstrumentRack>
            <div className="breadboard-panel"><div className="board-silkscreen"><span>BREADBOARD / PATCH FIELD</span><span>30 COLUMNS · SPLIT RAILS</span></div><BoardViewport workbenchWidth={document.pico ? 1110 : 920} ref={viewport} zoom={zoom} onZoomChange={setZoom} panEnabled={panEnabled} onPanEnabledChange={setPanEnabled}><Breadboard placement={placement} document={document} selectedId={selectedId} onSelect={setSelectedId} onChange={change} tool={tool} rotation={rotation} wireColor={wireColor} showConnections={showConnections} highlightTerminal={highlightedChannel ? document.probes[highlightedChannel] : null} zoom={1} onMessage={message} editingLead={editingLead} onStartLeadEdit={startLeadEdit} onFinishLeadEdit={finishLeadEdit} /></BoardViewport></div>
            <ControlCarrier document={document} onChange={change} onSelect={id => { setSelectedId(id); setTool('select'); setInspectorOpen(true) }} onPlace={kind => { setTool(kind); setRotation(0); message(`Choose free breadboard holes for your ${kind}.`) }} />
            <div className="device-footer"><span>PICO LABOR / VIRTUAL-1</span><span>PATCH SUPPLIES TO RAILS WITH JUMPERS</span><span>EDU</span></div></div><div className="board-hint"><MousePointer2 size={12} /><span>{toolHint}</span><span className="board-count">{document.wires.length} wires</span></div>
        </section>
        </div>
        {document.pico && <div className="workspace-panel" id="workspace-panel-code" role="tabpanel" aria-labelledby="workspace-tab-code" hidden={workspaceTab !== 'code'}><Suspense fallback={<p>Loading Pico editor…</p>}><PicoPanel durationSeconds={durationSeconds} sourceSession={sourceSession} source={document.pico.source} onChange={changeSource} onRun={simulation.captureNow} onStop={simulation.stop} onReset={simulation.reset} busy={simulation.status === 'calculating' || simulation.status === 'loading'} serial={simulation.serial} phase={simulation.picoPhase} error={simulation.error} onRemove={() => { const { pico: _pico, ...circuit } = document; change({ ...circuit, wires: circuit.wires.filter(wire => !wire.from.startsWith('pico:') && !wire.to.startsWith('pico:')), probes: { CH1: circuit.probes.CH1?.startsWith('pico:') ? null : circuit.probes.CH1, CH2: circuit.probes.CH2?.startsWith('pico:') ? null : circuit.probes.CH2 } }); openTab('circuit'); message('Pico removed. Undo restores the board, wiring and source.') }} /></Suspense></div>}
        <div className="capture-toolbar" hidden={workspaceTab !== 'results' && workspaceTab !== 'automations'}><label className="auto-update"><input type="checkbox" disabled={!!document.pico} checked={autoUpdate && !document.pico} onChange={e => setAutoUpdate(e.target.checked)} /><span className="toggle-track" /><span>Auto update</span></label>{document.pico && <span className="capture-mode-note">Pico · manual capture</span>}<div className="capture-actions"><label className="recording-duration">Duration<select aria-label="Simulation duration" value={durationSeconds} disabled={simulationBusy} onChange={event => { const value = Number(event.target.value); if (document.pico) change({ ...document, pico: { ...document.pico, captureMs: value * 1000 as PicoCaptureMs } }); else setAnalogDuration(value) }}>{[0.1, 0.5, 1, 5, 10].map(value => <option key={value} value={value}>{value < 1 ? `${value * 1000} ms` : `${value} s`}</option>)}</select></label>{simulationBusy && <button className="subtle-button" onClick={tests.busy ? tests.cancel : simulation.stop}>{tests.busy ? 'Cancel tests' : 'Stop simulation'}</button>}<select className="stimulus-select" aria-label="Capture stimulus" value={document.stimulus ?? 'periodic'} onChange={event => change({ ...document, stimulus: event.target.value as 'periodic' | 'step' })}><option value="periodic">Periodic input</option><option value="step">Charge / decay step</option></select><button className="subtle-button reset-button" disabled={tests.busy} onClick={simulation.reset} title="Reset simulation engine"><RotateCcw size={14} />Reset</button><Button className="capture-button" onClick={simulation.captureNow} disabled={simulationBusy || simulationBlocked} title="Simulate and capture a new waveform"><Play size={13} fill="currentColor" />Capture</Button></div></div>
        <div className="workspace-panel" id="workspace-panel-automations" role="tabpanel" aria-labelledby="workspace-tab-automations" hidden={workspaceTab !== 'automations'}>
        <AutomationWorkspace recordingSeed={recordingSeed} onSeedConsumed={() => setRecordingSeed(undefined)} visible={workspaceTab === 'automations'} tests={tests} onInspect={report => { setInspectedTest(report); openTab('results') }} onViewResults={() => { setInspectedTest(null); openTab('results') }} document={document} onChange={change} durationSeconds={durationSeconds} capture={simulation.status === 'ready' ? simulation.capture : null} status={simulation.status} />
        </div>
        <div className="workspace-panel" id="workspace-panel-results" role="tabpanel" aria-labelledby="workspace-tab-results" hidden={workspaceTab !== 'results'}>
        <div id="simulation-results"><SeekTestEvidence report={inspectedTest} />
        <div className="results-heading"><div><h2>Recording analysis</h2><p>Signals and code, on one timeline.</p></div><button className="subtle-button results-expand" aria-label="Expand results workspace" aria-pressed={resultsExpanded} title="Give the recording the full workspace width. Your sidebar settings are preserved." onClick={() => setResultsExpanded(value => !value)}><Maximize2 size={14} /><span>{resultsExpanded ? 'Restore layout' : 'Expand view'}</span></button></div>
        {inspectedTest && <div className="test-recording-banner"><strong>Test: {inspectedTest.name} · {inspectedTest.verdict}</strong><span>{inspectedTest.message}</span><button className="subtle-button" onClick={() => { setInspectedTest(null); openTab('automations') }}>Return to tests</button><button className="subtle-button" onClick={() => setInspectedTest(null)}>Ordinary recording</button></div>}
        <RecordingScope transportControls={<RecordingTransport compact probes={{ CH1: document.probes.CH1 ? simulation.nodeByTerminal[document.probes.CH1] ?? null : null, CH2: document.probes.CH2 ? simulation.nodeByTerminal[document.probes.CH2] ?? null : null }} />} automations={resultCapture?.automationRun?.actions ?? captureAutomations} pico={!!document.pico} key={`${exampleId || document.title}:${!!captureAutomations?.length}`} defaultTimeScale={captureAutomations?.length || exampleId === 'pico-state-logs' ? durationSeconds * 100 : document.pico || ['envelope-shaping', '555-monostable', 'ripple-divider', 'nand-oscillator'].includes(exampleId) ? 10 : undefined} onHighlight={highlightChannel} stimulus={document.stimulus ?? 'periodic'} defaultScale={exampleId === '555-astable' ? 5 : captureAutomations?.length ? 2 : document.stimulus === 'step' || ['opamp-amplifier', 'voltage-divider', 'envelope-shaping', '555-astable', '555-monostable', 'quad-buffer', 'lm13700-vca'].includes(exampleId) ? 2 : 1} capture={resultCapture} status={resultStatus} probes={document.probes} onProbe={channel => { setTool(channel === 'CH1' ? 'probe1' : 'probe2'); message(`Select a terminal for ${channel}.`) }} />
        {(document.pico || resultCapture?.picoTrace) && <PicoStateInspector enabled={!!document.pico} />}
        <OperatingPointPanel operatingPoint={operatingPoint} probes={document.probes} nodeByTerminal={simulation.nodeByTerminal} onHighlight={highlightChannel} />
        <div className="results-test-action"><RecordingExpectationButton onAdd={seed => { setRecordingSeed(seed); openTab('automations') }} /><span>Use the selected moment in a circuit test.</span></div>
        </div>
        </div>
        <div className="workspace-panel" id="workspace-panel-schema" role="tabpanel" aria-labelledby="workspace-tab-schema" hidden={workspaceTab !== 'schema'}>
          <SchemaPanel document={document} onChange={change} selectedId={selectedId} onSelect={id => { setSelectedId(id); setInspectorOpen(true) }} visible={workspaceTab === 'schema'} recordingAvailable={simulation.status === 'ready' && !inspectedTest} recordingNote={inspectedTest ? 'Return to the ordinary recording in Results to view this circuit’s voltages.' : undefined} />
        </div>
        <div className="workspace-panel" id="workspace-panel-overview" role="tabpanel" aria-labelledby="workspace-tab-overview" hidden={workspaceTab !== 'overview'}>
          <OverviewPanel document={document} example={currentExample} onRestore={loadExample} status={simulation.status} diagnostics={circuitIssues} netlist={simulation.netlist} onInspect={inspectComponent} onOpenCircuit={() => openTab('circuit')} onViewResults={() => openTab('results')} />
        </div>
        <div className="workspace-panel" id="workspace-panel-documentation" role="tabpanel" aria-labelledby="workspace-tab-documentation" hidden={workspaceTab !== 'documentation'}>
          <DocumentationPanel document={document} onChange={change} onMessage={message} />
        </div>
      </div>
      {inspectorOpen && (
        <Inspector
          onEditModel={model => setModelEditor({ initial: model, editing: true })}
          onCreateModel={part => setModelEditor({ initial: customTemplate(part.kind as 'resistor' | 'capacitor', part.value), editing: false })}
          document={document} selectedId={selectedId} onChange={change} onDelete={deleteSelection}
          colors={WIRE_COLORS} operatingPoint={operatingPoint} nodeByTerminal={simulation.nodeByTerminal}
          editingLead={editingLead} onStartLeadEdit={startLeadEdit} onFinishLeadEdit={finishLeadEdit}
        />
      )}
    </main>
    <footer className="app-footer"><span><span className={`small-status-dot ${saved ? '' : 'unsaved'}`} />{saved ? 'Browser recovery copy saved' : 'Browser recovery unavailable'}<span className="footer-separator">·</span>Export a file to keep a separate copy.</span><span className="copyright">© 2026 <a href="https://fredibach.com">Fredi Bach</a></span><span>Simulation runs locally.</span></footer>
    {notice && <div className="toast" role="status" aria-label="Workbench notification"><Info size={16} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
  </div></RecordingProvider>
}
