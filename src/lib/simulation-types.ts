import type { Diagnostic } from './circuit'

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
  | { kind: 'ideal-capacitor' }
)

export interface OperatingPointPartDescriptor {
  partId: string
  /** Every component pin must exist in the solved DC plot. */
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
}

export type SimulationStatus = 'loading' | 'calculating' | 'ready' | 'stale' | 'invalid' | 'error'

export interface SimulationRequest {
  type: 'run'
  revision: number
  netlist: string
  nodes: ProbeNodes
  voltageChecks?: VoltageCheck[]
  operatingPoint?: OperatingPointRequest
}

export type SimulationResponse =
  | { type: 'ready' }
  | { type: 'result'; revision: number; capture: Capture }
  | { type: 'error'; revision: number; message: string }

export const SIMULATION_LIMITS = {
  debounceMs: 160,
  startupTimeoutMs: 30_000,
  runTimeoutMs: 8_000,
  maxSamples: 50_000,
} as const
