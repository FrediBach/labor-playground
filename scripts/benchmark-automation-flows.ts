import { Simulation } from 'eecircuit-engine'
import { createEmptyDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { migrateAutomations, withProgram } from '../src/lib/automation-migration.ts'
import { emptyFlow, type CircuitTest } from '../src/lib/automation-graph.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { circuitTestRequest } from '../src/lib/circuit-test-request.ts'
import { captureFixture } from '../src/lib/circuit-tests.ts'

const engine = new Simulation(); await engine.start()
const base: CircuitDocument = { ...createEmptyDocument(), probes: { CH1: 'osc', CH2: 'cv' }, instruments: { frequency: 1000, amplitude: 2, waveform: 'sine', cv: 0 } }
const maximum = withProgram(base, migrateAutomations(Array.from({ length: 24 }, (_, i) => ({ id: `A${i}`, name: `Crossing ${i + 1}`, enabled: true, trigger: { kind: 'voltage' as const, channel: 'CH1' as const, threshold: .1, direction: 'rising' as const, afterMs: i }, action: { target: 'cv' as const, value: (i % 5) - 2, durationMs: 0 } }))))
const flow = emptyFlow()
for (let i = 0; i < 8; i++) { flow.nodes.push({ id: `A${i}`, label: `Ramp ${i + 1}`, kind: 'action', order: i + 1, action: { target: 'cv', value: (i % 5) - 2, durationMs: 5 } }); flow.edges.push({ id: `E${i}`, source: i ? `A${i - 1}` : 'Start', target: `A${i}`, outcome: 'done' }) }
const chain = withProgram(base, { version: 1, captureFlowId: flow.id, definitions: [flow], signals: [], tests: [] })
for (const [name, document] of [['eight dependent ramps', chain], ['24 one-shot voltage automations', maximum]] as const) {
  const test: CircuitTest = { id: 'Benchmark', name, flowId: document.automationProgram!.captureFlowId, enabled: true, tags: [], durationSeconds: .1, fixture: captureFixture(document) }
  const started = performance.now()
  const capture = await runCircuitCapture(engine, circuitTestRequest(document, test, 1))
  if (capture.automationRun?.status !== 'done') throw new Error(JSON.stringify(capture.automationRun))
  console.log(JSON.stringify({ name, elapsedMs: Math.round(performance.now() - started), solverPasses: capture.automationRun.solverPasses, actions: capture.automationEvents!.length, samples: capture.time.length, rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2) }))
}
