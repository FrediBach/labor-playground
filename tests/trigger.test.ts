import assert from 'node:assert/strict'
import test from 'node:test'
import { findTriggerCrossing, frameCapture } from '../src/lib/trigger.ts'

function close(actual: number | null, expected: number) {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-10, `Expected ${actual} ≈ ${expected}`)
}

test('rising trigger interpolates the first confirmed crossing using adaptive timestamps', () => {
  const time = [0, 0.002, 0.008, 0.012, 0.013, 0.022]
  const values = [-2, -1, 2, -2, -1, 3]
  close(findTriggerCrossing(time, values, { edge: 'rising', level: 0.5 }), 0.005)
})

test('falling trigger interpolates a nonzero level independently of the rising edge', () => {
  const time = [1, 1.1, 1.3, 1.7, 2]
  const values = [-3, 3, 4, -4, 1]
  close(findTriggerCrossing(time, values, { edge: 'falling', level: 1 }), 1.45)
  close(findTriggerCrossing(time, values, { edge: 'rising', level: 1 }), 1 + 0.1 * 4 / 6)
})

test('hysteresis rejects incomplete edges and rearms after a noise excursion', () => {
  const time = [0, 1, 2, 3, 4, 5]
  const values = [-1, 0.02, -0.2, -0.05, 0.05, 0.3]
  close(findTriggerCrossing(time, values, { edge: 'rising', level: 0, hysteresis: 0.1 }), 3.5)
  assert.equal(findTriggerCrossing([0, 1, 2], [-1, 0.03, 0.04], { edge: 'rising', level: 0, hysteresis: 0.1 }), null)
})

test('flat DC, unreachable levels, and tiny unconfirmed noise have no crossing', () => {
  assert.equal(findTriggerCrossing([0, 1, 2], [2.5, 2.5, 2.5], { edge: 'rising', level: 2.5 }), null)
  assert.equal(findTriggerCrossing([0, 1, 2], [-1, 1, -1], { edge: 'rising', level: 4 }), null)
  assert.equal(findTriggerCrossing([0, 1, 2], [-0.0001, 0.0001, 0], { edge: 'rising', level: 0 }), null)
  // Starting above the level does not invent an earlier crossing.
  assert.equal(findTriggerCrossing([0, 1, 2], [1, 2, 3], { edge: 'rising', level: 0 }), null)
})

test('a discontinuity uses its shared timestamp without division by zero', () => {
  close(findTriggerCrossing([0, 0.5, 0.5, 1], [-2, -2, 2, 2], { edge: 'rising', level: 0 }), 0.5)
})

test('invalid trigger input returns no crossing', () => {
  for (const [time, values] of [[[], []], [[0], [1]], [[0, 1], [1]], [[0, 2, 1], [-1, 0, 1]], [[0, 1], [-1, Infinity]], [[0, NaN], [-1, 1]], [[1, 1], [-1, 1]]]) {
    assert.equal(findTriggerCrossing(time, values, { edge: 'rising', level: 0 }), null)
  }
  assert.equal(findTriggerCrossing([0, 1], [-1, 1], { edge: 'rising', level: NaN }), null)
  assert.equal(findTriggerCrossing([0, 1], [-1, 1], { edge: 'rising', level: 0, hysteresis: 0 }), null)
})

test('framing puts a crossing at ten percent of the view and clamps both boundaries', () => {
  const time = [1, 2]
  const middle = frameCapture(time, 0.2, 1.4)!
  close(middle.start, 1.38); close(middle.end, 1.58)
  const early = frameCapture(time, 0.2, 1.005)!
  close(early.start, 1); close(early.end, 1.2)
  const late = frameCapture(time, 0.2, 1.99)!
  close(late.start, 1.8); close(late.end, 2)
})

test('no crossing starts at captured time and oversized windows never extrapolate', () => {
  assert.deepEqual(frameCapture([3, 4], 0.5), { start: 3, end: 3.5, duration: 0.5 })
  assert.deepEqual(frameCapture([3, 4], 10, 3.2), { start: 3, end: 4, duration: 1 })
  assert.deepEqual(frameCapture([3, 4], 0.5, 9), { start: 3, end: 3.5, duration: 0.5 })
  assert.equal(frameCapture([], 1), null)
  assert.equal(frameCapture([0, 0], 1), null)
  assert.equal(frameCapture([0, 1], -1), null)
})
