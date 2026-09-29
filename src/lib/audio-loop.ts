import type { Capture, Channel } from './simulation-types.ts'

export interface AudioLoopRegion {
  /** Absolute capture timestamps at matching rising crossings, in seconds. */
  start: number
  end: number
  period: number
  cycles: number
  frequency: number
}

export type AudioLoopAnalysis =
  | { available: true; region: AudioLoopRegion }
  | { available: false; reason: string }

export function validateAudioCapture(capture: Capture, channel: Channel): string | null {
  const time = capture.time
  const values = capture.channels[channel]
  if (time.length < 2 || values.length !== time.length) return `${channel} is not measuring a simulated node. Attach its probe to the circuit.`
  if (time.length > 100_000) return 'The capture has too many samples for audio preview.'
  for (let index = 0; index < time.length; index++) {
    if (!Number.isFinite(time[index]) || !Number.isFinite(values[index])) return 'The capture contains a non-finite timestamp or voltage.'
    if (Math.abs(values[index]) > 1e12) return 'The capture voltage is outside the supported audio preview range.'
    if (index > 0 && time[index] < time[index - 1]) return 'The capture timestamps are out of order.'
  }
  const duration = time.at(-1)! - time[0]
  return duration > 0 && duration <= 1 ? null : 'This capture is not suitable for audio preview.'
}

/** Validated, bounded input only. A duplicate timestamp uses its later value. */
function voltageAt(time: readonly number[], values: readonly number[], target: number): number {
  let low = 0
  let high = time.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (time[middle] <= target) low = middle + 1
    else high = middle
  }
  const previous = Math.max(0, low - 1)
  if (low === time.length || time[previous] === target) return values[previous]
  return values[previous] + (values[low] - values[previous]) * (target - time[previous]) / (time[low] - time[previous])
}

function stableRegion(time: number[], values: number[], crossings: number[]): AudioLoopRegion | null {
  const start = crossings[0]
  const end = crossings.at(-1)!
  const cycles = crossings.length - 1
  const period = (end - start) / cycles
  if (!(period > 0) || time.at(-1)! - end > period * 1.25) return null
  const periods = crossings.slice(1).map((crossing, index) => crossing - crossings[index])
  if (periods.some((duration) => Math.abs(duration - period) > period * 0.01)) return null

  let min = Infinity
  let max = -Infinity
  const minima = Array<number>(cycles).fill(Infinity)
  const maxima = Array<number>(cycles).fill(-Infinity)
  let cycle = 0
  for (let index = 0; index < time.length; index++) {
    if (time[index] < start || time[index] > end) continue
    min = Math.min(min, values[index])
    max = Math.max(max, values[index])
    while (cycle < cycles - 1 && time[index] >= crossings[cycle + 1]) cycle++
    minima[cycle] = Math.min(minima[cycle], values[index])
    maxima[cycle] = Math.max(maxima[cycle], values[index])
    // Sparse data cannot establish the shape of a repeating waveform.
    if (index > 0 && time[index] - time[index - 1] > period / 16) return null
  }
  const span = max - min
  if (!(span > Math.max(1e-6, Math.max(Math.abs(min), Math.abs(max)) * 1e-8))) return null
  if (Math.max(...minima) - Math.min(...minima) > span * 0.015 || Math.max(...maxima) - Math.min(...maxima) > span * 0.015) return null

  // Compare complete cycles after normalizing their durations. This rejects
  // changing envelopes and noisy signals even when crossings happen regularly.
  const phaseCount = 128
  let squaredError = 0
  let largestError = 0
  let firstLastError = 0
  for (let phase = 0; phase < phaseCount; phase++) {
    // Bin centers avoid placing every comparison exactly on a square edge.
    const samples = periods.map((duration, index) => voltageAt(time, values, crossings[index] + duration * (phase + 0.5) / phaseCount))
    const mean = samples.reduce((sum, value) => sum + value, 0) / cycles
    for (const value of samples) {
      squaredError += (value - mean) ** 2
      largestError = Math.max(largestError, Math.abs(value - mean))
    }
    firstLastError += (samples[0] - samples.at(-1)!) ** 2
  }
  if (Math.sqrt(squaredError / (cycles * phaseCount)) > span * 0.003 || largestError > span * 0.015) return null
  if (Math.sqrt(firstLastError / phaseCount) > span * 0.004) return null

  // Midpoint sampling alone can miss a narrow, changing notch. Compare each
  // phase bin's full recorded range, including its interpolated boundaries.
  // Offset bin boundaries from the usual half-period square-wave transition.
  const edges = [0, ...Array.from({ length: phaseCount }, (_, index) => (index + 0.25) / phaseCount), 1]
  const binCount = edges.length - 1
  const binMin = periods.map((duration, index) => edges.slice(1).map((upper, bin) => Math.min(
    voltageAt(time, values, crossings[index] + edges[bin] * duration),
    voltageAt(time, values, crossings[index] + upper * duration),
  )))
  const binMax = periods.map((duration, index) => edges.slice(1).map((upper, bin) => Math.max(
    voltageAt(time, values, crossings[index] + edges[bin] * duration),
    voltageAt(time, values, crossings[index] + upper * duration),
  )))
  cycle = 0
  for (let index = 0; index < time.length; index++) {
    if (time[index] < start || time[index] > end) continue
    while (cycle < cycles - 1 && time[index] >= crossings[cycle + 1]) cycle++
    const phase = (time[index] - crossings[cycle]) / periods[cycle]
    const bin = Math.max(0, Math.min(binCount - 1, Math.floor(phase * phaseCount - 0.25) + 1))
    binMin[cycle][bin] = Math.min(binMin[cycle][bin], values[index])
    binMax[cycle][bin] = Math.max(binMax[cycle][bin], values[index])
  }
  for (let bin = 0; bin < binCount; bin++) {
    const minima = binMin.map((bins) => bins[bin])
    const maxima = binMax.map((bins) => bins[bin])
    if (Math.max(...minima) - Math.min(...minima) > span * 0.02 || Math.max(...maxima) - Math.min(...maxima) > span * 0.02) return null
  }
  // The unfinished final cycle must agree too: a recording that stops ringing
  // or changes after its last crossing is not a settled periodic capture.
  const lastStart = crossings.at(-2)!
  const lastPeriod = periods.at(-1)!
  let tailError = 0
  let tailSamples = 0
  for (let index = 0; index < time.length; index++) {
    if (time[index] <= end) continue
    if (values[index] < min - span * 0.015 || values[index] > max + span * 0.015) return null
    if (index > 0 && time[index] - time[index - 1] > period / 16) return null
    const phase = ((time[index] - end) / period) % 1
    const bin = Math.max(0, Math.min(binCount - 1, Math.floor(phase * phaseCount - 0.25) + 1))
    if (values[index] < binMin[cycles - 1][bin] - span * 0.02 || values[index] > binMax[cycles - 1][bin] + span * 0.02) return null
  }
  for (let index = 0; ; index++) {
    const elapsed = period * (index + 0.5) / phaseCount
    if (end + elapsed > time.at(-1)!) break
    const phase = (elapsed / period) % 1
    const expected = voltageAt(time, values, lastStart + phase * lastPeriod)
    const error = Math.abs(voltageAt(time, values, end + elapsed) - expected)
    if (error > span * 0.025) return null
    tailError += error * error
    tailSamples++
  }
  if (tailSamples && Math.sqrt(tailError / tailSamples) > span * 0.006) return null
  return { start, end, period, cycles, frequency: 1 / period }
}

/** Find at least three observed stable cycles at the settled end of a capture. */
export function analyzeAudioLoop(capture: Capture, channel: Channel): AudioLoopAnalysis {
  const invalid = validateAudioCapture(capture, channel)
  if (invalid) return { available: false, reason: invalid }
  const time = capture.time
  const values = capture.channels[channel]
  // Derive the crossing level from the tail so a startup offset does not hide
  // an otherwise settled oscillation. Still search the full recorded interval.
  const tailStart = time[0] + (time.at(-1)! - time[0]) * 2 / 3
  let min = Infinity
  let max = -Infinity
  for (let index = 0; index < time.length; index++) {
    if (time[index] < tailStart) continue
    min = Math.min(min, values[index])
    max = Math.max(max, values[index])
  }
  const span = max - min
  if (span < Math.max(1e-6, Math.max(Math.abs(min), Math.abs(max)) * 1e-8)) {
    return { available: false, reason: 'Loop needs a repeating signal; this capture is DC or has no measurable variation.' }
  }
  const midpoint = (min + max) / 2
  const lowThreshold = midpoint - span * 0.1
  const highThreshold = midpoint + span * 0.1
  const crossings: number[] = []
  let armed = values[0] <= lowThreshold
  let candidate: number | null = null
  for (let index = 1; index < time.length; index++) {
    if (values[index] <= lowThreshold) { armed = true; candidate = null }
    if (armed && values[index - 1] < midpoint && values[index] >= midpoint) {
      candidate = time[index - 1] + (midpoint - values[index - 1]) / (values[index] - values[index - 1]) * (time[index] - time[index - 1])
    }
    if (armed && candidate !== null && values[index] >= highThreshold) {
      crossings.push(candidate)
      armed = false
      candidate = null
    }
  }
  for (let cycles = Math.min(8, crossings.length - 1); cycles >= 3; cycles--) {
    const region = stableRegion(time, values, crossings.slice(-cycles - 1))
    if (region) {
      if (region.frequency > 10_000) return { available: false, reason: 'The repeating signal is above the 10 kHz audio preview bandwidth.' }
      return { available: true, region }
    }
  }
  return { available: false, reason: 'Loop needs at least three settled cycles with matching periods and waveform shapes.' }
}

/** Shared audio-only interpolation/filtering; scope measurements stay untouched. */
export function renderAudioPcm(capture: Capture, channel: Channel, sampleRate: number, volume: number, region?: AudioLoopRegion): Float32Array<ArrayBuffer> {
  const invalid = validateAudioCapture(capture, channel)
  if (invalid) throw new Error(invalid)
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) throw new Error('The audio sample rate is unsupported.')
  const time = capture.time
  const values = capture.channels[channel]
  const start = region?.start ?? time[0]
  const duration = (region?.end ?? time.at(-1)!) - start
  const count = Math.max(1, region ? Math.round(duration * sampleRate) : Math.floor(duration * sampleRate))
  const factor = 4
  const interpolated = new Float64Array(count * factor)
  const highRate = region ? interpolated.length / duration : sampleRate * factor
  let mean = 0
  for (let index = 0; index < interpolated.length; index++) {
    const value = voltageAt(time, values, start + index / highRate)
    interpolated[index] = value
    mean += value
  }
  mean /= interpolated.length

  // Normalize the periodic interval to a whole PCM frame count. Playback rate
  // below restores its exact measured duration. Circular FIR taps use only the
  // validated matching boundary, without a crossfade or a per-cycle envelope.
  const half = 48
  const cutoff = Math.min(10_000, sampleRate * 0.22) / highRate
  const kernel = new Float64Array(half * 2 + 1)
  let kernelSum = 0
  for (let offset = -half; offset <= half; offset++) {
    const sinc = offset === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset)
    kernel[offset + half] = sinc * (0.5 + 0.5 * Math.cos(Math.PI * offset / half))
    kernelSum += kernel[offset + half]
  }
  const output = new Float32Array(count)
  let outputMean = 0
  for (let index = 0; index < count; index++) {
    let value = 0
    for (let tap = -half; tap <= half; tap++) {
      const position = index * factor + tap
      const source = region
        ? ((position % interpolated.length) + interpolated.length) % interpolated.length
        : Math.max(0, Math.min(interpolated.length - 1, position))
      value += (interpolated[source] - mean) * kernel[tap + half] / kernelSum
    }
    output[index] = value
    outputMean += value
  }
  outputMean /= count
  let peak = 0
  for (const value of output) peak = Math.max(peak, Math.abs(value - outputMean))
  const gain = Math.max(0, Math.min(0.35, Number.isFinite(volume) ? volume : 0.25)) / Math.max(1, peak)
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.005), Math.floor(count / 4))
  for (let index = 0; index < count; index++) {
    const fade = region ? 1 : Math.min(1, index / Math.max(1, fadeSamples), (count - 1 - index) / Math.max(1, fadeSamples))
    output[index] = Math.max(-0.35, Math.min(0.35, (output[index] - outputMean) * gain)) * fade
  }
  return output
}

export function resampleAudioLoop(capture: Capture, channel: Channel, sampleRate: number, volume = 0.25) {
  const analysis = analyzeAudioLoop(capture, channel)
  if (!analysis.available) throw new Error(analysis.reason)
  if (analysis.region.frequency > sampleRate * 0.22) throw new Error('The repeating signal exceeds this audio device’s preview bandwidth.')
  const pcm = renderAudioPcm(capture, channel, sampleRate, volume, analysis.region)
  return {
    pcm,
    region: analysis.region,
    playbackRate: pcm.length / sampleRate / (analysis.region.end - analysis.region.start),
  }
}
