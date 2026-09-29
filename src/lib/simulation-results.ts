import type { ResultType } from 'eecircuit-engine'
import type { Capture, Channel, OperatingPoint, OperatingPointPartDescriptor, ProbeNodes, VoltageCheck } from './simulation-types.ts'
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
export function fatalSimulationMessages(lines: string[], evidence: Pick<Capture, 'time'> | { analysis: 'operating-point'; complete: boolean }): string[] {
  const recovery = lines.findLastIndex(line => /^Note: Source stepping completed\s*$/i.test(line.trim()))
  const complete = 'time' in evidence
    ? (evidence.time.at(-1) ?? 0) >= 0.1 - 1e-9 && (evidence.time[0] ?? 1) <= 1e-9
    : evidence.complete
  return lines.filter((line, index) => {
    const recoveredGminWarning = /^Warning: (?:Dynamic|True) gmin stepping failed\s*$/i.test(line.trim())
    if (complete && recoveredGminWarning && recovery > index) return false
    return /error|failed|singular matrix|timestep too small|aborted/i.test(line)
  })
}

/** Match the fresh run's plot and completion log before trusting its raw file. */
export function requireAnalysisCompletion(result: ResultType, info: string, analysis: 'operating-point' | 'transient'): void {
  const plotName = analysis === 'operating-point' ? 'Operating Point' : 'Transient Analysis'
  const plot = /^Plotname:\s*(.+)\s*$/im.exec(result.header)?.[1].trim()
  const rows = [...info.matchAll(/No\. of Data Rows\s*:\s*(\d+)/g)].at(-1)?.[1]
  if (plot !== plotName || Number(rows) !== result.numPoints || !/binary raw file\s+"out\.raw"/i.test(info)) {
    throw new Error(`ngspice did not complete a fresh ${analysis === 'operating-point' ? 'DC operating-point' : 'transient'} analysis. An older result cannot be used.`)
  }
}

/** A genuine .op plot contains one real value per vector and no time axis. */
export function extractOperatingPoint(result: ResultType, descriptors: OperatingPointPartDescriptor[], elapsedMs: number): OperatingPoint {
  if (result.dataType !== 'real' || result.numPoints !== 1 || !Array.isArray(result.data) || result.data.length === 0 || !/^Plotname:\s*Operating Point\s*$/im.test(result.header)) {
    throw new Error('ngspice returned no valid DC operating point. A single real operating-point row is required.')
  }
  const nodeVoltages: Record<string, number> = { '0': 0 }
  const vectors = new Map<string, number>()
  for (const vector of result.data) {
    if (vector.type === 'time' || vector.values.length !== 1 || !Number.isFinite(vector.values[0])) throw new Error('The DC operating point contains invalid or incomplete values.')
    const name = vector.name.toLowerCase()
    vectors.set(name, vector.values[0])
    const node = /^v\(([^)]+)\)$/.exec(name)?.[1]
    if (vector.type === 'voltage' && node) nodeVoltages[node] = vector.values[0]
  }
  const parts: OperatingPoint['parts'] = {}
  for (const descriptor of descriptors) {
    for (const node of descriptor.nodes) {
      if (!node || !Object.hasOwn(nodeVoltages, node.toLowerCase())) throw new Error(`${descriptor.partId} returned no DC voltage for one of its pins.`)
    }
    const currents: OperatingPoint['parts'][string]['currents'] = []
    let power = descriptor.branches.length ? 0 : null
    for (const branch of descriptor.branches) {
      const voltage = nodeVoltages[branch.fromNode.toLowerCase()] - nodeVoltages[branch.toNode.toLowerCase()]
      let current: number
      if (branch.kind === 'resistance') {
        if (!Number.isFinite(branch.resistance) || branch.resistance <= 0) throw new Error(`${descriptor.partId} has an invalid resistance for its DC measurement.`)
        current = voltage / branch.resistance
      } else if (branch.kind === 'saved-current') {
        const saved = vectors.get(branch.vector.toLowerCase())
        if (saved === undefined) throw new Error(`${descriptor.partId} returned no saved DC current.`)
        current = saved
      } else current = 0
      if (!Number.isFinite(current) || !Number.isFinite(voltage * current)) throw new Error(`${descriptor.partId} returned a non-finite DC measurement.`)
      currents.push({ label: branch.label, value: current })
      power! += voltage * current
    }
    parts[descriptor.partId] = { currents, power }
  }
  return { nodeVoltages, parts, elapsedMs }
}

/** Production captures must cover the complete interval requested by the compiler. */
export function requireCompleteCapture(capture: Pick<Capture, 'time'>): void {
  if (Math.abs(capture.time[0] ?? 1) > 1e-9 || Math.abs((capture.time.at(-1) ?? 0) - 0.1) > 1e-9) {
    throw new Error('ngspice returned an incomplete capture. The circuit must finish the full 100 ms simulation; inspect its wiring and capture again.')
  }
}
