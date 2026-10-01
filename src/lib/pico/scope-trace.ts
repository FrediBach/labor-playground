import { recordingIndex } from '../recording.ts'
import type { PicoScopeChannel } from './scope-log.ts'

/** Logged values are discrete observations: hold the latest sample and leave
 * the time before the first observation blank. Never interpolate code values. */
export function createPicoScopeTrace(channel: PicoScopeChannel, duration: number) {
  const { time, values } = channel
  if (!time.length || time.length !== values.length || !Number.isFinite(duration) || duration <= 0
    || time.some((seconds, index) => !Number.isFinite(seconds) || seconds < 0 || seconds > duration || !Number.isFinite(values[index]) || index > 0 && seconds < time[index - 1])) return null
  let min = Infinity, max = -Infinity
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value) }
  // Normalize before subtracting or adding padding: even finite endpoints can
  // overflow when their span is calculated directly (for example ±1e308).
  const magnitude = Math.max(Math.abs(min), Math.abs(max)) || 1
  const low = min / magnitude, high = max / magnitude
  const padding = high > low ? (high - low) * 0.15 : 0.1
  const normalize = (value: number) => (value / magnitude - (low - padding)) / (high - low + 2 * padding)
  const sampleAt = (seconds: number) => !Number.isFinite(seconds) || seconds < time[0] || seconds > duration ? null : values[recordingIndex(time, seconds)]
  const window = (start: number, end: number, requestedColumns = 500) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(requestedColumns) || requestedColumns <= 0) return []
    const left = Math.max(start, time[0]), right = Math.min(end, duration)
    if (right < left || end <= start) return []
    const points: { seconds: number; value: number }[] = []
    let index = recordingIndex(time, left), held = values[index]
    points.push({ seconds: left, value: held })
    index++
    const last = recordingIndex(time, right)
    const columns = Math.max(1, Math.min(1000, Math.ceil(requestedColumns)))
    if (last - index < columns) {
      for (; index <= last; index++) {
        points.push({ seconds: time[index], value: held }, { seconds: time[index], value: values[index] })
        held = values[index]
      }
    } else {
      // Preserve brief extrema instead of losing single-sample pulses when a
      // dense log is viewed at a few hundred screen pixels.
      for (let column = 0; column < columns; column++) {
        const until = left + (column + 1) / columns * (right - left)
        const previous = held
        let low = held, high = held
        while (index <= last && time[index] <= until) {
          held = values[index++]; low = Math.min(low, held); high = Math.max(high, held)
        }
        const middle = left + (column + 0.5) / columns * (right - left)
        points.push({ seconds: middle, value: previous }, { seconds: middle, value: low }, { seconds: middle, value: high }, { seconds: middle, value: held }, { seconds: until, value: held })
      }
    }
    points.push({ seconds: right, value: held })
    return points
  }
  return { min, max, normalize, sampleAt, window }
}
