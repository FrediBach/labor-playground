import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { Simulation, type ResultType } from 'eecircuit-engine'
import { extractCapture } from '../src/lib/simulation-results.ts'
import { resampleCapture } from '../src/lib/audio.ts'
import { SimulationClient, SupersededSimulation } from '../src/lib/simulation-client.ts'
import type { Capture, SimulationRequest, SimulationResponse } from '../src/lib/simulation-types.ts'
import { compileCircuit, examples } from '../src/lib/circuit.ts'

const engine = new Simulation()
async function solve(body: string, step = '10u', duration = '100m') {
  await engine.start()
  engine.setNetList(`Analytical fixture\n${body}\n.tran ${step} ${duration} 0 ${step}\n.save all\n.end`)
  return extractCapture(await engine.runSim(), { CH1: 'in', CH2: 'out' }, 1, 0)
}

test('real ngspice: equal 10k divider produces 2.5V from 5V', { timeout: 15_000 }, async () => {
  const capture = await solve('V1 in 0 5\nR1 in out 10k\nR2 out 0 10k')
  assert.ok(capture.time.length > 10_000)
  assert.ok(Math.abs(capture.channels.CH2.at(-1)! - 2.5) < 1e-9)
})

test('real ngspice: 10k / 100n RC step reaches 3.16V after one millisecond', { timeout: 15_000 }, async () => {
  const capture = await solve('V1 in 0 PULSE(0 5 1u 1n 1n 1 2)\nR1 in out 10k\nC1 out 0 100n', '1u', '5m')
  const index = capture.time.findIndex((time) => time >= 0.001001)
  assert.ok(Math.abs(capture.channels.CH2[index] - 5 * (1 - Math.exp(-1))) < 0.005)
})

test('real ngspice: RC low-pass gain matches the analytical transfer function', { timeout: 15_000 }, async () => {
  const capture = await solve('V1 in 0 SIN(0 2 440)\nR1 in out 10k\nC1 out 0 100n')
  const values = capture.channels.CH2.filter((_, index) => capture.time[index] > 0.08)
  const amplitude = (Math.max(...values) - Math.min(...values)) / 2
  const expected = 2 / Math.sqrt(1 + (2 * Math.PI * 440 * 10_000 * 100e-9) ** 2)
  assert.ok(Math.abs(amplitude - expected) < 0.002, `${amplitude} vs ${expected}`)
})

test('real ngspice: antiparallel generic diodes limit both polarities', { timeout: 15_000 }, async () => {
  const capture = await solve('V1 in 0 SIN(0 3 440)\nR1 in out 1k\nD1 out 0 DGEN\nD2 0 out DGEN\n.model DGEN D(IS=2.52n N=1.752 RS=0.568)')
  const peak = Math.max(...capture.channels.CH2)
  const trough = Math.min(...capture.channels.CH2)
  assert.ok(peak > 0.4 && peak < 0.8)
  assert.ok(trough < -0.4 && trough > -0.8)
})

test('the editable divider, RC, and clipper documents compile to the expected real measurements', { timeout: 15_000 }, async () => {
  for (const example of examples) {
    const document = example.document
    const compiled = compileCircuit(document)
    assert.equal(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length, 0)
    engine.setNetList(compiled.netlist)
    const capture = extractCapture(await engine.runSim(), {
      CH1: compiled.nodeByTerminal[document.probes.CH1!],
      CH2: compiled.nodeByTerminal[document.probes.CH2!],
    }, 1, 0)
    const amplitude = (channel: 'CH1' | 'CH2') => {
      const values = capture.channels[channel].filter((_, index) => capture.time[index] > 0.08)
      return (Math.max(...values) - Math.min(...values)) / 2
    }
    if (example.id === 'voltage-divider') assert.ok(Math.abs(capture.channels.CH2.at(-1)! - 2.5) < 1e-9)
    if (example.id === 'rc-filter') {
      const expectedRatio = 1 / Math.sqrt(1 + (2 * Math.PI * document.instruments.frequency * 10_000 * 100e-9) ** 2)
      assert.ok(Math.abs(amplitude('CH2') / amplitude('CH1') - expectedRatio) < 0.002)
      const changed = structuredClone(document)
      changed.parts.find((part) => part.id === 'C1')!.value = 220e-9
      engine.setNetList(compileCircuit(changed).netlist)
      const changedCapture = extractCapture(await engine.runSim(), { CH1: compiled.nodeByTerminal[document.probes.CH1!], CH2: compiled.nodeByTerminal[document.probes.CH2!] }, 2, 0)
      assert.ok(Math.max(...changedCapture.channels.CH2) < Math.max(...capture.channels.CH2) * 0.8)
    }
    if (example.id === 'diode-clipper') assert.ok(amplitude('CH2') > 0.4 && amplitude('CH2') < 0.8)
  }
})

test('supported LED and switch models give finite, bounded electrical results', { timeout: 15_000 }, async () => {
  const document = structuredClone(examples.find((example) => example.id === 'voltage-divider')!.document)
  document.parts[0].value = 1_000
  document.parts[1].kind = 'led'
  document.parts[1].value = 1
  const outputVoltage = async () => {
    const compiled = compileCircuit(document)
    assert.equal(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length, 0)
    engine.setNetList(compiled.netlist)
    const capture = extractCapture(await engine.runSim(), { CH1: '0', CH2: compiled.nodeByTerminal[document.probes.CH2!] }, 1, 0)
    return capture.channels.CH2.at(-1)!
  }
  const ledVoltage = await outputVoltage()
  assert.ok(ledVoltage > 1.7 && ledVoltage < 2.5, `LED voltage ${ledVoltage}`)
  document.parts[1].kind = 'switch'
  document.parts[1].value = 1
  assert.ok(Math.abs(await outputVoltage() - 5 / 1_001) < 1e-8)
  document.parts[1].value = 0
  assert.ok(Math.abs(await outputVoltage() - 5 * 1e9 / (1e9 + 1_000)) < 1e-8)
})

test('capture extraction keeps floating probes empty and resolves reference ground', () => {
  const result: ResultType = { header: '', numPoints: 2, numVariables: 1, variableNames: ['time'], dataType: 'real', data: [{ name: 'time', type: 'time', values: [0, 0.1] }] }
  const capture = extractCapture(result, { CH1: '0', CH2: 'unconnected' }, 1, 0)
  assert.deepEqual(capture.channels.CH1, [0, 0])
  assert.deepEqual(capture.channels.CH2, [])
  assert.throws(() => extractCapture({ ...result, data: [{ name: 'time', type: 'time', values: [0.1, 0] }] }, { CH1: null, CH2: null }, 1, 0), /timestamps/)
})

test('audio uses timestamps, removes DC, fades endpoints, and attenuates above-band signals', () => {
  function make(frequency: number): Capture {
    const time: number[] = [0]
    while (time.at(-1)! < 0.1) time.push(Math.min(0.1, time.at(-1)! + (time.length % 2 ? 2e-6 : 8e-6)))
    return { revision: 1, time, channels: { CH1: time.map((t) => 2 + Math.sin(2 * Math.PI * frequency * t)), CH2: time.map(() => 2.5) }, duration: 0.1, elapsedMs: 0 }
  }
  const base = make(1_000)
  const pcm = resampleCapture(base, 'CH1', 48_000)
  const high = resampleCapture(make(30_000), 'CH1', 48_000)
  const dc = resampleCapture(base, 'CH2', 48_000)
  assert.equal(pcm.length, 4_800)
  assert.equal(pcm[0], 0)
  assert.equal(Math.abs(pcm.at(-1)!), 0)
  assert.ok(Math.max(...pcm) < 0.26 && Math.max(...pcm) > 0.23)
  assert.ok(Math.max(...dc.map(Math.abs)) < 1e-6)
  const rms = (samples: Float32Array) => Math.sqrt(samples.slice(480, -480).reduce((sum, value) => sum + value * value, 0) / (samples.length - 960))
  assert.ok(rms(high) < rms(pcm) * 0.02)
})

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: SimulationResponse }) => void) | null = null
  onerror: ((event: { preventDefault: () => void; message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  sent: SimulationRequest[] = []
  terminated = false
  constructor() { FakeWorker.instances.push(this) }
  postMessage(request: SimulationRequest) { this.sent.push(request) }
  terminate() { this.terminated = true }
  send(message: SimulationResponse) { this.onmessage?.({ data: message }) }
}

const fakeCapture = (revision: number): Capture => ({ revision, time: [0, 0.1], channels: { CH1: [1, 1], CH2: [] }, duration: 0.1, elapsedMs: 1 })

function installFakeWorker(context: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker })
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'Worker', original)
    else Reflect.deleteProperty(globalThis, 'Worker')
  })
}

test('worker scheduling coalesces edits and runs only the newest waiting revision', async (context) => {
  installFakeWorker(context)
  const client = new SimulationClient()
  context.after(() => client.dispose())
  const first = client.run('first', { CH1: 'n1', CH2: null }, 1)
  const worker = FakeWorker.instances.at(-1)!
  worker.send({ type: 'ready' })
  const second = client.run('second', { CH1: 'n1', CH2: null }, 2)
  const rejected = assert.rejects(second, SupersededSimulation)
  const third = client.run('third', { CH1: 'n1', CH2: null }, 3)
  await rejected
  assert.deepEqual(worker.sent.map((request) => request.revision), [1])
  worker.send({ type: 'result', revision: 1, capture: fakeCapture(1) })
  await first
  assert.deepEqual(worker.sent.map((request) => request.revision), [1, 3])
  worker.send({ type: 'result', revision: 3, capture: fakeCapture(3) })
  assert.equal((await third).revision, 3)
})

test('a stuck worker is terminated and the next capture creates a new one', async (context) => {
  installFakeWorker(context)
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const client = new SimulationClient()
  context.after(() => client.dispose())
  const first = client.run('first', { CH1: null, CH2: null }, 1)
  const worker = FakeWorker.instances.at(-1)!
  worker.send({ type: 'ready' })
  const rejected = assert.rejects(first, /exceeded 8 seconds/)
  context.mock.timers.tick(8_000)
  await rejected
  assert.equal(worker.terminated, true)
  const next = client.run('next', { CH1: null, CH2: null }, 2)
  const replacement = FakeWorker.instances.at(-1)!
  assert.notEqual(replacement, worker)
  replacement.send({ type: 'ready' })
  replacement.send({ type: 'result', revision: 2, capture: fakeCapture(2) })
  assert.equal((await next).revision, 2)
})
