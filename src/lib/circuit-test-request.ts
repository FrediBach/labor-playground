import { compileCircuit, type CircuitDocument } from './circuit.ts'
import type { CircuitTest } from './automation-graph.ts'
import type { PicoTrace } from './pico/runtime.ts'
import { PICO_PINS } from './pico/profile.ts'
import { operatingPointDescriptors } from './simulation-descriptors.ts'
import type { SimulationRequest } from './simulation-types.ts'

export function circuitTestRequest(document: CircuitDocument, test: CircuitTest, revision: number, picoTrace?: PicoTrace): SimulationRequest {
  if (document.pico && !picoTrace) throw new Error('Pico tests require a fresh supported firmware trace.')
  const transient = compileCircuit(document, 'transient', picoTrace, test.durationSeconds), operating = compileCircuit(document, 'operating-point', picoTrace, test.durationSeconds)
  const failure = [...transient.diagnostics, ...operating.diagnostics].find(d => d.severity === 'error'); if (failure) throw new Error(failure.message)
  const node = (pin: string | null) => pin ? transient.nodeByTerminal[pin] ?? null : null
  const used = new Set([...document.wires.flatMap(w => [node(w.from), node(w.to)]), ...Object.values(document.probes).map(node)])
  return { type: 'run', runId: crypto.randomUUID(), owner: 'suite', revision, netlist: transient.netlist, nodes: { CH1: node(document.probes.CH1), CH2: node(document.probes.CH2) }, durationSeconds: test.durationSeconds, operatingPoint: { netlist: operating.netlist, parts: operatingPointDescriptors(document, operating.nodeByTerminal) }, voltageChecks: document.parts.filter(p => p.kind === 'electrolytic').map(p => ({ partId: p.id, positiveNode: node(p.pins[0])!, negativeNode: node(p.pins[1])! })), picoChecks: document.pico ? PICO_PINS.filter(p => p.gpio !== null && used.has(node(p.id))).map(p => ({ gpio: p.gpio!, node: node(p.id)! })) : undefined, automation: { document, picoTrace, flowId: test.flowId } }
}
