import type { PicoElectricalCheck } from './pico/checks.ts'
import type { PicoTrace } from './pico/runtime.ts'
import type { CircuitDocument, Diagnostic } from './circuit'
import type { AutomationEvent } from './automations.ts'

export type Channel = 'CH1' | 'CH2'
export type ProbeNodes = Record<Channel, string | null>

export interface VoltageCheck {
  partId: string
  positiveNode: string
  negativeNode: string
}

export type OperatingPointBranch = {
  label: string
  fromNode: string
  toNode: string
} & (
  | { kind: 'resistance'; resistance: number }
  | { kind: 'saved-current'; vector: string }
  | { kind: 'ideal-capacitor'; vector?: string }
)

export interface OperatingPointPartDescriptor {
  customModel?: import('./custom-components.ts').CurveComponent
  partId: string
  /** Every component pin must exist in the solved plot. */
  nodes: string[]
  branches: OperatingPointBranch[]
}

export interface OperatingPoint {
  nodeVoltages: Record<string, number>
  parts: Record<string, { currents: Array<{ label: string; value: number }>; power: number | null }>
  elapsedMs: number
}

export interface OperatingPointRequest {
  netlist: string
  parts: OperatingPointPartDescriptor[]
}

export interface Capture {
  revision: number
  time: number[]
  channels: Record<Channel, number[]>
  duration: number
  elapsedMs: number
  diagnostics?: Diagnostic[]
  /** Absent only for legacy test fixtures; production captures include a real .op analysis. */
  operatingPoint?: OperatingPoint
  /** Aligned to time, retaining solver samples without downsampling. */
  recording?: {
    nodeVoltages: Record<string, number[]>
    currents: Record<string, number[]>
    parts: OperatingPointPartDescriptor[]
  }
  picoTrace?: PicoTrace
  /** Resolved, once-per-recording actions; times use the simulation clock. */
  automationEvents?: AutomationEvent[]
  automationRun?: import('./automation-runtime.ts').FlowRun
  automationInitialState?: Pick<CircuitDocument, 'instruments' | 'parts'>
}

export type SimulationStatus = 'loading' | 'calculating' | 'ready' | 'stale' | 'invalid' | 'error'

export interface SimulationRequest {
  type: 'run'
  runId?: string
  owner?: 'capture' | 'suite'
  revision: number
  netlist: string
  nodes: ProbeNodes
  voltageChecks?: VoltageCheck[]
  picoChecks?: PicoElectricalCheck[]
  operatingPoint?: OperatingPointRequest
  durationSeconds?: number
  automation?: { document: CircuitDocument; picoTrace?: PicoTrace; flowId?: string }
}

export type SimulationResponse =
  | { type: 'ready' }
  | { type: 'progress'; revision: number; runId: string; node: import('./automation-runtime.ts').NodeResult }
  | { type: 'result'; revision: number; capture: Capture }
  | { type: 'error'; revision: number; message: string }

export const SIMULATION_LIMITS = {
  debounceMs: 160,
  startupTimeoutMs: 30_000,
  runTimeoutMs: 8_000,
  longRunTimeoutMs: 60_000,
  maxDurationSeconds: 10,
  maxSamples: 1_000_000,
  /** Numeric payload only; the engine also needs working memory. */
  maxRecordedValues: 12_000_000,
} as const
