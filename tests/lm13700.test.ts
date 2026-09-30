import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation, type ResultType } from 'eecircuit-engine'
import { lm13700Lines } from '../src/lib/lm13700.ts'
import { fatalSimulationMessages, requireAnalysisCompletion } from '../src/lib/simulation-results.ts'

const engine = new Simulation()
const pins = ['bias_a', 'diode_a', 'inp_a', 'inn_a', 'out_a', 'vn', 'bufin_a', 'bufout_a', 'bufout_b', 'bufin_b', 'vp', 'out_b', 'inn_b', 'inp_b', 'diode_b', 'bias_b']

async function solve(body: string[], analysis = '.op'): Promise<ResultType> {
  await engine.start()
  engine.setNetList(['LM13700 fixture', ...body, ...lm13700Lines('U1', pins), '.options reltol=0.001 abstol=1e-12 vntol=1e-6', '.save all', analysis, '.end'].join('\n'))
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

function at(result: ResultType, name: string): number {
  return vector(result, name)[0]
}

const supplies = ['Vp vp 0 12', 'Vn vn 0 -12']
const groundedInputs = ['Vna inn_a 0 0', 'Vnb inn_b 0 0']

test('LM13700 halves independently convert differential voltage to bias-controlled output current', { timeout: 15_000 }, async () => {
  const result = await solve([...supplies, ...groundedInputs,
    'Vpa inp_a 0 1m', 'Vpb inp_b 0 -1m', 'Ia vp bias_a 100u', 'Ib vp bias_b 200u',
    'Rla out_a 0 10k', 'Rlb out_b 0 10k',
  ])
  const expected = 100e-6 * Math.tanh(0.001 / 0.052) / (1 / 10_000 + 2 / 100e6)
  assert.ok(Math.abs(at(result, 'v(out_a)') / expected - 1) < 0.001)
  assert.ok(Math.abs(at(result, 'v(out_b)') / (-2 * expected) - 1) < 0.001)
  assert.ok(at(result, 'v(bias_a)') > -10.8 && at(result, 'v(bias_a)') < -10.6)
})

test('LM13700 gain follows IABC and saturates at its available bias current', { timeout: 15_000 }, async () => {
  for (const bias of [0, 5e-6, 100e-6, 500e-6]) {
    const result = await solve([...supplies, ...groundedInputs,
      'Vpa inp_a 0 0.5', 'Vpb inp_b 0 -0.5', `Ia vp bias_a ${bias}`, `Ib vp bias_b ${bias}`,
      'Rla out_a 0 1k', 'Rlb out_b 0 1k',
    ])
    assert.ok(Math.abs(at(result, 'v(out_a)') / 1000 - bias) < 2e-8)
    assert.ok(Math.abs(at(result, 'v(out_b)') / 1000 + bias) < 2e-8)
  }
})

test('LM13700 open optional pins solve, while resistor-fed bias produces the expected gain', { timeout: 15_000 }, async () => {
  const result = await solve([...supplies, ...groundedInputs,
    'Vpa inp_a 0 1m', 'Vpb inp_b 0 0', 'Rb 0 bias_a 100k', 'Rla out_a 0 10k',
  ])
  const current = -at(result, 'v(bias_a)') / 100_000
  assert.ok(current > 100e-6 && current < 110e-6)
  const expected = current * Math.tanh(0.001 / 0.052) / (1 / 10_000 + 2 / 100e6)
  assert.ok(Math.abs(at(result, 'v(out_a)') / expected - 1) < 0.001)
  assert.ok(Math.abs(at(result, 'v(out_b)')) < 1e-5)
})

test('LM13700 loaded output has finite rail compliance in both directions', { timeout: 15_000 }, async () => {
  const result = await solve([...supplies, ...groundedInputs,
    'Vpa inp_a 0 0.5', 'Vpb inp_b 0 -0.5', 'Ia vp bias_a 500u', 'Ib vp bias_b 500u',
    'Rla out_a 0 100k', 'Rlb out_b 0 100k',
  ])
  assert.ok(at(result, 'v(out_a)') > 11 && at(result, 'v(out_a)') < 11.2)
  assert.ok(at(result, 'v(out_b)') < -11 && at(result, 'v(out_b)') > -11.2)
})

test('LM13700 linearizing diodes reduce compression with externally fed diode and signal currents', { timeout: 15_000 }, async () => {
  // Each diode supplies part of the two 500 uA input sinks. Modulating the
  // positive sink by ±250 uA changes their difference by ±250 uA at ID=1mA.
  for (const signal of [-250e-6, 0, 250e-6]) {
    const result = await solve([...supplies,
      'Ia vp bias_a 500u', 'Id vp diode_a 1m', `Ip inp_a 0 ${500e-6 + signal}`, `In inn_a 0 ${500e-6 - signal}`,
      'Rcommon diode_a 0 1meg', 'Rla out_a 0 1k', 'Vpb inp_b 0 0', 'Vnb inn_b 0 0',
    ])
    const expected = -signal // Iout = IABC * (Inegative−Ipositive)/Id
    assert.ok(Math.abs(at(result, 'v(out_a)') / 1000 - expected) < 4e-6, `Linearized current at ${signal}`)
  }
})

test('LM13700 buffers are independent Darlington followers with an external pull-down', { timeout: 15_000 }, async () => {
  const result = await solve([...supplies, ...groundedInputs,
    'Vpa inp_a 0 0', 'Vpb inp_b 0 0', 'Vba bufin_a 0 2', 'Vbb bufin_b 0 -2',
    'Ra bufout_a vn 10k', 'Rb bufout_b vn 10k',
  ])
  const a = at(result, 'v(bufout_a)')
  const b = at(result, 'v(bufout_b)')
  assert.ok(a > 0.7 && a < 1)
  assert.ok(b > -3.3 && b < -3)
  assert.ok(Math.abs((a - b) - 4) < 0.04)
  assert.ok(-at(result, 'i(vba)') > 0, 'The Darlington input consumes base current')
  assert.ok(-at(result, 'i(vp)') > 0.002, 'Buffers source their load current from V+')
})

test('LM13700 behavior follows shifted rails and does not use global ground internally', { timeout: 15_000 }, async () => {
  const result = await solve(['Vref reference 0 7', 'Vp vp reference 12', 'Vn vn reference -12',
    'Vpa inp_a reference 1m', 'Vna inn_a reference 0', 'Vpb inp_b reference -1m', 'Vnb inn_b reference 0',
    'Ia vp bias_a 100u', 'Ib vp bias_b 100u', 'Rla out_a reference 10k', 'Rlb out_b reference 10k',
  ])
  const expected = 100e-6 * Math.tanh(0.001 / 0.052) / (1 / 10_000 + 2 / 100e6)
  assert.ok(Math.abs(at(result, 'v(out_a)') - 7 - expected) < 1e-6)
  assert.ok(Math.abs(at(result, 'v(out_b)') - 7 + expected) < 1e-6)
})

test('LM13700 transient gain follows a changing bias current without changing the other channel', { timeout: 15_000 }, async () => {
  const result = await solve([...supplies, ...groundedInputs,
    'Vpa inp_a 0 SIN(0 1m 220)', 'Vpb inp_b 0 SIN(0 1m 220)',
    'Ia vp bias_a 100u', 'Ib vp bias_b PULSE(20u 200u 50m 1u 1u 40m 200m)',
    'Rla out_a 0 10k', 'Rlb out_b 0 10k',
  ], '.tran 10u 100m 0 10u')
  const time = vector(result, 'time')
  const peak = (node: string, start: number, end: number) => Math.max(...vector(result, node).filter((_, index) => time[index] >= start && time[index] <= end))
  const firstA = peak('v(out_a)', 0.005, 0.045)
  const secondA = peak('v(out_a)', 0.055, 0.085)
  const firstB = peak('v(out_b)', 0.005, 0.045)
  const secondB = peak('v(out_b)', 0.055, 0.085)
  assert.ok(Math.abs(firstA - 0.019224) < 1e-5)
  assert.ok(Math.abs(secondA / firstA - 1) < 0.001)
  assert.ok(Math.abs(firstB / firstA - 0.2) < 0.001)
  assert.ok(Math.abs(secondB / firstB - 10) < 0.01)
  assert.equal(time.at(-1), 0.1)
})

test('LM13700 active OTA current is disabled outside the supported supply range', { timeout: 15_000 }, async () => {
  for (const span of [-24, 0, 5, 34]) {
    const result = await solve([`Vp vp 0 ${span / 2}`, `Vn vn 0 ${-span / 2}`, ...groundedInputs,
      'Vpa inp_a 0 0.5', 'Vpb inp_b 0 -0.5', 'Ia vp bias_a 500u', 'Ib vp bias_b 500u',
      'Rla out_a 0 1k', 'Rlb out_b 0 1k',
    ])
    assert.ok(Math.abs(at(result, 'v(out_a)')) < 1e-8, `Positive output at ${span}V span`)
    assert.ok(Math.abs(at(result, 'v(out_b)')) < 1e-8, `Negative output at ${span}V span`)
  }
})
