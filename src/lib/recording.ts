import type { ResultType } from 'eecircuit-engine'
import type { Capture, OperatingPoint, OperatingPointPartDescriptor } from './simulation-types.ts'

/** Save physical terminal voltages and measured device currents, sharing arrays
 * with scope channels instead of allocating another copy of each waveform. */
export function extractRecording(result: ResultType, descriptors: OperatingPointPartDescriptor[]): NonNullable<Capture['recording']> {
  if (result.dataType !== 'real') throw new Error('The recording requires real electrical values.')
  const nodeVoltages: Record<string, number[]> = {}
  const currents: Record<string, number[]> = {}
  const vectors = new Map(result.data.map(vector => [vector.name.toLowerCase(), vector.values]))
  for (const vector of result.data) {
    const node = /^v\(([^)]+)\)$/i.exec(vector.name)?.[1].toLowerCase()
    // Pico conductance controls are internal electrical-check vectors.
    if (vector.type === 'voltage' && node && !node.startsWith('pico_')) nodeVoltages[node] = vector.values
  }
  const parts = descriptors.map(descriptor => ({
    ...descriptor,
    branches: descriptor.branches.map(branch => {
      if (branch.kind !== 'ideal-capacitor') return branch
      if (!branch.vector) throw new Error(`${descriptor.partId} has no transient current descriptor.`)
      return { ...branch, kind: 'saved-current' as const, vector: branch.vector, label: branch.label.replace(' (ideal DC)', '') }
    }),
  }))
  for (const descriptor of parts) {
    for (const node of descriptor.nodes) {
      if (node !== '0' && !nodeVoltages[node.toLowerCase()]) throw new Error(`${descriptor.partId} returned no recorded voltage for one of its pins.`)
    }
    for (const branch of descriptor.branches) {
      if (branch.kind !== 'saved-current') continue
      const name = branch.vector.toLowerCase()
      const values = vectors.get(name)
      if (!values) throw new Error(`${descriptor.partId} returned no saved transient current.`)
      currents[name] = values
    }
  }
  for (const values of [...Object.values(nodeVoltages), ...Object.values(currents)]) {
    if (values.length !== result.numPoints || values.some(value => !Number.isFinite(value))) throw new Error('The recording contains invalid or incomplete electrical values.')
  }
  return { nodeVoltages, currents, parts }
}

/** Return the last sample at or before a moment in O(log n), including exact
 * duplicate timestamps at a discontinuity. Playback never scans a recording. */
export function recordingIndex(time: readonly number[], seconds: number): number {
  let low = 0, high = time.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (time[middle] <= seconds) low = middle + 1
    else high = middle
  }
  return Math.max(0, low - 1)
}

/** Linear interpolation between adjacent adaptive solver samples; saved
 * capacitor/semiconductor currents are interpolated, never inferred from DC. */
export function sampleRecording(capture: Capture, seconds: number): OperatingPoint | undefined {
  const recording = capture.recording
  if (!recording || !capture.time.length || !Number.isFinite(seconds)) return undefined
  const time = Math.min(capture.time.at(-1)!, Math.max(capture.time[0], seconds))
  const left = recordingIndex(capture.time, time)
  const right = Math.min(left + 1, capture.time.length - 1)
  const span = capture.time[right] - capture.time[left]
  const fraction = span > 0 ? (time - capture.time[left]) / span : 0
  const sample = (values: number[]) => values[left] + fraction * (values[right] - values[left])
  const nodeVoltages: OperatingPoint['nodeVoltages'] = { '0': 0 }
  for (const [node, values] of Object.entries(recording.nodeVoltages)) nodeVoltages[node] = sample(values)
  const parts: OperatingPoint['parts'] = {}
  for (const descriptor of recording.parts) {
    const currents: OperatingPoint['parts'][string]['currents'] = []
    let power = descriptor.branches.length ? 0 : null
    for (const branch of descriptor.branches) {
      const voltage = nodeVoltages[branch.fromNode.toLowerCase()] - nodeVoltages[branch.toNode.toLowerCase()]
      const value = branch.kind === 'resistance' ? voltage / branch.resistance
        : branch.kind === 'saved-current' ? sample(recording.currents[branch.vector.toLowerCase()]) : 0
      currents.push({ label: branch.label, value })
      power! += voltage * value
    }
    parts[descriptor.partId] = { currents, power }
  }
  return { nodeVoltages, parts, elapsedMs: capture.elapsedMs }
}
