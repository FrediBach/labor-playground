import { PICO_PINS, picoGround } from './profile.ts'
import type { PicoTrace, PinEvent, PinState } from './runtime.ts'
export const PICO_MODEL = { volts: 3.3, outputOhms: 50, pullOhms: 50_000, leakageOhms: 1e9, edgeSeconds: 1e-6, maxEvents: 25_000, maxPwmHz: 5000, maxCurrent: 0.02, minVoltage: -0.3, maxVoltage: 3.6 } as const
const indexedTraces = new WeakMap<PicoTrace, { initial: Map<number, PinState>; events: Map<number, PinEvent[]> }>()

/** GPIO records are discrete states: use the final event at or before a moment,
 * including simultaneous register changes. Index once, then seek in O(log n). */
export function samplePicoPin(trace: PicoTrace | undefined, gpio: number, seconds: number): PinState | undefined {
  if (!trace || !Number.isFinite(seconds)) return undefined
  let index = indexedTraces.get(trace)
  if (!index) {
    index = { initial: new Map(trace.initial.map(state => [state.gpio, state])), events: new Map() }
    for (const event of trace.events) {
      const events = index.events.get(event.gpio)
      if (events) events.push(event)
      else index.events.set(event.gpio, [event])
    }
    indexedTraces.set(trace, index)
  }
  const events = index.events.get(gpio) ?? []
  const ns = Math.min(trace.durationNs, Math.max(0, seconds * 1e9))
  let low = 0, high = events.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (events[middle].ns <= ns) low = middle + 1
    else high = middle
  }
  return low ? events[low - 1] : index.initial.get(gpio)
}

const n = (value: number) => Number(value.toPrecision(12)).toString()
function conductance(state: PinState) {
  if (state.function === 3) return { high: 0, low: 0, pullHigh: state.pullUp ? 1 / PICO_MODEL.pullOhms : 0, pullLow: state.pullDown ? 1 / PICO_MODEL.pullOhms : 0 }
  if (state.enabled && ![4, 5].includes(state.function)) throw new Error(`GP${state.gpio}: unsupported peripheral function.`)
  if (state.state === 5) throw new Error(`GP${state.gpio}: bus keeper mode is unsupported.`)
  return {
    high: state.enabled && state.state === 1 ? 1 / PICO_MODEL.outputOhms : 0,
    low: state.enabled && state.state === 0 ? 1 / PICO_MODEL.outputOhms : 0,
    pullHigh: state.pullUp ? 1 / PICO_MODEL.pullOhms : 0,
    pullLow: state.pullDown ? 1 / PICO_MODEL.pullOhms : 0,
  }
}
export function picoDriverLines(nodes: Record<string, string>, used: Set<string>, trace?: PicoTrace, dc = false): string[] {
  const ground = nodes[picoGround]
  const durationSeconds = (trace?.durationNs ?? 100_000_000) / 1e9
  const lines = [`VPICO_SUPPLY pico_supply ${ground} 3.3`, `RPICO_SUPPLY pico_supply ${nodes['pico:36']} 1`]
  if (trace && trace.events.length > PICO_MODEL.maxEvents) throw new Error('Pico edge density exceeds the 25,000-event capture budget. Shorten the capture, reduce PWM frequency, or use fewer active outputs.')
  for (const pin of PICO_PINS.filter(pin => pin.gpio !== null && used.has(nodes[pin.id]))) {
    const initial = trace?.initial.find(state => state.gpio === pin.gpio) ?? { gpio: pin.gpio!, state: 4, function: 31, enabled: false, pullUp: false, pullDown: true }
    const start = conductance(initial)
    const events = trace?.events.filter(event => event.gpio === pin.gpio) ?? []
    let lastRise = -Infinity, wasHigh = initial.enabled && initial.state === 1
    for (const event of events) {
      const high = event.enabled && event.state === 1
      if (high && !wasHigh) {
        if (event.ns - lastRise < 1e9 / PICO_MODEL.maxPwmHz - 10) throw new Error(`GP${pin.gpio}: output repetition exceeds 5 kHz. Reduce PWM frequency.`)
        lastRise = event.ns
      }
      wasHigh = high
    }
    // Driver and pull registers can change independently during Pin initialization.
    // Apply edge spacing to each physical control, not their summed conductance.
    for (const side of ['high', 'low', 'pullHigh', 'pullLow'] as const) {
      let last = start[side], end = 0
      const points: [number, number][] = [[0, last]]
      if (!dc) for (const event of events) {
        const value = conductance(event)[side]
        if (value === last) continue
        const time = event.ns / 1e9
        if (time < end) throw new Error(`GP${pin.gpio}: edges are less than 1 µs apart. Reduce the frequency or pulse density.`)
        if (time > end) points.push([time, last])
        end = Math.min(time + PICO_MODEL.edgeSeconds, durationSeconds)
        points.push([end, value]); last = value
      }
      if (end < durationSeconds) points.push([durationSeconds, last])
      const control = `pico_${pin.gpio}_${side}_control`
      lines.push(`V${control} ${control} 0 ${dc ? n(start[side]) : `PWL(${points.map(([time, value]) => `${n(time)} ${n(value)}`).join(' ')})`}`)
    }
    for (const side of ['high', 'low'] as const) {
      const pull = side === 'high' ? 'pullHigh' : 'pullLow'
      lines.push(`BPICO_SUM_${pin.gpio}_${side} pico_${pin.gpio}_${side} 0 V = v(pico_${pin.gpio}_${side}_control)+v(pico_${pin.gpio}_${pull}_control)`)
    }
    const node = nodes[pin.id]
    lines.push(`RPICO_LEAK_${pin.gpio} ${node} ${ground} ${PICO_MODEL.leakageOhms}`)
    lines.push(`BPICO_${pin.gpio} ${node} ${ground} I = v(pico_${pin.gpio}_low)*v(${node},${ground})+v(pico_${pin.gpio}_high)*(v(${node},${ground})-3.3)`)
  }
  return lines
}
