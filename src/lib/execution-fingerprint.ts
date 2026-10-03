import type { CircuitDocument } from './circuit.ts'
import type { CircuitTest } from './automation-graph.ts'
import { programFor } from './automation-migration.ts'

export const EVALUATOR_VERSION = 'flows-1'
export const ENGINE_VERSION = 'eecircuit-engine-1.8.0'
/** A canonical semantic key, kept collision-free rather than using a short hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export function executionFingerprint(document: CircuitDocument, duration: number, test?: CircuitTest): string {
  const program = programFor(document), entry = test?.flowId ?? program.captureFlowId, visited = new Set<string>(), signalIds = new Set<string>()
  function visit(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const f = program.definitions.find(f => f.id === id)
    if (!f) return
    for (const n of f.nodes) {
      if (n.kind === 'call') visit(n.flowId)
      if (n.kind === 'watch') signalIds.add(n.signalId)
      if (n.kind === 'measure') signalIds.add(n.observation.signalId)
      if (n.kind === 'expect') { if ('signalId' in n.expectation) signalIds.add(n.expectation.signalId); if ('observation' in n.expectation) signalIds.add(n.expectation.observation.signalId) }
    }
  }
  visit(entry)
  const signals = program.signals.filter(s => signalIds.has(s.id)).map(s => { const { name: _name, ...rest } = s; return rest })
  const usedChannels = new Set(signals.flatMap(s => s.kind === 'channel' ? [s.channel] : []))
  // Captures include channel display bindings; terminal-bound tests do not.
  const probes = test ? Object.fromEntries(Object.entries(document.probes).filter(([k]) => usedChannels.has(k as 'CH1' | 'CH2'))) : document.probes
  const definitions = program.definitions.filter(f => visited.has(f.id)).map(f => ({ id: f.id, inputs: f.inputs, outputs: f.outputs, conflictPolicy: f.conflictPolicy, nodes: f.nodes.map(n => { const { label: _label, ...node } = n; return node }).sort((a, b) => a.id.localeCompare(b.id)), edges: f.edges.map(e => ({ source: e.source, target: e.target, outcome: e.outcome })).sort((a, b) => canonical(a).localeCompare(canonical(b))) })).sort((a, b) => a.id.localeCompare(b.id))
  const parts = document.parts.map(part => ({ id: part.id, kind: part.kind, value: test?.fixture.parts.find(p => p.partId === part.id)?.value ?? part.value, pins: part.pins, position: test?.fixture.parts.find(p => p.partId === part.id)?.position ?? part.position, customModelId: part.customModelId })).sort((a, b) => a.id.localeCompare(b.id))
  return canonical({ evaluator: EVALUATOR_VERSION, engine: ENGINE_VERSION, duration, entry, definitions, signals, parts, wires: document.wires.map(w => [w.from, w.to].sort()).sort(), instruments: test?.fixture.instruments ?? document.instruments, stimulus: document.stimulus ?? 'periodic', customComponents: document.customComponents?.map(m => { const { name: _name, description: _description, ...rest } = m; return rest }), pico: document.pico?.source, probes, fixture: test?.fixture })
}
