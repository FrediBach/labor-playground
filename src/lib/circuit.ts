import { PICO_PINS, PROJECT_LIMITS, picoGround, validatePico, type PicoConfiguration } from './pico/profile.ts'
import { picoDriverLines } from './pico/electrical.ts'
import type { PicoTrace } from './pico/runtime.ts'
import { passiveExamples } from './passive-examples.ts'
import { picoExamples } from './pico/examples.ts'
import { activeExamples } from './active-examples.ts'
import { icExamples } from './ic-examples.ts'
import { automationExamples } from './automation-examples.ts'
import { timer555Lines } from './timer555.ts'
import { lm13700Lines } from './lm13700.ts'
import { SIMULATION_LIMITS } from './simulation-types.ts'
import { automationIssue, automationPhase, automationPwl, automationWaveformTiming, automationTimelines, scheduledAutomationEvents, validateAutomations, type Automation, type AutomationEvent, type AutomationTimelines } from './automations.ts'

export type ComponentKind = 'resistor' | 'capacitor' | 'inductor' | 'diode' | 'schottky' | 'zener' | 'led' | 'npn' | 'pnp' | 'switch' | 'potentiometer' | 'electrolytic' | 'opamp' | 'quadopamp' | 'timer555' | 'lm13700'

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

export interface EnvelopeSettings {
  mode: 'gate' | 'trigger' | 'envelope'
  gateHigh: boolean
  /** Exponential decay time constant in milliseconds. */
  decayMs: number
}

export const DEFAULT_ENVELOPE: Readonly<EnvelopeSettings> = Object.freeze({ mode: 'envelope', gateHigh: false, decayMs: 20 })

export interface CircuitDocument {
  schemaVersion: 1 | 2
  pico?: PicoConfiguration
  boardVersion: 'virtual-1'
  title: string
  /** Omitted in legacy documents: periodic oscillator capture. */
  stimulus?: 'periodic' | 'step'
  parts: Part[]
  wires: Wire[]
  probes: { CH1: string | null; CH2: string | null }
  /** Optional so legacy projects remain byte-for-byte compatible on import. */
  automations?: Automation[]
  instruments: {
    frequency: number
    amplitude: number
    waveform: 'sine' | 'triangle' | 'square'
    cv: number
    /** Omitted in earlier schema-1 documents; see DEFAULT_ENVELOPE. */
    envelope?: EnvelopeSettings
  }
}

/** Read defaults without changing or expanding legacy saved documents. */
export function envelopeSettings(document: Pick<CircuitDocument, 'instruments'>): Readonly<EnvelopeSettings> {
  return document.instruments.envelope ?? DEFAULT_ENVELOPE
}

export interface Terminal {
  id: string
  x: number
  y: number
  group: string
}

export interface PartDefinition {
  package?: 'DIP-8' | 'DIP-14' | 'DIP-16'
  supplyHint?: string
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
  inductor: {
    pinNames: ['1', '2'],
    label: 'Inductor', unit: 'H', defaultValue: 10e-3, min: 1e-6, max: 10,
    description: 'Stores energy in a magnetic field and resists changes in current.',
    model: 'Linear inductor with a fixed 1 Ω series winding resistance. No magnetic saturation, core loss, coupling, or thermal model. Current starts at the DC operating point on every capture.',
  },
  diode: {
    pinNames: ['Anode', 'Cathode'],
    label: 'Signal diode', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Conducts from the first lead (anode) to the striped lead (cathode).',
    model: 'Generic silicon diode: Is=2.52 nA, N=1.752, Rs=0.568 Ω, Cjo=4 pF. Educational model, not a named manufacturer part.',
  },
  schottky: {
    pinNames: ['Anode', 'Cathode'],
    label: 'Schottky diode', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'A diode with a lower forward voltage. The stripe marks its cathode.',
    model: 'Generic Schottky-like diode: Is=200 nA, N=1.05, Rs=0.2 Ω, Cjo=10 pF, Eg=0.69 eV. No reverse-breakdown or damage model. Educational model, not a named manufacturer part.',
  },
  zener: {
    pinNames: ['Anode', 'Cathode'],
    label: 'Zener diode', unit: 'V', defaultValue: 5.1, min: 2.4, max: 24,
    description: 'Limits reverse voltage near its nominal breakdown voltage. Add a series resistor.',
    model: 'Generic zener diode with editable nominal breakdown voltage (BV), specified at 1 mA (IBV); Is=1 pA, N=1, Rs=2 Ω, Cjo=50 pF. The actual voltage depends on current. Forward conduction is also modeled; no tolerance, thermal, or damage model.',
  },
  led: {
    pinNames: ['Anode', 'Cathode'],
    label: 'Red LED', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'A light-emitting diode. Add a series resistor to limit current.',
    model: 'Generic red LED diode: Is=1e-20 A, N=2, Rs=5 Ω. Fixed model; visual glow is not a calibrated brightness measurement.',
  },
  npn: {
    pinNames: ['Collector', 'Base', 'Emitter'],
    label: 'NPN transistor', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'A small base current controls collector current. Pins are C, B, E in that order.',
    model: 'Generic NPN bipolar transistor: Is=10 fA, forward beta=100, reverse beta=1, Early voltage=100 V, Cje=10 pF, Cjc=4 pF, Tf=0.5 ns, Tr=10 ns. Fixed educational C–B–E package; not a manufacturer pinout. No breakdown, thermal, or damage model.',
  },
  pnp: {
    pinNames: ['Collector', 'Base', 'Emitter'],
    label: 'PNP transistor', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'The complementary bipolar transistor. Pins are C, B, E in that order.',
    model: 'Generic PNP bipolar transistor: Is=10 fA, forward beta=100, reverse beta=1, Early voltage=100 V, Cje=10 pF, Cjc=4 pF, Tf=0.5 ns, Tr=10 ns. Fixed educational C–B–E package; not a manufacturer pinout. No breakdown, thermal, or damage model.',
  },
  switch: {
    pinNames: ['1', '2'],
    label: 'Switch', unit: '', defaultValue: 1, min: 0, max: 1,
    description: 'Open or close a connection between two holes.',
    model: 'Two-terminal switch represented by 1 Ω closed or 1 GΩ open to avoid an ideal zero-resistance branch. Automations can change its state during a recording.',
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
    package: 'DIP-8',
    supplyHint: 'Connect pin 8 to the positive supply and pin 4 to the negative supply. Both amplifiers share these rails.',
    pinNames: ['OUT A', 'IN− A', 'IN+ A', 'V−', 'IN+ B', 'IN− B', 'OUT B', 'V+'],
    label: 'TL072-style dual op-amp', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Two feedback amplifiers with the TL072 DIP-8 pinout. Build buffers, mixers, and active filters on shared supply rails.',
    model: 'Educational dual op-amp with the TL072 pinout, not a manufacturer-calibrated TL072 model. Gain 100,000, 100 MΩ differential input resistance and 50 Ω output resistance. Outputs clip 1 V inside the connected supply rails; more than 2 V rail separation is required. No bandwidth, slew rate, input common-mode limit, supply-current, noise or damage model. Both halves require input connections.',
  },

  quadopamp: {
    package: 'DIP-14',
    supplyHint: 'Connect pin 4 to the positive supply and pin 11 to the negative supply, usually ±12 V. All four amplifiers share these rails. Wire unused sections as grounded followers.',
    pinNames: ['OUT A', 'IN− A', 'IN+ A', 'V+', 'IN+ B', 'IN− B', 'OUT B', 'OUT C', 'IN− C', 'IN+ C', 'V−', 'IN+ D', 'IN− D', 'OUT D'],
    label: 'TL074-style quad op-amp', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Four feedback amplifiers with the TL074 DIP-14 pinout. Build buffers, mixers, and active filters on shared supply rails.',
    model: 'Educational quad op-amp with the TL074 pinout, not a manufacturer-calibrated TL074 model. Each section has gain 10,000, 100 MΩ differential input resistance and 50 Ω output resistance. Outputs clip 1 V inside the connected rails; more than 2 V rail separation is required. All eight inputs need external DC returns. No bandwidth, slew rate, common-mode limits, bias current, supply-current, noise, or damage model.',
  },
  timer555: {
    package: 'DIP-8',
    supplyHint: 'Connect pin 1 to GND and pin 8 to a positive 4.5–16 V supply. Tie RESET (pin 4) high unless you drive it. CTRL (pin 5) may be left open or bypassed to GND with 10 nF.',
    pinNames: ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THRESH', 'DISCH', 'VCC'],
    label: '555 timer', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'An eight-pin timer for clocks, gate pulses, and oscillators. External resistors and a capacitor set its timing.',
    model: 'Educational bipolar 555 approximation with a three-5 kΩ CTRL divider and stateful latch. Nominal thresholds are 1/3 and 2/3 of VCC; CTRL shifts both. RESET below 0.7 V overrides TRIG, which overrides THRESH. Supply 4.5–16 V; output resistance 50 Ω, high target VCC−1.2 V, low target 0.1 V; discharge 10 Ω on / 1 GΩ off. A 1 µs power-on reset initializes every capture, so DC analysis shows reset. No calibrated manufacturer timing, supply spikes, tolerances, thermal, or damage model.',
  },
  lm13700: {
    package: 'DIP-16',
    supplyHint: 'Connect pin 11 to V+ and pin 6 to V−, usually ±12 V. Feed IABC through a resistor to control gain. Feed diode-bias pins through resistors or leave them open. Both OTA inputs need DC returns. Buffers need an external pull-down to V−; unused buffer pins may stay open.',
    pinNames: ['IABC A', 'DIODE A', 'IN+ A', 'IN− A', 'OUT A', 'V−', 'BUF IN A', 'BUF OUT A', 'BUF OUT B', 'BUF IN B', 'V+', 'OUT B', 'IN− B', 'IN+ B', 'DIODE B', 'IABC B'],
    label: 'LM13700-style dual OTA', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Two current-controlled transconductance amplifiers for VCAs and filters. OUT supplies current; add a load resistor or a current-to-voltage amplifier to obtain a voltage.',
    model: 'Educational LM13700 approximation with the DIP-16 pinout. Bias current controls each OTA’s transconductance and maximum output current. Includes differential-input saturation, output compliance, linearizing diodes and sourcing-only buffers. Supply 9.5–32 V total. Not a manufacturer-calibrated model; bandwidth, noise, offset, temperature drift and damage are not modeled.',
  },
}

interface AmplifierPins {
  negative: number
  positive: number
  /** Zero-based [output, inverting input, noninverting input] for each section. */
  sections: [number, number, number][]
}
const amplifierPinouts: Partial<Record<ComponentKind, AmplifierPins>> = {
  opamp: { negative: 3, positive: 7, sections: [[0, 1, 2], [6, 5, 4]] },
  quadopamp: { negative: 10, positive: 3, sections: [[0, 1, 2], [6, 5, 4], [7, 8, 9], [13, 12, 11]] },
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
  ...PICO_PINS.filter(pin => pin.supported),
  ...['osc', 'cv', 'gnd', 'vplus', 'vminus'].map((id, index) => ({ id, x: 135 + index * 160, y: 52, group: id })),
  { id: 'eg', x: 855, y: 52, group: 'eg' },
]

export const terminalById: Record<string, Terminal> = Object.fromEntries(TERMINALS.map((terminal) => [terminal.id, terminal]))

export function createEmptyDocument(): CircuitDocument {
  return {
    schemaVersion: 1, boardVersion: 'virtual-1', title: 'Untitled circuit',
    parts: [], wires: [], probes: { CH1: null, CH2: null },
    instruments: { frequency: 220, amplitude: 2.5, waveform: 'sine', cv: 5 },
  }
}

/** DIP packages straddle the trench only, with pin 1 at eN or fN. */
export function getPlacement(kind: ComponentKind, holeId: string, rotation = 0): string[] | null {
  const match = /^([a-j])(\d{1,2})$/.exec(holeId)
  if (!match || !Object.hasOwn(terminalById, holeId) || !Object.hasOwn(PARTS, kind)) return null
  const column = Number(match[2])
  const row = rows.indexOf(match[1])
  const direction = ((Math.round(rotation / 90) % 4) + 4) % 4
  if (PARTS[kind].package) {
    const perSide = PARTS[kind].pinNames.length / 2
    const offsets = Array.from({ length: perSide }, (_, index) => index)
    if (direction === 0 && match[1] === 'e' && column <= 31 - perSide) {
      return offsets.map(offset => `e${column + offset}`).concat([...offsets].reverse().map(offset => `f${column + offset}`))
    }
    if (direction === 2 && match[1] === 'f' && column >= perSide) {
      return offsets.map(offset => `f${column - offset}`).concat([...offsets].reverse().map(offset => `e${column - offset}`))
    }
    return null
  }
  const threeLead = kind === 'potentiometer' || kind === 'npn' || kind === 'pnp'
  const span = kind === 'capacitor' || kind === 'electrolytic' || threeLead ? 1 : 3
  const count = threeLead ? 3 : 2
  const pins = Array.from({ length: count }, (_, index) => {
    const nextColumn = column + (direction === 0 ? span : direction === 2 ? -span : 0) * index
    const nextRow = row + (direction === 1 ? span : direction === 3 ? -span : 0) * index
    return nextColumn < 1 || nextColumn > 30 || nextRow < 0 || nextRow >= rows.length ? null : `${rows[nextRow]}${nextColumn}`
  })
  if (threeLead && pins.some((pin) => pin !== null && (rows.indexOf(pin[0]) < 5) !== (row < 5))) return null
  return pins.some((pin) => pin === null) ? null : pins as string[]
}

/** Legacy two-lead parts keep arbitrary lead spacing; rigid new packages do not. */
export function isValidFootprint(kind: ComponentKind, pins: string[]): boolean {
  if (!Object.hasOwn(PARTS, kind) || pins.length !== PARTS[kind].pinNames.length || new Set(pins).size !== pins.length) return false
  if (pins.some((pin) => !Object.hasOwn(terminalById, pin) || !/^(?:[a-j]|tp|tn|bp|bn)\d+$/.test(pin))) return false
  if (!PARTS[kind].package && kind !== 'potentiometer' && kind !== 'npn' && kind !== 'pnp') return true
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
  if (!serialized || new TextEncoder().encode(serialized).length > PROJECT_LIMITS.bytes) throw new Error('Project files must be smaller than 200 kB.')
  const raw = object(input, 'Circuit')
  if (![1, 2].includes(raw.schemaVersion as number) || raw.boardVersion !== 'virtual-1') throw new Error('Unsupported circuit or board version.')
  if (typeof raw.title !== 'string' || raw.title.length > 100) throw new Error('Circuit title must contain at most 100 characters.')
  if (!Array.isArray(raw.parts) || raw.parts.length > 30) throw new Error('A circuit may contain up to 30 components.')
  if (!Array.isArray(raw.wires) || raw.wires.length > 120) throw new Error('A circuit may contain up to 120 wires.')
  if (raw.pico !== undefined && raw.schemaVersion !== 2) throw new Error('Pico projects require schema version 2.')
  const pico = raw.pico === undefined ? undefined : validatePico(raw.pico)
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
    if (value.startsWith('pico:') && !pico) throw new Error('A Pico terminal requires a Pico board.')
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
    if (!isValidFootprint(kind, pins)) throw new Error(`${id} has an invalid ${definition.label.toLowerCase()} footprint. ${definition.package ? `Place all ${definition.pinNames.length} pins across the center trench at 0° or 180°.` : 'Use the supported breadboard pin positions.'}`)
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
  let envelope: EnvelopeSettings | undefined
  if (instruments.envelope !== undefined) {
    const settings = object(instruments.envelope, 'Envelope settings')
    if (Object.keys(settings).some((key) => !['mode', 'gateHigh', 'decayMs'].includes(key))) throw new Error('Unsupported envelope setting.')
    if (!['gate', 'trigger', 'envelope'].includes(settings.mode as string)) throw new Error('Unsupported envelope mode.')
    if (typeof settings.gateHigh !== 'boolean') throw new Error('Envelope gateHigh must be true or false.')
    const decayMs = finiteNumber(settings.decayMs, 'Envelope decay', 1, 40)
    envelope = { mode: settings.mode as EnvelopeSettings['mode'], gateHigh: settings.gateHigh, decayMs }
  }
  const probes = object(raw.probes, 'Probes')
  if (raw.stimulus !== undefined && raw.stimulus !== 'periodic' && raw.stimulus !== 'step') throw new Error('Unsupported capture stimulus.')
  return {
    schemaVersion: raw.schemaVersion as 1 | 2, boardVersion: 'virtual-1', title: raw.title,
    ...(pico ? { pico } : {}),
    parts, wires,
    ...(raw.automations === undefined ? {} : { automations: validateAutomations(raw.automations, parts) }),
    ...(raw.stimulus === undefined ? {} : { stimulus: raw.stimulus as CircuitDocument['stimulus'] }),
    instruments: { frequency, amplitude, cv, waveform: instruments.waveform as CircuitDocument['instruments']['waveform'], ...(envelope === undefined ? {} : { envelope }) },
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

/** Injective SPICE-safe suffix shared by emitted devices and measurement vectors. */
export function spiceDeviceId(part: Pick<Part, 'id'>): string {
  return part.id.replace(/[^a-zA-Z0-9]/g, (character) => `_${character.charCodeAt(0).toString(16)}`)
}

/** Shared connectivity for wires, Pico grounds, compiler and probing. */
export function resolveTopology(doc: CircuitDocument) {
  const terminals = TERMINALS.filter(pin => doc.pico || !pin.id.startsWith('pico:'))
  const parent = new Map(terminals.map(({ id }) => [id, id]))
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
  for (const terminal of terminals) {
    const first = firstInGroup.get(terminal.group)
    if (first) union(first, terminal.id)
    else firstInGroup.set(terminal.group, terminal.id)
  }
  for (const wire of doc.wires) union(wire.from, wire.to)
  const rootToNode = new Map<string, string>([[find('gnd'), '0']])
  // Root names make output deterministic regardless of wire or component array order.
  const roots = [...new Set(terminals.map(({ id }) => find(id)))].sort()
  for (const root of roots) if (!rootToNode.has(root)) rootToNode.set(root, `n${rootToNode.size}`)
  const nodeByTerminal = Object.fromEntries(terminals.map(({ id }) => [id, rootToNode.get(find(id))!]))
  const nets: Record<string, string[]> = {}
  for (const { id } of terminals) (nets[nodeByTerminal[id]] ??= []).push(id)
  return { nodeByTerminal, nets }
}

export function compileCircuit(document: CircuitDocument, analysis: 'transient' | 'operating-point' = 'transient', picoTrace?: PicoTrace, durationSeconds = 0.1, automationEvents?: readonly AutomationEvent[]): CompiledCircuit {
  const diagnostics: Diagnostic[] = []
  let doc: CircuitDocument
  try { doc = validateDocument(document) } catch (error) {
    return { netlist: '', diagnostics: [{ severity: 'error', message: error instanceof Error ? error.message : 'Invalid circuit document.' }], nodeByTerminal: {}, nets: {} }
  }
  const { nodeByTerminal, nets } = resolveTopology(doc)
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.001 || durationSeconds > SIMULATION_LIMITS.maxDurationSeconds) {
    diagnostics.push({ severity: 'error', message: `Choose a simulation duration between 1 ms and ${SIMULATION_LIMITS.maxDurationSeconds} s.` })
    return { netlist: '', diagnostics, nodeByTerminal, nets }
  }
  if (picoTrace && Math.abs(picoTrace.durationNs / 1e9 - durationSeconds) > 1e-9) {
    diagnostics.push({ severity: 'error', message: 'The Pico recording and circuit simulation must have the same duration. Run the simulation again.' })
  }
  for (const automation of doc.automations ?? []) {
    const issue = automation.enabled ? automationIssue(automation, doc, durationSeconds) : null
    if (issue) diagnostics.push({ severity: 'warning', message: `${automation.name}: ${issue}`, ...(automation.action.partId ? { partId: automation.action.partId } : {}) })
  }
  const timelines: AutomationTimelines = analysis === 'transient' ? automationTimelines(doc, automationEvents ?? scheduledAutomationEvents(doc, durationSeconds), durationSeconds) : new Map()
  const controlNodes = new Map([...timelines.keys()].map((key, index) => [key, `automation_${index}`]))
  const control = (key: string, fallback: number) => controlNodes.has(key) ? `v(${controlNodes.get(key)})` : spiceNumber(fallback)
  const usedTerminals = [...doc.parts.flatMap((part) => part.pins), ...doc.wires.flatMap((wire) => [wire.from, wire.to]), ...Object.values(doc.probes).filter((probe): probe is string => probe !== null)]
  const activeNodes = new Set(usedTerminals.map((terminal) => nodeByTerminal[terminal]))
  if (activeNodes.size > 60) diagnostics.push({ severity: 'error', message: 'This workbench supports up to 60 connected circuit nodes. Simplify the circuit before capturing.' })
  if (doc.pico && nodeByTerminal[picoGround] !== '0') diagnostics.push({ severity: 'error', message: 'Connect a Pico GND pin to workbench GND before capturing.' })
  const idealSources = ['gnd', 'cv', 'vplus', 'vminus']
  for (let a = 0; a < idealSources.length; a++) {
    for (let b = a + 1; b < idealSources.length; b++) {
      if (nodeByTerminal[idealSources[a]] === nodeByTerminal[idealSources[b]]) diagnostics.push({ severity: 'error', message: `Supply short: ${idealSources[a].toUpperCase()} is directly connected to ${idealSources[b].toUpperCase()}. Remove the jumper before capturing.` })
    }
  }
  for (const source of ['osc', 'eg']) {
    if (nodeByTerminal[source] === '0') diagnostics.push({ severity: 'warning', message: `${source.toUpperCase()} is shorted to ground. Its virtual 100 Ω output resistor limits the current.` })
  }
  const dcEdges = new Map<string, Set<string>>()
  const addEdge = (a: string, b: string) => {
    if (!dcEdges.has(a)) dcEdges.set(a, new Set())
    if (!dcEdges.has(b)) dcEdges.set(b, new Set())
    dcEdges.get(a)!.add(b)
    dcEdges.get(b)!.add(a)
  }
  if (doc.pico) for (const pin of PICO_PINS.filter(pin => pin.supported)) addEdge(nodeByTerminal[pin.id], nodeByTerminal[picoGround])
  const fixedVoltages = new Map([
    [nodeByTerminal.gnd, 0], [nodeByTerminal.cv, doc.instruments.cv],
    [nodeByTerminal.vplus, 12], [nodeByTerminal.vminus, -12],
  ])
  for (const part of doc.parts) {
    const nodes = part.pins.map((pin) => nodeByTerminal[pin])
    const [a, b, c] = nodes
    if (PARTS[part.kind].package) continue
    if (part.kind === 'potentiometer' || part.kind === 'npn' || part.kind === 'pnp') {
      if (a === b || b === c || a === c) diagnostics.push({ severity: 'warning', message: `${part.id} has terminals on the same electrical net. ${part.kind === 'potentiometer' ? 'A potentiometer needs three separate strips to act as a divider.' : 'Use three separate strips for the collector, base, and emitter.'}`, partId: part.id })
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
  const referenced = new Set(['gnd', 'osc', 'cv', 'vplus', 'vminus', 'eg'].map((pin) => nodeByTerminal[pin]))
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
  for (const part of doc.parts.filter(part => amplifierPinouts[part.kind])) {
    const layout = amplifierPinouts[part.kind]!
    const nodes = part.pins.map(pin => nodeByTerminal[pin])
    const negative = nodes[layout.negative]
    const positive = nodes[layout.positive]
    let powered = true
    for (const index of [layout.negative, layout.positive]) {
      const label = `${PARTS[part.kind].pinNames[index]} (pin ${index + 1})`
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
      for (const [output] of layout.sections) addEdge(nodes[output], negative)
    }
  }
  traceReferences()
  for (const part of doc.parts.filter(part => part.kind === 'timer555')) {
    const nodes = part.pins.map(pin => nodeByTerminal[pin])
    const ground = nodes[0]
    const supply = nodes[7]
    let powered = true
    for (const index of [0, 7]) {
      if (!referenced.has(nodes[index])) {
        diagnostics.push({ severity: 'error', message: `${part.id} ${PARTS.timer555.pinNames[index]} (pin ${index + 1}) has no connected supply. Wire GND and VCC to referenced DC supplies.`, partId: part.id })
        powered = false
      }
    }
    if (ground === supply) {
      diagnostics.push({ severity: 'error', message: `${part.id} GND and VCC are on the same net. The 555 model needs 4.5–16 V from VCC to GND.`, partId: part.id })
      powered = false
    } else if (fixedVoltages.has(supply) && fixedVoltages.has(ground)) {
      const voltage = fixedVoltages.get(supply)! - fixedVoltages.get(ground)!
      if (voltage < 4.5 || voltage > 16) {
        diagnostics.push({ severity: 'error', message: `${part.id} supply is ${voltage} V. The 555 model needs 4.5–16 V from VCC to GND.`, partId: part.id })
        powered = false
      }
    } else if (powered) {
      diagnostics.push({ severity: 'warning', message: `${part.id} supply voltage depends on the circuit. Keep VCC 4.5–16 V above GND for the 555 model.`, partId: part.id })
    }
    if (powered) {
      // Real internal paths: driven output, CTRL resistor divider, discharge
      // switch (including modeled off leakage). Inputs never gain hidden returns.
      for (const index of [2, 4, 6]) addEdge(nodes[index], ground)
    }
  }
  traceReferences()
  const externalReferences = new Set(referenced)
  const loadEdges = new Map([...dcEdges].map(([node, neighbors]) => [node, new Set(neighbors)]))
  for (const part of doc.parts.filter(part => part.kind === 'lm13700')) {
    const nodes = part.pins.map(pin => nodeByTerminal[pin])
    const negative = nodes[5]
    const positive = nodes[10]
    let powered = true
    for (const index of [5, 10]) {
      if (!externalReferences.has(nodes[index])) {
        diagnostics.push({ severity: 'error', message: `${part.id} ${PARTS.lm13700.pinNames[index]} (pin ${index + 1}) has no connected supply. Wire V+ and V− to referenced DC supplies.`, partId: part.id })
        powered = false
      }
    }
    if (positive === negative) {
      diagnostics.push({ severity: 'error', message: `${part.id} supply pins are on the same net. The LM13700 model needs 9.5–32 V from V+ to V−.`, partId: part.id })
      powered = false
    } else if (fixedVoltages.has(positive) && fixedVoltages.has(negative)) {
      const span = fixedVoltages.get(positive)! - fixedVoltages.get(negative)!
      if (span < 9.5 || span > 32) {
        diagnostics.push({ severity: 'error', message: `${part.id} supply is ${span} V. The LM13700 model needs 9.5–32 V from V+ to V−.`, partId: part.id })
        powered = false
      }
    } else if (powered) {
      diagnostics.push({ severity: 'warning', message: `${part.id} supply voltage depends on the circuit. Keep V+ 9.5–32 V above V− for the LM13700 model.`, partId: part.id })
    }
    for (const index of [0, 15]) {
      if (fixedVoltages.has(nodes[index]) && fixedVoltages.has(negative) && fixedVoltages.get(nodes[index])! > fixedVoltages.get(negative)!) {
        diagnostics.push({ severity: 'error', message: `${part.id} ${PARTS.lm13700.pinNames[index]} (pin ${index + 1}) is directly connected to a supply. Feed bias current through a resistor; connect an unused IABC to V− or leave it open.`, partId: part.id })
      }
    }
    for (const [diode, plus, minus] of [[1, 2, 3], [14, 13, 12]]) {
      const diodeVoltage = fixedVoltages.get(nodes[diode])
      if (diodeVoltage !== undefined && [plus, minus].some(index => {
        const inputVoltage = fixedVoltages.get(nodes[index])
        return inputVoltage !== undefined && diodeVoltage - inputVoltage > 0.7
      })) {
        diagnostics.push({ severity: 'error', message: `${part.id} ${PARTS.lm13700.pinNames[diode]} (pin ${diode + 1}) is directly forward-biased by a supply. Feed diode-bias current through a resistor or leave the pin open.`, partId: part.id })
      }
    }
    if (powered) {
      // Bias junctions and finite OTA output resistance return to the supplies.
      // Buffer transistor junctions also allow unused buffer pins to stay open.
      // Never use these paths to hide a missing differential-input return.
      for (const index of [0, 4, 11, 15]) addEdge(nodes[index], negative)
      for (const index of [6, 7, 8, 9]) addEdge(nodes[index], positive)
      for (const index of [7, 8]) {
        const connected = doc.wires.some(wire => nodes[index] === nodeByTerminal[wire.from] || nodes[index] === nodeByTerminal[wire.to])
          || doc.parts.some(other => other !== part && other.pins.some(pin => nodes[index] === nodeByTerminal[pin]))
          || Object.values(doc.probes).some(pin => pin !== null && nodes[index] === nodeByTerminal[pin])
        const inputVoltage = fixedVoltages.get(nodes[index === 7 ? 6 : 9])
        const visited = new Set<string>()
        const queue = [nodes[index]]
        let hasPullDown = false
        while (queue.length) {
          const node = queue.pop()!
          if (visited.has(node)) continue
          visited.add(node)
          const loadVoltage = fixedVoltages.get(node)
          if (node === negative || (inputVoltage !== undefined && loadVoltage !== undefined && loadVoltage < inputVoltage - 1.4)) {
            hasPullDown = true
            break
          }
          // A path through V+ is a pull-up, even if another rail load eventually
          // leads to ground. Stop at every source rather than traversing it.
          if (node === positive || fixedVoltages.has(node)) continue
          for (const next of loadEdges.get(node) ?? []) queue.push(next)
        }
        if (connected && !hasPullDown) {
          diagnostics.push({ severity: 'warning', message: `${part.id} ${PARTS.lm13700.pinNames[index]} (pin ${index + 1}) needs an external pull-down/load to V− for its sourcing-only buffer.`, partId: part.id })
        }
      }
    }
  }
  traceReferences()
  for (const part of doc.parts.filter(part => part.kind === 'lm13700')) {
    const nodes = part.pins.map(pin => nodeByTerminal[pin])
    // Linearizing diodes may be left open. They reference the diode-bias pin
    // through an already-connected input, without validating a floating input.
    for (const [diode, plus, minus] of [[1, 2, 3], [14, 13, 12]]) {
      for (const input of [plus, minus]) if (referenced.has(nodes[input])) addEdge(nodes[diode], nodes[input])
    }
  }
  traceReferences()
  const warnedFloating = new Set<string>()
  for (const part of doc.parts) {
    for (const [index, pin] of part.pins.entries()) {
      const node = nodeByTerminal[pin]
      if (!referenced.has(node) && !warnedFloating.has(node)) {
        const input = amplifierPinouts[part.kind]?.sections.some(([, minus, plus]) => index === minus || index === plus)
        diagnostics.push({ severity: 'error', message: input
          ? `${part.id} ${PARTS[part.kind].pinNames[index]} (pin ${index + 1}) at ${pin} is floating. Connect an external DC return; wire unused amplifiers as grounded followers.`
          : `${part.id}${PARTS[part.kind].package ? ` ${PARTS[part.kind].pinNames[index]} (pin ${index + 1})` : ''} at ${pin} has no DC path to GND. Connect a return path; capacitors do not provide a DC connection.`, partId: part.id })
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
    '* Pico Labor virtual-1; local educational circuit',
    ...(activeNodes.has(nodeByTerminal.osc) ? ['VOSC osc_internal 0 ' + stimulus, `ROSC osc_internal ${nodeByTerminal.osc} 100`] : []),
    controlNodes.has('cv') ? `BCV ${nodeByTerminal.cv} 0 V = ${control('cv', cv)}` : `VCV ${nodeByTerminal.cv} 0 ${spiceNumber(cv)}`,
    `VPLUS ${nodeByTerminal.vplus} 0 12`,
    `VMINUS ${nodeByTerminal.vminus} 0 -12`,
    '.model D_SIGNAL D(Is=2.52e-9 N=1.752 Rs=0.568 Cjo=4e-12)',
    '.model D_RED D(Is=1e-20 N=2 Rs=5 Cjo=10e-12)',
    '.model D_SCHOTTKY D(Is=2e-7 N=1.05 Rs=0.2 Cjo=10e-12 Eg=0.69)',
    '.model Q_NPN NPN(Is=1e-14 Bf=100 Br=1 Vaf=100 Cje=10e-12 Cjc=4e-12 Tf=0.5e-9 Tr=10e-9)',
    '.model Q_PNP PNP(Is=1e-14 Bf=100 Br=1 Vaf=100 Cje=10e-12 Cjc=4e-12 Tf=0.5e-9 Tr=10e-9)',
  ]
  for (const [key, points] of timelines) lines.push(`V_${controlNodes.get(key)} ${controlNodes.get(key)} 0 ${automationPwl(points)}`)
  if (activeNodes.has(nodeByTerminal.osc) && (timelines.has('amplitude') || timelines.has('frequency'))) {
    const frequencyPoints = timelines.get('frequency') ?? [{ time: 0, value: frequency }]
    const phase = automationPhase(frequencyPoints)
    const fraction = `(${phase}-floor(${phase}))`
    const wave = waveform === 'sine' ? `sin(6.283185307179586*${phase})`
      : waveform === 'triangle' ? `(1-4*abs(${fraction}-0.5))`
        : 'v(automation_wave)'
    const index = lines.findIndex(line => line.startsWith('VOSC '))
    lines[index] = `BOSC osc_internal 0 V = ${control('amplitude', amplitude)}*${doc.stimulus === 'step' ? 'v(automation_step)' : wave}`
    if (doc.stimulus === 'step') lines.push('VAUTOSTEP automation_step 0 PULSE(0 1 0.001 1e-6 1e-6 0.049999 1)')
    // Native sources force exact edge/corner solver breakpoints. Triangle still
    // uses the analytic phase expression above: a frequency ramp makes each
    // slope quadratic in time, which linear PWL vertices alone cannot preserve.
    else if (waveform !== 'sine') lines.push(`VAUTOWAVE automation_wave 0 ${automationPwl(automationWaveformTiming(frequencyPoints, durationSeconds, waveform))}`)
  }
  if (doc.pico) {
    try { lines.push(...picoDriverLines(nodeByTerminal, activeNodes, picoTrace, analysis === 'operating-point')) }
    catch (error) { diagnostics.push({ severity: 'error', message: error instanceof Error ? error.message : 'Invalid Pico trace.' }) }
  }
  const envelope = envelopeSettings(doc)
  if (activeNodes.has(nodeByTerminal.eg)) {
    if (envelope.mode === 'gate') {
      lines.push(timelines.has('gate') ? `BEG eg_internal 0 V = 5*${control('gate', Number(envelope.gateHigh))}` : `VEG eg_internal 0 ${envelope.gateHigh ? 5 : 0}`)
    } else if (envelope.mode === 'trigger') {
      // A finite PWL pulse keeps exact edge breakpoints without a second periodic
      // clock competing with the oscillator's square/triangle source.
      lines.push('VEG eg_internal 0 PWL(0 0 0.001 0 0.001001 5 0.002 5 0.002001 0)')
    } else {
      // Native EXP avoids interacting timing-source breakpoints when OSC is square.
      // A 0.1 µs rise constant reaches 99.995% of 5 V by the 1 µs decay onset.
      lines.push(`VEG eg_internal 0 EXP(0 5 0.001 1e-7 0.001001 ${spiceNumber(envelope.decayMs / 1000)})`)
    }
    lines.push(`REG eg_internal ${nodeByTerminal.eg} 100`)
  }
  // Fixed templates emit at most 23 devices / 4 internal nodes per part
  // (LM13700); the 30-part limit bounds expansion to 690 devices / 120 nodes.
  for (const part of [...doc.parts].sort((a, b) => a.id.localeCompare(b.id))) {
    const [a, b] = part.pins.map((pin) => nodeByTerminal[pin])
    const safeId = spiceDeviceId(part)
    if (part.kind === 'resistor') lines.push(`R_${safeId} ${a} ${b} ${spiceNumber(part.value)}`)
    if (part.kind === 'capacitor' || part.kind === 'electrolytic') lines.push(`C_${safeId} ${a} ${b} ${spiceNumber(part.value)}`)
    if (part.kind === 'inductor') {
      lines.push(`L_${safeId} ${a} ind_${safeId} ${spiceNumber(part.value)}`)
      lines.push(`RL_${safeId} ind_${safeId} ${b} 1`)
    }
    if (part.kind === 'diode' || part.kind === 'led' || part.kind === 'schottky') lines.push(`D_${safeId} ${a} ${b} ${part.kind === 'led' ? 'D_RED' : part.kind === 'schottky' ? 'D_SCHOTTKY' : 'D_SIGNAL'}`)
    if (part.kind === 'zener') {
      lines.push(`.model DZ_${safeId} D(Is=1e-12 N=1 Rs=2 Cjo=50e-12 Bv=${spiceNumber(part.value)} Ibv=1e-3)`)
      lines.push(`D_${safeId} ${a} ${b} DZ_${safeId}`)
    }
    if (part.kind === 'npn' || part.kind === 'pnp') lines.push(`Q_${safeId} ${a} ${b} ${nodeByTerminal[part.pins[2]]} ${part.kind === 'npn' ? 'Q_NPN' : 'Q_PNP'}`)
    if (part.kind === 'switch') lines.push(timelines.has(`switch:${part.id}`)
      ? `BA_${safeId} ${a} ${b} I = v(${a},${b})/(1+(1-${control(`switch:${part.id}`, part.value)})*999999999)`
      : `R_${safeId} ${a} ${b} ${part.value === 1 ? '1' : '1e9'}`)
    if (part.kind === 'potentiometer') {
      const position = part.position ?? 0.5
      const c = nodeByTerminal[part.pins[2]]
      if (timelines.has(`potentiometer:${part.id}`)) {
        lines.push(`BA_${safeId}_ccw ${a} ${b} I = v(${a},${b})/max(1,${control(`potentiometer:${part.id}`, position)}*${spiceNumber(part.value)})`)
        lines.push(`BA_${safeId}_cw ${b} ${c} I = v(${b},${c})/max(1,(1-${control(`potentiometer:${part.id}`, position)})*${spiceNumber(part.value)})`)
      } else {
        lines.push(`RP_${safeId}_ccw ${a} ${b} ${spiceNumber(Math.max(1, position * part.value))}`)
        lines.push(`RP_${safeId}_cw ${b} ${c} ${spiceNumber(Math.max(1, (1 - position) * part.value))}`)
      }
    }
    if (part.kind === 'timer555') lines.push(...timer555Lines(safeId, part.pins.map(pin => nodeByTerminal[pin])))
    if (part.kind === 'lm13700') lines.push(...lm13700Lines(safeId, part.pins.map(pin => nodeByTerminal[pin])))
    const layout = amplifierPinouts[part.kind]
    if (layout) {
      const nodes = part.pins.map(pin => nodeByTerminal[pin])
      const negative = nodes[layout.negative]
      const positive = nodes[layout.positive]
      // Lower finite gain keeps cascaded quad sections numerically stable when
      // clipping while retaining <0.1% closed-loop error in the tested utilities.
      const gain = part.kind === 'quadopamp' ? '1e4' : '1e5'
      for (const [section, pins] of layout.sections.entries()) {
        const half = 'abcd'[section]
        const [output, inverting, noninverting] = pins.map(index => nodes[index])
        const internal = `op_${safeId}_${half}`
        const span = `v(${positive},${negative})`
        // The behavioral source returns to the visible V− pin, never to an
        // invented power rail. The available swing collapses continuously as
        // supplies ramp down, keeping .op source stepping well-conditioned.
        const swing = `max(0,${span}/2-1)`
        lines.push(`BO_${safeId}_${half} ${internal} ${negative} V = max(0,${span})/2+max(-${swing},min(${swing},${gain}*v(${noninverting},${inverting})))`)
        lines.push(`RO_${safeId}_${half} ${internal} ${output} 50`)
        lines.push(`RI_${safeId}_${half} ${noninverting} ${inverting} 1e8`)
      }
    }
  }
  // Bound the interpolation error of periodic inputs; otherwise let ngspice's
  // local-error control and source breakpoints refine a modest baseline grid.
  // Unconnected instruments must not force tiny steps for a slow/DC circuit.
  const timers = doc.parts.filter(part => part.kind === 'timer555')
  let timerStep = Infinity
  for (const timer of timers) {
    const timingNodes = new Set([1, 5, 6].map(index => nodeByTerminal[timer.pins[index]]))
    const capacitors = doc.parts.filter(part => (part.kind === 'capacitor' || part.kind === 'electrolytic') && part.pins.some(pin => timingNodes.has(nodeByTerminal[pin])))
    const resistors = doc.parts.filter(part => part.kind === 'resistor' && part.pins.some(pin => timingNodes.has(nodeByTerminal[pin])))
    // Behavioral latch thresholds need explicit resolution as well as LTE
    // control. Slow blinkers can still take proportionally larger steps.
    timerStep = Math.min(timerStep, capacitors.length && resistors.length
      ? Math.min(...capacitors.map(part => part.value)) * Math.min(...resistors.map(part => part.value)) / 50
      : 1e-5)
  }
  const maximumFrequency = Math.max(frequency, ...(timelines.get('frequency') ?? []).map(point => point.value))
  const maximumAmplitude = Math.max(amplitude, ...(timelines.get('amplitude') ?? []).map(point => point.value))
  const maximumStep = Math.min(durationSeconds / (activeNodes.has(nodeByTerminal.osc) && doc.stimulus === 'step' ? 10000 : 1000), activeNodes.has(nodeByTerminal.osc) && maximumAmplitude > 0 && doc.stimulus !== 'step' ? 1 / maximumFrequency / 80 : Infinity,
    activeNodes.has(nodeByTerminal.eg) && envelope.mode === 'envelope' ? envelope.decayMs / 200_000 : Infinity, timerStep)
  const step = spiceNumber(maximumStep)
  const savedCurrents = [...doc.parts].sort((a, b) => a.id.localeCompare(b.id)).flatMap((part) => {
    const safeId = spiceDeviceId(part)
    if (timelines.has(`switch:${part.id}`)) return [`@BA_${safeId}[i]`]
    if (timelines.has(`potentiometer:${part.id}`)) return [`@BA_${safeId}_ccw[i]`, `@BA_${safeId}_cw[i]`]
    if (part.kind === 'diode' || part.kind === 'led' || part.kind === 'schottky' || part.kind === 'zener') return [`@D_${safeId}[id]`]
    if (part.kind === 'npn' || part.kind === 'pnp') return [`@Q_${safeId}[ic]`, `@Q_${safeId}[ib]`]
    if (part.kind === 'inductor') return [`@L_${safeId}[i]`]
    if (analysis === 'transient' && (part.kind === 'capacitor' || part.kind === 'electrolytic')) return [`@C_${safeId}[i]`]
    return []
  })
  const savedNodes = new Set([...activeNodes].filter(node => node !== '0' && referenced.has(node)))
  // Fixed supplies remain inspectable, including a circuit with no components.
  for (const source of ['cv', 'vplus', 'vminus']) savedNodes.add(nodeByTerminal[source])
  if (doc.pico) {
    savedNodes.add(nodeByTerminal['pico:36'])
    for (const pin of PICO_PINS.filter(pin => pin.gpio !== null && activeNodes.has(nodeByTerminal[pin.id]))) {
      savedNodes.add(`pico_${pin.gpio}_high`)
      savedNodes.add(`pico_${pin.gpio}_low`)
    }
  }
  const savedVectors = [...[...savedNodes].sort().map(node => `v(${node})`), ...savedCurrents]
  const minimumSamples = Math.ceil(durationSeconds / maximumStep) + 1
  if (analysis === 'transient' && (minimumSamples > SIMULATION_LIMITS.maxSamples || minimumSamples * (savedVectors.length + 1) > SIMULATION_LIMITS.maxRecordedValues)) {
    diagnostics.push({ severity: 'error', message: 'This duration and oscillator frequency exceed the recording memory limit. Choose a shorter duration or lower the oscillator frequency.' })
  }
  // Tighter truncation-error control retains useful interpolation accuracy at
  // fast RC transitions even when the baseline grid spans a long recording.
  lines.push(`.options reltol=0.001 abstol=1e-12 vntol=1e-6 trtol=${timers.length ? 7 : 0.01}`, ['.save', ...savedVectors].join(' '), analysis === 'operating-point' ? '.op' : `.tran ${step} ${durationSeconds} 0 ${step}`, '.end')
  return { netlist: lines.join('\n') + '\n', diagnostics, nodeByTerminal, nets }
}

export function formatValue(value: number, kind: ComponentKind): string {
  if (kind === 'diode') return 'Silicon'
  if (kind === 'schottky') return 'Low Vf'
  if (kind === 'npn') return 'NPN · C–B–E'
  if (kind === 'pnp') return 'PNP · C–B–E'
  if (kind === 'led') return 'Red'
  if (kind === 'opamp') return 'Dual · DIP-8'
  if (kind === 'quadopamp') return 'Quad · DIP-14'
  if (kind === 'timer555') return 'Timer · DIP-8'
  if (kind === 'lm13700') return 'Dual OTA · DIP-16'
  if (kind === 'switch') return value === 1 ? 'Closed' : 'Open'
  const prefixes: [number, string][] = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']]
  const [scale, prefix] = prefixes.find(([scale]) => Math.abs(value) >= scale * (1 - 1e-12)) ?? [1, '']
  return `${Number((value / scale).toPrecision(3))} ${prefix}${PARTS[kind].unit}`
}

export interface CircuitExample {
  id: string
  name: string
  level: 'Basic' | 'Intermediate' | 'Advanced'
  description: string
  whatToChange: string
  whatToObserve: string
  why: string
  hardware: string
  document: CircuitDocument
}

export const examples: CircuitExample[] = [
  {
    id: 'rc-filter', name: 'RC low-pass filter', level: 'Basic', description: 'Let the low notes through. Explore how a capacitor softens a signal.',
    hardware: 'Use a 10 kΩ resistor and a non-polarized 100 nF capacitor. Patch SIGNAL OUT to the resistor input and connect the capacitor return to LABOR GND. This passive tone filter loses level; a following module’s input impedance also affects its response.',
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
    id: 'voltage-divider', name: 'Voltage divider', level: 'Basic', description: 'Two resistors, one useful ratio. Turn 5 volts into 2.5.',
    hardware: 'Use two 10 kΩ resistors between VARIABLE CV and GND. Set the physical CV output to +5 V with a meter. The midpoint is a simple CV attenuator; a connected load changes the division ratio.',
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
    id: 'diode-clipper', name: 'Diode clipper', level: 'Basic', description: 'Flatten the peaks with a pair of opposing signal diodes.',
    hardware: 'Use a 1 kΩ series resistor and two 1N4148 signal diodes in opposite directions between output and GND. The stripe marks the cathode. Real clipping levels depend on diode type, current, and temperature.',
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
    id: 'capacitor-charge', name: 'Capacitor charge & decay', level: 'Basic', description: 'Watch a capacitor store a pulse and release it through a resistor.',
    hardware: 'Use a 10 kΩ resistor and a 1 µF electrolytic rated at least 25 V, with its negative lead at GND. On LABOR use EG OUT in gate mode and press/release the button to charge and discharge it. The simulated 50 ms positive pulse is a capture stimulus, not a physical oscillator setting.',
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
    id: 'opamp-amplifier', name: 'Op-amp gain stage', level: 'Intermediate', description: 'Double a signal with feedback and explicitly powered amplifier pins.',
    hardware: 'Use a DIP-8 TL072 on ±12 V (pin 8 positive, pin 4 negative) and two 10 kΩ resistors. Add a 100 nF non-polarized bypass capacitor from each supply pin to GND beside the IC. Keep the unused half wired as the shown grounded follower. Real output swing depends on load and device; ±11 V is the virtual model’s limit.',
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
  {
    id: 'envelope-shaping', name: 'Envelope shaping', level: 'Intermediate', description: 'Soften the attack of a decaying envelope with a resistor and capacitor.',
    hardware: 'Connect LABOR EG OUT in envelope mode through 10 kΩ to a non-polarized 100 nF capacitor returned to GND. Fire the manual envelope and adjust its decay by observation: the virtual 5 V level and millisecond settings are not calibrated hardware values.',
    whatToChange: 'Change the envelope decay from 20 ms to 5 ms, then try C1 at 470 nF.',
    whatToObserve: 'CH1 shows the rapid attack and exponential decay. CH2 rounds off the attack; a larger capacitor makes the peak smaller and later.',
    why: 'EG OUT rises to 5 V at 1 ms, then decays with the chosen time constant. R1 and C1 store and release charge, filtering that envelope. The source’s 100 Ω resistance is included in the calculation. Each capture and Fire action starts again from 0 V.',
    document: {
      ...createEmptyDocument(), title: 'Envelope shaping',
      instruments: { ...createEmptyDocument().instruments, envelope: { ...DEFAULT_ENVELOPE } },
      parts: [{ id: 'R1', kind: 'resistor', value: 10_000, pins: ['a6', 'a17'] }, { id: 'C1', kind: 'capacitor', value: 100e-9, pins: ['e17', 'f17'] }],
      wires: [{ id: 'W1', from: 'eg', to: 'b6', color: '#b899ce' }, { id: 'W2', from: 'j17', to: 'bn17', color: '#6a839b' }, { id: 'W3', from: 'gnd', to: 'bn20', color: '#6a839b' }],
      probes: { CH1: 'd6', CH2: 'd17' },
    },
  },
  ...passiveExamples,
  ...automationExamples,
  ...activeExamples,
  ...icExamples,
  ...picoExamples,
]
