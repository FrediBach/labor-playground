import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation, type ResultType } from 'eecircuit-engine'
import { timer555Lines } from '../src/lib/timer555.ts'
import { fatalSimulationMessages, requireAnalysisCompletion } from '../src/lib/simulation-results.ts'

const engine = new Simulation()

async function solve(body: string[], nodes = ['0', 'cap', 'out', 'supply', 'ctrl', 'cap', 'disch', 'supply'], analysis = '.tran 10u 100m 0 10u'): Promise<ResultType> {
  await engine.start()
  engine.setNetList(['555 timer fixture', ...body, ...timer555Lines('U1', nodes), '.options reltol=0.001 abstol=1e-12 vntol=1e-6', '.save all', analysis, '.end'].join('\n'))
  const result = await engine.runSim()
  const operatingPoint = analysis === '.op'
  requireAnalysisCompletion(result, engine.getInfo(), operatingPoint ? 'operating-point' : 'transient')
  assert.deepEqual(fatalSimulationMessages(engine.getError(), operatingPoint ? { analysis: 'operating-point', complete: true } : { time: vector(result, 'time') }), [])
  return result
}

function vector(result: ResultType, name: string): number[] {
  const values = result.data.find(vector => vector.name === name)?.values
  assert.ok(values, `Missing vector ${name}`)
  assert.ok(values.every(Number.isFinite), `Non-finite vector ${name}`)
  return values
}

const astable = ['Vcc supply 0 5', 'Ra supply disch 10k', 'Rb disch cap 10k', 'Ctiming cap 0 100n', 'Cctrl ctrl 0 10n', 'Rload out 0 10k']

function crossings(result: ResultType, rising: boolean, after = 0): number[] {
  const output = vector(result, 'v(out)')
  return vector(result, 'time').filter((time, index) => time > after && index > 0 && (rising
    ? output[index] > 2.5 && output[index - 1] <= 2.5
    : output[index] < 2.5 && output[index - 1] >= 2.5))
}

function measuredPeriod(result: ResultType): number {
  const rising = crossings(result, true, 0.01)
  assert.ok(rising.length > 15, `Only ${rising.length} rising edges`)
  return (rising.at(-1)! - rising[0]) / (rising.length - 1)
}

test('555 astable oscillates at the frequency and duty cycle set by external RA, RB, C', { timeout: 15_000 }, async () => {
  const initial = await solve(astable, undefined, '.op')
  assert.ok(vector(initial, 'v(out)')[0] < 0.11, 'DC analysis reports the deterministic power-on reset state')
  const result = await solve(astable)
  const time = vector(result, 'time')
  const output = vector(result, 'v(out)')
  const period = measuredPeriod(result)
  const expected = Math.log(2) * 30_000 * 100e-9
  assert.ok(Math.abs(period / expected - 1) < 0.03, `${period} versus ${expected}`)
  const rising = crossings(result, true, 0.01)
  const falling = crossings(result, false, rising[0])
  assert.ok(Math.abs((falling[0] - rising[0]) / period - 2 / 3) < 0.02)
  assert.ok(Math.abs(Math.max(...output) - 3.8 * 10_000 / 10_050) < 0.01)
  const capacitor = vector(result, 'v(cap)').filter((_, index) => time[index] > 0.01)
  assert.ok(Math.abs(Math.min(...capacitor) - 5 / 3) < 0.03)
  assert.ok(Math.abs(Math.max(...capacitor) - 10 / 3) < 0.03)
  assert.equal(time.at(-1), 0.1)
})

test('555 frequency follows edited resistance and external control voltage', { timeout: 15_000 }, async () => {
  const slower = await solve(astable.map(line => line === 'Rb disch cap 10k' ? 'Rb disch cap 20k' : line))
  assert.ok(Math.abs(measuredPeriod(slower) / (Math.log(2) * 50_000 * 100e-9) - 1) < 0.03)
  const controlled = await solve([...astable, 'Vctrl ctrl 0 2'])
  // CTRL=2V makes the thresholds 1V and 2V, through the real divider.
  const expected = 20_000 * 100e-9 * Math.log(4 / 3) + 10_000 * 100e-9 * Math.log(2)
  assert.ok(Math.abs(measuredPeriod(controlled) / expected - 1) < 0.03)
})

test('555 monostable keeps its latch after the trigger and times out after ln(3) RC', { timeout: 15_000 }, async () => {
  const result = await solve([
    'Vcc supply 0 5', 'Vtrigger trigger 0 PULSE(5 0 1m 10n 10n 100u 200m)',
    'Rtiming supply cap 100k', 'Ctiming cap 0 100n', 'Rload out 0 10k',
  ], ['0', 'trigger', 'out', 'supply', 'ctrl', 'cap', 'cap', 'supply'])
  const rising = crossings(result, true)
  const falling = crossings(result, false)
  assert.equal(rising.length, 1)
  assert.equal(falling.length, 1)
  const width = falling[0] - rising[0]
  assert.ok(Math.abs(width / (Math.log(3) * 100_000 * 100e-9) - 1) < 0.02, `Pulse width ${width}`)
})

test('555 trigger overrides threshold and RESET overrides a sustained trigger', { timeout: 15_000 }, async () => {
  const result = await solve([
    'Vcc supply 0 5', 'Vtrigger trigger 0 0', 'Vthreshold threshold 0 5',
    'Vreset reset 0 PULSE(5 0 20m 10n 10n 30m 200m)', 'Rdisch supply disch 10k', 'Rload out 0 10k',
  ], ['0', 'trigger', 'out', 'reset', 'ctrl', 'threshold', 'disch', 'supply'])
  const time = vector(result, 'time')
  const output = vector(result, 'v(out)')
  const discharge = vector(result, 'v(disch)')
  const at = (when: number) => time.findIndex(value => value >= when)
  assert.ok(output[at(0.01)] > 3.7, 'Low trigger holds high despite high threshold')
  assert.ok(output[at(0.03)] < 0.11, 'RESET dominates trigger')
  assert.ok(discharge[at(0.03)] < 0.01, 'RESET turns on the discharge path')
  assert.ok(output[at(0.06)] > 3.7, 'Release of RESET allows the low trigger to set the latch')
})

test('555 loaded output has finite resistance and draws its sourcing current from VCC', { timeout: 15_000 }, async () => {
  const result = await solve([
    'Vcc supply 0 12', 'Vtrigger trigger 0 0', 'Vthreshold threshold 0 0', 'Rload out 0 1k', 'Rdisch supply disch 10k',
  ], ['0', 'trigger', 'out', 'supply', 'ctrl', 'threshold', 'disch', 'supply'])
  const output = vector(result, 'v(out)').at(-1)!
  assert.ok(Math.abs(output - 10.8 * 1000 / 1050) < 0.001)
  const expectedCurrent = 0.003 + 12 / 15_000 + output / 1_000 + 12 / (1e9 + 10_000)
  assert.ok(Math.abs(-vector(result, 'i(vcc)').at(-1)! - expectedCurrent) < 1e-6)
})

test('555 inactive and reversed supplies cannot generate an output voltage', { timeout: 15_000 }, async () => {
  for (const supply of [0, 3.3, -5, 17]) {
    const result = await solve([
      `Vcc supply 0 ${supply}`, 'Vtrigger trigger 0 0', 'Vthreshold threshold 0 0', 'Rload out 0 1k', 'Rdisch supply disch 10k',
    ], ['0', 'trigger', 'out', 'supply', 'ctrl', 'threshold', 'disch', 'supply'])
    assert.ok(vector(result, 'v(out)').every(value => Math.abs(value) < 1e-9), `Output with ${supply} V supply`)
  }
})

test('555 thresholds and output are relative to its connected GND pin', { timeout: 15_000 }, async () => {
  const shifted = await solve([
    'Vground ground 0 -5', 'Vcc supply ground 5', 'Ra supply disch 10k', 'Rb disch cap 10k', 'Ctiming cap ground 100n', 'Rload out ground 10k',
  ], ['ground', 'cap', 'out', 'supply', 'ctrl', 'cap', 'disch', 'supply'])
  const output = vector(shifted, 'v(out)')
  assert.ok(Math.abs(Math.max(...output) + 5 - 3.8 * 10_000 / 10_050) < 0.01)
  assert.ok(Math.abs(Math.min(...output) + 5 - 0.1 * 10_000 / 10_050) < 0.01)
  assert.equal(vector(shifted, 'time').at(-1), 0.1)
})
