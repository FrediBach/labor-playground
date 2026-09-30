import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, terminalById, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { passiveExamples } from '../src/lib/passive-examples.ts'
import { extractCapture } from '../src/lib/simulation-results.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(passiveExamples.find((item) => item.id === id)!.document)

async function capture(document: CircuitDocument) {
  const compiled = compileCircuit(document)
  assert.deepEqual(compiled.diagnostics, [])
  await engine.start()
  engine.setNetList(compiled.netlist)
  const result = await engine.runSim()
  assert.deepEqual(engine.getError(), [])
  return extractCapture(result, {
    CH1: document.probes.CH1 ? compiled.nodeByTerminal[document.probes.CH1] : null,
    CH2: document.probes.CH2 ? compiled.nodeByTerminal[document.probes.CH2] : null,
  }, 1, 0)
}

function interpolate(time: number[], voltage: number[], target: number): number {
  const index = time.findIndex((value) => value >= target)
  assert.ok(index >= 0)
  if (index === 0 || time[index] === target) return voltage[index]
  const fraction = (target - time[index - 1]) / (time[index] - time[index - 1])
  return voltage[index - 1] + fraction * (voltage[index] - voltage[index - 1])
}

test('passive synth lessons validate, compile cleanly, and use short two-lead footprints', () => {
  for (const example of passiveExamples) {
    assert.deepEqual(validateDocument(example.document), example.document, example.id)
    assert.deepEqual(compileCircuit(example.document).diagnostics, [], example.id)
    for (const part of example.document.parts.filter((part) => part.pins.length === 2)) {
      const [a, b] = part.pins.map((pin) => terminalById[pin])
      const pitch = Math.hypot(a.x - b.x, a.y - b.y) / 24
      assert.ok(pitch >= 1 && pitch <= 8, `${example.id}: ${part.id} lead span ${pitch}`)
    }
  }
})

test('real ngspice: CV attenuator follows the documented wiper fractions', { timeout: 15_000 }, async () => {
  for (const position of [0.5, 0.25, 0.75]) {
    const document = example('cv-attenuator')
    document.parts[0].position = position
    const result = await capture(document)
    assert.ok(result.channels.CH1.every((value) => Math.abs(value - 5) < 1e-9))
    assert.ok(result.channels.CH2.every((value) => Math.abs(value - 5 * position) < 1e-9))
  }
})

test('real ngspice: AC coupling changes the high-pass corner and rejects DC', { timeout: 15_000 }, async () => {
  for (const capacitance of [100e-9, 470e-9]) {
    const document = example('ac-coupling')
    document.parts.find((part) => part.id === 'C1')!.value = capacitance
    const result = await capture(document)
    const steady = result.channels.CH2.filter((_, index) => result.time[index] > 0.05)
    const reactance = 1 / (2 * Math.PI * 100 * capacitance)
    const expectedPeak = 2.5 * 10_000 / Math.hypot(10_100, reactance)
    assert.ok(Math.abs(Math.max(...steady) - expectedPeak) < 0.002, `${capacitance} F`)
    // At a source zero crossing, a positive output demonstrates phase lead.
    assert.ok(interpolate(result.time, result.channels.CH2, 0.09) > 0.6)
  }
  const dc = example('ac-coupling')
  dc.wires[0].from = 'cv'
  const result = await capture(dc)
  assert.ok(result.channels.CH1.every((value) => Math.abs(value - 5) < 1e-9))
  assert.ok(result.channels.CH2.every((value) => Math.abs(value) < 1e-9))
})

test('real ngspice: gate edges produce opposite pulses with the documented RC decay', { timeout: 15_000 }, async () => {
  for (const capacitance of [100e-9, 470e-9]) {
    const document = example('gate-to-trigger')
    document.parts.find((part) => part.id === 'C1')!.value = capacitance
    const result = await capture(document)
    const tau = 10_100 * capacitance
    const at = (time: number) => interpolate(result.time, result.channels.CH2, time)
    assert.ok(Math.max(...result.channels.CH2) > 4.94)
    assert.ok(Math.min(...result.channels.CH2) < -4.94)
    assert.ok(Math.abs(at(0.001001 + tau) / at(0.001001) - 1 / Math.E) < 0.001)
    assert.ok(Math.abs(at(0.051001 + tau) / at(0.051001) - 1 / Math.E) < 0.001)
    assert.ok(Math.abs(at(0.049)) < 0.001)
  }
})

test('real ngspice: envelope detector rectifies peaks and trades ripple for release time', { timeout: 15_000 }, async () => {
  const ripple: number[] = []
  for (const capacitance of [100e-9, 470e-9]) {
    const document = example('envelope-follower')
    document.parts.find((part) => part.id === 'C1')!.value = capacitance
    const result = await capture(document)
    const steady = result.channels.CH2.filter((_, index) => result.time[index] >= 0.08)
    assert.ok(Math.min(...steady) > 3.5)
    assert.ok(Math.max(...steady) < 4.7)
    ripple.push(Math.max(...steady) - Math.min(...steady))
    document.instruments.amplitude = 2.5
    const lower = await capture(document)
    const lowerSteady = lower.channels.CH2.filter((_, index) => lower.time[index] >= 0.08)
    assert.ok(Math.max(...lowerSteady) < Math.min(...steady) - 1.5)
    assert.ok(Math.min(...lowerSteady) > 1)

    // The step capture stops charging at 51 ms, exposing the release directly.
    document.stimulus = 'step'
    const release = await capture(document)
    const at = (time: number) => interpolate(release.time, release.channels.CH2, time)
    assert.ok(Math.abs(at(0.052 + 100_000 * capacitance) / at(0.052) - 1 / Math.E) < 0.001)
  }
  assert.ok(ripple[1] < ripple[0] * 0.6, `ripple: ${ripple.join(', ')}`)
})
