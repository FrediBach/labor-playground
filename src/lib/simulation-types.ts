import type { Diagnostic } from './circuit'

export type Channel = 'CH1' | 'CH2'
export type ProbeNodes = Record<Channel, string | null>

export interface VoltageCheck {
  partId: string
  positiveNode: string
  negativeNode: string
}

export interface Capture {
  revision: number
  time: number[]
  channels: Record<Channel, number[]>
  duration: number
  elapsedMs: number
  diagnostics?: Diagnostic[]
}

export type SimulationStatus = 'loading' | 'calculating' | 'ready' | 'stale' | 'invalid' | 'error'

export interface SimulationRequest {
  type: 'run'
  revision: number
  netlist: string
  nodes: ProbeNodes
  voltageChecks?: VoltageCheck[]
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
