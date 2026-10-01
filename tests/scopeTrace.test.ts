import assert from 'node:assert/strict'
import test from 'node:test'
import { createScopeTrace, followCaptureFrame } from '../src/lib/scopeTrace.ts'

test('scope envelopes preserve isolated spikes across adaptive timestamps and duplicate edges', () => {
  const time = Array.from({ length: 100_000 }, (_, index) => (index / 99_999) ** 2)
  const values = time.map(() => 0)
  values[43_217] = 8
  values[89_721] = -12
  const trace = createScopeTrace(time, values)!
  const envelope = trace.envelope(0, 1, 100)
  assert.equal(Math.max(...envelope.map(value => value?.max ?? -Infinity)), 8)
  assert.equal(Math.min(...envelope.map(value => value?.min ?? Infinity)), -12)
  const step = createScopeTrace([0, 0.5, 0.5, 1], [0, 0, 4, 4])!
  assert.deepEqual(step.envelope(0, 1, 2), [{ min: 0, max: 4 }, { min: 4, max: 4 }])
  assert.equal(step.sampleAt(0.5), 4)
})

test('indexed envelopes match a direct scan for arbitrary windows and pixel widths', () => {
  const time = Array.from({ length: 4379 }, (_, index) => index / 1000)
  const values = time.map((seconds, index) => Math.sin(seconds * 31) + index % 17)
  const trace = createScopeTrace(time, values)!
  for (const [start, end, width] of [[0, 4.378, 13], [1.278, 3.455, 77.3], [3.141, 3.147, 10], [0.001, 4.001, 1]]) {
    const expected = Array.from({ length: Math.ceil(width) }, (_, column) => {
      const left = start + column / width * (end - start)
      const right = Math.min(end, start + (column + 1) / width * (end - start))
      const samples = values.filter((_, index) => (column === 0 ? time[index] >= start : time[index] > left) && time[index] <= right)
      return samples.length ? { min: Math.min(...samples), max: Math.max(...samples) } : null
    })
    assert.deepEqual(trace.envelope(start, end, width), expected)
  }
})

test('cached envelope rendering avoids scanning every sample in a long recording', () => {
  const count = 1_000_000
  let reads = 0
  const values = new Proxy(Array.from({ length: count }, (_, index) => index % 97), {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads++
      return Reflect.get(target, property, receiver)
    },
  })
  const trace = createScopeTrace(Array.from({ length: count }, (_, index) => index / count), values)!
  reads = 0
  assert.equal(trace.envelope(0, 1, 600).length, 600)
  assert.ok(reads < 160_000, `Drawing read ${reads} samples instead of cached extrema`)
})

test('playback retains the visible page and follows seeks and loop restarts', () => {
  const initial = { start: 0, end: 0.1, duration: 0.1 }
  assert.equal(followCaptureFrame(initial, 0, 10, 0.05), initial)
  assert.equal(followCaptureFrame(initial, 0, 10, 0.1), initial)
  const later = followCaptureFrame(initial, 0, 10, 7.123)
  assert.ok(later.start <= 7.123 && later.end >= 7.123)
  assert.equal(later.duration, 0.1)
  assert.deepEqual(followCaptureFrame(later, 0, 10, 0), initial)
  assert.deepEqual(followCaptureFrame(later, 0, 10, 10), { start: 9.9, end: 10, duration: 0.1 })
})
