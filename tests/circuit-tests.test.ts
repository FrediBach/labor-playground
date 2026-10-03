import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { examples, createEmptyDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { emptyFlow, type CircuitTest, type FlowNode } from '../src/lib/automation-graph.ts'
import { programFor, withProgram } from '../src/lib/automation-migration.ts'
import { captureFixture, runCircuitTest, runCircuitTestSuite, junitReport, applyFixture } from '../src/lib/circuit-tests.ts'
import { circuitTestRequest } from '../src/lib/circuit-test-request.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { executionFingerprint } from '../src/lib/execution-fingerprint.ts'
import { runAutomationFlow } from '../src/lib/automation-runtime.ts'
import type { Capture } from '../src/lib/simulation-types.ts'

const engine = new Simulation()
async function execute(document: CircuitDocument, test: CircuitTest) { await engine.start(); return runCircuitCapture(engine, circuitTestRequest(document, test, 1)) }
function fixture() {
  const document = structuredClone(examples.find(e => e.id === 'voltage-divider')!.document), program = programFor(document), flow = emptyFlow('TestFlow', 'Divider test')
  program.signals.push({ id: 'Output', name: 'R2 output', kind: 'voltage', positive: document.probes.CH2! })
  flow.nodes.push({ id: 'Check', label: 'Output voltage', kind: 'expect', required: true, order: 1, expectation: { kind: 'range', observation: { signalId: 'Output', statistic: 'sample', reference: 'capture', from: .02, to: .02 }, min: 2.4, max: 2.6 } }, { id: 'Finish', label: 'Finish', kind: 'finish', order: 2, outputs: {} })
  flow.edges.push({ id: 'CheckEdge', source: 'Start', target: 'Check', outcome: 'done' }, { id: 'EndEdge', source: 'Check', target: 'Finish', outcome: 'passed' })
  const t: CircuitTest = { id: 'Divider', name: 'Divider output', enabled: true, flowId: flow.id, tags: [], durationSeconds: .1, fixture: captureFixture(document) }
  program.definitions.push(flow); program.tests.push(t)
  return withProgram(document, program)
}
test('real engine: saved test detects a component regression and passes after restoring it', async () => {
  const document = fixture(), t = document.automationProgram!.tests[0], original = structuredClone(document)
  const pass = await runCircuitTest(document, t, execute); assert.equal(pass.verdict, 'passed', pass.message)
  document.parts.find(p => p.id === 'R2')!.value = 1000
  const fail = await runCircuitTest(document, t, execute); assert.equal(fail.verdict, 'failed'); assert.match(fail.message, /Expected.*observed/)
  assert.notEqual(pass.fingerprint, fail.fingerprint)
  const restored = await runCircuitTest(original, t, execute); assert.equal(restored.verdict, 'passed'); assert.deepEqual(original.automationProgram!.tests[0].fixture, t.fixture)
})
test('semantic fingerprints ignore names, layout and unrelated tests; terminal checks ignore probe moves', () => {
  const document = fixture(), t = document.automationProgram!.tests[0], key = executionFingerprint(document, .1, t), captureKey = executionFingerprint(document, .1)
  document.title = 'Renamed'; document.wires[0].color = '#ffffff'; document.automationProgram!.definitions[1].name = 'Renamed'; document.automationProgram!.definitions[1].nodes[0].label = 'New label'; document.automationProgram!.definitions[1].layout.Start = { x: 500, y: 400 }
  assert.equal(executionFingerprint(document, .1, t), key)
  assert.equal(executionFingerprint(document, .1), captureKey)
  document.probes.CH2 = 'cv'; assert.equal(executionFingerprint(document, .1, t), key)
  document.automationProgram!.tests[0].name = 'New test name'; assert.equal(executionFingerprint(document, .1, t), key)
  const before = executionFingerprint(document, .1); document.automationProgram!.definitions[1].nodes[1].label = 'Other test edit'; assert.equal(executionFingerprint(document, .1), before)
})
test('suite runs serially once per case from a frozen snapshot; cancellation retains queued cases', async () => {
  const document = fixture(), program = document.automationProgram!, t = program.tests[0]
  program.tests.push({ ...structuredClone(t), id: 'Second', name: 'Second' }, { ...structuredClone(t), id: 'Disabled', enabled: false })
  let active = 0, calls = 0
  const result = await runCircuitTestSuite(document, async (snapshot, t) => { assert.equal(active++, 0); calls++; assert.equal(snapshot.parts.find(p => p.id === 'R2')!.value, 10000); document.parts.find(p => p.id === 'R2')!.value = 1; const c = await execute(snapshot, t); active--; return c })
  assert.equal(calls, 2); assert.equal(result.verdict, 'passed'); assert.equal(result.counts.disabled, 1)
  const controller = new AbortController(); let canceledCalls = 0
  const canceled = await runCircuitTestSuite(fixture(), async (d, t) => { canceledCalls++; controller.abort(); return execute(d, t) }, { signal: controller.signal })
  assert.equal(canceledCalls, 1); assert.equal(canceled.counts.canceled, 1); assert.equal(canceled.verdict, 'failed')
  assert.match(junitReport(result), /<skipped\/>/)
})
test('empty suites, zero checks, missing fixture parts and insufficient observations never pass', async () => {
  assert.equal((await runCircuitTestSuite(createEmptyDocument(), execute)).verdict, 'no-tests')
  const document = fixture(), t = document.automationProgram!.tests[0]
  assert.throws(() => applyFixture(document, { ...t.fixture, parts: [{ partId: 'Deleted', kind: 'resistor', value: 10 }] }), /missing/)
  t.durationSeconds = .01
  assert.equal((await runCircuitTest(document, t, execute)).verdict, 'inconclusive')
  t.flowId = document.automationProgram!.captureFlowId
  assert.equal((await runCircuitTest(document, t, execute)).verdict, 'inconclusive')
})
test('recordings are evicted by budget, independently of structured evidence', async () => {
  const result = await runCircuitTestSuite(fixture(), execute, { recordingBudgetBytes: 0 })
  assert.equal(result.reports[0].capture, undefined); assert.equal(result.reports[0].recordingEvicted, true); assert.ok(result.reports[0].run?.nodes.some(n => n.evidence))
})
const fake: Capture = { revision: 1, duration: .1, elapsedMs: 0, time: [0, .1], channels: { CH1: [0, 0], CH2: [0, 0] } }
function graph(nodes: FlowNode[], connections: [string, string, string][]) {
  const program = programFor(createEmptyDocument()), f = program.definitions[0]; f.nodes.push(...nodes); f.edges = connections.map(([source, outcome, target], i) => ({ id: `E${i}`, source, outcome: outcome as 'done', target })); return program
}
test('timeouts with explicit recovery complete; a failed required expectation stays failed through cleanup', async () => {
  const p = graph([{ id: 'Wait', label: 'Late', kind: 'wait', order: 1, mode: 'time', reference: 'capture', seconds: .2 }, { id: 'Finish', label: 'Recovery', kind: 'finish', order: 2, outputs: {} }], [['Start', 'done', 'Wait'], ['Wait', 'timed-out', 'Finish']])
  const recovered = await runAutomationFlow(createEmptyDocument(), p, 'Capture', .1, async () => ({ capture: fake, nodeByTerminal: {} })); assert.equal(recovered.run.status, 'done')
  p.definitions[0].nodes[1] = { id: 'Wait', label: 'Required check', kind: 'expect', order: 1, required: true, expectation: { kind: 'result', value: { kind: 'constant', value: 0, unit: 'V' }, operator: 'gte', expected: { kind: 'constant', value: 1, unit: 'V' } } }
  p.definitions[0].edges[1].outcome = 'failed'
  const failed = await runAutomationFlow(createEmptyDocument(), p, 'Capture', .1, async () => ({ capture: fake, nodeByTerminal: {} })); assert.equal(failed.run.status, 'failed'); assert.equal(failed.run.nodes.find(n => n.nodeId === 'Finish')!.status, 'done')
})
test('first joins do not abandon started branches; all joins wait for both inputs', async () => {
  const p = graph([
    { id: 'A', label: 'Fast', kind: 'wait', mode: 'delay', seconds: .01, reference: 'activation', order: 1 },
    { id: 'B', label: 'Slow', kind: 'wait', mode: 'delay', seconds: .04, reference: 'activation', order: 2 },
    { id: 'Join', label: 'Join', kind: 'join', mode: 'first', order: 3 },
    { id: 'Finish', label: 'Finish', kind: 'finish', outputs: {}, order: 4 },
  ], [['Start', 'done', 'A'], ['Start', 'done', 'B'], ['A', 'done', 'Join'], ['B', 'done', 'Join'], ['Join', 'done', 'Finish']])
  const first = await runAutomationFlow(createEmptyDocument(), p, 'Capture', .1, async () => ({ capture: fake, nodeByTerminal: {} })); assert.equal(first.run.nodes.find(n => n.nodeId === 'Join')!.ended, .01); assert.equal(first.run.nodes.find(n => n.nodeId === 'B')!.ended, .04)
  const join = p.definitions[0].nodes.find(n => n.kind === 'join')!; if (join.kind === 'join') join.mode = 'all'
  const all = await runAutomationFlow(createEmptyDocument(), p, 'Capture', .1, async () => ({ capture: fake, nodeByTerminal: {} })); assert.equal(all.run.nodes.find(n => n.nodeId === 'Join')!.ended, .04)
})
test('same-target concurrent ramps require explicit replacement and never emit successful completion when interrupted', async () => {
  const p = graph([
    { id: 'A', label: 'First', kind: 'action', order: 1, action: { target: 'cv', value: 4, durationMs: 40 } },
    { id: 'W', label: 'Delay', kind: 'wait', order: 2, mode: 'delay', reference: 'activation', seconds: .01 },
    { id: 'B', label: 'Second', kind: 'action', order: 3, action: { target: 'cv', value: 2, durationMs: 0 } },
  ], [['Start', 'done', 'A'], ['Start', 'done', 'W'], ['W', 'done', 'B']])
  const solve = async () => ({ capture: fake, nodeByTerminal: {} })
  assert.equal((await runAutomationFlow(createEmptyDocument(), p, 'Capture', .1, solve)).run.status, 'error')
  p.definitions[0].conflictPolicy = 'replace'
  const replaced = await runAutomationFlow(createEmptyDocument(), p, 'Capture', .1, solve); assert.equal(replaced.run.nodes.find(n => n.nodeId === 'A')!.status, 'interrupted'); assert.equal(replaced.run.status, 'failed')
})

test('a disabled prerequisite prevents passing even when an independent required assertion passes', async () => {
  const document = fixture(), p = document.automationProgram!, f = p.definitions.find(f => f.id === 'TestFlow')!
  f.nodes.push({ id: 'WaitDisabled', kind: 'watch', label: 'Disconnected disabled watch', order: 3, signalId: 'CH1', direction: 'rising', threshold: 0, after: 0, deadline: .01, reference: 'activation' }, { id: 'DisabledCall', kind: 'call', label: 'Disabled prerequisite', order: 4, flowId: p.captureFlowId, inputs: {}, enabled: false })
  f.edges.push({ id: 'DisabledStart', source: 'Start', outcome: 'done', target: 'WaitDisabled' }, { id: 'DisabledReady', source: 'WaitDisabled', outcome: 'done', target: 'DisabledCall' })
  const report = await runCircuitTest(document, p.tests[0], execute)
  assert.equal(report.verdict, 'failed'); assert.equal(report.run?.nodes.find(n => n.nodeId === 'Check')?.status, 'done')
})

test('solver pass exhaustion reports an error instead of returning a successful partial scenario', async () => {
  const p = programFor(createEmptyDocument()), f = p.definitions[0]
  for (let i = 0; i < 33; i++) { f.nodes.push({ id: `A${i}`, kind: 'action', label: `Action ${i}`, order: i + 1, action: { target: 'cv', value: i % 5, durationMs: 0 } }); f.edges.push({ id: `E${i}`, source: i ? `A${i - 1}` : 'Start', outcome: 'done', target: `A${i}` }) }
  let calls = 0
  const result = await runAutomationFlow(createEmptyDocument(), p, 'Capture', .1, async () => { calls++; return { capture: fake, nodeByTerminal: {} } })
  assert.equal(calls, 32); assert.equal(result.run.status, 'error'); assert.match(result.run.nodes.find(n => n.status === 'error')!.message!, /32 causal solver pass/)
})
test('stable component references survive probe moves and reject deleted components', async () => {
  const document = fixture(), program = document.automationProgram!, t = program.tests[0]
  program.signals.find(s => s.id === 'Output')!.kind = 'voltage'
  program.signals = program.signals.map(s => s.id === 'Output' ? { id: s.id, name: s.name, kind: 'voltage', positive: 'part:R2:0', negative: 'part:R2:1' } : s)
  document.probes = { CH1: null, CH2: null }
  assert.equal((await runCircuitTest(document, t, execute)).verdict, 'passed')
  document.parts = document.parts.filter(p => p.id !== 'R2')
  const report = await runCircuitTest(document, t, execute)
  assert.equal(report.verdict, 'error'); assert.match(report.message, /missing/)
})
test('custom component curves remain current in schema 4 test execution', async () => {
  // 5 V / (100 ohm source + 1.4k nonlinear resistor + 1k load) = 2 mA.
  const original = structuredClone(examples.find(e => e.id === 'custom-resistance')!.document)
  const setup = fixture(), p = setup.automationProgram!, flow = p.definitions.find(f => f.id === 'TestFlow')!
  p.signals = p.signals.map(s => s.id === 'Output' ? { id: s.id, name: s.name, kind: 'voltage', positive: 'part:R2:0', negative: 'part:R2:1' } : s)
  const check = flow.nodes.find(n => n.kind === 'expect')!
  if (check.kind === 'expect') check.expectation = { kind: 'range', observation: { signalId: 'Output', statistic: 'max', from: .05, to: .1, reference: 'capture' }, min: 1.99, max: 2.01 }
  p.tests[0].fixture = captureFixture(original)
  const document = withProgram(original, p)
  const baseline = await runCircuitTest(document, p.tests[0], execute)
  assert.equal(baseline.verdict, 'passed', baseline.message)
  document.customComponents![0].characteristic.points = [{ x: 0, y: 1000 }, { x: .01, y: 1000 }]
  assert.equal((await runCircuitTest(document, p.tests[0], execute)).verdict, 'failed')
})
