import type { ResultType } from 'eecircuit-engine'
import type { Capture, Channel, ProbeNodes } from './simulation-types.ts'
import { SIMULATION_LIMITS } from './simulation-types.ts'

/** Keep adaptive solver timestamps intact; rendering and audio resample explicitly. */
export function extractCapture(result: ResultType, nodes: ProbeNodes, revision: number, elapsedMs: number): Capture {
  if (result.dataType !== 'real' || !Array.isArray(result.data)) {
    throw new Error('ngspice returned no real transient data. Check the circuit connections.')
  }
  const time = result.data.find((vector) => vector.type === 'time')?.values
  if (!time || time.length < 2) throw new Error('The simulation produced no time capture. Check for floating or disconnected components.')
  if (time.length > SIMULATION_LIMITS.maxSamples) throw new Error('The capture exceeded the 50,000-sample limit. Simplify the circuit or reduce the oscillator frequency.')
  if (time.some((value, index) => !Number.isFinite(value) || (index > 0 && value < time[index - 1]))) {
    throw new Error('The simulation returned invalid timestamps.')
  }
  const channels = {} as Record<Channel, number[]>
  for (const channel of ['CH1', 'CH2'] as const) {
    const node = nodes[channel]
    if (node === null) {
      channels[channel] = []
      continue
    }
    // Reference ground is exactly 0 V and does not appear in ngspice's saved vectors.
    if (node === '0') {
      channels[channel] = time.map(() => 0)
      continue
    }
    const voltage = result.data.find((vector) => vector.name.toLowerCase() === `v(${node.toLowerCase()})`)?.values
    // A probe on an unused, electrically isolated hole has no calculated voltage.
    if (!voltage) {
      channels[channel] = []
      continue
    }
    if (voltage.length !== time.length || voltage.some((value) => !Number.isFinite(value))) {
      throw new Error(`${channel} returned invalid voltages. Inspect its connected components.`)
    }
    channels[channel] = voltage
  }
  return { revision, time, channels, duration: time.at(-1)! - time[0], elapsedMs }
}
