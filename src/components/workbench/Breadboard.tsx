import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  HOLES, TERMINALS, PARTS, terminalById, compileCircuit, getPlacement, canPlace, formatValue, isValidFootprint,
} from '@/lib/circuit'
import type { CircuitDocument, Part, ComponentKind } from '@/lib/circuit'
import { hasEditableLeads, leadPlacementError, previewLeadPins, type LeadEdit } from '@/lib/part-editing'
import { PartGlyph } from './PartGlyph'

type Tool = 'select' | 'wire' | 'probe1' | 'probe2' | ComponentKind
type Point = { x: number; y: number }
type Terminal = (typeof TERMINALS)[number]
type Move = { part: Part; start: Point; dragging: boolean; pins: string[] | null }

export interface BreadboardProps {
  document: CircuitDocument
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (document: CircuitDocument) => void
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
  { id: 'osc', label: 'OSC OUT', color: '#a6c4b0' },
  { id: 'cv', label: 'CV OUT', color: '#abbca8' },
  { id: 'gnd', label: 'GROUND', color: '#a3b5c0' },
  { id: 'vplus', label: '+12 V', color: '#d78575' },
  { id: 'vminus', label: '−12 V', color: '#89aabf' },
  { id: 'eg', label: 'EG OUT', color: '#c3aad1' },
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

const PREFIXES: Record<ComponentKind, string> = { resistor: 'R', capacitor: 'C', electrolytic: 'C', diode: 'D', led: 'LED', potentiometer: 'P', switch: 'S', opamp: 'U' }

export function Breadboard({ document, selectedId, onSelect, onChange, tool, rotation, wireColor, showConnections, zoom, onMessage, highlightTerminal, editingLead, onStartLeadEdit, onFinishLeadEdit }: BreadboardProps) {
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
      if (event.key !== 'Escape') return
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

  function place(kind: ComponentKind, terminal: Terminal) {
    if (document.parts.length >= 30) {
      onMessage('This workbench supports up to 30 components. Remove a component before adding another.')
      return
    }
    const pins = getPlacement(kind, terminal.id, rotation)
    if (!pins || !canPlace(document, pins)) {
      onMessage(kind === 'opamp'
        ? 'Place all eight IC pins across the center trench. Start on row E, or rotate to start on row F.'
        : `Choose ${PARTS[kind].pinNames.length} free holes for the component. Press R to rotate.`)
      return
    }
    const part: Part = { id: makeId(PREFIXES[kind], document), kind, value: PARTS[kind].defaultValue, pins, ...(kind === 'potentiometer' ? { position: 0.5 } : {}) }
    onChange({ ...document, parts: [...document.parts, part] })
    onSelect(part.id)
    onMessage(`${part.id} placed. Select it to change its value.`)
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
    if (isPart(tool) && !wireStart) { place(tool, terminal); return }
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
    const candidate = TERMINALS.filter(other => (other.x - terminal.x) * direction.x + (other.y - terminal.y) * direction.y > 0)
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
    if (current.dragging) {
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
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
    const a = terminals[0]
    const b = terminals[part.kind === 'opamp' ? 3 : terminals.length - 1]
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
    const bounds = part.kind === 'opamp'
      ? { x: -51, y: -35, width: 102, height: 74 }
      : part.kind === 'potentiometer'
        ? { x: -span / 2 - 8, y: -45, width: span + 16, height: 56 }
        : { x: -span / 2 - 5, y: -23, width: span + 10, height: 46 }
    const labelY = part.kind === 'opamp' ? 43
      : part.kind === 'potentiometer' ? Math.abs(angle) > 135 ? 48 : Math.abs(angle) > 45 ? 34 : 13
        : Math.abs(angle) > 45 && Math.abs(angle) < 135 ? -11 : 22
    const label = `${part.id} · ${formatValue(part.value, part.kind)}`
    const labelWidth = part.kind === 'opamp' ? 110 : 68
    const labelX = terminals.length === 2 && Math.abs(angle) > 45 && Math.abs(angle) < 135 ? 54 : 0
    return <g key={part.id}
      data-part={preview ? undefined : part.id}
      transform={`translate(${center.x} ${center.y})`}
      opacity={preview ? 0.7 : leadPart?.id === part.id || move?.dragging && move.part.id === part.id ? 0.28 : 1}
      role={preview ? undefined : 'button'} tabIndex={preview || leadPart ? undefined : 0}
      aria-label={preview ? undefined : `${label}. Drag to move or select to edit.`}
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
      <title>{label} · {part.pins.map((pin, index) => `${index + 1}: ${PARTS[part.kind].pinNames[index]} at ${pin.toUpperCase()}`).join(' · ')}</title>
      <g transform={`rotate(${angle})`}>
        <rect {...bounds} fill="transparent" />
        <PartGlyph kind={part.kind} value={part.value} position={part.position} span={span} pins={pins} pinNames={PARTS[part.kind].pinNames} selected={preview || selectedId === part.id} />
      </g>
      {!preview && <g pointerEvents="none">
        <rect x={labelX - labelWidth / 2} y={labelY} width={labelWidth} height={17} rx={4} fill="#eeeee3" fillOpacity={0.95} />
        <text x={labelX} y={labelY + 12} textAnchor="middle" fill="#586054" fontSize={9.5} fontWeight={600} fontFamily="'Geist Mono', monospace">{label}</text>
      </g>}
    </g>
  }

  const cursor = tool === 'select' && !wireStart && !leadPart ? 'default' : 'crosshair'
  const wireSource = wireStart ? terminalById[wireStart] : null
  return <svg ref={svg} className="breadboard-svg" data-fit={zoom === 1} viewBox="0 0 920 550" width={920 * zoom} height={550 * zoom}
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
      const kind = event.dataTransfer.getData('application/labor-part')
      const terminal = nearestTerminal(localPoint(event.clientX, event.clientY))
      if (isPart(kind) && terminal) place(kind, terminal)
    }}>
    <defs>
      <filter id="wire-shadow" x="-30%" y="-60%" width="160%" height="240%"><feDropShadow dx="0" dy="2" stdDeviation="1" floodColor="#1d261e" floodOpacity="0.2" /></filter>
      <linearGradient id="socket-metal" x1="0" x2="0.8" y2="1"><stop stopColor="#a9aca2" /><stop offset="0.5" stopColor="#70786e" /><stop offset="1" stopColor="#c0c1b6" /></linearGradient>
    </defs>

    <g aria-hidden="true" pointerEvents="none">
      <rect x={48} y={83} width={824} height={446} rx={13} fill="#141914" opacity={0.2} />
      <rect x={46} y={79} width={828} height={446} rx={13} fill="#dddccf" stroke="#c8cabb" strokeWidth={1.5} />
      <rect x={54} y={86} width={812} height={431} rx={8} fill="#eeeee3" />
      <rect x={58} y={88} width={804} height={57} rx={3} fill="#e6e7db" />
      <rect x={58} y={454} width={804} height={52} rx={3} fill="#e6e7db" />
      <rect x={57} y={286} width={806} height={21} rx={3} fill="#d3d5c6" />
      <path d="M63 286H855" stroke="#c5c8b9" />
      <path d="M63 306H855" stroke="#f9f8f0" />
      <text x={75} y={300} fill="#8b9280" fontSize={8} fontWeight={600} letterSpacing={2}>SOLDERLESS BREADBOARD</text>
      <text x={844} y={300} textAnchor="end" fill="#8b9280" fontSize={8} fontFamily="monospace">30 × 10 · SPLIT RAILS</text>
      {[0, 1].map(segment => <g key={segment}>
        {[{ y: 91, color: '#b9655b' }, { y: 138, color: '#668ca1' }, { y: 459, color: '#b9655b' }, { y: 505, color: '#668ca1' }].map(line => <path key={line.y} d={`M${90 + segment * 360} ${line.y}H${443 + segment * 360}`} stroke={line.color} strokeWidth={1.8} opacity={0.78} />)}
      </g>)}
      {[{ y: 103, text: '+', color: '#b56156' }, { y: 128, text: '−', color: '#678899' }, { y: 472, text: '+', color: '#b56156' }, { y: 496, text: '−', color: '#678899' }].map(label => <g key={label.y} fill={label.color} fontSize={13} fontWeight={600} textAnchor="middle"><text x={75} y={label.y}>{label.text}</text><text x={835} y={label.y}>{label.text}</text></g>)}
      {Array.from({ length: 30 }, (_, index) => index + 1).map(column => <g key={column} fill="#939989" fontSize={9} textAnchor="middle" fontFamily="monospace"><text x={100 + (column - 1) * 24} y={156}>{column}</text><text x={100 + (column - 1) * 24} y={444}>{column}</text></g>)}
      {'abcdefghij'.split('').map((row, index) => <g key={row} fill="#929887" fontSize={10} fontFamily="monospace" textAnchor="middle"><text x={75} y={174 + index * 24 + (index > 4 ? 36 : 0)}>{row}</text><text x={834} y={174 + index * 24 + (index > 4 ? 36 : 0)}>{row}</text></g>)}
      {strips.map(group => {
        const first = group[0], last = group[group.length - 1]
        const active = group.some(hole => highlighted.has(hole.id))
        if (!showConnections && !active) return null
        return <path key={first.group} d={`M${first.x} ${first.y}L${last.x} ${last.y}`} stroke={active ? '#bfd77d' : '#b6c0a3'} strokeWidth={active ? 13 : 8} strokeLinecap="round" opacity={active ? 0.55 : 0.25} />
      })}
      {HOLES.map(hole => <g key={hole.id}>
        <rect x={hole.x - 4.4} y={hole.y - 4.4} width={8.8} height={8.8} rx={2} fill="#cecfbf" />
        <rect x={hole.x - 2.9} y={hole.y - 3.1} width={5.8} height={5.8} rx={1.4} fill={highlighted.has(hole.id) ? '#748756' : '#5c6556'} />
        <path d={`M${hole.x - 1.6} ${hole.y + 1.7}H${hole.x + 1.7}`} stroke="#3b4939" strokeWidth={1.3} />
      </g>)}
      {PORTS.map(port => {
        const terminal = terminalById[port.id]
        if (!terminal) return null
        return <g key={port.id}>
          <text x={terminal.x} y={21} textAnchor="middle" fill={port.color} fontSize={9} letterSpacing={1.2} fontWeight={600}>{port.label}</text>
          <circle cx={terminal.x} cy={terminal.y} r={14} fill="#151c18" stroke="#4b584b" strokeWidth={1} />
          <circle cx={terminal.x} cy={terminal.y} r={9.5} fill="url(#socket-metal)" />
          <circle cx={terminal.x} cy={terminal.y} r={6} fill="#141e16" stroke="#505b4a" strokeWidth={1.5} />
          {highlighted.has(port.id) && <circle cx={terminal.x} cy={terminal.y} r={17} fill="none" stroke="#c6df8e" strokeWidth={1.2} strokeDasharray="3 3" />}
        </g>
      })}
    </g>

    {TERMINALS.map(terminal => <circle key={terminal.id} data-terminal={terminal.id}
      ref={element => { if (element) terminalElements.current.set(terminal.id, element); else terminalElements.current.delete(terminal.id) }}
      cx={terminal.x} cy={terminal.y} r={10} fill="transparent" stroke={hoverId === terminal.id ? '#97b652' : 'transparent'} strokeWidth={1.5}
      role="button" tabIndex={terminal.id === focusId ? 0 : -1}
      aria-label={`${terminal.id.toUpperCase()}${occupied.has(terminal.id) ? ', occupied' : ', available'}`}
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
      {renderPart({ ...(leadPart ?? (move?.dragging ? move.part : { kind: previewKind, value: PARTS[previewKind].defaultValue })), id: 'preview', pins: previewPins }, true)}
    </g>}
    {isPart(tool) && hover && !previewPins && <circle cx={hover.x} cy={hover.y} r={10} fill="#df7662" fillOpacity={0.24} stroke="#c04e3e" strokeWidth={1.8} pointerEvents="none" />}

    <g pointerEvents="none" aria-hidden="true">
      <text x={55} y={546} fill="#7b897c" fontSize={8.5} fontFamily="monospace" letterSpacing={0.4}>{hover ? `${hover.id.toUpperCase()}  /  ${highlighted.size} connected terminals` : 'RAILS ARE SPLIT AT 15 / 16 · CONNECT POWER WITH JUMPERS'}</text>
      <text x={866} y={546} fill="#7b897c" textAnchor="end" fontSize={8.5} fontFamily="monospace">{leadPart ? 'MOVE LEAD · 1–8 HOLE SPACINGS · ESC TO CANCEL' : wireStart ? 'CHOOSE DESTINATION · ESC TO CANCEL' : isPart(tool) ? 'CLICK TO PLACE · R TO ROTATE' : 'CLICK TO INSPECT · DRAG TO MOVE'}</text>
    </g>
  </svg>
}
