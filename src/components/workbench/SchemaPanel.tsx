import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { Download, Maximize2, Minus, Pause, Play, Plus, Zap } from 'lucide-react'
import { assignSchemaGroup, formatValue, SCHEMA_GROUP_NAME_LIMIT, type CircuitDocument } from '@/lib/circuit'
import { buildSchematic } from '@/lib/schematic'
import { RecordingContext } from '@/lib/recording-context'
import { SchematicDrawing } from './SchematicDrawing'
import './SchemaPanel.css'

const MIN_ZOOM = 0.01
const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(4, zoom))
type Point = { x: number; y: number }

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function SchemaPanel({ document, onChange, selectedId, onSelect, visible, recordingAvailable, recordingNote }: {
  document: CircuitDocument
  onChange: (document: CircuitDocument) => void
  selectedId: string | null
  onSelect: (id: string) => void
  visible: boolean
  recordingAvailable: boolean
  recordingNote?: string
}) {
  const layout = useMemo(() => buildSchematic(document), [document])
  const [showVoltages, setShowVoltages] = useState(false)
  const playback = useContext(RecordingContext)
  const subscribe = useCallback((listener: () => void) => visible && showVoltages ? playback.subscribe(listener) : () => {}, [visible, showVoltages, playback])
  const { seconds, playing, point } = useSyncExternalStore(subscribe, playback.getSnapshot, playback.getSnapshot)
  const available = recordingAvailable && !!playback.capture?.recording
  const [zoom, setZoom] = useState(1)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupSelection, setGroupSelection] = useState<string[]>([])
  const [groupMessage, setGroupMessage] = useState('')
  const viewport = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const fittedLayout = useRef('')
  const pendingPosition = useRef<Point | null>(null)
  const drag = useRef<{ id: number; start: Point; scroll: Point; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const sheetWidth = layout.width * zoom, sheetHeight = layout.height * zoom
  const spaceWidth = Math.max(size.width, sheetWidth + 48), spaceHeight = Math.max(size.height, sheetHeight + 48)
  const left = (spaceWidth - sheetWidth) / 2, top = (spaceHeight - sheetHeight) / 2
  const groupNames = [...new Set(document.parts.flatMap(part => part.schemaGroup ? [part.schemaGroup] : []))].sort()
  const selected = groupSelection.filter(id => document.parts.some(part => part.id === id))

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => {
      if (element.clientWidth && element.clientHeight) setSize(previous => previous.width === element.clientWidth && previous.height === element.clientHeight ? previous : { width: element.clientWidth, height: element.clientHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (!size.width || !size.height) return
    pendingPosition.current = { x: 0, y: 0 }
    setZoom(clampZoom(Math.min((size.width - 48) / layout.width, (size.height - 48) / layout.height, 1)))
    viewport.current?.scrollTo(0, 0)
  }, [layout.width, layout.height, size])

  useLayoutEffect(() => {
    const key = `${layout.width}:${layout.height}:${document.title}`
    if (visible && size.width && size.height && fittedLayout.current !== key) {
      fittedLayout.current = key
      fit()
    }
  }, [visible, layout.width, layout.height, document.title, size, fit])

  useLayoutEffect(() => {
    if (pendingPosition.current && viewport.current) {
      viewport.current.scrollTo(pendingPosition.current.x, pendingPosition.current.y)
      pendingPosition.current = null
    }
  }, [zoom])

  const zoomTo = useCallback((value: number, anchor?: Point) => {
    const element = viewport.current
    if (!element) return
    const next = clampZoom(value)
    const center = anchor ?? { x: size.width / 2, y: size.height / 2 }
    const sheetPoint = { x: (element.scrollLeft + center.x - left) / zoom, y: (element.scrollTop + center.y - top) / zoom }
    const nextLeft = (Math.max(size.width, layout.width * next + 48) - layout.width * next) / 2
    const nextTop = (Math.max(size.height, layout.height * next + 48) - layout.height * next) / 2
    pendingPosition.current = { x: nextLeft + sheetPoint.x * next - center.x, y: nextTop + sheetPoint.y * next - center.y }
    setZoom(next)
  }, [zoom, size, left, top, layout.width, layout.height])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const bounds = element.getBoundingClientRect()
      zoomTo(zoom * Math.exp(-event.deltaY * 0.008), { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [zoom, zoomTo])

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return
    if (event.button === 0 && (event.target as Element).closest('[data-schema-part]')) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, scroll: { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop }, moved: false }
    suppressClick.current = false
    setDragging(true)
  }

  function finishPan() {
    const gesture = drag.current
    if (!gesture) return
    drag.current = null
    suppressClick.current = gesture.moved
    if (viewport.current?.hasPointerCapture(gesture.id)) viewport.current.releasePointerCapture(gesture.id)
    setDragging(false)
    window.setTimeout(() => { suppressClick.current = false }, 0)
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomTo(zoom * 1.25) }
    if (event.key === '-') { event.preventDefault(); zoomTo(zoom / 1.25) }
    if (event.key === '0' || event.key.toLowerCase() === 'f') { event.preventDefault(); fit() }
    if (event.key === 'Escape') finishPan()
  }

  async function exportSchema(format: 'svg' | 'png') {
    const drawing = stage.current?.querySelector('svg')
    if (!drawing || exporting) return
    setExporting(true)
    setExportMessage('')
    let imageUrl: string | undefined
    try {
      const clone = drawing.cloneNode(true) as SVGSVGElement
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('width', String(layout.width))
      clone.setAttribute('height', String(layout.height))
      clone.querySelectorAll('[data-schema-selection]').forEach(element => element.remove())
      const source = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' })
      const filename = (document.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'circuit') + '-schema'
      if (format === 'svg') download(source, `${filename}.svg`)
      else {
        imageUrl = URL.createObjectURL(source)
        const image = new Image()
        image.src = imageUrl
        await image.decode()
        const scale = Math.min(2, 8192 / Math.max(layout.width, layout.height), Math.sqrt(16_000_000 / (layout.width * layout.height)))
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.round(layout.width * scale)
        canvas.height = Math.round(layout.height * scale)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Image export is unavailable in this browser.')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not export the image.')), 'image/png'))
        download(png, `${filename}.png`)
      }
      setExportMessage(`${format.toUpperCase()} exported${showVoltages && available ? ' with voltages at the current time' : ''}.`)
    } catch (error) { setExportMessage(error instanceof Error ? error.message : 'Schema export failed.') }
    finally { if (imageUrl) URL.revokeObjectURL(imageUrl); setExporting(false) }
  }

  function applyGroup(name: string) {
    onChange(assignSchemaGroup(document, selected, name))
    setGroupMessage(`${selected.length} ${selected.length === 1 ? 'component' : 'components'} ${name.trim() ? `in “${name.trim()}”` : 'ungrouped'}.`)
  }

  return <section className="schema-panel" aria-label="Schema">
    <header className="schema-heading"><div><h2>Circuit schema</h2><p>Electrical connections · {document.parts.length} components{groupNames.length ? ` · ${groupNames.length} groups` : ''}</p></div><div className="schema-exports">
      <button className="schema-button" aria-label="Export schema SVG" disabled={exporting} onClick={() => void exportSchema('svg')}><Download size={14} />SVG</button>
      <button className="schema-button" aria-label="Export schema PNG" disabled={exporting} onClick={() => void exportSchema('png')}><Download size={14} />PNG</button>
    </div></header>
    <div className="schema-toolbar"><label className="schema-voltage-toggle"><input type="checkbox" checked={showVoltages} onChange={event => setShowVoltages(event.target.checked)} aria-label="Show voltages" /><Zap size={14} /><span>Voltages</span></label><div className="schema-zoom">
      <button className="icon-button" aria-label="Zoom out schema" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom / 1.25)}><Minus size={15} /></button><output aria-label="Schema zoom">{Math.round(zoom * 100)}%</output><button className="icon-button" aria-label="Zoom in schema" disabled={zoom >= 4} onClick={() => zoomTo(zoom * 1.25)}><Plus size={15} /></button><button className="schema-button" aria-label="Fit schema" onClick={fit}><Maximize2 size={14} />Fit</button>
    </div></div>
    {showVoltages && <div className="schema-recording">
      <button className="icon-button" disabled={!available} aria-label={playing ? 'Pause schema recording' : 'Play schema recording'} onClick={playing ? playback.pause : playback.play}>{playing ? <Pause size={15} /> : <Play size={15} />}</button><input type="range" disabled={!available} aria-label="Schema timeline" min={playback.start} max={playback.end || 0.1} step="any" value={seconds} onChange={event => playback.seek(Number(event.target.value))} /><label><input type="number" disabled={!available} aria-label="Schema time milliseconds" min={playback.start * 1000} max={playback.end * 1000} step="any" value={Number((seconds * 1000).toFixed(4))} onChange={event => playback.seek(event.target.valueAsNumber / 1000)} /> ms</label>
      {available ? <span>Same position as Results · relative to GND</span> : <p role="status">{recordingNote ?? 'Simulate the current circuit to display recorded voltages.'}</p>}
    </div>}
    <div ref={viewport} className={`schema-viewport${dragging ? ' is-dragging' : ''}`} role="region" aria-label="Schematic view" tabIndex={0} aria-description="Drag the sheet or scroll to pan. Control or Command plus wheel zooms at the pointer. Use plus and minus to zoom, or F to fit." data-testid="schema-viewport" data-zoom={zoom} onKeyDown={keyboard}
      onPointerDownCapture={pointerDown} onPointerMove={event => {
        const gesture = drag.current
        if (!gesture || gesture.id !== event.pointerId) return
        const dx = event.clientX - gesture.start.x, dy = event.clientY - gesture.start.y
        if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true
        event.currentTarget.scrollTo(gesture.scroll.x - dx, gesture.scroll.y - dy)
      }} onPointerUp={finishPan} onPointerCancel={finishPan} onLostPointerCapture={finishPan} onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation() } }} onAuxClick={event => { if (event.button === 1) event.preventDefault() }}>
      <div className="schema-space" style={{ width: spaceWidth, height: spaceHeight }}><div ref={stage} className="schema-stage" style={{ width: sheetWidth, height: sheetHeight, left, top }}>
        <SchematicDrawing document={document} layout={layout} selectedId={selectedId} onSelect={onSelect} nodeVoltages={showVoltages && available ? point?.nodeVoltages : undefined} voltageTime={showVoltages && available ? seconds : undefined} />
      </div></div>
    </div>
    <div className="schema-caption"><span>Drag to pan · Ctrl / ⌘ + scroll to zoom · click a symbol to inspect</span><span>Matching net labels are connected.</span></div>
    <details className="schema-groups"><summary>Component groups{groupNames.length > 0 && <span>{groupNames.length}</span>}</summary><p>Give related components a name to place them together on the sheet. Groups are saved with your circuit.</p>
      {groupNames.length > 0 && <div className="schema-group-chips">{groupNames.map(name => <button key={name} className="schema-button" onClick={() => { setGroupName(name); setGroupSelection(document.parts.filter(part => part.schemaGroup === name).map(part => part.id)) }}>{name}<span>{document.parts.filter(part => part.schemaGroup === name).length}</span></button>)}</div>}
      {document.parts.length ? <><div className="schema-group-parts">{document.parts.map(part => <label key={part.id}><input type="checkbox" aria-label={`Group ${part.id}`} checked={selected.includes(part.id)} onChange={event => setGroupSelection(event.target.checked ? [...selected, part.id] : selected.filter(id => id !== part.id))} /><strong>{part.id}</strong><span>{formatValue(part.value, part.kind)}</span>{part.schemaGroup && <em>{part.schemaGroup}</em>}</label>)}</div><div className="schema-group-form"><label>Group name<input aria-label="Group name" placeholder="e.g. Input filter" maxLength={SCHEMA_GROUP_NAME_LIMIT} value={groupName} list="schema-existing-groups" onChange={event => setGroupName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && selected.length && groupName.trim()) { event.preventDefault(); applyGroup(groupName) } }} /></label><datalist id="schema-existing-groups">{groupNames.map(name => <option key={name} value={name} />)}</datalist><button className="schema-button" disabled={!selected.length || !groupName.trim()} onClick={() => applyGroup(groupName)}>Apply group</button><button className="schema-button" disabled={!selected.length || !selected.some(id => document.parts.find(part => part.id === id)?.schemaGroup)} onClick={() => applyGroup('')}>Ungroup selected</button><span>{selected.length} selected</span></div></> : <p>Add components in Circuit to create a group.</p>}
      <span role="status" className="schema-feedback">{groupMessage}</span>
    </details>
    <span className="schema-feedback" role="status">{exportMessage}</span>
  </section>
}
