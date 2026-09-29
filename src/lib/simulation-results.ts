import type { ResultType } from 'eecircuit-engine'
import type { Capture, Channel, ProbeNodes, VoltageCheck } from './simulation-types.ts'
import { SIMULATION_LIMITS } from './simulation-types.ts'

/** Keep adaptive solver timestamps intact; rendering and audio resample explicitly. */
export function extractCapture(result: ResultType, nodes: ProbeNodes, revision: number, elapsedMs: number, voltageChecks: VoltageCheck[] = []): Capture {
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
  const diagnostics: NonNullable<Capture['diagnostics']> = []
  const vectorByNode = new Map(result.data.map(vector => [vector.name.toLowerCase(), vector.values]))
  for (const check of voltageChecks) {
    const positive = check.positiveNode === '0' ? null : vectorByNode.get(`v(${check.positiveNode.toLowerCase()})`)
    const negative = check.negativeNode === '0' ? null : vectorByNode.get(`v(${check.negativeNode.toLowerCase()})`)
    if (positive === undefined || negative === undefined) throw new Error(`${check.partId} returned no voltage for its polarity check.`)
    if ((positive && positive.length !== time.length) || (negative && negative.length !== time.length)) throw new Error(`${check.partId} returned incomplete voltages for its polarity check.`)
    let minimum = Infinity
    for (let index = 0; index < time.length; index++) {
      const voltage = (positive?.[index] ?? 0) - (negative?.[index] ?? 0)
      if (!Number.isFinite(voltage)) throw new Error(`${check.partId} returned invalid voltages.`)
      minimum = Math.min(minimum, voltage)
    }
    if (minimum < -0.05) diagnostics.push({
      severity: 'warning', partId: check.partId,
      message: `${check.partId} is reverse-biased by up to ${Math.abs(minimum).toFixed(2)} V during this capture. Reverse the capacitor or correct its wiring. The ideal model does not simulate damage.`,
    })
  }
  return { revision, time, channels, duration: time.at(-1)! - time[0], elapsedMs, diagnostics }
}

/** ngspice can recover an operating point through source stepping after gmin attempts fail. */
export function fatalSimulationMessages(lines: string[], capture: Pick<Capture, 'time'>): string[] {
  const recovery = lines.findLastIndex(line => /^Note: Source stepping completed\s*$/i.test(line.trim()))
  const complete = (capture.time.at(-1) ?? 0) >= 0.1 - 1e-9 && (capture.time[0] ?? 1) <= 1e-9
  return lines.filter((line, index) => {
    const recoveredGminWarning = /^Warning: (?:Dynamic|True) gmin stepping failed\s*$/i.test(line.trim())
    if (complete && recoveredGminWarning && recovery > index) return false
    return /error|failed|singular matrix|timestep too small|aborted/i.test(line)
  })
}

/** Production captures must cover the complete interval requested by the compiler. */
export function requireCompleteCapture(capture: Pick<Capture, 'time'>): void {
  if (Math.abs(capture.time[0] ?? 1) > 1e-9 || Math.abs((capture.time.at(-1) ?? 0) - 0.1) > 1e-9) {
    throw new Error('ngspice returned an incomplete capture. The circuit must finish the full 100 ms simulation; inspect its wiring and capture again.')
  }
}
