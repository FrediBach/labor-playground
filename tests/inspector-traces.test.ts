import assert from 'node:assert/strict'
import test from 'node:test'
import { createInspectorTrace } from '../src/lib/inspector-traces.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

function capture(time: number[], nodeVoltages: Record<string, number[]>): Capture {
  return { revision: 1, time, duration: time.at(-1)!, elapsedMs: 1, channels: { CH1: [], CH2: [] }, recording: { nodeVoltages, currents: {}, parts: [] } }
}

test('pin and differential previews use physical node recordings with interpolated cursor values', () => {
  const recording = capture([0, 0.1, 0.1, 0.4], { a: [0, 2, 4, 10], b: [1, 1, 1, 4] })
  const pin = createInspectorTrace(recording, 'A')!
  const difference = createInspectorTrace(recording, 'a', 'b')!
  assert.equal(pin.sampleAt(0.1), 4)
  assert.ok(Math.abs(pin.sampleAt(0.25)! - 7) < 1e-12)
  assert.equal(pin.sampleAt(-1), null)
  assert.equal(difference.sampleAt(0.1), 3)
  assert.ok(Math.abs(difference.sampleAt(0.25)! - 4.5) < 1e-12)
  assert.deepEqual(difference.points.filter(point => point.seconds === 0.1).map(point => point.voltage), [1, 3])
  assert.equal(difference.min, -1)
  assert.equal(difference.max, 6)
})

test('ground has a constant baseline but missing, legacy, or malformed node data stays unavailable', () => {
  const recording = capture([0, 1], { a: [0, 3] })
  const ground = createInspectorTrace(recording, '0')!
  assert.equal(ground.min, 0)
  assert.equal(ground.max, 0)
  assert.deepEqual(ground.points, [{ seconds: 0, voltage: 0 }, { seconds: 1, voltage: 0 }])
  assert.equal(ground.sampleAt(0.5), 0)
  assert.equal(ground.sampleAt(NaN), null)
  assert.equal(createInspectorTrace(recording, 'missing'), null)
  assert.equal(createInspectorTrace(recording, 'a', 'missing'), null)
  assert.equal(createInspectorTrace(recording, 'missing', 'missing'), null)
  assert.equal(createInspectorTrace(recording, null), null)
  assert.equal(createInspectorTrace(recording, 'a', null), null)
  assert.equal(createInspectorTrace({ ...recording, recording: undefined }, '0'), null)
  assert.equal(createInspectorTrace(capture([0, 1], { a: [3] }), 'a'), null)
  assert.equal(createInspectorTrace(capture([0, 1], { a: [3, NaN] }), 'a'), null)
  assert.equal(createInspectorTrace(capture([0, 1, 0.5], { a: [0, 2, 3] }), 'a'), null)
  assert.equal(createInspectorTrace(capture([0, Infinity], {}), '0'), null)
})

test('dense previews retain isolated positive and negative peaks with a bounded SVG point count', () => {
  const time = Array.from({ length: 100_000 }, (_, index) => (index / 99_999) ** 2)
  const voltage = time.map(() => 0)
  voltage[32_117] = 17
  voltage[76_409] = -12
  const trace = createInspectorTrace(capture(time, { a: voltage, b: voltage.slice() }), 'a')!
  assert.equal(trace.min, -12)
  assert.equal(trace.max, 17)
  assert.ok(trace.points.length <= 482)
  const maximum = trace.window(0, 1, 1_000_000)!
  assert.ok(maximum.points.length <= 1026)
  assert.equal(maximum.min, -12)
  assert.equal(maximum.max, 17)
  const difference = createInspectorTrace(capture(time, { a: voltage, b: voltage.slice() }), 'a', 'b')!
  assert.equal(difference.min, 0)
  assert.equal(difference.max, 0)
  assert.ok(difference.points.every(point => point.voltage === 0))
})

test('window previews preserve exact sparse timing, interpolate boundaries, and reject invalid ranges', () => {
  const trace = createInspectorTrace(capture([0, 0.1, 0.4, 1], { a: [0, 10, -2, 4] }), 'a')!
  const window = trace.window(0.2, 0.7)!
  assert.equal(window.start, 0.2)
  assert.equal(window.end, 0.7)
  assert.equal(window.min, -2)
  assert.ok(Math.abs(window.max - 6) < 1e-12)
  assert.deepEqual(window.points.map(point => point.seconds), [0.2, 0.4, 0.7])
  assert.deepEqual(trace.window(-1, 2)?.points, trace.points)
  for (const [start, end, columns] of [[1, 2, 240], [-2, -1, 240], [1, 0, 240], [0, 1, 0], [NaN, 1, 240], [0, Infinity, 240]]) {
    assert.equal(trace.window(start, end, columns), null)
  }
})
