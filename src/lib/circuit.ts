export type ComponentKind = 'resistor' | 'capacitor' | 'diode' | 'led' | 'switch' | 'potentiometer' | 'electrolytic' | 'opamp'

export interface Part {
  id: string
  kind: ComponentKind
  value: number
  /** Physical terminals in the order named by the component definition. */
  pins: string[]
  /** Potentiometer wiper position: 0 at CCW, 1 at CW; omitted means 0.5. */
  position?: number
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
  /** Omitted in legacy documents: periodic oscillator capture. */
  stimulus?: 'periodic' | 'step'
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
  pinNames: string[]
}

export const PARTS: Record<ComponentKind, PartDefinition> = {
  resistor: {
    pinNames: ['1', '2'],
    label: 'Resistor', unit: 'Ω', defaultValue: 10_000, min: 10, max: 10_000_000,
    description: 'Limits current and forms voltage dividers.',
    model: 'Ideal linear resistor. No tolerance, temperature drift, or thermal damage model.',
  },
  capacitor: {
    pinNames: ['1', '2'],
    label: 'Capacitor', unit: 'F', defaultValue: 100e-9, min: 100e-12, max: 0.01,
    description: 'Stores charge. Combine with a resistor to shape a signal.',
    model: 'Ideal non-polarized capacitor. Every capture starts at the DC operating point; charge is not preserved between edits.',
  },
  diode: {
    pinNames: ['Anode', 'Cathode'],
    label: 'Signal diode', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Conducts from the first lead (anode) to the striped lead (cathode).',
    model: 'Generic silicon diode: Is=2.52 nA, N=1.752, Rs=0.568 Ω, Cjo=4 pF. Educational model, not a named manufacturer part.',
  },
  led: {
    pinNames: ['Anode', 'Cathode'],
    label: 'Red LED', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'A light-emitting diode. Add a series resistor to limit current.',
    model: 'Generic red LED diode: Is=1e-20 A, N=2, Rs=5 Ω. Fixed model; visual glow is not a calibrated brightness measurement.',
  },
  switch: {
    pinNames: ['1', '2'],
    label: 'Switch', unit: '', defaultValue: 1, min: 0, max: 1,
    description: 'Open or close a connection between two holes.',
    model: 'Static two-terminal switch represented by 1 Ω closed or 1 GΩ open to avoid an ideal zero-resistance branch.',
  },
  potentiometer: {
    pinNames: ['CCW', 'Wiper', 'CW'],
    label: 'Potentiometer', unit: 'Ω', defaultValue: 10_000, min: 100, max: 1_000_000,
    description: 'A variable divider. Move the wiper between the CCW and CW ends.',
    model: 'Linear three-terminal potentiometer. CCW-to-wiper resistance is position × total; wiper-to-CW is (1 − position) × total. Each segment has a 1 Ω minimum at the endpoints. No contact noise or mechanical taper.',
  },
  electrolytic: {
    pinNames: ['+', '−'],
    label: 'Electrolytic capacitor', unit: 'F', defaultValue: 1e-6, min: 100e-9, max: 0.01,
    description: 'Stores charge with marked positive and negative leads. Keep the + lead at the higher voltage.',
    model: 'Ideal capacitor with visible polarity. Reverse bias is not a damage or breakdown model; warnings identify detected reverse bias but do not change the capacitor’s electrical behavior. Charge restarts from the DC operating point on every capture.',
  },
  opamp: {
    pinNames: ['OUT A', 'IN− A', 'IN+ A', 'V−', 'IN+ B', 'IN− B', 'OUT B', 'V+'],
    label: 'Dual op-amp', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Two feedback amplifiers in a DIP-8 package. Wire both visible supply pins and give every input a DC return.',
    model: 'Generic educational dual op-amp: gain 100,000, 100 MΩ differential input resistance and 50 Ω output resistance. Outputs clip 1 V inside the connected supply rails; more than 2 V rail separation is required. No bandwidth, slew rate, input common-mode limit, supply-current, noise or damage model. Both halves require input connections. Not a calibrated manufacturer device.',
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

/** Default footprints. DIP-8 fits across the trench only, with pin 1 at eN or fN. */
export function getPlacement(kind: ComponentKind, holeId: string, rotation = 0): string[] | null {
  const match = /^([a-j])(\d{1,2})$/.exec(holeId)
  if (!match || !Object.hasOwn(terminalById, holeId) || !Object.hasOwn(PARTS, kind)) return null
  const column = Number(match[2])
  const row = rows.indexOf(match[1])
  const direction = ((Math.round(rotation / 90) % 4) + 4) % 4
  if (kind === 'opamp') {
    if (direction === 0 && match[1] === 'e' && column <= 27) {
      return [0, 1, 2, 3].map((offset) => `e${column + offset}`).concat([3, 2, 1, 0].map((offset) => `f${column + offset}`))
    }
    if (direction === 2 && match[1] === 'f' && column >= 4) {
      return [0, 1, 2, 3].map((offset) => `f${column - offset}`).concat([3, 2, 1, 0].map((offset) => `e${column - offset}`))
    }
    return null
  }
  const span = kind === 'capacitor' || kind === 'electrolytic' || kind === 'potentiometer' ? 1 : 3
  const count = kind === 'potentiometer' ? 3 : 2
  const pins = Array.from({ length: count }, (_, index) => {
    const nextColumn = column + (direction === 0 ? span : direction === 2 ? -span : 0) * index
    const nextRow = row + (direction === 1 ? span : direction === 3 ? -span : 0) * index
    return nextColumn < 1 || nextColumn > 30 || nextRow < 0 || nextRow >= rows.length ? null : `${rows[nextRow]}${nextColumn}`
  })
  if (kind === 'potentiometer' && pins.some((pin) => pin !== null && (rows.indexOf(pin[0]) < 5) !== (row < 5))) return null
  return pins.some((pin) => pin === null) ? null : pins as string[]
}

/** Legacy two-lead parts keep arbitrary lead spacing; rigid new packages do not. */
export function isValidFootprint(kind: ComponentKind, pins: string[]): boolean {
  if (!Object.hasOwn(PARTS, kind) || pins.length !== PARTS[kind].pinNames.length || new Set(pins).size !== pins.length) return false
  if (pins.some((pin) => !Object.hasOwn(terminalById, pin) || !/^(?:[a-j]|tp|tn|bp|bn)\d+$/.test(pin))) return false
  if (kind !== 'potentiometer' && kind !== 'opamp') return true
  return [0, 90, 180, 270].some((rotation) => getPlacement(kind, pins[0], rotation)?.every((pin, index) => pin === pins[index]))
}

/** Leads and jumpers occupy holes; probes are measurement attachments and do not. */
export function canPlace(doc: CircuitDocument, pins: string[], excludeId?: string): boolean {
  if (pins.length < 2 || new Set(pins).size !== pins.length || pins.some((pin) => !Object.hasOwn(terminalById, pin))) return false
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
    if (!Array.isArray(part.pins) || part.pins.length !== definition.pinNames.length) throw new Error(`${id} requires exactly ${definition.pinNames.length} pins.`)
    const pins = part.pins.map(readTerminal)
    if (!isValidFootprint(kind, pins)) throw new Error(`${id} has an invalid ${definition.label.toLowerCase()} footprint. ${kind === 'opamp' ? 'Place all eight pins across the center trench at 0° or 180°.' : 'Use the supported breadboard pin positions.'}`)
    occupy(pins)
    const position = kind === 'potentiometer' && part.position !== undefined ? finiteNumber(part.position, `${id} wiper position`, 0, 1) : undefined
    return { id, kind, value, pins, ...(position === undefined ? {} : { position }) }
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
  if (raw.stimulus !== undefined && raw.stimulus !== 'periodic' && raw.stimulus !== 'step') throw new Error('Unsupported capture stimulus.')
  return {
    schemaVersion: 1, boardVersion: 'virtual-1', title: raw.title,
    parts, wires,
    ...(raw.stimulus === undefined ? {} : { stimulus: raw.stimulus as CircuitDocument['stimulus'] }),
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
  const addEdge = (a: string, b: string) => {
    if (!dcEdges.has(a)) dcEdges.set(a, new Set())
    if (!dcEdges.has(b)) dcEdges.set(b, new Set())
    dcEdges.get(a)!.add(b)
    dcEdges.get(b)!.add(a)
  }
  const fixedVoltages = new Map([
    [nodeByTerminal.gnd, 0], [nodeByTerminal.cv, doc.instruments.cv],
    [nodeByTerminal.vplus, 12], [nodeByTerminal.vminus, -12],
  ])
  for (const part of doc.parts) {
    const nodes = part.pins.map((pin) => nodeByTerminal[pin])
    const [a, b, c] = nodes
    if (part.kind === 'opamp') continue
    if (part.kind === 'potentiometer') {
      if (a === b || b === c || a === c) diagnostics.push({ severity: 'warning', message: `${part.id} has terminals on the same electrical net. A potentiometer needs three separate strips to act as a divider.`, partId: part.id })
      addEdge(a, b)
      addEdge(b, c)
    } else {
      if (a === b) diagnostics.push({ severity: 'warning', message: `${part.id} has both leads on the same electrical net and is bypassed.`, partId: part.id })
      if (part.kind !== 'capacitor' && part.kind !== 'electrolytic') addEdge(a, b)
    }
    if (part.kind === 'electrolytic' && fixedVoltages.has(a) && fixedVoltages.has(b) && fixedVoltages.get(a)! < fixedVoltages.get(b)!) {
      diagnostics.push({ severity: 'warning', message: `${part.id} has reversed DC polarity: its + lead is below its − lead. Swap the leads. The ideal model does not simulate damage.`, partId: part.id })
    }
  }
  // Instrument sources have explicit reference-ground connections. IC input
  // resistances never excuse a missing external return on an input pin.
  const referenced = new Set(['gnd', 'osc', 'cv', 'vplus', 'vminus'].map((pin) => nodeByTerminal[pin]))
  const traceReferences = () => {
    const queue = [...referenced]
    while (queue.length) {
      const node = queue.pop()!
      for (const next of dcEdges.get(node) ?? []) {
        if (!referenced.has(next)) { referenced.add(next); queue.push(next) }
      }
    }
  }
  traceReferences()
  for (const part of doc.parts.filter((part) => part.kind === 'opamp')) {
    const nodes = part.pins.map((pin) => nodeByTerminal[pin])
    const negative = nodes[3]
    const positive = nodes[7]
    let powered = true
    for (const [index, label] of [[3, 'V− (pin 4)'], [7, 'V+ (pin 8)']] as const) {
      if (!referenced.has(nodes[index])) {
        diagnostics.push({ severity: 'error', message: `${part.id} ${label} has no connected supply. Wire both visible supply pins to DC supplies with a GND reference.`, partId: part.id })
        powered = false
      }
    }
    if (positive === negative) {
      diagnostics.push({ severity: 'error', message: `${part.id} supply pins are on the same net. Connect V+ above V− with more than 2 V between them.`, partId: part.id })
      powered = false
    } else if (fixedVoltages.has(positive) && fixedVoltages.has(negative)) {
      const span = fixedVoltages.get(positive)! - fixedVoltages.get(negative)!
      if (span <= 2) {
        diagnostics.push({ severity: 'error', message: `${part.id} ${span < 0 ? 'supply polarity is reversed' : 'supply voltage is insufficient'}. V+ must be more than 2 V above V− for this model.`, partId: part.id })
        powered = false
      }
    } else if (powered) {
      diagnostics.push({ severity: 'warning', message: `${part.id} supply voltage depends on the circuit. Verify that V+ stays more than 2 V above V−; the output model shuts down below that separation.`, partId: part.id })
    }
    if (powered) {
      // An output is driven relative to the connected negative supply. This does
      // not merge nets or give either input an implicit connection to ground.
      addEdge(nodes[0], negative)
      addEdge(nodes[6], negative)
    }
  }
  traceReferences()
  const warnedFloating = new Set<string>()
  for (const part of doc.parts) {
    for (const [index, pin] of part.pins.entries()) {
      const node = nodeByTerminal[pin]
      if (!referenced.has(node) && !warnedFloating.has(node)) {
        const input = part.kind === 'opamp' && [1, 2, 4, 5].includes(index)
        diagnostics.push({ severity: 'error', message: input
          ? `${part.id} ${PARTS.opamp.pinNames[index]} (pin ${index + 1}) at ${pin} is floating. Connect an external DC return; wire unused amplifiers as grounded followers.`
          : `${part.id} at ${pin} has no DC path to GND. Connect a return path; capacitors do not provide a DC connection.`, partId: part.id })
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
  const stimulus = doc.stimulus === 'step'
    ? `PULSE(0 ${spiceNumber(amplitude)} 0.001 1e-6 1e-6 0.049999 1)`
    : waveform === 'sine'
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
  // Fixed model templates emit at most six devices and two internal nodes per
  // part: the 30-part document limit bounds expansion to 180 devices / 60 nodes.
  for (const part of [...doc.parts].sort((a, b) => a.id.localeCompare(b.id))) {
    const [a, b] = part.pins.map((pin) => nodeByTerminal[pin])
    // Encode punctuation injectively so e.g. R-1 and R_1 stay distinct devices.
    const safeId = part.id.replace(/[^a-zA-Z0-9]/g, (character) => `_${character.charCodeAt(0).toString(16)}`)
    if (part.kind === 'resistor') lines.push(`R_${safeId} ${a} ${b} ${spiceNumber(part.value)}`)
    if (part.kind === 'capacitor' || part.kind === 'electrolytic') lines.push(`C_${safeId} ${a} ${b} ${spiceNumber(part.value)}`)
    if (part.kind === 'diode' || part.kind === 'led') lines.push(`D_${safeId} ${a} ${b} ${part.kind === 'led' ? 'D_RED' : 'D_SIGNAL'}`)
    if (part.kind === 'switch') lines.push(`R_${safeId} ${a} ${b} ${part.value === 1 ? '1' : '1e9'}`)
    if (part.kind === 'potentiometer') {
      const position = part.position ?? 0.5
      const c = nodeByTerminal[part.pins[2]]
      lines.push(`RP_${safeId}_ccw ${a} ${b} ${spiceNumber(Math.max(1, position * part.value))}`)
      lines.push(`RP_${safeId}_cw ${b} ${c} ${spiceNumber(Math.max(1, (1 - position) * part.value))}`)
    }
    if (part.kind === 'opamp') {
      const nodes = part.pins.map((pin) => nodeByTerminal[pin])
      const negative = nodes[3]
      const positive = nodes[7]
      for (const [half, output, inverting, noninverting] of [['a', nodes[0], nodes[1], nodes[2]], ['b', nodes[6], nodes[5], nodes[4]]]) {
        const internal = `op_${safeId}_${half}`
        const span = `v(${positive},${negative})`
        // The behavioral source returns to the visible V− pin, never to an
        // invented power rail. A failed supply collapses its internal output to V−.
        lines.push(`BO_${safeId}_${half} ${internal} ${negative} V = ${span} > 2 ? max(1,min(${span}-1,${span}/2+1e5*v(${noninverting},${inverting}))) : 0`)
        lines.push(`RO_${safeId}_${half} ${internal} ${output} 50`)
        lines.push(`RI_${safeId}_${half} ${noninverting} ${inverting} 1e8`)
      }
    }
  }
  const step = spiceNumber(Math.min(1e-5, period / 80))
  lines.push('.options reltol=0.001 abstol=1e-12 vntol=1e-6', '.save all', `.tran ${step} 0.1 0 ${step}`, '.end')
  return { netlist: lines.join('\n') + '\n', diagnostics, nodeByTerminal, nets }
}

export function formatValue(value: number, kind: ComponentKind): string {
  if (kind === 'diode') return 'Silicon'
  if (kind === 'led') return 'Red'
  if (kind === 'opamp') return 'Dual · DIP-8'
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
  {
    id: 'capacitor-charge', name: 'Capacitor charge & decay', description: 'Watch a capacitor store a pulse and release it through a resistor.',
    whatToChange: 'Change C1 from 1 µF to 2.2 µF, then capture again.',
    whatToObserve: 'The amber output rises and falls more slowly. The input rises at 1 ms and falls at 51 ms.',
    why: 'This capture starts at 0 V, then applies a 5 V pulse for 50 ms. The 10 kΩ resistor and 1 µF capacitor have a 10.1 ms time constant including the oscillator’s 100 Ω output resistance. Each capture starts again from the DC operating point.',
    document: {
      ...createEmptyDocument(), title: 'Capacitor charge & decay', stimulus: 'step',
      instruments: { frequency: 220, amplitude: 5, waveform: 'sine', cv: 5 },
      parts: [{ id: 'R1', kind: 'resistor', value: 10_000, pins: ['a6', 'a17'] }, { id: 'C1', kind: 'electrolytic', value: 1e-6, pins: ['e17', 'f17'] }],
      wires: [{ id: 'W1', from: 'osc', to: 'b6', color: '#56c7c2' }, { id: 'W2', from: 'j17', to: 'bn17', color: '#6a839b' }, { id: 'W3', from: 'gnd', to: 'bn20', color: '#6a839b' }],
      probes: { CH1: 'd6', CH2: 'd17' },
    },
  },
  {
    id: 'opamp-amplifier', name: 'Op-amp gain stage', description: 'Double a signal with feedback and explicitly powered amplifier pins.',
    whatToChange: 'Change feedback resistor R1 from 10 kΩ to 20 kΩ.',
    whatToObserve: 'CH2 grows from about 5 V peak to 7.5 V peak while CH1 stays at 2.5 V. Larger gains clip near the supply limits.',
    why: 'Negative feedback makes the gain approximately 1 + R1/R2. U1 needs both visible supply connections; its output clips 1 V inside the rails. The unused amplifier is a grounded follower so its inputs stay defined.',
    document: {
      ...createEmptyDocument(), title: 'Op-amp gain stage',
      parts: [
        { id: 'U1', kind: 'opamp', value: 1, pins: ['e13', 'e14', 'e15', 'e16', 'f16', 'f15', 'f14', 'f13'] },
        { id: 'R1', kind: 'resistor', value: 10_000, pins: ['a13', 'a14'] },
        { id: 'R2', kind: 'resistor', value: 10_000, pins: ['c14', 'c9'] },
      ],
      wires: [
        { id: 'W1', from: 'osc', to: 'a15', color: '#56c7c2' },
        { id: 'W2', from: 'vplus', to: 'j13', color: '#d98870' },
        { id: 'W3', from: 'vminus', to: 'a16', color: '#798bbf' },
        { id: 'W4', from: 'gnd', to: 'bn5', color: '#6a839b' },
        { id: 'W5', from: 'd9', to: 'bn9', color: '#6a839b' },
        { id: 'W6', from: 'j16', to: 'bn10', color: '#6a839b' },
        { id: 'W7', from: 'j14', to: 'j15', color: '#c8a55b' },
      ],
      probes: { CH1: 'b15', CH2: 'b13' },
    },
  },
]
