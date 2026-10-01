import { createScopeTrace } from './scopeTrace.ts'
import type { Capture } from './simulation-types.ts'

const DEFAULT_COLUMNS = 240
const MAX_COLUMNS = 512

export interface InspectorTracePoint {
  seconds: number
  voltage: number
}

export interface InspectorTraceWindow {
  start: number
  end: number
  min: number
  max: number
  points: InspectorTracePoint[]
}

export interface InspectorTrace extends InspectorTraceWindow {
  sampleAt: (seconds: number) => number | null
  window: (start: number, end: number, columns?: number) => InspectorTraceWindow | null
}

function bound(time: readonly number[], seconds: number, inclusive: boolean): number {
  let low = 0, high = time.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (time[middle] < seconds || inclusive && time[middle] === seconds) low = middle + 1
    else high = middle
  }
  return low
}

/** Build once for an immutable recording, then draw bounded, peak-preserving
 * previews of any time window. A missing node is unavailable, never ground.
 * Differential voltages are subtracted at solver samples before downsampling. */
export function createInspectorTrace(
  capture: Capture | null | undefined,
  node: string | null | undefined,
  referenceNode: string | null = '0',
): InspectorTrace | null {
  if (!capture?.recording || !node || !referenceNode) return null
  const time = capture.time
  const start = time[0], end = time.at(-1)!
  const positive = node.toLowerCase(), negative = referenceNode.toLowerCase()
  const positiveValues = positive === '0' ? null : capture.recording.nodeVoltages[positive]
  const negativeValues = negative === '0' ? null : capture.recording.nodeVoltages[negative]
  if (positive !== '0' && (!positiveValues || positiveValues.length !== time.length)) return null
  if (negative !== '0' && (!negativeValues || negativeValues.length !== time.length)) return null

  // Ground needs no million-element array of invented samples: it is a known
  // reference with exactly zero volts throughout a valid recording.
  if (!positiveValues && !negativeValues) {
    if (time.length < 2 || end <= start || !time.every((seconds, index) => Number.isFinite(seconds) && (index === 0 || seconds >= time[index - 1]))) return null
    const sampleAt = (seconds: number) => Number.isFinite(seconds) && seconds >= start && seconds <= end ? 0 : null
    const window = (from: number, until: number, columns = DEFAULT_COLUMNS): InspectorTraceWindow | null => {
      if (!Number.isFinite(from) || !Number.isFinite(until) || !Number.isFinite(columns) || columns <= 0) return null
      const left = Math.max(start, from), right = Math.min(end, until)
      return right > left ? { start: left, end: right, min: 0, max: 0, points: [{ seconds: left, voltage: 0 }, { seconds: right, voltage: 0 }] } : null
    }
    return { ...window(start, end)!, sampleAt, window }
  }

  const values = !negativeValues ? positiveValues!
    : negativeValues.map((voltage, index) => (positiveValues?.[index] ?? 0) - voltage)
  const trace = createScopeTrace(time, values)
  if (!trace) return null

  const window = (from: number, until: number, columns = DEFAULT_COLUMNS): InspectorTraceWindow | null => {
    if (!Number.isFinite(from) || !Number.isFinite(until) || !Number.isFinite(columns) || columns <= 0) return null
    const left = Math.max(start, from), right = Math.min(end, until)
    if (right <= left) return null
    const count = Math.min(MAX_COLUMNS, Math.max(1, Math.ceil(columns)))
    const points: InspectorTracePoint[] = [{ seconds: left, voltage: trace.sampleAt(left)! }]
    const first = bound(time, left, false), last = bound(time, right, true)
    if (last - first <= count * 2) {
      // Retain the exact timing of sparse adaptive samples and duplicate edges.
      for (let index = first; index < last; index++) points.push({ seconds: time[index], voltage: values[index] })
    } else {
      // Dense samples become a min/max envelope, keeping one-sample pulses.
      const envelope = trace.envelope(left, right, count)
      for (let column = 0; column < envelope.length; column++) {
        const extrema = envelope[column]
        if (!extrema) continue
        const seconds = left + (column + 0.5) / count * (right - left)
        points.push({ seconds, voltage: extrema.min })
        if (extrema.max !== extrema.min) points.push({ seconds, voltage: extrema.max })
      }
    }
    points.push({ seconds: right, voltage: trace.sampleAt(right)! })
    let min = Infinity, max = -Infinity
    for (const point of points) { min = Math.min(min, point.voltage); max = Math.max(max, point.voltage) }
    return { start: left, end: right, min, max, points }
  }
  return { ...window(start, end)!, sampleAt: trace.sampleAt, window }
}
