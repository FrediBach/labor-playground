import assert from 'node:assert/strict'
import test from 'node:test'
import { createPicoScopeTrace } from '../src/lib/pico/scope-trace.ts'

test('code values are held, duplicate timestamps use the last observation, and pre-log time stays unknown', () => {
  const trace = createPicoScopeTrace({ name: 'count', unit: '', time: [0.01, 0.03, 0.03, 0.07], values: [1, 2, 3, 4] }, 0.1)!
  assert.equal(trace.sampleAt(0), null)
  assert.equal(trace.sampleAt(0.02), 1)
  assert.equal(trace.sampleAt(0.03), 3)
  assert.equal(trace.sampleAt(0.1), 4)
  assert.equal(trace.sampleAt(0.11), null)
  assert.equal(trace.sampleAt(NaN), null)
  assert.deepEqual(trace.window(0, 0.02), [{ seconds: 0.01, value: 1 }, { seconds: 0.02, value: 1 }])
  assert.deepEqual(trace.window(0.04, 0.05), [{ seconds: 0.04, value: 3 }, { seconds: 0.05, value: 3 }])
  assert.deepEqual(trace.window(0, 0.005), [])
  assert.deepEqual(createPicoScopeTrace({ name: 'single', unit: 'V', time: [0.01], values: [5] }, 0.1)!.window(0, 0.1), [{ seconds: 0.01, value: 5 }, { seconds: 0.1, value: 5 }])
})

test('dense code logs retain short pulses with a bounded drawing cost', () => {
  const time = Array.from({ length: 25_000 }, (_, index) => index / 25_000)
  const values = time.map(() => 0)
  values[15421] = 40; values[23570] = -10
  const trace = createPicoScopeTrace({ name: 'pulses', unit: '', time, values }, 1)!
  const points = trace.window(0, 1, 200)
  assert.ok(points.length <= 1002)
  assert.ok(points.every((point, index) => index === 0 || point.seconds === points[index - 1].seconds || point.value === points[index - 1].value), 'every segment remains horizontal or vertical after downsampling')
  assert.equal(Math.max(...points.map(point => point.value)), 40)
  assert.equal(Math.min(...points.map(point => point.value)), -10)
  assert.equal(trace.sampleAt(time[15421]), 40)
  assert.equal(trace.sampleAt(time[15422]), 0)
  assert.equal(createPicoScopeTrace({ name: 'invalid', unit: '', time: [0], values: [NaN] }, 1), null)
})

test('independent log scales stay finite for extreme and tiny numeric values', () => {
  for (const values of [[-1e308, 1e308], [1e308, 1e308], [-Number.MAX_VALUE, Number.MAX_VALUE], [Number.MIN_VALUE, Number.MIN_VALUE], [0, 0], [1e-30, 2e-30]]) {
    const trace = createPicoScopeTrace({ name: 'range', unit: '', time: [0.01, 0.02], values }, 0.1)!
    for (const value of values) {
      const position = trace.normalize(value)
      assert.ok(Number.isFinite(position) && position >= 0 && position <= 1)
    }
  }
})
