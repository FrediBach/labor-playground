import type { Automation } from './automations.ts'
import type { CircuitDocument } from './circuit.ts'
import { programFor, simpleAction, withProgram, migrateAutomations } from './automation-migration.ts'
import { type AutomationProgram, type FlowDefinition, type FlowNode, type Outcome } from './automation-graph.ts'
export const flowId = (prefix = 'N') => `${prefix}${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
export interface SimpleRow { automation: Automation; callId: string; flowId: string; waitId: string; predecessor?: string; delay: number }
export function simpleRows(program: AutomationProgram): SimpleRow[] {
  const capture = program.definitions.find(f => f.id === program.captureFlowId)!
  return capture.nodes.flatMap(call => {
    if (call.kind !== 'call') return []
    const definition = program.definitions.find(f => f.id === call.flowId), action = definition && simpleAction(definition)
    if (!action) return []
    const incoming = capture.edges.filter(e => e.target === call.id)
    if (incoming.length !== 1 || incoming[0].outcome !== 'done') return []
    const wait = capture.nodes.find(n => n.id === incoming[0].source)
    if (!wait || (wait.kind !== 'wait' && wait.kind !== 'watch') || capture.edges.filter(e => e.source === wait.id).length !== 1) return []
    const before = capture.edges.filter(e => e.target === wait.id)
    if (before.length !== 1 || before[0].outcome !== 'done') return []
    const parent = capture.nodes.find(n => n.id === before[0].source)
    if (!parent || (parent.kind !== 'start' && parent.kind !== 'call')) return []
    const signal = wait.kind === 'watch' ? program.signals.find(s => s.id === wait.signalId) : null
    if (wait.kind === 'watch' && (signal?.kind !== 'channel' || !['rising', 'falling'].includes(wait.direction))) return []
    if (parent.kind === 'call' && (wait.kind !== 'wait' || wait.reference !== 'activation')) return []
    const trigger: Automation['trigger'] = wait.kind === 'wait' ? { kind: 'time', atMs: wait.seconds * 1000 } : { kind: 'voltage', channel: signal!.kind === 'channel' ? signal!.channel : 'CH1', direction: wait.direction as 'rising' | 'falling', threshold: wait.threshold, afterMs: wait.after * 1000 }
    return [{ automation: { id: call.legacyId ?? call.id, name: call.label, enabled: call.enabled, trigger, action }, callId: call.id, flowId: call.flowId, waitId: wait.id, predecessor: parent.kind === 'call' ? parent.id : undefined, delay: wait.kind === 'wait' ? wait.seconds : 0 }]
  })
}
export function saveSimple(document: CircuitDocument, automation: Automation, predecessor?: string, delay = 0): CircuitDocument {
  const program = structuredClone(programFor(document)), existing = simpleRows(program).find(r => r.automation.id === automation.id), capture = program.definitions.find(f => f.id === program.captureFlowId)!
  const start = capture.nodes.find(node => node.kind === 'start')
  if (!start) throw new Error('The capture flow has no Start step. Open Flow to inspect it.')
  if (!existing) {
    const migrated = migrateAutomations([automation]), definition = migrated.definitions[1]
    definition.conflictPolicy = 'error'
    program.definitions.push(definition)
    const source = migrated.definitions[0]
    capture.nodes.push(...source.nodes.filter(n => n.kind !== 'start').map((n, i) => ({ ...n, order: capture.nodes.length + i })))
    capture.edges.push(...source.edges.map(e => ({ ...e, source: e.source === 'Start' ? start.id : e.source })))
    for (const signal of migrated.signals) if (!program.signals.some(s => s.id === signal.id)) program.signals.push(signal)
  } else {
    const def = program.definitions.find(f => f.id === existing.flowId)!
    def.nodes = def.nodes.map(n => n.kind === 'action' ? { ...n, label: automation.name, action: automation.action } : n); def.name = automation.name
    capture.nodes = capture.nodes.map(n => n.id === existing.callId && n.kind === 'call' ? { ...n, label: automation.name, enabled: automation.enabled } : n)
  }
  const row = simpleRows(program).find(r => r.automation.id === automation.id)!, wait = capture.nodes.find(n => n.id === row.waitId)!
  const replacement: FlowNode = predecessor ? { id: wait.id, label: `Wait ${delay * 1000} ms`, order: wait.order, kind: 'wait', mode: 'delay', seconds: delay, reference: 'activation' } : automation.trigger.kind === 'time' ? { id: wait.id, label: `At ${automation.trigger.atMs} ms`, order: wait.order, kind: 'wait', mode: 'time', seconds: automation.trigger.atMs / 1000, reference: 'capture' } : { id: wait.id, label: `${automation.trigger.channel} ${automation.trigger.direction}`, order: wait.order, kind: 'watch', signalId: automation.trigger.channel, direction: automation.trigger.direction, threshold: automation.trigger.threshold, after: automation.trigger.afterMs / 1000, deadline: 10, reference: 'capture' }
  capture.nodes = capture.nodes.map(n => n.id === wait.id ? replacement : n)
  capture.edges = capture.edges.map(e => e.target === wait.id ? { ...e, source: predecessor ?? start.id, outcome: 'done' } : e)
  return withProgram(document, program)
}
export function toggleSimple(document: CircuitDocument, id: string): CircuitDocument {
  const program = structuredClone(programFor(document)), row = simpleRows(program).find(r => r.automation.id === id), capture = program.definitions.find(f => f.id === program.captureFlowId)!
  if (!row) throw new Error('This automation is no longer available in Simple view. Open Flow to inspect it.')
  capture.nodes = capture.nodes.map(n => n.id === row.callId && n.kind === 'call' ? { ...n, enabled: !n.enabled } : n)
  return withProgram(document, program)
}
export function deleteSimple(document: CircuitDocument, id: string): CircuitDocument {
  const program = structuredClone(programFor(document)), row = simpleRows(program).find(r => r.automation.id === id), capture = program.definitions.find(f => f.id === program.captureFlowId)!
  if (!row) throw new Error('This automation is no longer available in Simple view. Open Flow to inspect it.')
  if (capture.edges.some(e => e.source === row.callId)) throw new Error('Other steps depend on this invocation. Reconnect them in Flow before deleting it.')
  const removed = new Set([row.callId, row.waitId]); capture.nodes = capture.nodes.filter(n => !removed.has(n.id)); capture.edges = capture.edges.filter(e => !removed.has(e.source) && !removed.has(e.target))
  return withProgram(document, program)
}
export function appendStep(flow: FlowDefinition, source: string, outcome: Outcome, node: FlowNode): FlowDefinition {
  const position = flow.layout[source] ?? { x: 0, y: 0 }
  return { ...flow, nodes: [...flow.nodes, node], edges: [...flow.edges, { id: flowId('E'), source, target: node.id, outcome }], layout: { ...flow.layout, [node.id]: { x: position.x + 250, y: position.y } } }
}
export function arrangedLayout(flow: FlowDefinition): FlowDefinition['layout'] {
  const levels = new Map<string, number>(), slots = new Map<number, number>()
  const level = (id: string): number => { if (levels.has(id)) return levels.get(id)!; const parents = flow.edges.filter(e => e.target === id); const value = parents.length ? Math.max(...parents.map(e => level(e.source))) + 1 : 0; levels.set(id, value); return value }
  return Object.fromEntries([...flow.nodes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(n => { const x = level(n.id), y = slots.get(x) ?? 0; slots.set(x, y + 1); return [n.id, { x: x * 260, y: y * 140 }] }))
}
export function snapshotScenario(program: AutomationProgram, callId?: string): FlowDefinition {
  const capture = program.definitions.find(f => f.id === program.captureFlowId)!
  const included = new Set<string>()
  function include(id: string) { if (included.has(id)) return; included.add(id); for (const e of capture.edges.filter(e => e.target === id)) include(e.source) }
  if (callId) include(callId); else for (const n of capture.nodes) included.add(n.id)
  return { ...structuredClone(capture), id: flowId('TestFlow'), name: 'Test scenario', nodes: capture.nodes.filter(n => included.has(n.id)).map(n => structuredClone(n)), edges: capture.edges.filter(e => included.has(e.source) && included.has(e.target)).map(e => structuredClone(e)) }
}
