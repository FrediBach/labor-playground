import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { automationExamples } from '../src/lib/automation-examples.ts'
import { compileCircuit, terminalById, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { sampleRecording } from '../src/lib/recording.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import type { Capture, Channel } from '../src/lib/simulation-types.ts'

const engine = new Simulation()
const example = (id: string) => structuredClone(automationExamples.find(item => item.id === id)!.document)

async function capture(document: CircuitDocument) {
  const transient = compileCircuit(document)
  const dc = compileCircuit(document, 'operating-point')
  assert.deepEqual(transient.diagnostics, [])
  assert.deepEqual(dc.diagnostics, [])
  await engine.start()
  const recording = await runCircuitCapture(engine, {
    type: 'run', revision: 1, netlist: transient.netlist, durationSeconds: 0.1,
    nodes: {
      CH1: transient.nodeByTerminal[document.probes.CH1!],
      CH2: transient.nodeByTerminal[document.probes.CH2!],
    },
    operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(document, dc.nodeByTerminal) },
    automation: { document },
  })
  assert.equal(recording.time[0], 0)
  assert.equal(recording.time.at(-1), 0.1)
  assert.deepEqual(recording.diagnostics, [])
  return recording
}

function at(capture: Capture, channel: Channel, seconds: number): number {
  const index = capture.time.findIndex(time => time >= seconds)
  assert.ok(index >= 0)
  if (index === 0 || capture.time[index] === seconds) return capture.channels[channel][index]
  const fraction = (seconds - capture.time[index - 1]) / (capture.time[index] - capture.time[index - 1])
  return capture.channels[channel][index - 1] + fraction * (capture.channels[channel][index] - capture.channels[channel][index - 1])
}

test('automation lessons round-trip their definitions and fit the editable breadboard', () => {
  for (const { id, document } of automationExamples) {
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(document))), document, id)
    for (const part of document.parts.filter(part => part.pins.length === 2)) {
      const [a, b] = part.pins.map(pin => terminalById[pin])
      const span = Math.hypot(a.x - b.x, a.y - b.y) / 24
      assert.ok(span >= 1 && span <= 8, `${id}: ${part.id} lead span`)
    }
  }
})

test('real ngspice: automated knob example follows both ramps with correct recorded currents and fresh initial state', { timeout: 15_000 }, async () => {
  const document = example('automated-pot-sweep')
  const saved = structuredClone(document)
  const recording = await capture(document)
  assert.deepEqual(recording.automationEvents, [{ automationId: 'A1', time: 0.01 }, { automationId: 'A2', time: 0.06 }])
  for (const [seconds, expected] of [[0.005, 0.5], [0.03, 2.5], [0.055, 4.5], [0.075, 2.75], [0.095, 1]]) {
    assert.ok(Math.abs(at(recording, 'CH1', seconds) - 5) < 1e-8)
    assert.ok(Math.abs(at(recording, 'CH2', seconds) - expected) < 0.002, `${seconds} s: expected ${expected} V`)
    const state = sampleRecording(recording, seconds)!
    assert.ok(state.parts.P1.currents.every(current => Math.abs(current.value + 0.0005) < 1e-8), 'Both divider segments carry 0.5 mA')
    assert.ok(Math.abs(state.parts.P1.power! - 0.0025) < 1e-8)
  }
  const nodes = compileCircuit(document).nodeByTerminal
  assert.ok(Math.abs(recording.operatingPoint!.nodeVoltages[nodes[document.probes.CH2!]] - 0.5) < 1e-8)
  assert.deepEqual(document, saved, 'Capturing does not replace the saved knob position')

  document.automations![0].action.durationMs = 20
  document.automations![1].enabled = false
  const edited = await capture(document)
  assert.ok(Math.abs(at(edited, 'CH2', 0.005) - 0.5) < 0.002, 'The next capture starts at the saved position')
  assert.ok(Math.abs(at(edited, 'CH2', 0.02) - 2.5) < 0.002)
  assert.ok(Math.abs(at(edited, 'CH2', 0.04) - 4.5) < 0.002)
  assert.ok(Math.abs(at(edited, 'CH2', 0.095) - 4.5) < 0.002)
  assert.deepEqual(edited.automationEvents, [{ automationId: 'A1', time: 0.01 }])
})

test('real ngspice: capacitor event example releases at its threshold and preserves charge through discharge', { timeout: 15_000 }, async () => {
  for (const [threshold, capacitance] of [[3, 1e-6], [4, 1e-6], [4, 2.2e-6]]) {
    const document = example('voltage-triggered-release')
    const release = document.automations![1]
    assert.equal(release.trigger.kind, 'voltage')
    if (release.trigger.kind !== 'voltage') throw new Error('Expected voltage release')
    release.trigger.threshold = threshold
    document.parts.find(part => part.id === 'C1')!.value = capacitance
    const recording = await capture(document)
    const tau = 10_100 * capacitance
    const expectedRelease = 0.01 - tau * Math.log(1 - threshold / 5)
    const event = recording.automationEvents!.find(event => event.automationId === 'A2')!
    assert.ok(event, 'The capacitor crossing releases the gate')
    assert.equal(recording.automationEvents!.length, 2, 'Each action runs once')
    assert.ok(Math.abs(event.time - expectedRelease) < 0.00002, `${threshold} V, ${capacitance} F: ${event.time} vs ${expectedRelease} s`)
    assert.ok(Math.abs(at(recording, 'CH2', event.time) - threshold) < 0.005)
    assert.ok(Math.abs(Math.max(...recording.channels.CH2) - threshold) < 0.005)
    assert.ok(Math.abs(at(recording, 'CH2', event.time + tau) - threshold / Math.E) < 0.005, 'Discharge starts from the threshold voltage')
    assert.ok(at(recording, 'CH1', event.time + 0.001) < 0.05, 'The gate source has been released')
    assert.ok(sampleRecording(recording, event.time + tau)!.parts.C1.currents[0].value < 0, 'Recorded capacitor current reverses during discharge')
    assert.equal(recording.channels.CH2[0], 0)
  }
})
