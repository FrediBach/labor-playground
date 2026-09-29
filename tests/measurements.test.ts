import assert from 'node:assert/strict'
import test from 'node:test'
import { differentialVoltage, estimateFrequency, interpolateVoltage, measureTrace } from '../src/lib/measurements.ts'

function close(actual: number | null | undefined, expected: number, tolerance = 1e-9) {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`)
}

function signal(fn: (seconds: number) => number, duration = 0.1, adaptive = false) {
  const time = [0]
  let index = 0
  while (time.at(-1)! < duration) {
    const step = adaptive ? [5e-6, 20e-6, 75e-6, 10e-6][index++ % 4] : 10e-6
    time.push(Math.min(duration, time.at(-1)! + step))
  }
  return { time, values: time.map(fn) }
}

test('capture mean integrates time rather than averaging adaptive solver rows', () => {
  const time = [0, 0.01, 0.02, 0.1, 1]
  const values = time.map((t) => 10 * t)
  const result = measureTrace(time, values)!
  close(result.min, 0)
  close(result.max, 10)
  close(result.peakToPeak, 10)
  close(result.mean, 5)
  assert.notEqual(result.mean, values.reduce((sum, value) => sum + value, 0) / values.length)
  assert.equal(result.frequency, null)
})

test('time weighting is independent of adaptive sample density for a piecewise linear signal', () => {
  const coarse = measureTrace([2, 3, 5], [1, 5, 1])!
  const fine = measureTrace([2, 2.1, 2.2, 2.4, 3, 4, 4.9, 5], [1, 1.4, 1.8, 2.6, 5, 3, 1.2, 1])!
  close(coarse.mean, 3)
  close(fine.mean, coarse.mean)
})

test('cursor interpolation uses timestamp spacing and does not extrapolate', () => {
  const time = [1, 1.1, 1.6, 2]
  const voltage = [-2, 0, 10, 6]
  close(interpolateVoltage(time, voltage, 1.35), 5)
  close(interpolateVoltage(time, voltage, 1), -2)
  close(interpolateVoltage(time, voltage, 2), 6)
  assert.equal(interpolateVoltage(time, voltage, 0.9), null)
  assert.equal(interpolateVoltage(time, voltage, 2.1), null)
  assert.equal(interpolateVoltage(time, voltage, NaN), null)
})

test('duplicate-time step edges use the later voltage at the exact cursor position', () => {
  const time = [0, 0.5, 0.5, 1]
  const voltage = [0, 0, 4, 4]
  close(interpolateVoltage(time, voltage, 0.499), 0)
  close(interpolateVoltage(time, voltage, 0.5), 4)
  close(measureTrace(time, voltage)!.mean, 2)
})

test('differential meter subtracts interpolated voltages or their time-weighted capture means', () => {
  const time = [0, 0.01, 0.1, 1]
  const first = time.map((t) => 5 + 2 * t)
  const second = time.map((t) => 1 - t)
  close(differentialVoltage(time, first, second), 5.5)
  close(differentialVoltage(time, first, second, 0.4), 5.2)
  assert.equal(differentialVoltage(time, first, [], 0.4), null)
  assert.equal(differentialVoltage(time, first, second, 1.1), null)
})

test('stable sine frequency is accurate with adaptive timestamps and a DC offset', () => {
  const { time, values } = signal((t) => 7 + 2 * Math.sin(2 * Math.PI * 220 * t), 0.1, true)
  close(estimateFrequency(time, values), 220, 0.1)
})

test('triangle and square traces report their measured repetition frequency', () => {
  const triangle = signal((t) => 2 * Math.abs(2 * ((t * 200) % 1) - 1) - 1)
  close(estimateFrequency(triangle.time, triangle.values), 200, 0.1)
  const square = signal((t) => (t * 100) % 1 < 0.4 ? -2 : 3)
  close(estimateFrequency(square.time, square.values), 100, 0.2)
})

test('DC, charging steps, tiny noise, and short captures have no frequency reading', () => {
  for (const fn of [() => 2.5, (t: number) => 5 * (1 - Math.exp(-t / 0.001)), (t: number) => 5 + 1e-8 * Math.sin(2 * Math.PI * 200 * t)]) {
    const { time, values } = signal(fn)
    assert.equal(estimateFrequency(time, values), null)
  }
  const short = signal((t) => Math.sin(2 * Math.PI * 100 * t), 0.029)
  assert.equal(estimateFrequency(short.time, short.values), null)
  const pulse = signal((t) => t < 0.001 || t > 0.051 ? 0 : 5)
  assert.equal(estimateFrequency(pulse.time, pulse.values), null)
  const periodic = signal((t) => Math.sin(2 * Math.PI * 100 * t))
  assert.equal(measureTrace(periodic.time, periodic.values, 'step')!.frequency, null)
})

test('irregular crossings and noisy cycle shapes are not labelled as a stable frequency', () => {
  const chirp = signal((t) => Math.sin(2 * Math.PI * (100 * t + 1500 * t * t)))
  assert.equal(estimateFrequency(chirp.time, chirp.values), null)
  // The disturbance is zero at crossings, so timing alone appears regular.
  const noisy = signal((t) => {
    const phase = 2 * Math.PI * 200 * t
    const cycle = Math.floor(t * 200)
    return Math.sin(phase) + 0.3 * Math.sin(phase) ** 2 * Math.sin(phase * 7 + cycle * 1.731)
  })
  assert.equal(estimateFrequency(noisy.time, noisy.values), null)
  const changingAmplitude = signal((t) => (0.5 + t * 10) * Math.sin(2 * Math.PI * 100 * t))
  assert.equal(estimateFrequency(changingAmplitude.time, changingAmplitude.values), null)
})

test('empty, non-finite, mismatched, and backwards timestamps return unavailable measurements', () => {
  const fixtures = [
    { time: [], values: [] }, { time: [0], values: [1] },
    { time: [0, 1], values: [1] }, { time: [0, 1], values: [0, Infinity] },
    { time: [0, NaN], values: [0, 1] }, { time: [0, 2, 1], values: [1, 2, 3] },
    { time: [1, 1], values: [0, 1] },
  ]
  for (const { time, values } of fixtures) {
    assert.equal(measureTrace(time, values), null)
    assert.equal(estimateFrequency(time, values), null)
    assert.equal(interpolateVoltage(time, values, 0), null)
  }
})
