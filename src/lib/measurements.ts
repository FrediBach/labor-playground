export interface TraceMeasurements {
  min: number
  max: number
  peakToPeak: number
  /** Integral of voltage over time, divided by capture duration. */
  mean: number
  /** A conservative estimate from the repeating end of the capture, or null. */
  frequency: number | null
}

function validSeries(time: readonly number[], values: readonly number[]): boolean {
  if (time.length < 2 || time.length !== values.length || time.at(-1)! <= time[0]) return false
  return time.every((t, index) => Number.isFinite(t) && Number.isFinite(values[index]) && (index === 0 || t >= time[index - 1]))
}

/** A duplicate timestamp represents a discontinuity; its last value wins. */
function interpolateValid(time: readonly number[], values: readonly number[], target: number): number | null {
  if (!Number.isFinite(target) || target < time[0] || target > time.at(-1)!) return null
  let low = 0
  let high = time.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (time[middle] <= target) low = middle + 1
    else high = middle
  }
  const previous = low - 1
  if (low === time.length || time[previous] === target) return values[previous]
  const fraction = (target - time[previous]) / (time[low] - time[previous])
  return values[previous] + fraction * (values[low] - values[previous])
}

export function interpolateVoltage(time: readonly number[], values: readonly number[], seconds: number): number | null {
  return validSeries(time, values) ? interpolateValid(time, values, seconds) : null
}

function integratedMean(time: readonly number[], values: readonly number[]): number {
  let integral = 0
  for (let index = 1; index < time.length; index++) {
    integral += (values[index - 1] + values[index]) * 0.5 * (time[index] - time[index - 1])
  }
  return integral / (time.at(-1)! - time[0])
}

function frequencyFromValid(time: readonly number[], values: readonly number[], min: number, max: number): number | null {
  const span = max - min
  if (span < Math.max(1e-6, Math.max(Math.abs(min), Math.abs(max)) * 1e-8)) return null
  const midpoint = (min + max) / 2
  const lowThreshold = midpoint - span * 0.1
  const highThreshold = midpoint + span * 0.1
  const crossings: number[] = []
  let armed = values[0] <= lowThreshold
  let candidate: number | null = null
  for (let index = 1; index < time.length; index++) {
    if (values[index] <= lowThreshold) { armed = true; candidate = null }
    if (armed && values[index - 1] < midpoint && values[index] >= midpoint) {
      const fraction = (midpoint - values[index - 1]) / (values[index] - values[index - 1])
      candidate = time[index - 1] + fraction * (time[index] - time[index - 1])
    }
    if (armed && candidate !== null && values[index] >= highThreshold) {
      crossings.push(candidate)
      armed = false
      candidate = null
    }
  }
  // Four rising crossings bound three complete periods. Inspect up to eight
  // periods at the end, allowing a physical startup transient to settle first.
  if (crossings.length < 4) return null
  const steady = crossings.slice(-9)
  const periods = steady.slice(1).map((t, index) => t - steady[index])
  const period = periods.reduce((sum, value) => sum + value, 0) / periods.length
  if (period <= 0 || periods.some((value) => Math.abs(value - period) > period * 0.03)) return null

  // Stable crossings alone can incorrectly label noise or a changing envelope
  // as periodic. Check that the voltage shape repeats at equal cycle phases.
  let squaredError = 0
  let largestError = 0
  const phaseCount = 48
  for (let phase = 0; phase < phaseCount; phase++) {
    const samples = periods.map((duration, index) => interpolateValid(time, values, steady[index] + duration * phase / phaseCount)!)
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    for (const value of samples) {
      squaredError += (value - mean) ** 2
      largestError = Math.max(largestError, Math.abs(value - mean))
    }
  }
  const rmsError = Math.sqrt(squaredError / (periods.length * phaseCount))
  if (rmsError > span * 0.015 || largestError > span * 0.07) return null
  return 1 / period
}

export function estimateFrequency(time: readonly number[], values: readonly number[]): number | null {
  if (!validSeries(time, values)) return null
  let min = Infinity
  let max = -Infinity
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value) }
  return frequencyFromValid(time, values, min, max)
}

export function measureTrace(time: readonly number[], values: readonly number[], stimulus: 'periodic' | 'step' = 'periodic'): TraceMeasurements | null {
  if (!validSeries(time, values)) return null
  let min = Infinity
  let max = -Infinity
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value) }
  return {
    min, max, peakToPeak: max - min, mean: integratedMean(time, values),
    frequency: stimulus === 'step' ? null : frequencyFromValid(time, values, min, max),
  }
}

/** CH1 minus CH2 at a cursor, or its time-weighted capture mean when omitted. */
export function differentialVoltage(time: readonly number[], channel1: readonly number[], channel2: readonly number[], seconds?: number): number | null {
  if (!validSeries(time, channel1) || !validSeries(time, channel2)) return null
  if (seconds !== undefined) {
    const first = interpolateValid(time, channel1, seconds)
    const second = interpolateValid(time, channel2, seconds)
    return first === null || second === null ? null : first - second
  }
  return integratedMean(time, channel1) - integratedMean(time, channel2)
}
