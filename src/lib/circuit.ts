export type ComponentKind = 'resistor' | 'capacitor' | 'diode' | 'led' | 'switch'

export interface Part {
  id: string
  kind: ComponentKind
  value: number
  /** Physical terminals. Diodes use [anode, cathode]. */
  pins: [string, string]
}

export interface Wire {
  id: string
  from: string
  to: string
  color: string
}

export interface CircuitDocument {
  schemaVersion: 1
  boardVersion: 'virtual-1'
  title: string
  parts: Part[]
  wires: Wire[]
  probes: { CH1: string | null; CH2: string | null }
  instruments: {
    frequency: number
    amplitude: number
    waveform: 'sine' | 'triangle' | 'square'
    cv: number
  }
}

export interface Terminal {
  id: string
  x: number
  y: number
  group: string
}

export interface PartDefinition {
  label: string
  unit: string
  defaultValue: number
  min: number
  max: number
  description: string
  model: string
}

export const PARTS: Record<ComponentKind, PartDefinition> = {
  resistor: {
    label: 'Resistor', unit: 'Ω', defaultValue: 10_000, min: 10, max: 10_000_000,
    description: 'Limits current and forms voltage dividers.',
    model: 'Ideal linear resistor. No tolerance, temperature drift, or thermal damage model.',
  },
  capacitor: {
    label: 'Capacitor', unit: 'F', defaultValue: 100e-9, min: 100e-12, max: 0.01,
    description: 'Stores charge. Combine with a resistor to shape a signal.',
    model: 'Ideal non-polarized capacitor. Every capture starts at the DC operating point; charge is not preserved between edits.',
  },
  diode: {
    label: 'Signal diode', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Conducts from the first lead (anode) to the striped lead (cathode).',
    model: 'Generic silicon diode: Is=2.52 nA, N=1.752, Rs=0.568 Ω, Cjo=4 pF. Educational model, not a named manufacturer part.',
  },
  led: {
    label: 'Red LED', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'A light-emitting diode. Add a series resistor to limit current.',
    model: 'Generic red LED diode: Is=1e-20 A, N=2, Rs=5 Ω. Fixed model; visual glow is not a calibrated brightness measurement.',
  },
  switch: {
    label: 'Switch', unit: '', defaultValue: 1, min: 0, max: 1,
    description: 'Open or close a connection between two holes.',
    model: 'Static two-terminal switch represented by 1 Ω closed or 1 GΩ open to avoid an ideal zero-resistance branch.',
  },
}

const rows = 'abcdefghij'
const rowY = [170, 194, 218, 242, 266, 326, 350, 374, 398, 422]
const rails = [{ id: 'tp', y: 100 }, { id: 'tn', y: 124 }, { id: 'bp', y: 468 }, { id: 'bn', y: 492 }]

/** Virtual board geometry, in shared SVG coordinates. All rail halves are isolated. */
export const HOLES: Terminal[] = [
  ...Array.from(rows).flatMap((row, rowIndex) => Array.from({ length: 30 }, (_, index) => ({
    id: `${row}${index + 1}`, x: 100 + index * 24, y: rowY[rowIndex],
    group: `${rowIndex < 5 ? 'top' : 'bottom'}-${index + 1}`,
  }))),
  ...rails.flatMap((rail) => Array.from({ length: 30 }, (_, index) => ({
    id: `${rail.id}${index + 1}`, x: 100 + index * 24, y: rail.y,
    group: `${rail.id}-${index < 15 ? 'left' : 'right'}`,
  }))),
]

export const TERMINALS: Terminal[] = [
  ...HOLES,
  ...['osc', 'cv', 'gnd', 'vplus', 'vminus'].map((id, index) => ({ id, x: 135 + index * 160, y: 52, group: id })),
]

export const terminalById: Record<string, Terminal> = Object.fromEntries(TERMINALS.map((terminal) => [terminal.id, terminal]))

export function createEmptyDocument(): CircuitDocument {
  return {
    schemaVersion: 1, boardVersion: 'virtual-1', title: 'Untitled circuit',
    parts: [], wires: [], probes: { CH1: null, CH2: null },
    instruments: { frequency: 220, amplitude: 2.5, waveform: 'sine', cv: 5 },
  }
}

/** Default two-lead footprints; 90°/270° orientations may span the center trench. */
export function getPlacement(kind: ComponentKind, holeId: string, rotation = 0): [string, string] | null {
  const match = /^([a-j])(\d{1,2})$/.exec(holeId)
  if (!match || !Object.hasOwn(terminalById, holeId) || !Object.hasOwn(PARTS, kind)) return null
  const column = Number(match[2])
  const row = rows.indexOf(match[1])
  const direction = ((Math.round(rotation / 90) % 4) + 4) % 4
  const span = kind === 'capacitor' ? 1 : 3
  const nextColumn = column + (direction === 0 ? span : direction === 2 ? -span : 0)
  const nextRow = row + (direction === 1 ? span : direction === 3 ? -span : 0)
  if (nextColumn < 1 || nextColumn > 30 || nextRow < 0 || nextRow >= rows.length) return null
  return [holeId, `${rows[nextRow]}${nextColumn}`]
}

/** Leads and jumpers occupy holes; probes are measurement attachments and do not. */
export function canPlace(doc: CircuitDocument, pins: [string, string], excludeId?: string): boolean {
  if (pins[0] === pins[1] || pins.some((pin) => !Object.hasOwn(terminalById, pin))) return false
  const occupied = new Set([
    ...doc.parts.filter((part) => part.id !== excludeId).flatMap((part) => part.pins),
    ...doc.wires.filter((wire) => wire.id !== excludeId).flatMap((wire) => [wire.from, wire.to]),
  ])
  return pins.every((pin) => !occupied.has(pin))
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`)
  return value as Record<string, unknown>
}

function finiteNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number between ${min} and ${max}.`)
  }
  return value
}

/** Returns a clean document; imported extra properties never reach the netlist. */
export function validateDocument(input: unknown): CircuitDocument {
  let serialized: string
  try { serialized = JSON.stringify(input) } catch { throw new Error('The circuit must contain valid JSON data.') }
  if (!serialized || serialized.length > 100_000) throw new Error('Circuit files must be smaller than 100 kB.')
  const raw = object(input, 'Circuit')
  if (raw.schemaVersion !== 1 || raw.boardVersion !== 'virtual-1') throw new Error('Unsupported circuit or board version.')
  if (typeof raw.title !== 'string' || raw.title.length > 100) throw new Error('Circuit title must contain at most 100 characters.')
  if (!Array.isArray(raw.parts) || raw.parts.length > 30) throw new Error('A circuit may contain up to 30 components.')
  if (!Array.isArray(raw.wires) || raw.wires.length > 120) throw new Error('A circuit may contain up to 120 wires.')
  const ids = new Set<string>()
  const occupied = new Set<string>()
  const readId = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(value)) throw new Error('Every part and wire needs a short alphanumeric ID.')
    if (ids.has(value.toLowerCase())) throw new Error(`Duplicate part or wire ID: ${value}.`)
    ids.add(value.toLowerCase())
    return value
  }
  const readTerminal = (value: unknown): string => {
    if (typeof value !== 'string' || !Object.hasOwn(terminalById, value)) throw new Error(`Unknown terminal: ${String(value)}.`)
    return value
  }
  const occupy = (terminals: string[]) => {
    for (const terminal of terminals) {
      if (occupied.has(terminal)) throw new Error(`Hole ${terminal} is occupied more than once. Use another hole on the same strip.`)
      occupied.add(terminal)
    }
  }
  const parts: Part[] = raw.parts.map((entry, index) => {
    const part = object(entry, `Component ${index + 1}`)
    const id = readId(part.id)
    if (typeof part.kind !== 'string' || !Object.hasOwn(PARTS, part.kind)) throw new Error(`Unknown component type on ${id}.`)
    const kind = part.kind as ComponentKind
    const definition = PARTS[kind]
    const value = finiteNumber(part.value, `${id} value`, definition.min, definition.max)
    if (kind === 'switch' && value !== 0 && value !== 1) throw new Error(`${id} must be either open (0) or closed (1).`)
    if (!Array.isArray(part.pins) || part.pins.length !== 2) throw new Error(`${id} requires exactly two pins.`)
    const pins: [string, string] = [readTerminal(part.pins[0]), readTerminal(part.pins[1])]
    if (pins.some((pin) => !/^(?:[a-j]|tp|tn|bp|bn)\d+$/.test(pin))) throw new Error(`${id} must be placed on breadboard holes.`)
    occupy(pins)
    return { id, kind, value, pins }
  })
  const wires: Wire[] = raw.wires.map((entry, index) => {
    const wire = object(entry, `Wire ${index + 1}`)
    const id = readId(wire.id)
    const from = readTerminal(wire.from)
    const to = readTerminal(wire.to)
    occupy([from, to])
    if (typeof wire.color !== 'string' || !/^#[\da-fA-F]{6}$/.test(wire.color)) throw new Error(`${id} needs a six-digit hex color.`)
    return { id, from, to, color: wire.color }
  })
  const instruments = object(raw.instruments, 'Instruments')
  const frequency = finiteNumber(instruments.frequency, 'Oscillator frequency', 20, 2000)
  const amplitude = finiteNumber(instruments.amplitude, 'Oscillator amplitude', 0, 5)
  const cv = finiteNumber(instruments.cv, 'CV voltage', -5, 5)
  if (!['sine', 'triangle', 'square'].includes(instruments.waveform as string)) throw new Error('Unsupported oscillator waveform.')
  const probes = object(raw.probes, 'Probes')
  return {
    schemaVersion: 1, boardVersion: 'virtual-1', title: raw.title,
    parts, wires,
    instruments: { frequency, amplitude, cv, waveform: instruments.waveform as CircuitDocument['instruments']['waveform'] },
    probes: { CH1: probes.CH1 === null ? null : readTerminal(probes.CH1), CH2: probes.CH2 === null ? null : readTerminal(probes.CH2) },
  }
}

export interface Diagnostic {
  severity: 'error' | 'warning'
  message: string
  partId?: string
}

export interface CompiledCircuit {
  netlist: string
  diagnostics: Diagnostic[]
  nodeByTerminal: Record<string, string>
  nets: Record<string, string[]>
}

function spiceNumber(value: number): string {
  return value.toExponential(9)
}

export function compileCircuit(document: CircuitDocument): CompiledCircuit {
  const diagnostics: Diagnostic[] = []
  const parent = new Map(TERMINALS.map(({ id }) => [id, id]))
  const find = (id: string): string => {
    const next = parent.get(id)
    if (!next || next === id) return id
    const root = find(next)
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string) => {
    const roots = [find(a), find(b)].sort()
    parent.set(roots[1], roots[0])
  }
  const firstInGroup = new Map<string, string>()
  for (const terminal of TERMINALS) {
    const first = firstInGroup.get(terminal.group)
    if (first) union(first, terminal.id)
    else firstInGroup.set(terminal.group, terminal.id)
  }
  let doc: CircuitDocument
  try { doc = validateDocument(document) } catch (error) {
    return { netlist: '', diagnostics: [{ severity: 'error', message: error instanceof Error ? error.message : 'Invalid circuit document.' }], nodeByTerminal: {}, nets: {} }
  }
  for (const wire of doc.wires) union(wire.from, wire.to)
  const rootToNode = new Map<string, string>([[find('gnd'), '0']])
  // Root names make output deterministic regardless of wire or component array order.
  const roots = [...new Set(TERMINALS.map(({ id }) => find(id)))].sort()
  for (const root of roots) if (!rootToNode.has(root)) rootToNode.set(root, `n${rootToNode.size}`)
  const nodeByTerminal = Object.fromEntries(TERMINALS.map(({ id }) => [id, rootToNode.get(find(id))!]))
  const nets: Record<string, string[]> = {}
  for (const { id } of TERMINALS) (nets[nodeByTerminal[id]] ??= []).push(id)
  const usedTerminals = [...doc.parts.flatMap((part) => part.pins), ...doc.wires.flatMap((wire) => [wire.from, wire.to]), ...Object.values(doc.probes).filter((probe): probe is string => probe !== null)]
  const activeNodes = new Set(usedTerminals.map((terminal) => nodeByTerminal[terminal]))
  if (activeNodes.size > 60) diagnostics.push({ severity: 'error', message: 'This workbench supports up to 60 connected circuit nodes. Simplify the circuit before capturing.' })
  const idealSources = ['gnd', 'cv', 'vplus', 'vminus']
  for (let a = 0; a < idealSources.length; a++) {
    for (let b = a + 1; b < idealSources.length; b++) {
      if (nodeByTerminal[idealSources[a]] === nodeByTerminal[idealSources[b]]) diagnostics.push({ severity: 'error', message: `Supply short: ${idealSources[a].toUpperCase()} is directly connected to ${idealSources[b].toUpperCase()}. Remove the jumper before capturing.` })
    }
  }
  if (nodeByTerminal.osc === '0') diagnostics.push({ severity: 'warning', message: 'OSC is shorted to ground. Its virtual 100 Ω output resistor limits the current.' })
  const dcEdges = new Map<string, Set<string>>()
  for (const part of doc.parts) {
    const [a, b] = part.pins.map((pin) => nodeByTerminal[pin])
    if (a === b) diagnostics.push({ severity: 'warning', message: `${part.id} has both leads on the same electrical net and is bypassed.`, partId: part.id })
    if (part.kind !== 'capacitor') {
      if (!dcEdges.has(a)) dcEdges.set(a, new Set())
      if (!dcEdges.has(b)) dcEdges.set(b, new Set())
      dcEdges.get(a)!.add(b)
      dcEdges.get(b)!.add(a)
    }
  }
  // Instrument sources themselves have explicit internal reference-ground connections.
  const referenced = new Set(['gnd', 'osc', 'cv', 'vplus', 'vminus'].map((pin) => nodeByTerminal[pin]))
  const queue = [...referenced]
  while (queue.length) {
    const node = queue.pop()!
    for (const next of dcEdges.get(node) ?? []) {
      if (!referenced.has(next)) { referenced.add(next); queue.push(next) }
    }
  }
  const warnedFloating = new Set<string>()
  for (const part of doc.parts) {
    for (const pin of part.pins) {
      const node = nodeByTerminal[pin]
      if (!referenced.has(node) && !warnedFloating.has(node)) {
        diagnostics.push({ severity: 'error', message: `${part.id} at ${pin} has no DC path to GND. Connect a return path; capacitors do not provide a DC connection.`, partId: part.id })
        warnedFloating.add(node)
      }
    }
  }
  for (const [channel, probe] of Object.entries(doc.probes)) {
    if (probe && !referenced.has(nodeByTerminal[probe])) diagnostics.push({ severity: 'warning', message: `${channel} is attached to a floating node at ${probe}; connect it to the circuit to measure a voltage.` })
  }
  const { frequency, amplitude, waveform, cv } = doc.instruments
  const period = 1 / frequency
  const edge = Math.min(1e-6, period / 1000)
  const stimulus = waveform === 'sine'
    ? `SIN(0 ${spiceNumber(amplitude)} ${spiceNumber(frequency)})`
    : waveform === 'square'
      ? `PULSE(${spiceNumber(-amplitude)} ${spiceNumber(amplitude)} 0 ${spiceNumber(edge)} ${spiceNumber(edge)} ${spiceNumber(period / 2 - edge)} ${spiceNumber(period)})`
      : `PULSE(${spiceNumber(-amplitude)} ${spiceNumber(amplitude)} 0 ${spiceNumber(period / 2)} ${spiceNumber(period / 2)} 0 ${spiceNumber(period)})`
  const lines = [
    '* LABOR Playground virtual-1; local educational circuit',
    'VOSC osc_internal 0 ' + stimulus,
    `ROSC osc_internal ${nodeByTerminal.osc} 100`,
    `VCV ${nodeByTerminal.cv} 0 ${spiceNumber(cv)}`,
    `VPLUS ${nodeByTerminal.vplus} 0 12`,
    `VMINUS ${nodeByTerminal.vminus} 0 -12`,
    '.model D_SIGNAL D(Is=2.52e-9 N=1.752 Rs=0.568 Cjo=4e-12)',
    '.model D_RED D(Is=1e-20 N=2 Rs=5 Cjo=10e-12)',
  ]
  for (const part of [...doc.parts].sort((a, b) => a.id.localeCompare(b.id))) {
    const [a, b] = part.pins.map((pin) => nodeByTerminal[pin])
    // Encode punctuation injectively so e.g. R-1 and R_1 stay distinct devices.
    const safeId = part.id.replace(/[^a-zA-Z0-9]/g, (character) => `_${character.charCodeAt(0).toString(16)}`)
    if (part.kind === 'resistor') lines.push(`R_${safeId} ${a} ${b} ${spiceNumber(part.value)}`)
    if (part.kind === 'capacitor') lines.push(`C_${safeId} ${a} ${b} ${spiceNumber(part.value)}`)
    if (part.kind === 'diode' || part.kind === 'led') lines.push(`D_${safeId} ${a} ${b} ${part.kind === 'led' ? 'D_RED' : 'D_SIGNAL'}`)
    if (part.kind === 'switch') lines.push(`R_${safeId} ${a} ${b} ${part.value === 1 ? '1' : '1e9'}`)
  }
  const step = spiceNumber(Math.min(1e-5, period / 80))
  lines.push('.options reltol=0.001 abstol=1e-12 vntol=1e-6', '.save all', `.tran ${step} 0.1 0 ${step}`, '.end')
  return { netlist: lines.join('\n') + '\n', diagnostics, nodeByTerminal, nets }
}

export function formatValue(value: number, kind: ComponentKind): string {
  if (kind === 'diode') return 'Silicon'
  if (kind === 'led') return 'Red'
  if (kind === 'switch') return value === 1 ? 'Closed' : 'Open'
  const prefixes: [number, string][] = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']]
  const [scale, prefix] = prefixes.find(([scale]) => Math.abs(value) >= scale * (1 - 1e-12)) ?? [1, '']
  return `${Number((value / scale).toPrecision(3))} ${prefix}${PARTS[kind].unit}`
}

export interface CircuitExample {
  id: string
  name: string
  description: string
  whatToChange: string
  whatToObserve: string
  why: string
  document: CircuitDocument
}

export const examples: CircuitExample[] = [
  {
    id: 'rc-filter', name: 'RC low-pass filter', description: 'Let the low notes through. Explore how a capacitor softens a signal.',
    whatToChange: 'Select C1 and change its capacitance from 100 nF to 220 nF.',
    whatToObserve: 'The amber output gets smaller and lags further behind the cyan input.',
    why: 'A capacitor carries more current as frequency rises. R1 and C1 form a frequency-dependent divider. With 10 kΩ and 100 nF, the nominal corner is about 159 Hz.',
    document: {
      ...createEmptyDocument(), title: 'RC low-pass filter',
      parts: [{ id: 'R1', kind: 'resistor', value: 10_000, pins: ['a6', 'a17'] }, { id: 'C1', kind: 'capacitor', value: 100e-9, pins: ['e17', 'f17'] }],
      wires: [{ id: 'W1', from: 'osc', to: 'b6', color: '#56c7c2' }, { id: 'W2', from: 'j17', to: 'bn17', color: '#6a839b' }, { id: 'W3', from: 'gnd', to: 'bn20', color: '#6a839b' }],
      probes: { CH1: 'd6', CH2: 'd17' },
    },
  },
  {
    id: 'voltage-divider', name: 'Voltage divider', description: 'Two resistors, one useful ratio. Turn 5 volts into 2.5.',
    whatToChange: 'Change R2 from 10 kΩ to 20 kΩ.',
    whatToObserve: 'CH2 rises from 2.50 V to about 3.33 V. CH1 stays at 5 V.',
    why: 'The two resistors share the supply voltage. The midpoint is 5 × R2 / (R1 + R2). The scope measures a constant DC voltage.',
    document: {
      ...createEmptyDocument(), title: 'Voltage divider',
      parts: [{ id: 'R1', kind: 'resistor', value: 10_000, pins: ['a6', 'a16'] }, { id: 'R2', kind: 'resistor', value: 10_000, pins: ['d16', 'd26'] }],
      wires: [{ id: 'W1', from: 'cv', to: 'b6', color: '#c8a55b' }, { id: 'W2', from: 'e26', to: 'bn26', color: '#6a839b' }, { id: 'W3', from: 'gnd', to: 'bn20', color: '#6a839b' }],
      probes: { CH1: 'c6', CH2: 'c16' },
    },
  },
  {
    id: 'diode-clipper', name: 'Diode clipper', description: 'Flatten the peaks with a pair of opposing signal diodes.',
    whatToChange: 'Increase the oscillator amplitude, then try a triangle wave.',
    whatToObserve: 'CH2 flattens around the diodes’ forward voltage while CH1 keeps growing.',
    why: 'Opposing diodes conduct on opposite signal polarities and divert current to ground. R1 limits that current. The clipping voltage depends on current and the diode model.',
    document: {
      ...createEmptyDocument(), title: 'Diode clipper',
      parts: [{ id: 'R1', kind: 'resistor', value: 1000, pins: ['a6', 'a17'] }, { id: 'D1', kind: 'diode', value: 1, pins: ['e17', 'f17'] }, { id: 'D2', kind: 'diode', value: 1, pins: ['g18', 'd18'] }],
      wires: [{ id: 'W1', from: 'osc', to: 'b6', color: '#56c7c2' }, { id: 'W2', from: 'j17', to: 'bn17', color: '#6a839b' }, { id: 'W3', from: 'gnd', to: 'bn20', color: '#6a839b' }, { id: 'W4', from: 'c17', to: 'c18', color: '#d9a650' }, { id: 'W5', from: 'j18', to: 'bn18', color: '#6a839b' }],
      probes: { CH1: 'd6', CH2: 'd17' },
    },
  },
]
