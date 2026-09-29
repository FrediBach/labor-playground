export type TriggerEdge = 'rising' | 'falling'

export interface TriggerSettings {
  edge: TriggerEdge
  level: number
  /** Half-width of the confirmation band, in volts. Defaults to 1% of span, minimum 1 mV. */
  hysteresis?: number
}

/** First crossing that travels from one side of the hysteresis band to the other. */
export function findTriggerCrossing(time: readonly number[], values: readonly number[], settings: TriggerSettings): number | null {
  if (time.length < 2 || time.length !== values.length || !Number.isFinite(settings.level) || time.at(-1)! <= time[0]) return null
  let min = Infinity, max = -Infinity
  for (let index = 0; index < time.length; index++) {
    if (!Number.isFinite(time[index]) || !Number.isFinite(values[index]) || (index > 0 && time[index] < time[index - 1])) return null
    min = Math.min(min, values[index]); max = Math.max(max, values[index])
  }
  const hysteresis = settings.hysteresis ?? Math.max(0.001, (max - min) * 0.01)
  if (!Number.isFinite(hysteresis) || hysteresis <= 0) return null
  const direction = settings.edge === 'rising' ? 1 : -1
  const relative = (index: number) => (values[index] - settings.level) * direction
  let armed = relative(0) <= -hysteresis
  let candidate: number | null = null
  for (let index = 1; index < time.length; index++) {
    const before = relative(index - 1), after = relative(index)
    if (after <= -hysteresis) { armed = true; candidate = null }
    if (armed && candidate === null && before < 0 && after >= 0) {
      // Equal timestamps are a genuine step; its crossing has that timestamp.
      const fraction = -before / (after - before)
      candidate = time[index - 1] + fraction * (time[index] - time[index - 1])
    }
    if (armed && candidate !== null && after >= hysteresis) return candidate
  }
  return null
}

export interface CaptureFrame {
  start: number
  end: number
  duration: number
}

/** Keep the requested view inside captured time; use 10% pre-trigger where possible. */
export function frameCapture(time: readonly number[], requestedDuration: number, triggerTime: number | null = null): CaptureFrame | null {
  if (time.length < 2 || !Number.isFinite(requestedDuration) || requestedDuration <= 0) return null
  const first = time[0], last = time.at(-1)!
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null
  const duration = Math.min(requestedDuration, last - first)
  const crossing = triggerTime !== null && Number.isFinite(triggerTime) && triggerTime >= first && triggerTime <= last ? triggerTime : null
  const requestedStart = crossing === null ? first : crossing - duration * 0.1
  const start = Math.max(first, Math.min(last - duration, requestedStart))
  return { start, end: Math.min(last, start + duration), duration }
}
