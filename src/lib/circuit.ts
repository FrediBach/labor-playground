import { validateAutomationProgram, type AutomationProgram } from './automation-graph.ts'
import { exampleDocumentation, validateDocumentation, type CircuitDocumentation } from './documentation.ts'
import { customExamples } from './custom-examples.ts'
import { PROJECT_LIMITS } from './project-limits.ts'
import { CUSTOM_LIMITS, validateCustomComponents, resolvePartModel, nominalValue, minimumModelValue, type CustomComponent } from './custom-components.ts'
import { compileCustomModel } from './component-models.ts'
import { PICO_PINS, picoGround, validatePico, type PicoConfiguration } from './pico/profile.ts'
import { picoDriverLines } from './pico/electrical.ts'
import type { OledConnection } from './ssd1306.ts'
import type { PicoTrace } from './pico/runtime.ts'
import { passiveExamples } from './passive-examples.ts'
import { picoExamples } from './pico/examples.ts'
import { activeExamples } from './active-examples.ts'
import { icExamples } from './ic-examples.ts'
import { automationExamples } from './automation-examples.ts'
import { synthIcLines, SYNTH_IC_LAYOUTS } from './synth-models.ts'
import { synthUtilityLines, SCHMITT_SECTIONS, MULTIPLEXER_SECTIONS } from './synth-utilities.ts'
import { synthTimingLines, COUNTER_NC } from './synth-timing.ts'
import { synthTimingExamples } from './synth-timing-examples.ts'
import { synthLogicLines, LOGIC_PINOUTS } from './synth-logic.ts'
import { synthLogicExamples } from './synth-logic-examples.ts'
import { synthUtilityExamples } from './synth-utility-examples.ts'
import { synthExamples } from './synth-examples.ts'
import { cd4069Lines, INVERTER_SECTIONS } from './cd4069.ts'
import { synthDesignExamples } from './synth-design-examples.ts'
import { timer555Lines } from './timer555.ts'
import { lm13700Lines } from './lm13700.ts'
import { SIMULATION_LIMITS } from './simulation-types.ts'
import { automationIssue, automationPhase, automationPwl, automationWaveformTiming, automationTimelines, scheduledAutomationEvents, validateAutomations, type Automation, type AutomationEvent, type AutomationTimelines } from './automations.ts'

export type ComponentKind = 'resistor' | 'capacitor' | 'inductor' | 'diode' | 'schottky' | 'zener' | 'led' | 'npn' | 'pnp' | 'switch' | 'potentiometer' | 'electrolytic' | 'opamp' | 'quadopamp' | 'timer555' | 'lm13700' | 'ssd1306' | 'njfet' | 'nmos' | 'lm393' | 'cd4066' | 'pmos' | 'vactrol' | 'cd40106' | 'cd4069' | 'cd4053' | 'cd4013' | 'cd4070' | 'cd4081' | 'pc817' | 'cd4024' | 'cd4093' | 'cd4001' | 'lm4040'

export interface Part {
  id: string
  kind: ComponentKind
  value: number
  /** Physical terminals in the order named by the component definition. */
  pins: string[]
  /** Potentiometer wiper position: 0 at CCW, 1 at CW; omitted means 0.5. */
  customModelId?: string
  position?: number
  /** Presentation-only group shared by matching names in the schematic. */
  schemaGroup?: string
}

export const SCHEMA_GROUP_NAME_LIMIT = 60

function readSchemaGroup(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length > SCHEMA_GROUP_NAME_LIMIT) throw new Error(`Schema group must contain at most ${SCHEMA_GROUP_NAME_LIMIT} characters.`)
  return value.trim() || undefined
}

/** Assign presentation groups without changing electrical state or legacy parts. */
export function assignSchemaGroup(document: CircuitDocument, partIds: readonly string[], name: string): CircuitDocument {
  const schemaGroup = readSchemaGroup(name)
  const ids = new Set(partIds)
  let changed = false
  const parts = document.parts.map(part => {
    if (!ids.has(part.id) || part.schemaGroup === schemaGroup) return part
    changed = true
    const { schemaGroup: _previousGroup, ...rest } = part
    return schemaGroup ? { ...rest, schemaGroup } : rest
  })
  return changed ? { ...document, parts } : document
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
  documentation?: CircuitDocumentation
  schemaVersion: 1 | 2 | 3 | 4
  customComponents?: CustomComponent[]
  pico?: PicoConfiguration
  boardVersion: 'virtual-1'
  /** Omitted in older projects: 30 columns and one breadboard row. */
  board?: BoardConfiguration
  title: string
  /** Omitted in legacy documents: periodic oscillator capture. */
  stimulus?: 'periodic' | 'step'
  parts: Part[]
  wires: Wire[]
  probes: { CH1: string | null; CH2: string | null }
  /** Optional so legacy projects remain byte-for-byte compatible on import. */
  automations?: Automation[]
  automationProgram?: AutomationProgram
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
  package?: 'DIP-4' | 'DIP-8' | 'DIP-14' | 'DIP-16'
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
  cd4024: {
    package: 'DIP-14', pinNames: ['CLK', 'RESET', 'Q7', 'Q6', 'Q5', 'Q4', 'VSS', 'NC', 'Q3', 'NC', 'Q2', 'Q1', 'NC', 'VDD'],
    label: 'CD4024-style ripple counter', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Seven binary divider stages provide clocks and sub-octaves from ÷2 through ÷128.',
    supplyHint: 'Pin 14 VDD, pin 7 VSS (3–18 V). Clock pin 1 counts falling edges; RESET pin 2 clears all stages when high. Pins 8, 10, and 13 are not connected internally.',
    model: 'CD4024B DIP-14 pinout. Seven falling-edge master/slave stages with asynchronous active-high reset, Schmitt clock thresholds at 40%/60% of supply, and 100 ns state poles. Outputs have 500 Ω resistance at 5 V, falling to 167 Ω at 15 V; inputs have 5 pF capacitance and 1 TΩ leakage. Captures initialize all stages low for 1 µs. Real hardware needs reset for predictable startup. Ripple stages are not simultaneous. No calibrated propagation delays, metastability, protection, supply current, temperature, or damage model.',
  },
  cd4093: {
    package: 'DIP-14', pinNames: ['A1', 'B1', 'Y1', 'Y2', 'A2', 'B2', 'VSS', 'A3', 'B3', 'Y3', 'Y4', 'A4', 'B4', 'VDD'],
    label: 'CD4093-style Schmitt NAND gates', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Four NAND gates with hysteresis on both inputs for gated oscillators and pulse shaping.',
    supplyHint: 'Pin 14 VDD, pin 7 VSS (3–18 V). An output goes low only when both inputs are high. Tie unused inputs to a supply rail. A low enable holds a gated oscillator output high.',
    model: 'CD4093B DIP-14 pinout. Independent input hysteresis at 40%/60% of supply, 100 ns input and output state poles, 5 pF input capacitance, and 1 TΩ leakage. Output resistance is 500 Ω at 5 V and 167 Ω at 15 V. A deterministic 1 µs initialization starts RC oscillators. No calibrated thresholds/delay, protection diodes, supply current, temperature, or noise model. DC describes startup.',
  },
  cd4001: {
    package: 'DIP-14', pinNames: ['A1', 'B1', 'Y1', 'Y2', 'A2', 'B2', 'VSS', 'A3', 'B3', 'Y3', 'Y4', 'A4', 'B4', 'VDD'],
    label: 'CD4001-style NOR gates', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Four NOR gates for inverted gate combining, pulse inhibition, and logic experiments.',
    supplyHint: 'Pin 14 VDD, pin 7 VSS (3–18 V). Output is high only when both inputs are low. Keep inputs inside the supply range and define every unused input.',
    model: 'CD4001B DIP-14 pinout and NOR truth table. Smooth switching around half the supply, 100 ns state pole, 5 pF input capacitance, and 1 TΩ leakage. Output resistance is 500 Ω at 5 V and 167 Ω at 15 V. No hysteresis, calibrated propagation delay, metastability, protection, supply current, or thermal behavior. Cross-coupled latches require an explicit set/reset stimulus.',
  },
  lm4040: {
    pinNames: ['NC / A', 'Cathode', 'Anode'],
    label: 'LM4040-style 2.5 V reference', unit: 'V', defaultValue: 2.5, min: 2.5, max: 2.5,
    description: 'A fixed shunt voltage reference for stable CV offsets and control-voltage scaling.',
    supplyHint: 'TI TO-92 pin order: 1 float or anode, 2 cathode, 3 anode. Connect anode to the reference return and feed cathode through a resistor. Allow 60 µA–15 mA shunt current after load current; the reference cannot source current.',
    model: 'Original nominal 2.5 V shunt approximation, using the TI LM4040 TO-92 pin order (not the SOT-23 order). A soft pre-regulation current rises to 60 µA at 2.5 V, followed by 0.5 Ω incremental resistance. Includes forward diode conduction and 1 nF effective capacitance. Pin 1 is electrically omitted and may only float or connect to anode. No tolerance, temperature coefficient, noise, calibrated startup, or overcurrent failure model. Behavior above 15 mA is not device-qualified.',
  },
  cd4013: {
    package: 'DIP-14', pinNames: ['Q A', '/Q A', 'CLK A', 'RST A', 'D A', 'SET A', 'VSS', 'SET B', 'D B', 'RST B', 'CLK B', '/Q B', 'Q B', 'VDD'],
    label: 'CD4013-style dual flip-flop', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Two rising-edge D flip-flops for clock division, sub-octaves, and latched gates.',
    supplyHint: 'Pin 14 to VDD, pin 7 to VSS (3–18 V). Tie unused inputs low. Connect /Q to D for divide-by-two. SET and RESET are asynchronous and active high.',
    model: 'Approximate CD4013B pinout with two independent master/slave latches, 100 ns state poles and non-overlapping clock phases below 45% / above 55% of supply. Inputs have 5 pF capacitance and 1 TΩ leakage; outputs have 500 Ω resistance at 5 V, falling to 167 Ω at 15 V. Each capture initializes Q low for 1 µs; DC describes initialization. Both SET/RESET high forces both outputs high; simultaneous release deterministically retains reset. No metastability, setup/hold violation, protection diodes, supply current, or thermal model. Intended for audio/LFO clocks, not high-speed timing validation.',
  },
  cd4070: {
    package: 'DIP-14', pinNames: ['A1', 'B1', 'Y1', 'Y2', 'A2', 'B2', 'VSS', 'A3', 'B3', 'Y3', 'Y4', 'A4', 'B4', 'VDD'],
    label: 'CD4070-style XOR gates', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Four exclusive-OR gates for pulse combining, selectable inversion, and digital ring modulation.',
    supplyHint: 'Pin 14 to VDD, pin 7 to VSS (3–18 V). Each output is high when its inputs differ. Keep inputs within the rails and tie unused inputs low.',
    model: 'Approximate CD4070B pinout and XOR truth table. Smooth input transition centered at half the supply, 100 ns output state pole, 5 pF input capacitance, 1 TΩ input leakage. Output resistance is 500 Ω at 5 V and 167 Ω at 15 V. No hysteresis, calibrated propagation delay, protection diodes, noise, chip supply current, or thermal behavior. This is logic-level pulse processing, not a four-quadrant analog multiplier.',
  },
  cd4081: {
    package: 'DIP-14', pinNames: ['A1', 'B1', 'Y1', 'Y2', 'A2', 'B2', 'VSS', 'A3', 'B3', 'Y3', 'Y4', 'A4', 'B4', 'VDD'],
    label: 'CD4081-style AND gates', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Four AND gates for clock enabling, trigger coincidence, and rhythmic logic.',
    supplyHint: 'Pin 14 to VDD, pin 7 to VSS (3–18 V). Both inputs must be high for a high output. Keep inputs within the rails and tie unused inputs low.',
    model: 'Approximate CD4081B pinout and AND truth table. Smooth input transition centered at half the supply, 100 ns output state pole, 5 pF input capacitance, 1 TΩ input leakage. Output resistance is 500 Ω at 5 V and 167 Ω at 15 V. No hysteresis, calibrated propagation delay, protection diodes, noise, chip supply current, or thermal behavior.',
  },
  pc817: {
    package: 'DIP-4', pinNames: ['LED A', 'LED K', 'Emitter', 'Collector'],
    label: 'PC817-style optocoupler', unit: '%', defaultValue: 100, min: 50, max: 600,
    description: 'An infrared LED drives an isolated phototransistor for gate inputs and level conversion.',
    supplyHint: 'Pin 1 LED anode, 2 cathode, 3 emitter, 4 collector. Add an LED series resistor and an output pull-up. Each side needs its own DC return. CTR sets nominal collector current relative to LED current before saturation.',
    model: 'PC817-style DIP-4 pinout; generic IR diode and optically driven NPN model. Editable nominal CTR 50–600% (default 100%), not a particular device bin. LED Is=1e−15 A, N=1.6, Rs=10 Ω; optical attack/release poles 2/5 µs. The output includes saturation, Early effect, junction capacitance and storage (Bf=100, Vaf=100 V, Tf=0.5 µs, Tr=5 µs). Actual CTR depends on current, voltage and temperature; this model scales nominal optical drive only. No breakdown, isolation-voltage rating, safety certification, noise, or damage model. Not a high-speed MIDI receiver model.',
  },
  pmos: {
    pinNames: ['Drain', 'Gate', 'Source'],
    label: 'P-channel MOSFET', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'A high-side switch that conducts when its gate is below its source. Useful for switched rails and gate drivers.',
    model: 'Generic level-1 PMOS, virtual D–G–S pinout, body tied to source: VTO=−2 V, KP=10 mA/V², W/L=1, lambda=0.02/V, RD=RS=2 Ω. Includes body diode, 30 pF gate–source and 5 pF gate–drain capacitance, and 1 TΩ gate leakage. No avalanche, gate breakdown, noise, temperature drift, or thermal damage. Physical device pinouts vary.',
  },
  vactrol: {
    package: 'DIP-4', pinNames: ['LED A', 'LED K', 'LDR 2', 'LDR 1'],
    label: 'LED/LDR optocoupler', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'An LED illuminates an electrically isolated photoresistor for optical gain control and low-pass gates.',
    supplyHint: 'Virtual four-pin carrier: 1 LED anode, 2 cathode, 3/4 photoresistor. Add an LED current-limiting resistor. Either LDR direction works. Each side needs its own DC return.',
    model: 'Generic optical resistor, not a calibrated VTL5C device. LED Is=1e−18 A, N=2, Rs=10 Ω. Optical state follows LED current with 2 ms attack and 20 ms release time constants. R=500+9999500/(1+light_mA/0.05)² Ω: 10 MΩ dark, about 1.48 kΩ at 5 mA. The LDR is bilateral and electrically isolated. DC starts at equilibrium light; no temperature, light-history aging, voltage dependence, noise, or damage model. DIP-4 is a virtual adapter, not a manufacturer footprint.',
  },
  cd4069: {
    package: 'DIP-14', pinNames: ['IN A', 'OUT A', 'IN B', 'OUT B', 'IN C', 'OUT C', 'VSS', 'OUT D', 'IN D', 'OUT E', 'IN E', 'OUT F', 'IN F', 'VDD'],
    label: 'CD4069UB-style unbuffered inverter', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Six continuous CMOS inverters for analog feedback, WASP-style filters, and distortion.',
    supplyHint: 'Pin 14 VDD, pin 7 VSS, 3–18 V total. Tie unused inputs to VSS; outputs may remain open. Use the unbuffered UB device for analog feedback, not a Schmitt inverter.',
    model: 'Educational continuous transfer centered at half supply: Vout = VSS + span/2 × (1 − tanh(40 × ((Vin − VSS)/span − 0.5))), with midpoint gain −20, 500 Ω output resistance, 20 pF output and 5 pF input capacitance, and 1 TΩ input leakage. No hysteresis or forced startup. Output drive collapses outside 3–18 V. No calibrated distortion spectrum, protection diodes, supply current, noise, process spread, or thermal model. Current/power unavailable.',
  },
  cd40106: {
    package: 'DIP-14', pinNames: ['IN A', 'OUT A', 'IN B', 'OUT B', 'IN C', 'OUT C', 'VSS', 'OUT D', 'IN D', 'OUT E', 'IN E', 'OUT F', 'IN F', 'VDD'],
    label: 'CD40106-style Schmitt inverter', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Six inverters with hysteresis for RC oscillators, clean clocks, and pulse shaping.',
    supplyHint: 'Pin 14 to VDD, pin 7 to VSS (3–18 V). Keep inputs within the rails and tie unused inputs low. Outputs may be left open. One resistor and capacitor make an oscillator.',
    model: 'Approximate six-section Schmitt inverter with standard CD40106B pinout. Thresholds are 0.58 and 0.38 of supply, with state retained between them. 100 ns state pole, 5 pF input capacitance, 1 TΩ input leakage; output resistance is 500 Ω at 5 V, falling to 167 Ω at 15 V. A deterministic 1 µs high-output initialization starts each capture; DC readings describe that initial state. No protection diodes, supply current, noise, threshold spread, or thermal model. Not a manufacturer macromodel.',
  },
  cd4053: {
    package: 'DIP-16', pinNames: ['BY', 'BX', 'CY', 'COM C', 'CX', 'INH', 'VEE', 'VSS', 'SEL C', 'SEL B', 'SEL A', 'AX', 'AY', 'COM A', 'COM B', 'VDD'],
    label: 'CD4053-style signal selector', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Three independent bilateral SPDT switches select between audio or CV sources. Inhibit disconnects all channels.',
    supplyHint: 'Pin 16 VDD, 8 logic ground VSS, 7 analog negative rail VEE. Use 3–18 V logic supply, VEE ≤ VSS, and at most 20 V total span. Select low chooses X; high chooses Y. INH high opens all paths. Define unused logic and analog pins.',
    model: 'Approximate CD4053B pinout with independent A/B/C selectors and inhibit. Bilateral on resistance scales from 470 Ω at 5 V total span to 125 Ω at 15 V, with signal dependence; each off path is 1 GΩ. 5 pF branch/9 pF common capacitances; 100 ns control filters and a 45–55% dead band give break-before-make. No charge injection, protection diodes, noise, chip supply current, or damage model. Not a manufacturer macromodel.',
  },
  njfet: {
    pinNames: ['Drain', 'Gate', 'Source'],
    label: 'N-channel JFET', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Normally-on field-effect transistor for high-impedance buffers and voltage-controlled resistance.',
    model: 'Generic depletion JFET, virtual D–G–S pinout: VTO=−2 V, beta=1 mA/V², lambda=0.01/V, RD=RS=10 Ω, CGS=5 pF, CGD=2 pF. Native nonlinear junction model includes gate conduction and pinch-off; about 4 mA IDSS. Not a selected manufacturer device. No noise, tolerance, breakdown, or thermal damage model.',
  },
  nmos: {
    pinNames: ['Drain', 'Gate', 'Source'],
    label: 'N-channel MOSFET', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Enhancement-mode transistor for gate inverters, LED drivers, and discharge switches.',
    model: 'Generic small-signal level-1 NMOS, virtual D–G–S pinout, body tied to source: VTO=2 V, KP=20 mA/V², W/L=1, lambda=0.02/V, RD=RS=2 Ω. Includes body junction, 30 pF gate–source and 5 pF gate–drain capacitance, and 1 TΩ gate leakage. Not a calibrated 2N7000. No noise, avalanche, gate breakdown, or thermal damage model.',
  },
  lm393: {
    package: 'DIP-8', pinNames: ['OUT A', 'IN− A', 'IN+ A', 'V−', 'IN+ B', 'IN− B', 'OUT B', 'V+'],
    label: 'LM393-style dual comparator', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Converts a voltage comparison into a gate. Each open-collector output needs a pull-up resistor.',
    supplyHint: 'Pin 8 is V+, pin 4 is V− (2–36 V span). Add an output pull-up, for example 10 kΩ to +5 V. Tie unused inputs to defined voltages. Inputs must remain between V− and V+ − 1.5 V.',
    model: 'Approximate dual comparator with standard LM393 pinout: open-collector sink, 40 Ω on resistance, 16 mA sink limit, 1 GΩ off leakage, 5 pF output capacitance, 25 nA input bias and a 0.6 µs internal pole. Differential transition width is 1 mV. No built-in hysteresis. Offset, noise, overdrive-dependent delay, common-mode failure and chip supply current are not modeled. Not a manufacturer macromodel.',
  },
  cd4066: {
    package: 'DIP-14', pinNames: ['A1', 'A2', 'B1', 'B2', 'EN B', 'EN C', 'VSS', 'C1', 'C2', 'D1', 'D2', 'EN D', 'EN A', 'VDD'],
    label: 'CD4066-style analog switch', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'Four independent bilateral switches for CV routing, audio gating, and track-and-hold circuits.',
    supplyHint: 'Pin 14 is VDD, pin 7 is VSS (3–18 V span; do not use ±12 V). Signal and enable pins must stay within the rails. Enable high connects a pair; tie unused enables and signal pins to VSS.',
    model: 'Approximate CD4066B pinout and bilateral conductance. On resistance scales from 470 Ω at 5 V to 125 Ω at 15 V, with signal-level dependence. Off resistance is 1 GΩ, each signal pin has 8 pF to VSS, and each enable has a 100 ns pole. Switching threshold is half the supply span with a smooth transition. No charge injection, protection diodes, noise, temperature drift, or chip supply-current model. Not a manufacturer macromodel.',
  },
  ssd1306: {
    pinNames: ['GND', 'VCC', 'SCL', 'SDA'],
    label: 'SSD1306 OLED display', unit: '', defaultValue: 1, min: 1, max: 1,
    description: 'A 128×64 monochrome I²C display for Pico text and graphics. Address 0x3C.',
    supplyHint: 'Connect GND to Pico GND, VCC to Pico 3V3, SCL to GP1 and SDA to GP0. Use machine.I2C(0).',
    model: 'SSD1306 128×64 at 0x3C, with 4.7 kΩ bus pull-ups. Hardware I²C writes update pixels at transaction completion; recordings preserve display frames. Direct Pico 3V3/GND and a hardware I²C pin pair are required. Bus edges, supply current, charge-pump timing, hardware scrolling, SoftI2C and SPI are not modeled.',
  },
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

export interface BoardConfiguration { columns: 30 | 45 | 60; rows: 1 | 2 | 3 }
export const DEFAULT_BOARD: Readonly<BoardConfiguration> = Object.freeze({ columns: 30, rows: 1 })
export const BOARD_ROW_PITCH = 480
export function boardConfiguration(document: Pick<CircuitDocument, 'board'>): Readonly<BoardConfiguration> {
  return document.board ?? DEFAULT_BOARD
}

function readBoard(value: unknown): BoardConfiguration {
  const board = object(value, 'Breadboard')
  if (![30, 45, 60].includes(board.columns as number) || ![1, 2, 3].includes(board.rows as number)) throw new Error('Choose 30, 45, or 60 breadboard columns and 1, 2, or 3 rows.')
  return { columns: board.columns as BoardConfiguration['columns'], rows: board.rows as BoardConfiguration['rows'] }
}

function makeBoardGeometry(board: Readonly<BoardConfiguration>) {
  const extraWidth = (board.columns - 30) * 24
  const extraHeight = (board.rows - 1) * BOARD_ROW_PITCH
  const holes: Terminal[] = Array.from({ length: board.rows }, (_, bank) => {
    // The first row retains every legacy ID and group. Additional rows are isolated.
    const prefix = bank === 0 ? '' : `r${bank + 1}:`
    return [
      ...Array.from(rows).flatMap((row, rowIndex) => Array.from({ length: board.columns }, (_, index) => ({
        id: `${prefix}${row}${index + 1}`, x: 100 + index * 24, y: rowY[rowIndex] + bank * BOARD_ROW_PITCH,
        group: `${prefix}${rowIndex < 5 ? 'top' : 'bottom'}-${index + 1}`,
      }))),
      ...rails.flatMap(rail => Array.from({ length: board.columns }, (_, index) => ({
        id: `${prefix}${rail.id}${index + 1}`, x: 100 + index * 24, y: rail.y + bank * BOARD_ROW_PITCH,
        group: `${prefix}${rail.id}-${index < 15 ? 'left' : index < 30 ? 'right' : `segment${Math.floor(index / 15) + 1}`}`,
      }))),
    ]
  }).flat()
  const terminals: Terminal[] = [
    ...holes,
    ...PICO_PINS.filter(pin => pin.supported).map(pin => ({ ...pin, x: pin.x + extraWidth })),
    ...['osc', 'cv', 'gnd', 'vplus', 'vminus'].map((id, index) => ({ id, x: 135 + index * 160, y: 52, group: id })),
    { id: 'eg', x: 855, y: 52, group: 'eg' },
  ]
  return { holes, terminals, terminalById: Object.fromEntries(terminals.map(terminal => [terminal.id, terminal])) as Record<string, Terminal>,
    extraWidth, extraHeight, width: 920 + extraWidth, height: 550 + extraHeight,
    breadboardExtent: { x: 46, y: 79, width: 828 + extraWidth, height: 450 + extraHeight } }
}
const boardGeometries = new Map<string, ReturnType<typeof makeBoardGeometry>>()
/** Shared, cached geometry for validation, connectivity, rendering and placement. */
export function boardGeometry(document: Pick<CircuitDocument, 'board'> = {}) {
  const board = boardConfiguration(document)
  const key = `${board.columns}:${board.rows}`
  let geometry = boardGeometries.get(key)
  if (!geometry) { geometry = makeBoardGeometry(board); boardGeometries.set(key, geometry) }
  return geometry
}
// Legacy exports keep existing callers and fixtures on the original board.
export const HOLES = boardGeometry().holes
export const TERMINALS = boardGeometry().terminals
export const terminalById = boardGeometry().terminalById

/** Reject shrinking that would discard any physical attachment. */
export function resizeBoard(document: CircuitDocument, board: BoardConfiguration): CircuitDocument {
  const next = { ...document, board: readBoard(board) }
  const terminals = boardGeometry(next).terminalById
  const attached = [...document.parts.flatMap(part => part.pins), ...document.wires.flatMap(wire => [wire.from, wire.to]), ...Object.values(document.probes).filter((pin): pin is string => pin !== null)]
  const previousTerminals = boardGeometry(document).terminalById
  const signalPins = document.automationProgram?.signals.flatMap(signal => signal.kind === 'voltage' ? [signal.positive, ...(signal.negative ? [signal.negative] : [])] : []) ?? []
  attached.push(...signalPins.filter(pin => Object.hasOwn(previousTerminals, pin)))
  const missing = attached.find(pin => !Object.hasOwn(terminals, pin))
  if (missing) throw new Error(`Cannot shrink the breadboard: ${missing.toUpperCase()} is in use. Move its component, wire, probe, or signal first.`)
  return next
}

export function createEmptyDocument(): CircuitDocument {
  return {
    schemaVersion: 1, boardVersion: 'virtual-1', title: 'Untitled circuit',
    parts: [], wires: [], probes: { CH1: null, CH2: null },
    instruments: { frequency: 220, amplitude: 2.5, waveform: 'sine', cv: 5 },
  }
}

/** DIP packages straddle the trench only, with pin 1 at eN or fN. */
export function getPlacement(kind: ComponentKind, holeId: string, rotation = 0, document: Pick<CircuitDocument, 'board'> = {}): string[] | null {
  const { terminalById } = boardGeometry(document)
  const { columns } = boardConfiguration(document)
  const match = /^(r[23]:)?([a-j])(\d{1,2})$/.exec(holeId)
  if (!match || !Object.hasOwn(terminalById, holeId) || !Object.hasOwn(PARTS, kind)) return null
  const prefix = match[1] ?? ''
  const column = Number(match[3])
  const row = rows.indexOf(match[2])
  const direction = ((Math.round(rotation / 90) % 4) + 4) % 4
  if (PARTS[kind].package) {
    const perSide = PARTS[kind].pinNames.length / 2
    const offsets = Array.from({ length: perSide }, (_, index) => index)
    if (direction === 0 && match[2] === 'e' && column <= columns + 1 - perSide) {
      return offsets.map(offset => `${prefix}e${column + offset}`).concat([...offsets].reverse().map(offset => `${prefix}f${column + offset}`))
    }
    if (direction === 2 && match[2] === 'f' && column >= perSide) {
      return offsets.map(offset => `${prefix}f${column - offset}`).concat([...offsets].reverse().map(offset => `${prefix}e${column - offset}`))
    }
    return null
  }
  if (kind === 'ssd1306') {
    if (direction !== 0 && direction !== 2) return null
    const pins = Array.from({ length: 4 }, (_, index) => `${prefix}${match[2]}${column + (direction === 0 ? index : -index)}`)
    return pins.every(pin => Object.hasOwn(terminalById, pin)) ? pins : null
  }
  const threeLead = PARTS[kind].pinNames.length === 3
  const span = kind === 'capacitor' || kind === 'electrolytic' || threeLead ? 1 : 3
  const count = threeLead ? 3 : 2
  const pins = Array.from({ length: count }, (_, index) => {
    const nextColumn = column + (direction === 0 ? span : direction === 2 ? -span : 0) * index
    const nextRow = row + (direction === 1 ? span : direction === 3 ? -span : 0) * index
    return nextColumn < 1 || nextColumn > columns || nextRow < 0 || nextRow >= rows.length ? null : `${prefix}${rows[nextRow]}${nextColumn}`
  })
  if (threeLead && pins.some((pin) => pin !== null && (rows.indexOf(pin.slice(prefix.length)[0]) < 5) !== (row < 5))) return null
  return pins.some((pin) => pin === null) ? null : pins as string[]
}

/** Legacy two-lead parts keep arbitrary lead spacing; rigid new packages do not. */
export function isValidFootprint(kind: ComponentKind, pins: string[], document: Pick<CircuitDocument, 'board'> = {}): boolean {
  const { terminalById } = boardGeometry(document)
  if (!Object.hasOwn(PARTS, kind) || pins.length !== PARTS[kind].pinNames.length || new Set(pins).size !== pins.length) return false
  if (pins.some((pin) => !Object.hasOwn(terminalById, pin) || !/^(?:r[23]:)?(?:[a-j]|tp|tn|bp|bn)\d+$/.test(pin))) return false
  if (PARTS[kind].pinNames.length === 2) return true
  return [0, 90, 180, 270].some((rotation) => getPlacement(kind, pins[0], rotation, document)?.every((pin, index) => pin === pins[index]))
}

/** Leads and jumpers occupy holes; probes are measurement attachments and do not. */
export function canPlace(doc: CircuitDocument, pins: string[], excludeId?: string): boolean {
  const { terminalById } = boardGeometry(doc)
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
  if (![1, 2, 3, 4].includes(raw.schemaVersion as number) || raw.boardVersion !== 'virtual-1') throw new Error('Unsupported circuit or board version.')
  if (typeof raw.title !== 'string' || raw.title.length > 100) throw new Error('Circuit title must contain at most 100 characters.')
  if (!Array.isArray(raw.parts) || raw.parts.length > 30) throw new Error('A circuit may contain up to 30 components.')
  if (!Array.isArray(raw.wires) || raw.wires.length > 120) throw new Error('A circuit may contain up to 120 wires.')
  if (raw.schemaVersion === 4 && (raw.automationProgram === undefined || raw.automations !== undefined)) throw new Error('Schema 4 requires one automationProgram and no legacy automations.')
  if (raw.schemaVersion !== 4 && raw.automationProgram !== undefined) throw new Error('Automation flows require schema version 4.')
  if (raw.pico !== undefined && raw.schemaVersion === 1) throw new Error('Pico projects require schema version 2 or 3.')
  if ((raw.schemaVersion !== 3 && raw.schemaVersion !== 4) && (raw.customComponents !== undefined || raw.parts.some(p => p && typeof p === 'object' && 'customModelId' in p))) throw new Error('Custom components require schema version 3.')
  const customComponents = raw.customComponents === undefined ? undefined : validateCustomComponents(raw.customComponents)
  const pico = raw.pico === undefined ? undefined : validatePico(raw.pico)
  const board = raw.board === undefined ? undefined : readBoard(raw.board)
  const { terminalById } = boardGeometry({ board })
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
    let value = finiteNumber(part.value, `${id} value`, definition.min, definition.max)
    const model = resolvePartModel({ customComponents }, { kind, customModelId: part.customModelId as string | undefined })
    if (model) value = nominalValue(model)
    if (kind === 'switch' && value !== 0 && value !== 1) throw new Error(`${id} must be either open (0) or closed (1).`)
    if (!Array.isArray(part.pins) || part.pins.length !== definition.pinNames.length) throw new Error(`${id} requires exactly ${definition.pinNames.length} pins.`)
    const pins = part.pins.map(readTerminal)
    if (!isValidFootprint(kind, pins, { board })) throw new Error(`${id} has an invalid ${definition.label.toLowerCase()} footprint. ${definition.package ? `Place all ${definition.pinNames.length} pins across the center trench at 0° or 180°.` : 'Use the supported breadboard pin positions.'}`)
    occupy(pins)
    const position = kind === 'potentiometer' && part.position !== undefined ? finiteNumber(part.position, `${id} wiper position`, 0, 1) : undefined
    const schemaGroup = readSchemaGroup(part.schemaGroup)
    return { id, kind, value, pins, ...(model ? { customModelId: model.id } : {}), ...(position === undefined ? {} : { position }), ...(schemaGroup ? { schemaGroup } : {}) }
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
  const result: CircuitDocument = {
    schemaVersion: raw.schemaVersion as 1 | 2 | 3 | 4,
    ...(customComponents === undefined ? {} : { customComponents }), boardVersion: 'virtual-1', title: raw.title,
    ...(pico ? { pico } : {}),
    ...(board ? { board } : {}),
    parts, wires,
    ...(raw.documentation === undefined ? {} : { documentation: validateDocumentation(raw.documentation) }),
    ...(raw.automationProgram === undefined ? {} : { automationProgram: validateAutomationProgram(raw.automationProgram) }),
    ...(raw.automations === undefined ? {} : { automations: validateAutomations(raw.automations, parts) }),
    ...(raw.stimulus === undefined ? {} : { stimulus: raw.stimulus as CircuitDocument['stimulus'] }),
    instruments: { frequency, amplitude, cv, waveform: instruments.waveform as CircuitDocument['instruments']['waveform'], ...(envelope === undefined ? {} : { envelope }) },
    probes: { CH1: probes.CH1 === null ? null : readTerminal(probes.CH1), CH2: probes.CH2 === null ? null : readTerminal(probes.CH2) },
  }
  if (new TextEncoder().encode(JSON.stringify(result, null, 2)).length > PROJECT_LIMITS.bytes) throw new Error('Formatted project files must be smaller than 200 kB.')
  return result
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
  const terminals = boardGeometry(doc).terminals.filter(pin => doc.pico || !pin.id.startsWith('pico:'))
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

export function compileCircuit(document: CircuitDocument, analysis: 'transient' | 'operating-point' = 'transient', picoTrace?: PicoTrace, durationSeconds = 0.1, automationEvents?: readonly AutomationEvent[], resolvedActions?: readonly Automation[]): CompiledCircuit {
  const diagnostics: Diagnostic[] = []
  let doc: CircuitDocument
  try { doc = validateDocument(document) } catch (error) {
    return { netlist: '', diagnostics: [{ severity: 'error', message: error instanceof Error ? error.message : 'Invalid circuit document.' }], nodeByTerminal: {}, nets: {} }
  }
  // Runtime actions are individually validated, never persisted as a second model.
  if (resolvedActions) doc = { ...doc, automations: resolvedActions.flatMap(action => validateAutomations([action])) }
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
  try { oledConnections(doc, nodeByTerminal) }
  catch (error) { diagnostics.push({ severity: 'error', message: error instanceof Error ? error.message : 'Invalid OLED wiring.' }) }
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
    if (part.kind === 'ssd1306') { addEdge(nodes[2], b); addEdge(nodes[3], b); continue }
    if (part.kind === 'njfet' || part.kind === 'nmos' || part.kind === 'pmos') {
      addEdge(a, c) // Insulated/reverse-biased gates still require an external return.
      if (new Set(nodes).size < 3) diagnostics.push({ severity: 'warning', message: `${part.id} has transistor terminals on the same net. Check the D–G–S connections.`, partId: part.id })
      continue
    }
    if (part.kind === 'lm4040') {
      addEdge(b, c)
      const spareUsed = doc.wires.some(w => nodeByTerminal[w.from] === a || nodeByTerminal[w.to] === a) || doc.parts.some(p => p.id !== part.id && p.pins.some(pin => nodeByTerminal[pin] === a))
      if (a !== c && spareUsed) diagnostics.push({ severity: 'error', message: `${part.id} pin 1 must float or connect to its anode (pin 3).`, partId: part.id })
      continue
    }
    if (part.kind === 'vactrol' || part.kind === 'pc817') { addEdge(a, b); addEdge(nodes[2], nodes[3]); continue }
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
  for (const part of doc.parts.filter(part => SYNTH_IC_LAYOUTS[part.kind])) {
    const layout = SYNTH_IC_LAYOUTS[part.kind]!
    const nodes = part.pins.map(pin => nodeByTerminal[pin])
    const low = nodes[layout.negative], high = nodes[layout.positive]
    const span = fixedVoltages.has(high) && fixedVoltages.has(low) ? fixedVoltages.get(high)! - fixedVoltages.get(low)! : undefined
    const powered = referenced.has(low) && referenced.has(high) && low !== high && (span === undefined || span >= layout.min && span <= layout.max)
    if (!powered) diagnostics.push({ severity: 'error', message: `${part.id} needs connected, correctly ordered supply pins with a ${layout.min}–${layout.max} V span.`, partId: part.id })
    else if (span === undefined) diagnostics.push({ severity: 'warning', message: `${part.id}: verify the circuit-fed supply stays within ${layout.min}–${layout.max} V.`, partId: part.id })
    if (part.kind === 'lm393' && powered) {
      for (const output of [0, 6]) {
        addEdge(nodes[output], low)
        if (!doc.parts.some(p => p.kind === 'resistor' && p.pins.some(pin => nodeByTerminal[pin] === nodes[output]))) diagnostics.push({ severity: 'warning', message: `${part.id} ${PARTS.lm393.pinNames[output]} needs an external pull-up resistor to produce a high output.`, partId: part.id })
      }
    }
    if (LOGIC_PINOUTS[part.kind] && powered) for (const output of LOGIC_PINOUTS[part.kind]!.outputs) addEdge(nodes[output], low)
    if (part.kind === 'cd4069' && powered) for (const [, output] of INVERTER_SECTIONS) addEdge(nodes[output], low)
    if (part.kind === 'cd40106' && powered) for (const [, output] of SCHMITT_SECTIONS) addEdge(nodes[output], low)
    if (part.kind === 'cd4053') {
      const vee = nodes[6], negativeVoltage = fixedVoltages.get(vee), logicLow = fixedVoltages.get(low), logicHigh = fixedVoltages.get(high)
      if (!referenced.has(vee) || negativeVoltage !== undefined && logicLow !== undefined && negativeVoltage > logicLow || negativeVoltage !== undefined && logicHigh !== undefined && logicHigh - negativeVoltage > 20) diagnostics.push({ severity: 'error', message: `${part.id}: connect VEE at or below VSS, with VDD − VEE no greater than 20 V.`, partId: part.id })
      for (const [common, x, y] of MULTIPLEXER_SECTIONS) { addEdge(nodes[common], nodes[x]); addEdge(nodes[common], nodes[y]) }
    }
    if (part.kind === 'cd4066') for (const [a, b] of [[0, 1], [2, 3], [7, 8], [9, 10]]) addEdge(nodes[a], nodes[b])
    if (span !== undefined) {
      const indices = LOGIC_PINOUTS[part.kind]?.inputs ?? (part.kind === 'cd4069' ? INVERTER_SECTIONS.map(([input]) => input) : part.kind === 'cd40106' ? SCHMITT_SECTIONS.map(([input]) => input) : part.kind === 'cd4053' ? [5, 8, 9, 10] : part.kind === 'lm393' ? [1, 2, 4, 5] : [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12])
      for (const index of indices) {
        const voltage = fixedVoltages.get(nodes[index])
        if (voltage !== undefined && (voltage < fixedVoltages.get(low)! || voltage > fixedVoltages.get(high)! - (part.kind === 'lm393' ? 1.5 : 0))) diagnostics.push({ severity: 'warning', message: `${part.id} ${PARTS[part.kind].pinNames[index]} is outside the modeled operating input range.`, partId: part.id })
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
      if (part.kind === 'cd4024' && (COUNTER_NC as readonly number[]).includes(index) || part.kind === 'lm4040' && index === 0) continue
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
  // Fixed templates expand to bounded device networks. The compiler checks
  // actual device/node/byte totals below, including the larger CMOS packages.
  for (const part of [...doc.parts].sort((a, b) => a.id.localeCompare(b.id))) {
    const [a, b] = part.pins.map((pin) => nodeByTerminal[pin])
    const safeId = spiceDeviceId(part)
    const custom = compileCustomModel(doc, part, part.pins.map(pin => nodeByTerminal[pin]))
    if (custom) { lines.push(...custom.lines); continue }
    if (part.kind === 'ssd1306') {
      lines.push(`ROLED_${safeId}_scl ${nodeByTerminal[part.pins[2]]} ${b} 4700`, `ROLED_${safeId}_sda ${nodeByTerminal[part.pins[3]]} ${b} 4700`)
    }
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
    if (part.kind === 'njfet' || part.kind === 'nmos' || part.kind === 'pmos') {
      const c = nodeByTerminal[part.pins[2]]
      lines.push(`VFD_${safeId} ${a} fd_${safeId} 0`, `VFG_${safeId} ${b} fg_${safeId} 0`)
      if (part.kind === 'njfet') lines.push(`.model JF_${safeId} NJF(Vto=-2 Beta=1m Lambda=0.01 Rd=10 Rs=10 Cgs=5p Cgd=2p Is=1p)`, `J_${safeId} fd_${safeId} fg_${safeId} ${c} JF_${safeId}`)
      else lines.push(`.model MF_${safeId} ${part.kind === 'pmos' ? 'PMOS(Level=1 Vto=-2 Kp=10m' : 'NMOS(Level=1 Vto=2 Kp=20m'} Lambda=0.02 Rd=2 Rs=2 Cbd=10p Is=1p)`, `M_${safeId} fd_${safeId} fg_${safeId} ${c} ${c} MF_${safeId} W=10u L=10u`, `CGS_${safeId} fg_${safeId} ${c} 30p`, `CGD_${safeId} fg_${safeId} fd_${safeId} 5p`, `RG_${safeId} fg_${safeId} ${c} 1e12`)
    }
    if (part.kind === 'cd4024' || part.kind === 'cd4093' || part.kind === 'lm4040') lines.push(...synthTimingLines(part.kind, safeId, part.pins.map(pin => nodeByTerminal[pin])))
    if (part.kind === 'cd4001' || part.kind === 'cd4013' || part.kind === 'cd4070' || part.kind === 'cd4081' || part.kind === 'pc817') lines.push(...synthLogicLines(part.kind, safeId, part.pins.map(pin => nodeByTerminal[pin]), part.value))
    if (part.kind === 'cd40106' || part.kind === 'cd4053' || part.kind === 'vactrol') lines.push(...synthUtilityLines(part.kind, safeId, part.pins.map(pin => nodeByTerminal[pin])))
    if (part.kind === 'lm393' || part.kind === 'cd4066') lines.push(...synthIcLines(part.kind, safeId, part.pins.map(pin => nodeByTerminal[pin])))
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
    if (part.kind === 'cd4069') lines.push(...cd4069Lines(safeId, part.pins.map(pin => nodeByTerminal[pin])))
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
  const timers = doc.parts.filter(part => part.kind === 'timer555' || part.kind === 'cd40106' || part.kind === 'cd4093')
  const hasRippleCounter = doc.parts.some(part => part.kind === 'cd4024')
  let timerStep = hasRippleCounter || doc.parts.some(part => part.kind === 'cd4013') ? 1e-5 : Infinity
  for (const timer of timers) {
    const timingNodes = new Set((timer.kind === 'cd4093' ? LOGIC_PINOUTS.cd4093!.inputs : timer.kind === 'cd40106' ? SCHMITT_SECTIONS.map(([input]) => input) : [1, 5, 6]).map(index => nodeByTerminal[timer.pins[index]]))
    const capacitors = doc.parts.filter(part => (part.kind === 'capacitor' || part.kind === 'electrolytic') && part.pins.some(pin => timingNodes.has(nodeByTerminal[pin])))
    const resistors = doc.parts.filter(part => part.kind === 'resistor' && part.pins.some(pin => timingNodes.has(nodeByTerminal[pin])))
    // Behavioral latch thresholds need explicit resolution as well as LTE
    // control. Slow blinkers can still take proportionally larger steps.
    timerStep = Math.min(timerStep, capacitors.length && resistors.length
      ? Math.min(...capacitors.map(part => minimumModelValue(doc, part))) * Math.min(...resistors.map(part => minimumModelValue(doc, part))) / 50
      : 1e-5)
  }
  const maximumFrequency = Math.max(frequency, ...(timelines.get('frequency') ?? []).map(point => point.value))
  const maximumAmplitude = Math.max(amplitude, ...(timelines.get('amplitude') ?? []).map(point => point.value))
  const maximumStep = Math.min(durationSeconds / (activeNodes.has(nodeByTerminal.osc) && doc.stimulus === 'step' ? 10000 : 1000), activeNodes.has(nodeByTerminal.osc) && maximumAmplitude > 0 && doc.stimulus !== 'step' ? 1 / maximumFrequency / 80 : Infinity,
    activeNodes.has(nodeByTerminal.eg) && envelope.mode === 'envelope' ? envelope.decayMs / 200_000 : Infinity, timerStep)
  const step = spiceNumber(maximumStep)
  const savedCurrents = [...doc.parts].sort((a, b) => a.id.localeCompare(b.id)).flatMap((part) => {
    const custom = compileCustomModel(doc, part, part.pins.map(pin => nodeByTerminal[pin]))
    if (custom) return custom.savedVectors
    const safeId = spiceDeviceId(part)
    if (timelines.has(`switch:${part.id}`)) return [`@BA_${safeId}[i]`]
    if (timelines.has(`potentiometer:${part.id}`)) return [`@BA_${safeId}_ccw[i]`, `@BA_${safeId}_cw[i]`]
    if (part.kind === 'diode' || part.kind === 'led' || part.kind === 'schottky' || part.kind === 'zener') return [`@D_${safeId}[id]`]
    if (part.kind === 'npn' || part.kind === 'pnp') return [`@Q_${safeId}[ic]`, `@Q_${safeId}[ib]`]
    if (part.kind === 'njfet' || part.kind === 'nmos' || part.kind === 'pmos') return [`i(VFD_${safeId})`, `i(VFG_${safeId})`]
    if (part.kind === 'lm4040') return [`i(VREF_${safeId})`]
    if (part.kind === 'pc817') return [`i(VLED_${safeId})`, `i(VCOL_${safeId})`]
    if (part.kind === 'vactrol') return [`i(VLED_${safeId})`, `@BLDR_${safeId}[i]`]
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
  // Ripple storage needs tight local-error control even alongside RC timers;
  // loose integration can introduce an extra transition between clock edges.
  lines.push(`.options reltol=0.001 abstol=1e-12 vntol=1e-6 trtol=${timers.length && !hasRippleCounter ? 7 : 0.01}`, ['.save', ...savedVectors].join(' '), analysis === 'operating-point' ? '.op' : `.tran ${step} ${durationSeconds} 0 ${step}`, '.end')
  const netlist = lines.join('\n') + '\n'
  const externalNodes = new Set(Object.values(nodeByTerminal))
  const internalNodes = new Set(lines.slice(1).filter(line => /^[RCLVIBDQ]/i.test(line)).flatMap(line => {
    const fields = line.split(/\s+/)
    return fields.slice(1, fields[0].startsWith('Q') ? 4 : 3).filter(node => !externalNodes.has(node))
  }))
  if (new TextEncoder().encode(netlist).length > CUSTOM_LIMITS.netlistBytes || lines.filter(line => /^[a-z]/i.test(line)).length > CUSTOM_LIMITS.devices || internalNodes.size > CUSTOM_LIMITS.internalNodes) diagnostics.push({ severity: 'error', message: 'Expanded circuit exceeds the netlist resource limit. Reduce curve points or components.' })
  return { netlist, diagnostics, nodeByTerminal, nets }
}

export function formatValue(value: number, kind: ComponentKind): string {
  if (kind === 'ssd1306') return '128×64 · I²C'
  if (kind === 'diode') return 'Silicon'
  if (kind === 'schottky') return 'Low Vf'
  if (kind === 'cd4024') return '7-stage · DIP-14'
  if (kind === 'cd4093') return 'Quad Schmitt NAND · DIP-14'
  if (kind === 'cd4001') return 'Quad NOR · DIP-14'
  if (kind === 'lm4040') return '2.5 V shunt · TO-92'
  if (kind === 'cd4013') return 'Dual D-type · DIP-14'
  if (kind === 'cd4070') return 'Quad XOR · DIP-14'
  if (kind === 'cd4081') return 'Quad AND · DIP-14'
  if (kind === 'pc817') return `CTR ${value}% · DIP-4`
  if (kind === 'pmos') return 'PMOS · D–G–S'
  if (kind === 'vactrol') return 'Optical · 4-pin'
  if (kind === 'cd4069') return 'Hex unbuffered inverter · DIP-14'
  if (kind === 'cd40106') return 'Hex Schmitt · DIP-14'
  if (kind === 'cd4053') return 'Triple SPDT · DIP-16'
  if (kind === 'njfet') return 'JFET · D–G–S'
  if (kind === 'nmos') return 'NMOS · D–G–S'
  if (kind === 'lm393') return 'Comparator · DIP-8'
  if (kind === 'cd4066') return 'Quad switch · DIP-14'
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
  ...customExamples,
  ...automationExamples,
  ...activeExamples,
  ...icExamples,
  ...synthExamples,
  ...synthUtilityExamples,
  ...synthLogicExamples,
  ...synthTimingExamples,
  ...synthDesignExamples,
  ...picoExamples,
]

for (const example of examples) example.document.documentation = exampleDocumentation(example)

/** Resolve only directly wired, powered peripherals; never invent a device on a bus. */
export function oledConnections(doc: CircuitDocument, nodes = resolveTopology(doc).nodeByTerminal): OledConnection[] {
  const connections: OledConnection[] = []
  for (const part of doc.parts.filter(part => part.kind === 'ssd1306')) {
    const [ground, supply, sclNode, sdaNode] = part.pins.map(pin => nodes[pin])
    if (!doc.pico || ground !== nodes[picoGround] || supply !== nodes['pico:36'] || ground === supply) throw new Error(`${part.id}: connect OLED GND to Pico GND and VCC directly to Pico 3V3.`)
    const gpios = (node: string) => PICO_PINS.filter(pin => pin.gpio !== null && nodes[pin.id] === node).map(pin => pin.gpio!)
    const sdas = gpios(sdaNode), scls = gpios(sclNode)
    const sda = sdas[0], scl = scls[0]
    if (sdas.length !== 1 || scls.length !== 1 || sda % 2 !== 0 || scl % 2 !== 1 || Math.floor(sda / 2) % 2 !== Math.floor(scl / 2) % 2 || [ground, supply].includes(sdaNode) || [ground, supply].includes(sclNode)) throw new Error(`${part.id}: connect SDA and SCL to a hardware I²C pair, for example SDA GP0 and SCL GP1.`)
    const bus = Math.floor(sda / 2) % 2
    if (connections.some(connection => connection.bus === bus)) throw new Error('Only one OLED at address 0x3C is supported on each I²C bus.')
    connections.push({ partId: part.id, bus, sda, scl })
  }
  return connections
}
