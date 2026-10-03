import type { Signal, Observation, Expectation, Operator, TimeReference } from './automation-graph.ts'
import type { Capture } from './simulation-types.ts'
import { createVoltageSampler, measureTrace } from './measurements.ts'

export interface Evidence { from: number; to: number; actual?: number; min?: number; max?: number; time?: number; unit: string; message: string; passed?: boolean }
export class ObservationUnavailable extends Error {}
export function referenceTime(reference: TimeReference, activation: number, invocation: number): number { return reference === 'capture' ? 0 : reference === 'invocation' ? invocation : activation }
export function signalValues(signal: Signal, capture: Capture, nodeByTerminal: Record<string, string>): number[] {
  const voltage = (pin?: string) => {
    if (!pin) return capture.time.map(() => 0)
    const node = nodeByTerminal[pin]
    if (!node) throw new Error(`Signal terminal ${pin} is missing.`)
    if (node === '0') return capture.time.map(() => 0)
    const values = capture.recording?.nodeVoltages[node.toLowerCase()]
    if (!values) throw new Error(`No recorded voltage for ${pin}.`)
    return values
  }
  if (signal.kind === 'channel') { const values = capture.channels[signal.channel]; if (values.length !== capture.time.length) throw new Error(`${signal.channel} is not connected.`); return values }
  if (signal.kind === 'voltage') { const positive = voltage(signal.positive), negative = voltage(signal.negative); return positive.map((v, i) => v - negative[i]) }
  const branch = capture.recording?.parts.find(p => p.partId === signal.partId)?.branches[signal.branch]
  if (!branch) throw new Error(`Current branch ${signal.partId} is unavailable.`)
  if (branch.kind === 'saved-current') { const values = capture.recording?.currents[branch.vector.toLowerCase()]; if (values) return values }
  if (branch.kind === 'resistance') {
    const values = (node: string) => node === '0' ? capture.time.map(() => 0) : capture.recording?.nodeVoltages[node.toLowerCase()]
    const a = values(branch.fromNode), b = values(branch.toNode)
    if (a && b) return a.map((v, i) => (v - b[i]) / branch.resistance)
  }
  throw new Error('This branch has no supported recorded current.')
}
export function observationWindow(time: number[], values: number[], from: number, to: number) {
  const sample = createVoltageSampler(time, values)
  if (!sample || to < from || from < time[0] || to > time.at(-1)!) throw new ObservationUnavailable('The complete observation interval is not covered by finite solver samples.')
  const left = sample(from), right = sample(to)
  if (left === null || right === null) throw new ObservationUnavailable('Observation boundary is unavailable.')
  const times = [from], data = [left]
  for (let i = 0; i < time.length; i++) if (time[i] > from && time[i] < to) { times.push(time[i]); data.push(values[i]) }
  if (to > from) { times.push(to); data.push(right) }
  return { time: times, values: data }
}
export function measureObservation(observation: Observation, signal: Signal, capture: Capture, nodes: Record<string, string>, activation: number, invocation: number): Evidence {
  const base = referenceTime(observation.reference, activation, invocation), from = base + observation.from, to = base + observation.to
  if (from < activation - 1e-12) throw new Error('Observation starts before this step is activated.')
  const values = signalValues(signal, capture, nodes), window = observationWindow(capture.time, values, from, to)
  const statistics = measureTrace(window.time, window.values)
  const actual = observation.statistic === 'sample' ? window.values.at(-1)! : statistics?.[observation.statistic]
  if (actual === null || actual === undefined || !Number.isFinite(actual)) throw new ObservationUnavailable('The observation has insufficient duration, resolution, or stable periods.')
  return { from, to, actual, unit: observation.statistic === 'frequency' ? 'Hz' : signal.kind === 'current' ? 'A' : 'V', message: `${observation.statistic}: ${actual.toPrecision(5)}` }
}
export function compare(left: number, operator: Operator, right: number): boolean { return operator === 'lt' ? left < right : operator === 'lte' ? left <= right : operator === 'eq' ? left === right : operator === 'gte' ? left >= right : operator === 'gt' ? left > right : left !== right }
export function crossing(time: number[], values: number[], from: number, to: number, threshold: number, direction: 'rising' | 'falling' | 'above' | 'below'): number | null {
  const window = observationWindow(time, values, from, to)
  if (direction === 'above' || direction === 'below') {
    const above = direction === 'above'
    if (above ? window.values[0] >= threshold : window.values[0] <= threshold) return from
    direction = above ? 'rising' : 'falling'
  }
  // Keep the preceding original sample so a crossing exactly at arming is valid.
  for (let i = 1; i < time.length; i++) {
    if (time[i] < from || time[i - 1] > to) continue
    const a = values[i - 1], b = values[i]
    if (direction === 'rising' ? a >= threshold || b < threshold : a <= threshold || b > threshold) continue
    const at = time[i - 1] + (time[i] - time[i - 1]) * (threshold - a) / (b - a)
    if (at >= from - 1e-12 && at <= to) return Math.max(from, at)
  }
  return null
}
export function evaluateExpectation(expectation: Exclude<Expectation, { kind: 'result' }>, signal: Signal, capture: Capture, nodes: Record<string, string>, activation: number, invocation: number): Evidence {
  if (expectation.kind === 'range' || expectation.kind === 'equal') {
    const evidence = measureObservation(expectation.observation, signal, capture, nodes, activation, invocation)
    const tolerance = expectation.kind === 'equal' ? Math.max(expectation.absoluteTolerance, expectation.relativeTolerance * Math.abs(expectation.expected)) : 0
    const min = expectation.kind === 'range' ? expectation.min : expectation.expected - tolerance, max = expectation.kind === 'range' ? expectation.max : expectation.expected + tolerance
    return { ...evidence, min, max, passed: evidence.actual! >= min && evidence.actual! <= max, message: `Expected ${min}–${max} ${evidence.unit}; observed ${evidence.actual!.toPrecision(5)} ${evidence.unit}.` }
  }
  const base = referenceTime(expectation.reference, activation, invocation), from = base + expectation.from, to = base + expectation.to
  if (from < activation - 1e-12) throw new Error('Expectation starts before activation.')
  const coveredTo = expectation.kind === 'stays' ? to : Math.min(to, capture.time.at(-1)!)
  const values = signalValues(signal, capture, nodes), window = observationWindow(capture.time, values, from, coveredTo), unit = signal.kind === 'current' ? 'A' : 'V'
  if (expectation.kind === 'reaches') {
    const time = crossing(capture.time, values, from, coveredTo, expectation.threshold, expectation.direction)
    if (time === null && coveredTo < to) throw new ObservationUnavailable('The recording ends before the crossing deadline.')
    let extreme = expectation.direction === 'rising' ? -Infinity : Infinity
    const evidenceValues = time === null ? window.values : observationWindow(capture.time, values, from, time).values
    for (const value of evidenceValues) extreme = expectation.direction === 'rising' ? Math.max(extreme, value) : Math.min(extreme, value)
    return { from, to: time ?? to, time: time ?? undefined, actual: extreme, unit, passed: time !== null, message: time === null ? `Expected a ${expectation.direction} crossing of ${expectation.threshold} ${unit} within ${to - from} s; extreme observed was ${extreme.toPrecision(5)} ${unit}.` : `Crossed ${expectation.threshold} ${unit} at ${time.toPrecision(5)} s.` }
  }
  const inside = (value: number) => value >= expectation.min && value <= expectation.max
  if (expectation.kind === 'stays') {
    const violation = window.values.findIndex(value => !inside(value))
    return { from, to, unit, min: expectation.min, max: expectation.max, passed: violation < 0, ...(violation >= 0 ? { time: window.time[violation], actual: window.values[violation] } : {}), message: violation < 0 ? 'Every solver sample and interpolated boundary is within range.' : `Expected ${expectation.min}–${expectation.max} ${unit}; observed ${window.values[violation]} ${unit} at ${window.time[violation]} s.` }
  }
  // Clip each linear segment to its in-range interval, accumulating contiguous time.
  let entered: number | null = inside(window.values[0]) ? from : null
  if (entered !== null && expectation.hold === 0) return { from, to: from, time: from, unit, passed: true, message: 'The signal is in range at activation.' }
  for (let i = 1; i < window.time.length; i++) {
    const a = window.values[i - 1], b = window.values[i], t0 = window.time[i - 1], t1 = window.time[i]
    let lo = 0, hi = 1
    if (a === b) { if (!inside(a)) { entered = null; continue } }
    else { const p = (expectation.min - a) / (b - a), q = (expectation.max - a) / (b - a); lo = Math.max(0, Math.min(p, q)); hi = Math.min(1, Math.max(p, q)); if (lo > hi) { entered = null; continue } }
    if (entered === null || lo > 0) entered = t0 + lo * (t1 - t0)
    const end = t0 + hi * (t1 - t0)
    if (end - entered >= expectation.hold) return { from, to: entered + expectation.hold, time: entered, unit, passed: true, message: `Settled at ${entered} s and held for ${expectation.hold} s.` }
    if (hi < 1) entered = null
  }
  if (coveredTo < to) throw new ObservationUnavailable('The recording ends before the settling deadline.')
  return { from, to, unit, passed: false, message: `No contiguous ${expectation.hold} s hold in ${expectation.min}–${expectation.max} ${unit} before ${to} s.` }
}

/** Component pins are resolved from the current placement, not a saved net name. */
export function signalNodeMap(document: import('./circuit.ts').CircuitDocument, nodes: Record<string, string>): Record<string, string> {
  const result = { ...nodes }
  for (const part of document.parts) part.pins.forEach((terminal, pin) => { result[`part:${part.id}:${pin}`] = nodes[terminal] })
  return result
}
export function stableTerminal(document: import('./circuit.ts').CircuitDocument, terminal: string, nodes: Record<string, string>): string {
  const candidates = document.parts.flatMap(p => p.pins.map((pin, index) => ({ part: p, pin, index }))).filter(p => nodes[p.pin] === nodes[terminal])
  const chosen = candidates.find(p => p.pin === terminal) ?? candidates[0]
  return chosen ? `part:${chosen.part.id}:${chosen.index}` : terminal
}
