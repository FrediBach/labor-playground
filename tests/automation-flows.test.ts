import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, createEmptyDocument, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { migrateAutomations, withProgram } from '../src/lib/automation-migration.ts'
import { deleteSimple, toggleSimple } from '../src/lib/automation-editing.ts'
import { emptyFlow, validateAutomationProgram, type AutomationProgram, type FlowNode } from '../src/lib/automation-graph.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { automationExamples } from '../src/lib/automation-examples.ts'
import { interpolateVoltage } from '../src/lib/measurements.ts'
import { evaluateExpectation, observationWindow } from '../src/lib/automation-signals.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

const engine = new Simulation()
async function solve(document: CircuitDocument, duration = .1) {
  await engine.start()
  const transient = compileCircuit(document, 'transient', undefined, duration), dc = compileCircuit(document, 'operating-point', undefined, duration)
  assert.deepEqual(transient.diagnostics.filter(d => d.severity === 'error'), [])
  return runCircuitCapture(engine, { type: 'run', revision: 1, netlist: transient.netlist, nodes: { CH1: document.probes.CH1 ? transient.nodeByTerminal[document.probes.CH1] : null, CH2: document.probes.CH2 ? transient.nodeByTerminal[document.probes.CH2] : null }, durationSeconds: duration, automation: { document }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(document, dc.nodeByTerminal) } })
}
function sequential(nodes: FlowNode[]): AutomationProgram {
  const f = emptyFlow(); f.nodes.push(...nodes)
  f.edges = f.nodes.slice(1).map((node, i) => ({ id: `E${i}`, source: f.nodes[i].id, outcome: 'done', target: node.id }))
  return { version: 1, captureFlowId: f.id, definitions: [f], signals: [{ id: 'CV', name: 'CV', kind: 'voltage', positive: 'cv' }], tests: [] }
}
const end: FlowNode = { id: 'Finish', label: 'Finish', kind: 'finish', order: 100, outputs: {} }

test('stale Simple actions fail clearly without changing the document', () => {
  const document = structuredClone(automationExamples[0].document)
  const original = structuredClone(document)
  for (const update of [toggleSimple, deleteSimple]) {
    assert.throws(() => update(document, 'Missing'), /no longer available in Simple view/)
    assert.deepEqual(document, original)
  }
})

test('schema 4 migration is deterministic, idempotent, and has one executable representation', () => {
  const legacy = automationExamples[0].document
  const program = migrateAutomations(legacy.automations!)
  const document = withProgram(legacy, program)
  assert.equal(document.automations, undefined)
  assert.deepEqual(validateDocument(document), document)
  assert.deepEqual(withProgram(document, program), document)
  assert.deepEqual(migrateAutomations(legacy.automations!), program)
  assert.throws(() => validateDocument({ ...document, automations: [] }), /no legacy/)
  assert.throws(() => validateDocument({ ...document, schemaVersion: 3 }), /schema version 4/)
  assert.equal(migrateAutomations([]).definitions[0].nodes.length, 1)
})
test('graph rejects cycles, recursion, invalid units, unknown fields and unavailable branch results', () => {
  const p = sequential([{ id: 'A', label: 'Ramp', kind: 'action', action: { target: 'cv', value: 2, durationMs: 1 }, order: 1 }, end])
  assert.doesNotThrow(() => validateAutomationProgram(p))
  const cycle = structuredClone(p); cycle.definitions[0].edges.push({ id: 'Cycle', source: 'Finish', outcome: 'done', target: 'A' }); assert.throws(() => validateAutomationProgram(cycle), /cycle|Join/)
  const recursive = structuredClone(p); recursive.definitions[0].nodes[1] = { id: 'A', label: 'Call', kind: 'call', flowId: 'Capture', enabled: true, inputs: {}, order: 1 }; assert.throws(() => validateAutomationProgram(recursive), /Recursive/)
  const invalid = structuredClone(p); Object.assign(invalid.definitions[0].nodes[1], { value: { kind: 'constant', value: 1, unit: 'Hz' } }); assert.throws(() => validateAutomationProgram(invalid), /units/)
  assert.throws(() => validateAutomationProgram({ ...p, script: 'evil' }), /Unknown/)
})
test('real engine: migrated gate release retains causal RC charge and legacy event times', { timeout: 20000 }, async () => {
  const legacy = structuredClone(automationExamples.find(e => e.id === 'voltage-triggered-release')!.document)
  const before = await solve(legacy), after = await solve(withProgram(legacy, migrateAutomations(legacy.automations!)))
  assert.equal(after.automationRun?.status, 'done', JSON.stringify(after.automationRun))
  assert.deepEqual(after.automationEvents, before.automationEvents)
  for (const at of [.005, .015, .025, .05, .09]) assert.ok(Math.abs(interpolateVoltage(before.time, before.channels.CH2, at)! - interpolateVoltage(after.time, after.channels.CH2, at)!) < .001)
})
test('real engine: A completion then B delay preserves ramp completion semantics', { timeout: 15000 }, async () => {
  const document = { ...createEmptyDocument(), probes: { CH1: 'cv', CH2: null } }
  const p = sequential([
    { id: 'A', label: 'Raise', kind: 'action', action: { target: 'cv', value: 4, durationMs: 20 }, order: 1 },
    { id: 'Delay', label: 'Wait 5 ms', kind: 'wait', mode: 'delay', seconds: .005, reference: 'activation', order: 2 },
    { id: 'B', label: 'Lower', kind: 'action', action: { target: 'cv', value: 0, durationMs: 10 }, order: 3 }, end,
  ])
  const capture = await solve(withProgram(document, p))
  assert.equal(capture.automationRun?.status, 'done')
  assert.ok(Math.abs(capture.automationEvents![1].time - .025) < 1e-12)
  assert.ok(Math.abs(interpolateVoltage(capture.time, capture.channels.CH1, .022)! - 4) < .001)
})
test('real engine: an observation routes an action only after its complete window', { timeout: 15000 }, async () => {
  const document = { ...createEmptyDocument(), probes: { CH1: 'cv', CH2: null } }
  const p = sequential([
    { id: 'A', label: 'Raise', kind: 'action', action: { target: 'cv', value: 4, durationMs: 10 }, order: 1 },
    { id: 'M', label: 'Measure', kind: 'measure', observation: { signalId: 'CV', statistic: 'mean', from: 0, to: .01, reference: 'activation' }, output: 'voltage', order: 2 },
    { id: 'C', label: 'Enough voltage', kind: 'condition', left: { kind: 'result', nodeId: 'M', output: 'voltage', unit: 'V' }, operator: 'gte', right: { kind: 'constant', value: 3, unit: 'V' }, order: 3 },
    { id: 'B', label: 'Lower', kind: 'action', action: { target: 'cv', value: 0, durationMs: 0 }, order: 4 }, end,
  ])
  p.definitions[0].edges.find(e => e.source === 'C')!.outcome = 'yes'
  const capture = await solve(withProgram(document, p))
  assert.equal(capture.automationRun?.status, 'done', JSON.stringify(capture.automationRun))
  assert.equal(capture.automationEvents![1].time, .02)
})
test('real engine: an unhandled timeout cannot complete successfully', { timeout: 15000 }, async () => {
  const p = sequential([{ id: 'W', label: 'Wait for 100 V', kind: 'watch', signalId: 'CV', direction: 'rising', threshold: 100, after: 0, deadline: .02, reference: 'activation', order: 1 }, end])
  const capture = await solve(withProgram(createEmptyDocument(), p))
  assert.equal(capture.automationRun?.status, 'failed')
  assert.equal(capture.automationRun?.nodes.find(n => n.nodeId === 'W')?.status, 'timed-out')
  assert.equal(capture.automationRun?.nodes.find(n => n.nodeId === 'Finish')?.status, 'skipped')
})
test('windows include interpolated endpoints and use nonuniform sample timing', () => {
  assert.deepEqual(observationWindow([0, 1, 3], [0, 2, 2], .5, 2), { time: [.5, 1, 2], values: [1, 2, 2] })
  const capture = { time: [0, 1, 3], channels: { CH1: [0, 2, 2], CH2: [] } } as unknown as Capture
  const evidence = evaluateExpectation({ kind: 'range', observation: { signalId: 'CH1', statistic: 'mean', from: 0, to: 3, reference: 'capture' }, min: 1.66, max: 1.67 }, { id: 'CH1', name: 'CH1', kind: 'channel', channel: 'CH1' }, capture, {}, 0, 0)
  assert.equal(evidence.passed, true)
  assert.ok(Math.abs(evidence.actual! - 5 / 3) < 1e-12)
})

test('real engine: the existing maximum of 24 voltage automations fits the causal pass budget', { timeout: 15000 }, async () => {
  const document = { ...createEmptyDocument(), probes: { CH1: 'osc', CH2: 'cv' }, instruments: { cv: 0, frequency: 1000, amplitude: 2, waveform: 'sine' as const } }
  const p = migrateAutomations(Array.from({ length: 24 }, (_, i) => ({ id: `A${i}`, name: `Crossing ${i + 1}`, enabled: true, trigger: { kind: 'voltage' as const, channel: 'CH1' as const, threshold: .1, direction: 'rising' as const, afterMs: i }, action: { target: 'cv' as const, value: i % 5, durationMs: 0 } })))
  const capture = await solve(withProgram(document, p))
  assert.equal(capture.automationEvents!.length, 24); assert.equal(new Set(capture.automationEvents!.map(e => e.automationId)).size, 24)
  assert.equal(capture.automationRun!.solverPasses, 25); assert.equal(capture.automationRun!.status, 'done', capture.automationRun!.nodes.find(n => n.status === 'error')?.message)
})
test('reused calls export independent measured values and call-relative times', async () => {
  const document = { ...createEmptyDocument(), probes: { CH1: 'cv', CH2: null } }
  const program = sequential([{ id: 'First', label: 'First use', kind: 'call', flowId: 'Measure', enabled: true, inputs: { target: { kind: 'constant', value: 2, unit: 'V' } }, order: 1 }, { id: 'Second', label: 'Second use', kind: 'call', flowId: 'Measure', enabled: true, inputs: { target: { kind: 'constant', value: 4, unit: 'V' } }, order: 2 }, end])
  const called = emptyFlow('Measure', 'Set and measure'); called.inputs = [{ id: 'target', unit: 'V' }]; called.outputs = [{ id: 'voltage', unit: 'V' }]
  called.nodes.push({ id: 'Set', kind: 'action', label: 'Set voltage', order: 1, action: { target: 'cv', value: 0, durationMs: 5 }, value: { kind: 'input', inputId: 'target', unit: 'V' } }, { id: 'M', kind: 'measure', label: 'Measure settled value', output: 'voltage', order: 2, observation: { signalId: 'CV', statistic: 'sample', from: .001, to: .001, reference: 'activation' } }, { id: 'Finish', kind: 'finish', label: 'Export', order: 3, outputs: { voltage: { kind: 'result', nodeId: 'M', output: 'voltage', unit: 'V' } } })
  called.edges = [{ id: 'E1', source: 'Start', target: 'Set', outcome: 'done' }, { id: 'E2', source: 'Set', target: 'M', outcome: 'done' }, { id: 'E3', source: 'M', target: 'Finish', outcome: 'done' }]; program.definitions.push(called)
  const capture = await solve(withProgram(document, program))
  assert.equal(capture.automationRun?.status, 'done', JSON.stringify(capture.automationRun))
  assert.equal(capture.automationEvents?.length, 2)
  const calls = capture.automationRun!.nodes.filter(n => n.kind === 'call')
  assert.ok(Math.abs(calls[0].values.voltage - 2) < 1e-6); assert.ok(Math.abs(calls[1].values.voltage - 4) < 1e-6)
  assert.equal(calls[0].ended, .006); assert.equal(calls[1].ended, .012)
})
