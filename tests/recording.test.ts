import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, examples, type CircuitDocument } from '../src/lib/circuit.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { requireCompleteCapture } from '../src/lib/simulation-results.ts'
import { recordingIndex, sampleRecording } from '../src/lib/recording.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(examples.find(item => item.id === id)!.document)
async function solve(document: CircuitDocument, durationSeconds = 0.1) {
  await engine.start()
  const transient = compileCircuit(document, 'transient', undefined, durationSeconds)
  const dc = compileCircuit(document, 'operating-point', undefined, durationSeconds)
  assert.deepEqual(transient.diagnostics.filter(item => item.severity === 'error'), [])
  return runCircuitCapture(engine, {
    type: 'run', revision: 7, netlist: transient.netlist, durationSeconds,
    nodes: { CH1: document.probes.CH1 ? transient.nodeByTerminal[document.probes.CH1] : null, CH2: document.probes.CH2 ? transient.nodeByTerminal[document.probes.CH2] : null },
    operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(document, transient.nodeByTerminal) },
  })
}

test('real ngspice records every offered duration with complete endpoints and bounded static samples', { timeout: 15_000 }, async () => {
  const document = example('voltage-divider')
  for (const seconds of [0.1, 0.5, 1, 5, 10]) {
    const capture = await solve(document, seconds)
    assert.equal(capture.time[0], 0)
    assert.equal(capture.time.at(-1), seconds)
    assert.ok(capture.time.length < 2_000, `DC needs ${capture.time.length} samples`)
    const state = sampleRecording(capture, seconds / 2)!
    assert.ok(Math.abs(state.parts.R1.currents[0].value - 0.00025) < 1e-9)
    assert.ok(Math.abs(state.parts.R2.power! - 0.000625) < 1e-9)
  }
})

test('real transient capacitor currents track charging and discharging, independently of the zero DC current', { timeout: 15_000 }, async () => {
  const document = example('rc-filter')
  document.stimulus = 'step'
  const capture = await solve(document, 1)
  const nodes = compileCircuit(document).nodeByTerminal
  const recording = capture.recording!
  assert.strictEqual(recording.nodeVoltages[nodes[document.probes.CH2!]], capture.channels.CH2)
  assert.equal(capture.operatingPoint!.parts.C1.currents[0].value, 0)
  const charging = sampleRecording(capture, 0.002)!
  const discharging = sampleRecording(capture, 0.052)!
  assert.ok(charging.parts.C1.currents[0].value > 0)
  assert.ok(discharging.parts.C1.currents[0].value < 0)
  assert.ok(Math.abs(charging.parts.C1.currents[0].value - charging.parts.R1.currents[0].value) < 1e-8)
  assert.ok(Math.abs(discharging.parts.C1.currents[0].value - discharging.parts.R1.currents[0].value) < 1e-8)
  assert.ok(Math.abs(charging.nodeVoltages[nodes[document.probes.CH2!]] - document.instruments.amplitude * (1 - Math.exp(-0.0009995 / 0.00101))) < 0.004)
  assert.equal(charging.parts.C1.currents[0].label, '1 → 2')
})

test('recorded LED current changes with the driving waveform and matches the series resistor', { timeout: 15_000 }, async () => {
  const document = example('voltage-divider')
  document.wires.find(wire => wire.from === 'cv')!.from = 'osc'
  document.instruments = { ...document.instruments, waveform: 'square', frequency: 100, amplitude: 3.3 }
  document.parts[0].value = 1_000
  document.parts[1].kind = 'led'
  document.parts[1].value = 1
  const capture = await solve(document)
  const high = sampleRecording(capture, 0.002)!
  const low = sampleRecording(capture, 0.007)!
  assert.ok(high.parts.R2.currents[0].value > 0.0005)
  assert.ok(low.parts.R2.currents[0].value < 1e-8)
  assert.ok(Math.abs(high.parts.R1.currents[0].value - high.parts.R2.currents[0].value) < 1e-7)
  assert.ok(high.parts.R2.power! > 0.001)
})

test('scrubbing interpolates timestamps, clamps endpoints, and resolves repeated timestamps', () => {
  const capture: Capture = { revision: 1, time: [0, 0.1, 0.1, 0.4], channels: { CH1: [], CH2: [] }, duration: 0.4, elapsedMs: 1,
    recording: { nodeVoltages: { a: [0, 2, 4, 10] }, currents: {}, parts: [{ partId: 'R1', nodes: ['a', '0'], branches: [{ kind: 'resistance', label: '1 → 2', fromNode: 'a', toNode: '0', resistance: 1_000 }] }] },
  }
  assert.equal(recordingIndex(capture.time, 0.1), 2)
  assert.equal(sampleRecording(capture, -1)!.nodeVoltages.a, 0)
  assert.equal(sampleRecording(capture, 0.1)!.nodeVoltages.a, 4)
  assert.ok(Math.abs(sampleRecording(capture, 0.25)!.nodeVoltages.a - 7) < 1e-12)
  assert.equal(sampleRecording(capture, 2)!.nodeVoltages.a, 10)
  assert.equal(sampleRecording(capture, NaN), undefined)
  assert.equal(sampleRecording({ ...capture, recording: undefined }, 0), undefined)
})

test('duration and memory limits are explicit and partial long runs are never accepted', () => {
  const document = example('rc-filter')
  document.instruments.frequency = 2_000
  assert.match(compileCircuit(document, 'transient', undefined, 10).diagnostics.map(item => item.message).join(' '), /memory limit/)
  for (const duration of [NaN, Infinity, -1, 0, 11]) assert.equal(compileCircuit(document, 'transient', undefined, duration).netlist, '')
  assert.throws(() => requireCompleteCapture({ time: [0, 0.1] }, 10), /full 10 s/)
  assert.doesNotThrow(() => requireCompleteCapture({ time: [0, 10] }, 10))
})
