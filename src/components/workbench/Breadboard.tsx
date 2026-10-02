import { parsePlacement, resolvePartModel, nominalValue, partDisplayName, partValueSummary, type PartPlacement } from '@/lib/custom-components'
import { PICO_PINS } from '@/lib/pico/profile'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  HOLES, TERMINALS, PARTS, terminalById, compileCircuit, getPlacement, canPlace, formatValue, isValidFootprint,
} from '@/lib/circuit'
import type { CircuitDocument, Part, ComponentKind } from '@/lib/circuit'
import { hasEditableLeads, leadPlacementError, previewLeadPins, type LeadEdit } from '@/lib/part-editing'
import { PartGlyph } from './PartGlyph'
import { RecordedOled, RecordedLed, RecordedTerminalVoltage } from './Recording'
import { PicoBoard } from './PicoBoard'

type Tool = 'select' | 'wire' | 'probe1' | 'probe2' | ComponentKind
type Point = { x: number; y: number }
type Terminal = (typeof TERMINALS)[number]
type Move = { part: Part; start: Point; dragging: boolean; pins: string[] | null }

export interface BreadboardProps {
  document: CircuitDocument
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (document: CircuitDocument) => void
  placement?: PartPlacement
  tool: Tool
  rotation: number
  wireColor: string
  showConnections: boolean
  zoom: number
  onMessage: (message: string) => void
  highlightTerminal?: string | null
  editingLead?: LeadEdit | null
  onStartLeadEdit?: (edit: LeadEdit) => void
  onFinishLeadEdit?: () => void
}

const PART_KINDS = Object.keys(PARTS) as ComponentKind[]
const isPart = (tool: string): tool is ComponentKind => PART_KINDS.includes(tool as ComponentKind)
const PORTS = [
  { id: 'osc', label: 'SIGNAL OUT' },
  { id: 'cv', label: 'CV OUT' },
  { id: 'gnd', label: 'GROUND' },
  { id: 'vplus', label: '+12 V' },
  { id: 'vminus', label: '−12 V' },
  { id: 'eg', label: 'EG OUT' },
]

function nearestTerminal(point: Point, distance = 16): Terminal | null {
  let nearest: Terminal | null = null
  let best = distance * distance
  for (const terminal of TERMINALS) {
    const delta = (terminal.x - point.x) ** 2 + (terminal.y - point.y) ** 2
    if (delta < best) { nearest = terminal; best = delta }
  }
  return nearest
}

function wirePath(a: Point, b: Point, index = 0) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) < 40) {
    const bow = Math.min(76, Math.max(23, Math.abs(dy) * 0.3))
    return `M${a.x},${a.y} C${a.x - bow},${a.y + dy * 0.2} ${b.x - bow},${b.y - dy * 0.2} ${b.x},${b.y}`
  }
  const lift = Math.min(96, Math.max(28, Math.hypot(dx, dy) * 0.24)) + index % 3 * 5
  return `M${a.x},${a.y} C${a.x + dx * 0.16},${a.y - lift} ${b.x - dx * 0.16},${b.y - lift} ${b.x},${b.y}`
}

function translatedPins(part: Part, target: Terminal): string[] | null {
  const anchor = terminalById[part.pins[0]]
  if (!anchor) return null
  const pins: string[] = []
  for (const id of part.pins) {
    const source = terminalById[id]
    if (!source) return null
    const destination = HOLES.find(hole => hole.x === target.x + source.x - anchor.x && hole.y === target.y + source.y - anchor.y)
    if (!destination) return null
    pins.push(destination.id)
  }
  return isValidFootprint(part.kind, pins) ? pins : null
}

function makeId(prefix: string, document: CircuitDocument) {
  const used = new Set([...document.parts, ...document.wires].map(item => item.id.toLowerCase()))
  let value = 1
  while (used.has(`${prefix}${value}`.toLowerCase())) value++
  return `${prefix}${value}`
}

const PREFIXES: Record<ComponentKind, string> = { resistor: 'R', capacitor: 'C', electrolytic: 'C', inductor: 'L', diode: 'D', schottky: 'D', zener: 'D', led: 'LED', npn: 'Q', pnp: 'Q', potentiometer: 'P', switch: 'S', opamp: 'U', timer555: 'U', quadopamp: 'U', lm13700: 'U', ssd1306: 'OLED' }

export function Breadboard({ document, selectedId, onSelect, onChange, tool, placement, rotation, wireColor, showConnections, zoom, onMessage, highlightTerminal, editingLead, onStartLeadEdit, onFinishLeadEdit }: BreadboardProps) {
  const svg = useRef<SVGSVGElement>(null)
  const terminalElements = useRef(new Map<string, SVGCircleElement>())
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [inspectedTerminal, setInspectedTerminal] = useState<string | null>(null)
  const [focusId, setFocusId] = useState('a1')
  const [pointer, setPointer] = useState<Point | null>(null)
  const [wireStart, setWireStart] = useState<string | null>(null)
  const [editingWire, setEditingWire] = useState<{ id: string; moving: 'from' | 'to' } | null>(null)
  const [move, setMove] = useState<Move | null>(null)
  const [previousTool, setPreviousTool] = useState(tool)
  const [interactionDocument, setInteractionDocument] = useState(document)
  const moveRef = useRef<Move | null>(null)
  const suppressClick = useRef(false)
  if (previousTool !== tool || interactionDocument !== document) {
    setPreviousTool(tool)
    setInteractionDocument(document)
    setWireStart(null)
    setEditingWire(null)
    setMove(null)
  }
  const graph = useMemo(() => compileCircuit(document), [document])
  const strips = useMemo(() => {
    const groups = new Map<string, Terminal[]>()
    HOLES.forEach(hole => groups.set(hole.group, [...(groups.get(hole.group) ?? []), hole]))
    return [...groups.values()]
  }, [])
  const occupied = useMemo(() => new Set([
    ...document.parts.flatMap(part => part.pins),
    ...document.wires.flatMap(wire => [wire.from, wire.to]),
  ]), [document.parts, document.wires])
  const leadPart = editingLead && tool === 'select' && selectedId === editingLead.partId
    ? document.parts.find(part => part.id === editingLead.partId && hasEditableLeads(part)) : undefined

  const hover = hoverId ? terminalById[hoverId] : undefined
  const highlightSource = wireStart ?? hoverId ?? highlightTerminal ?? inspectedTerminal
  const highlightedNet = highlightSource ? graph.nodeByTerminal[highlightSource] : undefined
  const highlighted = new Set(highlightedNet ? graph.nets[highlightedNet] ?? [] : [])
  const previewPins = leadPart && editingLead && hover ? previewLeadPins(leadPart, editingLead.pinIndex, hover.id)
    : move?.dragging ? move.pins : isPart(tool) && hover ? getPlacement(tool, hover.id, rotation) : null
  const previewKind = leadPart?.kind ?? (move?.dragging ? move.part.kind : isPart(tool) ? tool : null)
  const placementValid = leadPart && editingLead && hover
    ? leadPlacementError(document, leadPart, editingLead.pinIndex, hover.id) === null
    : !!previewPins && !!previewKind && isValidFootprint(previewKind, previewPins) && canPlace(document, previewPins, move?.part.id)

  useEffect(() => {
    if (!leadPart || !editingLead) return
    // A new explicit lead edit supersedes any unfinished wire or whole-part drag.
    // oxlint-disable-next-line react/set-state-in-effect
    setWireStart(null)
    setEditingWire(null)
    setMove(null)
    moveRef.current = null
    terminalElements.current.get(leadPart.pins[editingLead.pinIndex])?.focus()
  }, [leadPart, editingLead])

  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('.pico-panel'))) return
      if (leadPart) {
        event.preventDefault()
        onFinishLeadEdit?.()
        onMessage('Lead move cancelled.')
      }
      setWireStart(null)
      setEditingWire(null)
      setMove(null)
      moveRef.current = null
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [leadPart, onFinishLeadEdit, onMessage])

  useEffect(() => {
    moveRef.current = null
  }, [document, tool])

  function localPoint(clientX: number, clientY: number): Point {
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return { x: 0, y: 0 }
    const position = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    return { x: position.x, y: position.y }
  }

  function place(selection: PartPlacement, terminal: Terminal) {
    const { kind, customModelId } = selection
    const model = resolvePartModel(document, selection)
    if (document.parts.length >= 30) {
      onMessage('This workbench supports up to 30 components. Remove a component before adding another.')
      return
    }
    const pins = getPlacement(kind, terminal.id, rotation)
    if (!pins || !canPlace(document, pins)) {
      onMessage(PARTS[kind].package
        ? `Place all ${PARTS[kind].pinNames.length} IC pins across the center trench. Start on row E, or rotate to start on row F.`
        : `Choose ${PARTS[kind].pinNames.length} free holes for the component. Press R to rotate.`)
      return
    }
    const part: Part = { id: makeId(PREFIXES[kind], document), kind, value: model ? nominalValue(model) : PARTS[kind].defaultValue, pins, ...(customModelId ? { customModelId } : {}), ...(kind === 'potentiometer' ? { position: 0.5 } : {}) }
    onChange({ ...document, parts: [...document.parts, part] })
    onSelect(part.id)
    onMessage(`${part.id}${model ? ` (${model.name})` : ''} placed. Select it to ${PARTS[kind].package ? 'inspect its pins and model' : 'change its value'}.`)
  }

  function clickTerminal(terminal: Terminal) {
    setFocusId(terminal.id)
    if (leadPart && editingLead) {
      const error = leadPlacementError(document, leadPart, editingLead.pinIndex, terminal.id)
      if (error) { onMessage(error); return }
      const pins = previewLeadPins(leadPart, editingLead.pinIndex, terminal.id)!
      if (pins[editingLead.pinIndex] !== leadPart.pins[editingLead.pinIndex]) {
        onChange({ ...document, parts: document.parts.map(part => part.id === leadPart.id ? { ...part, pins } : part) })
        onMessage(`${leadPart.id} lead moved. Jumper wires and probes stay attached to their holes.`)
      } else onMessage('Lead kept in its current hole.')
      onFinishLeadEdit?.()
      return
    }
    if (isPart(tool) && !wireStart) { place(placement ?? { kind: tool }, terminal); return }
    if (tool === 'probe1' || tool === 'probe2') {
      const channel = tool === 'probe1' ? 'CH1' : 'CH2'
      onChange({ ...document, probes: { ...document.probes, [channel]: terminal.id } })
      onMessage(`${channel} attached to ${terminal.id.toUpperCase()}.`)
      return
    }
    if (tool === 'wire' || wireStart) {
      if (!wireStart) {
        if (occupied.has(terminal.id)) {
          onMessage('That hole already contains a lead. Use another hole on the same connected strip.')
          return
        }
        setWireStart(terminal.id)
        onMessage(`Wire from ${terminal.id.toUpperCase()}. Choose a free destination, or Escape to cancel.`)
        return
      }
      if (terminal.id === wireStart) { setWireStart(null); setEditingWire(null); return }
      if (!editingWire && document.wires.length >= 120) {
        onMessage('This workbench supports up to 120 jumper wires. Remove a wire before adding another.')
        return
      }
      if (!canPlace(document, [wireStart, terminal.id], editingWire?.id)) {
        onMessage('That hole already contains a lead. Choose a free hole on the strip.')
        return
      }
      const id = editingWire?.id ?? makeId('W', document)
      const wires = editingWire
        ? document.wires.map(wire => wire.id === id ? { ...wire, [editingWire.moving]: terminal.id } : wire)
        : [...document.wires, { id, from: wireStart, to: terminal.id, color: wireColor }]
      onChange({ ...document, wires })
      onSelect(id)
      setWireStart(null)
      setEditingWire(null)
      onMessage(editingWire ? 'Wire endpoint moved.' : 'Jumper connected. Choose another starting point to add a wire.')
      return
    }
    onSelect(null)
    setInspectedTerminal(terminal.id)
    onMessage(`${terminal.id.toUpperCase()} · ${highlighted.size} electrically connected terminals`)
  }

  function terminalKey(event: KeyboardEvent<SVGCircleElement>, terminal: Terminal) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      clickTerminal(terminal)
      return
    }
    const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    event.stopPropagation()
    const candidate = TERMINALS.filter(other => (document.pico || !other.id.startsWith('pico:'))).filter(other => (other.x - terminal.x) * direction.x + (other.y - terminal.y) * direction.y > 0)
      .sort((a, b) => {
        const score = (item: Terminal) => Math.hypot(item.x - terminal.x, item.y - terminal.y) + Math.abs((item.x - terminal.x) * direction.y - (item.y - terminal.y) * direction.x) * 5
        return score(a) - score(b)
      })[0]
    if (candidate) { setFocusId(candidate.id); terminalElements.current.get(candidate.id)?.focus() }
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const point = localPoint(event.clientX, event.clientY)
    const nearest = nearestTerminal(point)
    setPointer(point)
    setHoverId(nearest?.id ?? null)
    const current = moveRef.current
    if (!current) return
    const dragging = current.dragging || Math.hypot(point.x - current.start.x, point.y - current.start.y) > 5
    // Preserve where the pointer grabbed the part while snapping its first lead.
    const first = terminalById[current.part.pins[0]]
    const anchor = nearestTerminal({ x: first.x + point.x - current.start.x, y: first.y + point.y - current.start.y }, 20)
    const next = { ...current, dragging, pins: anchor ? translatedPins(current.part, anchor) : null }
    moveRef.current = next
    setMove(next)
  }

  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const current = moveRef.current
    if (!current) return
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId)
    // SVG pointer capture retargets the subsequent click to the board even
    // without a drag. Preserve the part selected on pointer-down.
    suppressClick.current = true
    window.setTimeout(() => { suppressClick.current = false }, 0)
    if (current.dragging) {
      if (current.pins && canPlace(document, current.pins, current.part.id)) {
        if (current.pins[0] !== current.part.pins[0]) {
          onChange({ ...document, parts: document.parts.map(part => part.id === current.part.id ? { ...part, pins: current.pins! } : part) })
          onMessage(`${current.part.id} moved. Jumper wires remain attached to their holes.`)
        }
      } else onMessage('Move cancelled: all leads need free holes that fit the component.')
    }
    moveRef.current = null
    setMove(null)
  }

  function renderPart(part: Part, preview = false) {
    const terminals = part.pins.map(id => terminalById[id])
    if (terminals.some(terminal => !terminal)) return null
    const dipPackage = !!PARTS[part.kind].package
    const a = terminals[0]
    const b = terminals[dipPackage ? terminals.length / 2 - 1 : terminals.length - 1]
    if (!a || !b) return null
    const radians = Math.atan2(b.y - a.y, b.x - a.x)
    const angle = radians * 180 / Math.PI
    const center = {
      x: (Math.min(...terminals.map(terminal => terminal.x)) + Math.max(...terminals.map(terminal => terminal.x))) / 2,
      y: (Math.min(...terminals.map(terminal => terminal.y)) + Math.max(...terminals.map(terminal => terminal.y))) / 2,
    }
    const pins = terminals.map(terminal => ({
      x: (terminal.x - center.x) * Math.cos(radians) + (terminal.y - center.y) * Math.sin(radians),
      y: -(terminal.x - center.x) * Math.sin(radians) + (terminal.y - center.y) * Math.cos(radians),
    }))
    const span = Math.hypot(b.x - a.x, b.y - a.y)
    const threeLeadPackage = part.kind === 'potentiometer' || part.kind === 'npn' || part.kind === 'pnp'
    const bounds = part.kind === 'ssd1306' ? { x: -77, y: -5, width: 154, height: 119 } : dipPackage
      ? { x: -span / 2 - 15, y: -35, width: span + 30, height: 74 }
      : threeLeadPackage
        ? { x: -span / 2 - 8, y: -45, width: span + 16, height: 56 }
        : { x: -span / 2 - 5, y: -23, width: span + 10, height: 46 }
    const labelY = part.kind === 'ssd1306' ? Math.abs(angle) > 135 ? -138 : 118 : dipPackage ? 43
      : threeLeadPackage ? Math.abs(angle) > 135 ? 48 : Math.abs(angle) > 45 ? 34 : 13
        : Math.abs(angle) > 45 && Math.abs(angle) < 135 ? -11 : 22
    const label = part.customModelId ? `${part.id} ◆ ${formatValue(part.value, part.kind)} nom.` : `${part.id} · ${partValueSummary(document, part)}`
    const labelWidth = part.customModelId ? Math.max(110, label.length * 5.8 + 12) : part.kind === 'ssd1306' ? 145 : dipPackage ? Math.max(110, label.length * 6 + 12) : part.kind === 'npn' || part.kind === 'pnp' ? 110 : 68
    const labelX = terminals.length === 2 && Math.abs(angle) > 45 && Math.abs(angle) < 135 ? 54 : 0
    return <g key={part.id}
      data-part={preview ? undefined : part.id}
      data-part-preview={preview ? part.kind : undefined}
      transform={`translate(${center.x} ${center.y})`}
      opacity={preview ? 0.7 : leadPart?.id === part.id || move?.dragging && move.part.id === part.id ? 0.28 : 1}
      role={preview ? undefined : 'button'} tabIndex={preview || leadPart ? undefined : 0}
      aria-label={preview ? undefined : `${partDisplayName(document, part)}. ${part.id} · ${partValueSummary(document, part)}. Drag to move or select to edit.`}
      style={{ cursor: preview ? 'none' : tool === 'select' ? 'grab' : 'pointer', outline: 'none', pointerEvents: preview || leadPart ? 'none' : 'auto' }}
      onPointerDown={preview ? undefined : event => {
        event.stopPropagation()
        if (tool !== 'select' || event.button !== 0 || wireStart) return
        onSelect(part.id)
        const next: Move = { part, start: localPoint(event.clientX, event.clientY), dragging: false, pins: part.pins }
        moveRef.current = next
        setMove(next)
        svg.current?.setPointerCapture(event.pointerId)
      }}
      onFocus={preview ? undefined : () => onSelect(part.id)}
      onClick={preview ? undefined : event => {
        event.stopPropagation()
        if (suppressClick.current) return
        if (tool === 'probe1' || tool === 'probe2') {
          const point = localPoint(event.clientX, event.clientY)
          const closest = terminals.reduce((nearest, terminal) => Math.hypot(point.x - terminal.x, point.y - terminal.y) < Math.hypot(point.x - nearest.x, point.y - nearest.y) ? terminal : nearest)
          clickTerminal(closest)
        } else onSelect(part.id)
      }}
      onKeyDown={preview ? undefined : event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(part.id); return }
        const delta: Record<string, Point> = { ArrowLeft: { x: -24, y: 0 }, ArrowRight: { x: 24, y: 0 }, ArrowUp: { x: 0, y: -24 }, ArrowDown: { x: 0, y: 24 } }
        const direction = delta[event.key]
        if (!direction || tool !== 'select') return
        event.preventDefault()
        event.stopPropagation()
        const target = nearestTerminal({ x: a.x + direction.x, y: a.y + direction.y }, 8)
        const pins = target ? translatedPins(part, target) : null
        if (pins && canPlace(document, pins, part.id)) {
          onChange({ ...document, parts: document.parts.map(item => item.id === part.id ? { ...item, pins } : item) })
        } else onMessage('No free placement in that direction.')
      }}>
      <title>{partDisplayName(document, part)} · {label} · {part.pins.map((pin, index) => `${index + 1}: ${PARTS[part.kind].pinNames[index]} at ${pin.toUpperCase()}`).join(' · ')}</title>
      <g transform={`rotate(${angle})`}>
        <rect {...bounds} fill="transparent" />
        {part.kind === 'ssd1306' && !preview ? <RecordedOled partId={part.id} kind={part.kind} pins={pins} selected={selectedId === part.id} /> : part.kind === 'led' && !preview ? <RecordedLed partId={part.id} kind={part.kind} value={part.value} span={span} pins={pins} selected={selectedId === part.id} /> : <PartGlyph kind={part.kind} value={part.value} position={part.position} span={span} pins={pins} pinNames={PARTS[part.kind].pinNames} selected={preview || selectedId === part.id} />}
      </g>
      {!preview && <g pointerEvents="none">
        <rect x={labelX - labelWidth / 2} y={labelY} width={labelWidth} height={17} rx={4} fill="#eeeee3" fillOpacity={0.95} />
        <text x={labelX} y={labelY + 12} textAnchor="middle" fill="#586054" fontSize={9.5} fontWeight={600} fontFamily="'Geist Mono', monospace">{label}</text>
      </g>}
    </g>
  }

  const cursor = tool === 'select' && !wireStart && !leadPart ? 'default' : 'crosshair'
  const wireSource = wireStart ? terminalById[wireStart] : null
  return <svg ref={svg} className="breadboard-svg" data-fit={zoom === 1} viewBox={`0 0 ${document.pico ? 1110 : 920} 550`} width={(document.pico ? 1110 : 920) * zoom} height={550 * zoom}
    style={{ display: 'block', width: `${zoom * 100}%`, minWidth: 670 * zoom, height: 'auto', flexShrink: 0, userSelect: 'none', touchAction: 'none', cursor }}
    aria-label="Interactive breadboard. Use arrow keys to move between holes; Enter connects or places the selected tool."
    onPointerMove={pointerMove} onPointerUp={pointerUp}
    onPointerCancel={() => { moveRef.current = null; setMove(null) }}
    onPointerLeave={() => { if (!moveRef.current) { setHoverId(null); setPointer(null) } }}
    onClick={() => { if (!suppressClick.current && !leadPart) { onSelect(null); setInspectedTerminal(null) } }}
    onDragOver={event => {
      if (!event.dataTransfer.types.includes('application/labor-part')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      const point = localPoint(event.clientX, event.clientY)
      setHoverId(nearestTerminal(point)?.id ?? null)
      setPointer(point)
    }}
    onDrop={event => {
      event.preventDefault()
      if (leadPart) { onFinishLeadEdit?.(); return }
      const selection = parsePlacement(event.dataTransfer.getData('application/labor-part'), document)
      const terminal = nearestTerminal(localPoint(event.clientX, event.clientY))
      if (selection && terminal) place(selection, terminal)
    }}>
    <defs>
      <filter id="wire-shadow" x="-30%" y="-60%" width="160%" height="240%"><feDropShadow dx="0" dy="2" stdDeviation="1" floodColor="#171713" floodOpacity="0.3" /></filter>
      <linearGradient id="breadboard-pcb" x1="0" y1="0" x2="0.7" y2="1"><stop stopColor="#303435" /><stop offset="0.45" stopColor="#222626" /><stop offset="1" stopColor="#191d1d" /></linearGradient>
      <linearGradient id="breadboard-plastic" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#f3f0df" /><stop offset="0.5" stopColor="#e8e7d7" /><stop offset="1" stopColor="#d6d8c9" /></linearGradient>
      <linearGradient id="breadboard-edge" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fffbea" /><stop offset="0.75" stopColor="#dadcce" /><stop offset="1" stopColor="#999e90" /></linearGradient>
      <linearGradient id="breadboard-trench" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#92998b" /><stop offset="0.24" stopColor="#c2c8b9" /><stop offset="1" stopColor="#e1e4d5" /></linearGradient>
      <linearGradient id="socket-metal" x1="0" y1="0" x2="0.9" y2="1"><stop stopColor="#f4f3dc" /><stop offset="0.22" stopColor="#c5c9be" /><stop offset="0.45" stopColor="#727c78" /><stop offset="0.58" stopColor="#dfe1cf" /><stop offset="0.84" stopColor="#8e9890" /><stop offset="1" stopColor="#e8e7d2" /></linearGradient>
      <linearGradient id="hardware-steel" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#8c9794" /><stop offset="0.28" stopColor="#eef0df" /><stop offset="0.5" stopColor="#aab5ad" /><stop offset="0.72" stopColor="#5c6864" /><stop offset="1" stopColor="#c5cec2" /></linearGradient>
    </defs>

    <g aria-hidden="true" pointerEvents="none">
      <rect x={3} y={2} width={914} height={548} rx={5} fill="url(#breadboard-pcb)" stroke="#4b504c" />
      <path d="M10 74H910M10 532H910" stroke="#535b54" strokeOpacity={0.4} />
      <path d="M34 104V205L15 224V458M886 114V246L906 266V443M37 452V486L15 508M882 315V385L907 410" fill="none" stroke="#626958" strokeWidth={1} opacity={0.18} />
      <text transform="translate(28 386) rotate(-90)" fill="none" stroke="#c5d0c7" strokeWidth={0.7} fontSize={25} fontWeight={500} letterSpacing={4}>LABOR</text>
      <text transform="translate(28 227) rotate(-90)" fill="#acb6ad" fontSize={5.5} fontFamily="monospace" letterSpacing={1}>ERICA SYNTHS · EDU</text>
      {[{ x: 24, y: 33 }, { x: 896, y: 33 }, { x: 23, y: 91 }, { x: 897, y: 91 }, { x: 23, y: 516 }, { x: 897, y: 516 }].map(({ x, y }) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
        <circle cy={2} r={11} fill="#090e0d" opacity={0.75} />
        <path d="M-5-9H5L10 0 5 9H-5L-10 0Z" fill="url(#hardware-steel)" stroke="#7b8781" strokeWidth={0.7} />
        <circle r={6.3} fill="#aeb9ae" stroke="#dde2d5" strokeWidth={0.9} />
        <circle r={4.7} fill="#65716a" />
        <path d="M-3.8 0H3.8M0-3.8V3.8" stroke="#151d19" strokeWidth={2.1} transform="rotate(28)" />
        <path d="M-6-5A8 8 0 0 1 5-6" fill="none" stroke="#f9f6df" strokeWidth={1.2} opacity={0.75} />
      </g>)}
      <rect x={47} y={84} width={828} height={445} rx={5} fill="#080c0a" opacity={0.65} />
      <rect x={46} y={79} width={828} height={446} rx={5} fill="url(#breadboard-edge)" stroke="#b0b5a6" strokeWidth={1} />
      <rect x={52} y={83} width={816} height={433} rx={2} fill="url(#breadboard-plastic)" />
      <rect x={55} y={85} width={810} height={60} rx={1} fill="url(#breadboard-plastic)" stroke="#c7cebf" strokeWidth={0.7} />
      <rect x={55} y={150} width={810} height={132} rx={1} fill="url(#breadboard-plastic)" />
      <rect x={55} y={310} width={810} height={140} rx={1} fill="url(#breadboard-plastic)" />
      <rect x={55} y={454} width={810} height={55} rx={1} fill="url(#breadboard-plastic)" stroke="#c0c8b8" strokeWidth={0.7} />
      <path d="M55 146H865M55 452H865" stroke="#909c8d" strokeWidth={1} opacity={0.65} />
      <path d="M55 148H865M55 453H865M56 86H864M53 513H867" stroke="#fffdef" strokeWidth={1.4} opacity={0.8} />
      <rect x={54} y={283} width={812} height={27} fill="url(#breadboard-trench)" />
      <path d="M56 283H864" stroke="#8b9487" />
      <path d="M56 310H864" stroke="#fffdee" strokeWidth={1.5} />
      <text x={75} y={300} fill="#778475" fontSize={6.8} fontFamily="monospace" letterSpacing={1}>SOLDERLESS BREADBOARD</text>
      <text x={844} y={300} textAnchor="end" fill="#778475" fontSize={6.8} fontFamily="monospace" letterSpacing={0.6}>30 × 10 · SPLIT RAILS</text>
      {[0, 1].map(segment => <g key={segment}>
        {[{ y: 89, color: '#b95548' }, { y: 138, color: '#647e88' }, { y: 457, color: '#b95548' }, { y: 505, color: '#647e88' }].map(line => <path key={line.y} d={`M${90 + segment * 360} ${line.y}H${443 + segment * 360}`} stroke={line.color} strokeWidth={1.6} />)}
      </g>)}
      {[{ y: 104, text: '+', color: '#b95548' }, { y: 128, text: '−', color: '#647e88' }, { y: 472, text: '+', color: '#b95548' }, { y: 496, text: '−', color: '#647e88' }].map(label => <g key={label.y} fill={label.color} fontSize={13} fontWeight={500} textAnchor="middle"><text x={71} y={label.y}>{label.text}</text><text x={846} y={label.y}>{label.text}</text></g>)}
      {Array.from({ length: 30 }, (_, index) => index + 1).map(column => <g key={column} fill="#536258" fontSize={8} textAnchor="middle" fontFamily="monospace"><text x={100 + (column - 1) * 24} y={157}>{column}</text><text x={100 + (column - 1) * 24} y={442}>{column}</text></g>)}
      {'abcdefghij'.split('').map((row, index) => <g key={row} fill="#536258" fontSize={8.5} fontFamily="monospace" textAnchor="middle"><text x={71} y={173 + index * 24 + (index > 4 ? 36 : 0)}>{row.toUpperCase()}</text><text x={846} y={173 + index * 24 + (index > 4 ? 36 : 0)}>{row.toUpperCase()}</text></g>)}
      {strips.map(group => {
        const first = group[0], last = group[group.length - 1]
        const active = group.some(hole => highlighted.has(hole.id))
        if (!showConnections && !active) return null
        return <path key={first.group} d={`M${first.x} ${first.y}L${last.x} ${last.y}`} stroke={active ? '#bfd77d' : '#b6c0a3'} strokeWidth={active ? 13 : 8} strokeLinecap="round" opacity={active ? 0.55 : 0.25} />
      })}
      {HOLES.map(hole => <g key={hole.id}>
        <rect x={hole.x - 4.2} y={hole.y - 4.2} width={8.4} height={8.4} rx={0.6} fill="#c2c6b3" />
        <path d={`M${hole.x - 4.2} ${hole.y + 4.2}H${hole.x + 4.2}V${hole.y - 4.2}`} fill="none" stroke="#fffbe7" strokeWidth={0.85} opacity={0.9} />
        <rect x={hole.x - 3} y={hole.y - 3.2} width={6} height={6.2} rx={0.45} fill={highlighted.has(hole.id) ? '#6d8550' : '#3e4436'} />
        <rect x={hole.x - 1.9} y={hole.y - 2.2} width={3.8} height={4.2} rx={0.25} fill={highlighted.has(hole.id) ? '#556c3e' : '#222a22'} />
        <path d={`M${hole.x - 1.7} ${hole.y + 2.1}H${hole.x + 1.7}`} stroke="#a1a083" strokeWidth={0.75} />
      </g>)}
      {PORTS.map(port => {
        const terminal = terminalById[port.id]
        if (!terminal) return null
        return <g key={port.id}>
          <text x={terminal.x} y={21} textAnchor="middle" fill="#cbd5cc" fontSize={9} letterSpacing={0.8} fontFamily="monospace">{port.label}</text>
          <circle cx={terminal.x} cy={terminal.y + 2} r={15.5} fill="#0b100e" opacity={0.8} />
          <path transform={`translate(${terminal.x} ${terminal.y}) rotate(15)`} d="M-7-12H7L14 0 7 12H-7L-14 0Z" fill="url(#socket-metal)" stroke="#89938b" strokeWidth={0.8} />
          <circle cx={terminal.x} cy={terminal.y} r={11.3} fill="#151d18" stroke="#d5dbca" strokeWidth={1.5} />
          <circle cx={terminal.x} cy={terminal.y} r={8.7} fill="url(#socket-metal)" />
          <circle cx={terminal.x} cy={terminal.y} r={6.8} fill="#0c120e" stroke="#777c65" strokeWidth={1.1} />
          <path d={`M${terminal.x - 6} ${terminal.y - 9}A11 11 0 0 1 ${terminal.x + 7} ${terminal.y - 8}`} fill="none" stroke="#faf3d3" strokeWidth={1.2} />
          {highlighted.has(port.id) && <circle cx={terminal.x} cy={terminal.y} r={17} fill="none" stroke="#c6df8e" strokeWidth={1.2} strokeDasharray="3 3" />}
        </g>
      })}
    </g>

    {document.pico && <PicoBoard />}

    {TERMINALS.filter(terminal => document.pico || !terminal.id.startsWith('pico:')).map(terminal => <circle key={terminal.id} data-terminal={terminal.id}
      ref={element => { if (element) terminalElements.current.set(terminal.id, element); else terminalElements.current.delete(terminal.id) }}
      cx={terminal.x} cy={terminal.y} r={10} fill="transparent" stroke={hoverId === terminal.id ? '#97b652' : 'transparent'} strokeWidth={1.5}
      role="button" tabIndex={terminal.id === focusId ? 0 : -1}
      aria-label={`${terminal.id.startsWith('pico:') ? `Pico pin ${PICO_PINS.find(pin => pin.id === terminal.id)?.number} ${PICO_PINS.find(pin => pin.id === terminal.id)?.label}` : terminal.id.toUpperCase()}${occupied.has(terminal.id) ? ', occupied' : ', available'}`}
      style={{ outline: 'none' }}
      onFocus={() => { setHoverId(terminal.id); setFocusId(terminal.id) }}
      onClick={event => { event.stopPropagation(); if (!suppressClick.current) clickTerminal(terminal) }}
      onKeyDown={event => terminalKey(event, terminal)}>
      <title>{terminal.id.toUpperCase()} · {terminal.group}{occupied.has(terminal.id) ? ' · occupied' : ''}</title>
    </circle>)}

    {document.wires.map((wire, index) => {
      const a = terminalById[wire.from], b = terminalById[wire.to]
      if (!a || !b) return null
      const path = wirePath(a, b, index)
      const selected = wire.id === selectedId
      return <g key={wire.id} data-wire={wire.id} role="button" tabIndex={leadPart ? undefined : 0} aria-label={`${wire.id}, jumper from ${wire.from} to ${wire.to}`}
        style={{ cursor: 'pointer', outline: 'none', pointerEvents: leadPart ? 'none' : 'auto' }}
        onFocus={() => onSelect(wire.id)}
        onClick={event => {
          event.stopPropagation()
          if (tool === 'probe1' || tool === 'probe2') {
            const point = localPoint(event.clientX, event.clientY)
            clickTerminal(Math.hypot(point.x - a.x, point.y - a.y) < Math.hypot(point.x - b.x, point.y - b.y) ? a : b)
          } else onSelect(wire.id)
        }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(wire.id) } }}>
        <title>{wire.id} · {wire.from.toUpperCase()} → {wire.to.toUpperCase()}{selected ? ' · click an endpoint to move it' : ''}</title>
        <path d={path} fill="none" stroke="transparent" strokeWidth={14} />
        {selected && <path d={path} fill="none" stroke="#f0f7ce" strokeWidth={8} opacity={0.95} />}
        <path d={path} fill="none" stroke={wire.color} strokeWidth={4.8} strokeLinecap="round" filter="url(#wire-shadow)" pointerEvents="none" />
        <path d={path} fill="none" stroke="#fff" strokeOpacity={0.15} strokeWidth={1.1} strokeLinecap="round" transform="translate(0 -0.7)" pointerEvents="none" />
        {[{ terminal: a, end: 'from' as const }, { terminal: b, end: 'to' as const }].map(({ terminal, end }) => <g key={end}>
          <circle cx={terminal.x} cy={terminal.y} r={4} fill={wire.color} stroke="#263b2a" strokeWidth={0.8} />
          {selected && tool === 'select' && <circle cx={terminal.x} cy={terminal.y} r={8} fill="transparent" stroke="#f0f7ce" strokeWidth={2}
            onClick={event => {
              event.stopPropagation()
              setEditingWire({ id: wire.id, moving: end })
              setWireStart(end === 'from' ? wire.to : wire.from)
              onMessage(`Move ${wire.id}: choose a free hole for its ${end === 'from' ? 'first' : 'second'} endpoint.`)
            }} />}
        </g>)}
      </g>
    })}

    {document.parts.map(part => renderPart(part))}

    {!leadPart && tool === 'select' && onStartLeadEdit && document.parts.filter(part => part.id === selectedId && hasEditableLeads(part)).flatMap(part => part.pins.map((pin, pinIndex) => {
      const terminal = terminalById[pin]
      const name = `Move ${part.id} lead ${PARTS[part.kind].pinNames[pinIndex]}`
      const start = () => onStartLeadEdit({ partId: part.id, pinIndex })
      return <circle key={`${part.id}-${pinIndex}`} data-lead-handle={`${part.id}-${pinIndex}`} cx={terminal.x} cy={terminal.y} r={7}
        fill="transparent" stroke="#d3e7a6" strokeWidth={1.8} strokeDasharray="2 2" role="button" tabIndex={0} aria-label={name}
        style={{ cursor: 'crosshair' }} onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); start() }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); start() } }}><title>{name}</title></circle>
    }))}

    {(['CH1', 'CH2'] as const).map((channel, index) => {
      const attachment = document.probes[channel]
      const terminal = attachment ? terminalById[attachment] : null
      if (!terminal) return null
      const color = index === 0 ? '#c0dc88' : '#e6ad6c'
      const offset = index === 0 ? -31 : 31
      return <g key={channel} pointerEvents="none" aria-label={`${channel} attached to ${terminal.id}`}>
        <path d={`M${terminal.x},${terminal.y}L${terminal.x + offset},${terminal.y - 28}`} fill="none" stroke="#263529" strokeWidth={4} />
        <path d={`M${terminal.x},${terminal.y}L${terminal.x + offset},${terminal.y - 28}`} fill="none" stroke={color} strokeWidth={2.4} />
        <circle cx={terminal.x} cy={terminal.y} r={5.7} fill="none" stroke={color} strokeWidth={2} />
        <rect x={terminal.x + offset - 18} y={terminal.y - 45} width={36} height={18} rx={4} fill={color} stroke="#546343" strokeWidth={0.6} />
        <text x={terminal.x + offset} y={terminal.y - 32} textAnchor="middle" fill="#34442d" fontSize={9} fontWeight={800} fontFamily="monospace">{channel}</text>
      </g>
    })}

    {wireSource && (hover || pointer) && <g pointerEvents="none">
      <circle cx={wireSource.x} cy={wireSource.y} r={8} fill="none" stroke={wireColor} strokeWidth={2} />
      <path d={wirePath(wireSource, hover ?? pointer!)} fill="none" stroke={wireColor} strokeWidth={4} strokeDasharray="7 5" opacity={0.8} />
    </g>}
    {previewPins && previewKind && <g pointerEvents="none" data-lead-preview={leadPart ? placementValid ? 'valid' : 'invalid' : undefined}>
      {previewPins.map((id, index) => { const terminal = terminalById[id]; return terminal && <circle key={`${id}-${index}`} cx={terminal.x} cy={terminal.y} r={9} fill={placementValid ? '#bad279' : '#df7662'} fillOpacity={0.3} stroke={placementValid ? '#819e45' : '#c04e3e'} strokeWidth={1.8} /> })}
      {renderPart({ ...(leadPart ?? (move?.dragging ? move.part : { kind: previewKind, ...(placement?.customModelId ? { customModelId: placement.customModelId } : {}), value: placement && resolvePartModel(document, placement) ? nominalValue(resolvePartModel(document, placement)!) : PARTS[previewKind].defaultValue })), id: 'preview', pins: previewPins }, true)}
    </g>}
    {highlightSource && <RecordedTerminalVoltage node={graph.nodeByTerminal[highlightSource]} x={770} y={546} />}
    {isPart(tool) && hover && !previewPins && <circle cx={hover.x} cy={hover.y} r={10} fill="#df7662" fillOpacity={0.24} stroke="#c04e3e" strokeWidth={1.8} pointerEvents="none" />}

    <g pointerEvents="none" aria-hidden="true">
      <text x={55} y={546} fill="#7b897c" fontSize={8.5} fontFamily="monospace" letterSpacing={0.4}>{hover ? `${hover.id.toUpperCase()}  /  ${highlighted.size} connected terminals` : 'RAILS ARE SPLIT AT 15 / 16 · CONNECT POWER WITH JUMPERS'}</text>
      <text x={866} y={546} fill="#7b897c" textAnchor="end" fontSize={8.5} fontFamily="monospace">{leadPart ? 'MOVE LEAD · 1–8 HOLE SPACINGS · ESC TO CANCEL' : wireStart ? 'CHOOSE DESTINATION · ESC TO CANCEL' : isPart(tool) ? 'CLICK TO PLACE · R TO ROTATE' : 'CLICK TO INSPECT · DRAG TO MOVE'}</text>
    </g>
  </svg>
}
