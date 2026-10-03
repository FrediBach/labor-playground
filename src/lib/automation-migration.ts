import type { Automation } from './automations.ts'
import type { CircuitDocument } from './circuit.ts'
import { emptyFlow, validateAutomationProgram, type AutomationProgram, type FlowDefinition, type FlowNode } from './automation-graph.ts'

/** Pure and deterministic; no disk writes or duplicate executable representation. */
export function migrateAutomations(rows: readonly Automation[]): AutomationProgram {
  const capture = emptyFlow(); capture.conflictPolicy = rows.length ? 'replace' : 'error'
  const definitions: FlowDefinition[] = [capture]
  rows.forEach((row, index) => {
    const definition = emptyFlow(`Flow_${row.id}`, row.name); definition.conflictPolicy = 'replace'
    definition.nodes.push({ kind: 'action', id: 'Action', label: row.name, order: 1, action: structuredClone(row.action) }, { kind: 'finish', id: 'Finish', label: 'Finish', order: 2, outputs: {} })
    definition.edges = [{ id: 'StartAction', source: 'Start', outcome: 'done', target: 'Action' }, { id: 'ActionFinish', source: 'Action', outcome: 'done', target: 'Finish' }]
    definitions.push(definition)
    const waitId = `Wait_${row.id}`, callId = `Call_${row.id}`
    const wait: FlowNode = row.trigger.kind === 'time'
      ? { id: waitId, label: `At ${row.trigger.atMs} ms`, kind: 'wait', mode: 'time', seconds: row.trigger.atMs / 1000, reference: 'capture', order: index * 2 + 1 }
      : { id: waitId, label: `${row.trigger.channel} ${row.trigger.direction}`, kind: 'watch', signalId: row.trigger.channel, direction: row.trigger.direction, threshold: row.trigger.threshold, after: row.trigger.afterMs / 1000, deadline: 10, reference: 'capture', order: index * 2 + 1 }
    capture.nodes.push(wait, { id: callId, label: row.name, kind: 'call', flowId: definition.id, inputs: {}, enabled: row.enabled, legacyId: row.id, order: index * 2 + 2 })
    capture.edges.push({ id: `Start_${row.id}`, source: 'Start', outcome: 'done', target: waitId }, { id: `Ready_${row.id}`, source: waitId, outcome: 'done', target: callId })
    capture.layout[waitId] = { x: 240, y: index * 130 }; capture.layout[callId] = { x: 500, y: index * 130 }
  })
  return validateAutomationProgram({ version: 1, captureFlowId: capture.id, signals: [{ id: 'CH1', name: 'CH1 · follows probe', kind: 'channel', channel: 'CH1' }, { id: 'CH2', name: 'CH2 · follows probe', kind: 'channel', channel: 'CH2' }], definitions, tests: [] })
}
export function programFor(document: CircuitDocument): AutomationProgram { return document.automationProgram ?? migrateAutomations(document.automations ?? []) }
export function withProgram(document: CircuitDocument, program: AutomationProgram): CircuitDocument { const { automations: _legacy, ...rest } = document; return { ...rest, schemaVersion: 4, automationProgram: validateAutomationProgram(program) } }
export function simpleAction(flow: FlowDefinition): Automation['action'] | null {
  if (flow.nodes.length !== 3 || flow.edges.length !== 2 || flow.inputs.length || flow.outputs.length) return null
  const action = flow.nodes.find(n => n.kind === 'action'), start = flow.nodes.find(n => n.kind === 'start'), finish = flow.nodes.find(n => n.kind === 'finish')
  if (!action || action.kind !== 'action' || action.value || !start || !finish || !flow.edges.some(e => e.source === start.id && e.target === action.id && e.outcome === 'done') || !flow.edges.some(e => e.source === action.id && e.target === finish.id && e.outcome === 'done')) return null
  return action.action
}
