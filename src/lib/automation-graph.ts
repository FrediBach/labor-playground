import { validateAutomations, type Automation } from './automations.ts'

export const GRAPH_LIMITS = { definitions: 32, tests: 32, nodes: 256, nodesPerFlow: 64, depth: 4, expanded: 256, events: 512, passes: 32 } as const
export type Unit = 'V' | 'A' | 'Hz' | 's' | 'ratio' | 'boolean'
export type Outcome = 'done' | 'yes' | 'no' | 'passed' | 'failed' | 'timed-out' | 'interrupted'
export type Binding = { kind: 'constant'; value: number; unit: Unit } | { kind: 'result'; nodeId: string; output: string; unit: Unit } | { kind: 'input'; inputId: string; unit: Unit }
export type Signal = { id: string; name: string } & ({ kind: 'channel'; channel: 'CH1' | 'CH2' } | { kind: 'voltage'; positive: string; negative?: string } | { kind: 'current'; partId: string; branch: number })
export type TimeReference = 'activation' | 'invocation' | 'capture'
export type Observation = { signalId: string; statistic: 'sample' | 'min' | 'max' | 'mean' | 'peakToPeak' | 'frequency'; from: number; to: number; reference: TimeReference }
export type Expectation =
  | { kind: 'range'; observation: Observation; min: number; max: number }
  | { kind: 'equal'; observation: Observation; expected: number; absoluteTolerance: number; relativeTolerance: number }
  | { kind: 'stays' | 'settles'; signalId: string; from: number; to: number; reference: TimeReference; min: number; max: number; hold: number }
  | { kind: 'reaches'; signalId: string; from: number; to: number; reference: TimeReference; direction: 'rising' | 'falling'; threshold: number }
  | { kind: 'result'; value: Binding; operator: Operator; expected: Binding }
export type Operator = 'lt' | 'lte' | 'eq' | 'gte' | 'gt' | 'ne'
type Base = { id: string; label: string; order: number }
export type FlowNode = Base & (
  | { kind: 'start' }
  | { kind: 'wait'; mode: 'delay' | 'time'; seconds: number; reference: TimeReference }
  | { kind: 'watch'; signalId: string; direction: 'rising' | 'falling' | 'above' | 'below'; threshold: number; after: number; deadline: number; reference: TimeReference }
  | { kind: 'action'; action: Automation['action']; value?: Binding }
  | { kind: 'measure'; observation: Observation; output: string }
  | { kind: 'condition'; left: Binding; operator: Operator; right: Binding }
  | { kind: 'expect'; expectation: Expectation; required: boolean }
  | { kind: 'join'; mode: 'all' | 'first' }
  | { kind: 'call'; flowId: string; enabled: boolean; inputs: Record<string, Binding>; legacyId?: string }
  | { kind: 'finish'; outputs: Record<string, Binding> }
)
export interface FlowEdge { id: string; source: string; outcome: Outcome; target: string }
export interface Contract { id: string; unit: Unit }
export interface FlowDefinition {
  id: string; name: string; description?: string; inputs: Contract[]; outputs: Contract[]
  nodes: FlowNode[]; edges: FlowEdge[]; conflictPolicy: 'error' | 'replace'
  layout: Record<string, { x: number; y: number }>
}
export interface TestFixture {
  instruments: { frequency: number; amplitude: number; waveform: 'sine' | 'square' | 'triangle'; cv: number; envelope?: { mode: 'envelope' | 'gate' | 'trigger'; gateHigh: boolean; decayMs: number } }
  parts: { partId: string; kind: string; value?: number; position?: number }[]
}
export interface CircuitTest { id: string; name: string; enabled: boolean; tags: string[]; flowId: string; durationSeconds: number; fixture: TestFixture }
export interface AutomationProgram { version: 1; captureFlowId: string; signals: Signal[]; definitions: FlowDefinition[]; tests: CircuitTest[] }
export const NODE_LABELS: Record<FlowNode['kind'], string> = { start: 'Start', wait: 'Wait', watch: 'Watch signal', action: 'Change control', measure: 'Measure', condition: 'Condition', expect: 'Expect', join: 'Join', call: 'Run automation', finish: 'Finish' }
export function outcomes(node: FlowNode): Outcome[] {
  return node.kind === 'condition' ? ['yes', 'no'] : node.kind === 'expect' ? ['passed', 'failed'] : node.kind === 'watch' || node.kind === 'wait' ? ['done', 'timed-out'] : node.kind === 'action' || node.kind === 'call' ? ['done', 'interrupted', 'timed-out'] : ['done']
}
export function actionUnit(action: Automation['action']): Unit { return action.target === 'cv' || action.target === 'amplitude' ? 'V' : action.target === 'frequency' ? 'Hz' : action.target === 'gate' || action.target === 'switch' ? 'boolean' : 'ratio' }
function object(input: unknown): Record<string, unknown> { if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Flow settings must be objects.'); return input as Record<string, unknown> }
function keys(row: Record<string, unknown>, allowed: string[]) { for (const key of Object.keys(row)) if (!allowed.includes(key)) throw new Error(`Unknown flow setting: ${key}.`) }
function finite(value: unknown, min = -1e12, max = 1e12): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Flow number must be between ${min} and ${max}.`) }
function text(value: unknown, max = 80): asserts value is string { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Flow text is missing or too long.') }
function id(value: unknown): asserts value is string { text(value, 64); if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) throw new Error('Invalid flow ID.') }
function choice(value: unknown, options: readonly unknown[]) { if (!options.includes(value)) throw new Error(`Unsupported flow option: ${String(value)}.`) }
function bool(value: unknown) { choice(value, [true, false]) }
const units: Unit[] = ['V', 'A', 'Hz', 's', 'ratio', 'boolean']
const references: TimeReference[] = ['activation', 'invocation', 'capture']
const operators: Operator[] = ['lt', 'lte', 'eq', 'gte', 'gt', 'ne']
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw new Error(`Flow collection exceeds ${max} entries or is not an array.`); return value }
function unique(rows: { id: string }[]) { const ids = new Set<string>(); for (const row of rows) { id(row.id); if (ids.has(row.id.toLowerCase())) throw new Error(`Duplicate flow ID: ${row.id}.`); ids.add(row.id.toLowerCase()) } }
function binding(value: unknown) {
  const row = object(value); choice(row.kind, ['constant', 'result', 'input']); choice(row.unit, units)
  keys(row, row.kind === 'constant' ? ['kind', 'value', 'unit'] : row.kind === 'result' ? ['kind', 'nodeId', 'output', 'unit'] : ['kind', 'inputId', 'unit'])
  if (row.kind === 'constant') { finite(row.value); if (row.unit === 'boolean') choice(row.value, [0, 1]) }
  else if (row.kind === 'result') { id(row.nodeId); id(row.output) } else id(row.inputId)
}
function bindings(value: unknown) { const row = object(value); if (Object.keys(row).length > 16) throw new Error('Too many flow outputs.'); for (const [key, item] of Object.entries(row)) { id(key); binding(item) } }
function observation(value: unknown) { const row = object(value); keys(row, ['signalId', 'statistic', 'from', 'to', 'reference']); id(row.signalId); choice(row.statistic, ['sample', 'min', 'max', 'mean', 'peakToPeak', 'frequency']); interval(row) }
function interval(row: Record<string, unknown>) { finite(row.from, 0, 10); finite(row.to, 0, 10); if (row.to < row.from) throw new Error('Observation ends before it starts.'); choice(row.reference, references) }
function expectation(value: unknown) {
  const row = object(value); choice(row.kind, ['range', 'equal', 'stays', 'settles', 'reaches', 'result'])
  const fields = row.kind === 'range' ? ['observation', 'min', 'max'] : row.kind === 'equal' ? ['observation', 'expected', 'absoluteTolerance', 'relativeTolerance'] : row.kind === 'result' ? ['value', 'operator', 'expected'] : row.kind === 'reaches' ? ['signalId', 'from', 'to', 'reference', 'direction', 'threshold'] : ['signalId', 'from', 'to', 'reference', 'min', 'max', 'hold']
  keys(row, ['kind', ...fields])
  if (row.kind === 'result') { binding(row.value); binding(row.expected); choice(row.operator, operators); return }
  if ('observation' in row) observation(row.observation); else { id(row.signalId); interval(row) }
  if ('min' in row) { finite(row.min); finite(row.max); if (row.min > (row.max as number)) throw new Error('Expected range is reversed.') }
  if (row.kind === 'equal') { finite(row.expected); finite(row.absoluteTolerance, 0); finite(row.relativeTolerance, 0, 1); if (Math.abs(row.expected) < 1e-12 && row.absoluteTolerance === 0) throw new Error('Near zero requires a nonzero absolute tolerance.') }
  if ('hold' in row) finite(row.hold, 0, 10)
  if (row.kind === 'reaches') { choice(row.direction, ['rising', 'falling']); finite(row.threshold) }
}
export function nodeBindings(node: FlowNode): Binding[] { return node.kind === 'action' ? node.value ? [node.value] : [] : node.kind === 'condition' ? [node.left, node.right] : node.kind === 'finish' ? Object.values(node.outputs) : node.kind === 'call' ? Object.values(node.inputs) : node.kind === 'expect' && node.expectation.kind === 'result' ? [node.expectation.value, node.expectation.expected] : [] }
export function outputUnit(node: FlowNode, output: string, program: AutomationProgram): Unit | undefined {
  if (output === 'time') return 's'
  if (node.kind === 'watch' && output === 'value') return program.signals.find(s => s.id === node.signalId)?.kind === 'current' ? 'A' : 'V'
  if (node.kind === 'action' && output === 'value') return actionUnit(node.action)
  if (node.kind === 'measure' && output === node.output) return node.observation.statistic === 'frequency' ? 'Hz' : program.signals.find(s => s.id === node.observation.signalId)?.kind === 'current' ? 'A' : 'V'
  if (node.kind === 'call') return program.definitions.find(f => f.id === node.flowId)?.outputs.find(o => o.id === output)?.unit
  return undefined
}

/** Strict executable schema. Circuit references are resolved separately at run time. */
export function validateAutomationProgram(input: unknown): AutomationProgram {
  const root = object(input); keys(root, ['version', 'captureFlowId', 'signals', 'definitions', 'tests']); choice(root.version, [1]); id(root.captureFlowId)
  for (const item of array(root.signals, 128)) {
    const s = object(item); id(s.id); text(s.name); choice(s.kind, ['channel', 'voltage', 'current'])
    keys(s, ['id', 'name', 'kind', ...(s.kind === 'channel' ? ['channel'] : s.kind === 'voltage' ? ['positive', 'negative'] : ['partId', 'branch'])])
    if (s.kind === 'channel') choice(s.channel, ['CH1', 'CH2']); else if (s.kind === 'voltage') { text(s.positive); if (s.negative !== undefined) text(s.negative) } else { id(s.partId); finite(s.branch, 0, 32); if (!Number.isInteger(s.branch)) throw new Error('Invalid current branch.') }
  }
  for (const item of array(root.definitions, GRAPH_LIMITS.definitions)) {
    const f = object(item); keys(f, ['id', 'name', 'description', 'inputs', 'outputs', 'nodes', 'edges', 'conflictPolicy', 'layout']); id(f.id); text(f.name); if (f.description !== undefined) text(f.description, 1000); choice(f.conflictPolicy, ['error', 'replace'])
    for (const list of [f.inputs, f.outputs]) { for (const entry of array(list, 16)) { const c = object(entry); keys(c, ['id', 'unit']); id(c.id); choice(c.unit, units) }; unique(list as Contract[]) }
    const layout = object(f.layout); for (const [key, entry] of Object.entries(layout)) { id(key); const p = object(entry); keys(p, ['x', 'y']); finite(p.x, -1e6, 1e6); finite(p.y, -1e6, 1e6) }
    for (const item of array(f.nodes, GRAPH_LIMITS.nodesPerFlow)) {
      const n = object(item); id(n.id); text(n.label); finite(n.order, 0, 1e6); if (!Number.isInteger(n.order)) throw new Error('Execution order must be an integer.'); choice(n.kind, Object.keys(NODE_LABELS))
      const extra: Record<string, string[]> = { start: [], wait: ['mode', 'seconds', 'reference'], watch: ['signalId', 'direction', 'threshold', 'after', 'deadline', 'reference'], action: ['action', 'value'], measure: ['observation', 'output'], condition: ['left', 'operator', 'right'], expect: ['expectation', 'required'], join: ['mode'], call: ['flowId', 'enabled', 'inputs', 'legacyId'], finish: ['outputs'] }
      keys(n, ['id', 'label', 'order', 'kind', ...extra[n.kind as string]])
      switch (n.kind) {
        case 'wait': choice(n.mode, ['delay', 'time']); finite(n.seconds, 0, 10); choice(n.reference, references); break
        case 'watch': id(n.signalId); choice(n.direction, ['rising', 'falling', 'above', 'below']); finite(n.threshold); finite(n.after, 0, 10); finite(n.deadline, 0, 10); if (n.deadline < n.after) throw new Error('Watch deadline is before arming.'); choice(n.reference, references); break
        case 'action': validateAutomations([{ id: 'Action', name: 'Action', enabled: true, trigger: { kind: 'time', atMs: 0 }, action: n.action }]); if (n.value !== undefined) binding(n.value); break
        case 'measure': observation(n.observation); id(n.output); if (n.output === 'time') throw new Error('time is reserved for completion time.'); break
        case 'condition': binding(n.left); binding(n.right); choice(n.operator, operators); break
        case 'expect': expectation(n.expectation); bool(n.required); break
        case 'join': choice(n.mode, ['all', 'first']); break
        case 'call': id(n.flowId); bool(n.enabled); bindings(n.inputs); if (n.legacyId !== undefined) id(n.legacyId); break
        case 'finish': bindings(n.outputs); break
      }
    }
    for (const item of array(f.edges, 512)) { const e = object(item); keys(e, ['id', 'source', 'outcome', 'target']); id(e.id); id(e.source); id(e.target); choice(e.outcome, ['done', 'yes', 'no', 'passed', 'failed', 'timed-out', 'interrupted']) }
  }
  for (const item of array(root.tests, GRAPH_LIMITS.tests)) {
    const t = object(item); keys(t, ['id', 'name', 'enabled', 'tags', 'flowId', 'durationSeconds', 'fixture']); id(t.id); text(t.name); bool(t.enabled); id(t.flowId); finite(t.durationSeconds, 0.001, 10); for (const tag of array(t.tags, 16)) text(tag)
    const fixture = object(t.fixture); keys(fixture, ['instruments', 'parts']); const i = object(fixture.instruments); keys(i, ['frequency', 'amplitude', 'waveform', 'cv', 'envelope']); finite(i.frequency, 20, 2000); finite(i.amplitude, 0, 5); finite(i.cv, -5, 5); choice(i.waveform, ['sine', 'square', 'triangle'])
    if (i.envelope !== undefined) { const e = object(i.envelope); keys(e, ['mode', 'gateHigh', 'decayMs']); choice(e.mode, ['envelope', 'gate', 'trigger']); bool(e.gateHigh); finite(e.decayMs, 1, 40) }
    const seen = new Set<string>()
    for (const part of array(fixture.parts, 128)) { const p = object(part); keys(p, ['partId', 'kind', 'value', 'position']); id(p.partId); text(p.kind); if (seen.has(p.partId)) throw new Error('Duplicate fixture override.'); seen.add(p.partId); if (p.value !== undefined) finite(p.value); if (p.position !== undefined) finite(p.position, 0, 1) }
  }
  const program = structuredClone(input) as AutomationProgram
  unique(program.signals); unique(program.definitions); unique(program.tests)
  if (!program.definitions.some(f => f.id === program.captureFlowId)) throw new Error('Capture flow is missing.')
  if (program.definitions.reduce((n, f) => n + f.nodes.length, 0) > GRAPH_LIMITS.nodes) throw new Error('Project exceeds 256 flow nodes.')
  for (const t of program.tests) if (!program.definitions.some(f => f.id === t.flowId)) throw new Error(`Test ${t.name} has no entry flow.`)
  for (const f of program.definitions) {
    unique(f.nodes); unique(f.edges)
    const byId = new Map(f.nodes.map(n => [n.id, n])); const start = f.nodes.filter(n => n.kind === 'start')
    if (start.length !== 1) throw new Error(`${f.name} needs exactly one Start.`)
    const incoming = (id: string) => f.edges.filter(e => e.target === id)
    for (const e of f.edges) { if (!byId.has(e.source) || !byId.has(e.target)) throw new Error('Flow connection references a missing step.'); if (!outcomes(byId.get(e.source)!).includes(e.outcome)) throw new Error('Flow connection uses an unavailable output.'); if (e.target === start[0].id) throw new Error('Start cannot have incoming connections.') }
    const visited = new Set<string>(), active = new Set<string>(), ordered: FlowNode[] = []
    function visit(n: FlowNode) { if (active.has(n.id)) throw new Error('Flow cycles are not supported.'); if (visited.has(n.id)) return; active.add(n.id); for (const e of incoming(n.id)) visit(byId.get(e.source)!); active.delete(n.id); visited.add(n.id); ordered.push(n) }
    for (const n of f.nodes) visit(n)
    const dominators = new Map<string, Set<string>>()
    for (const n of ordered) {
      const parents = incoming(n.id).map(e => e.source)
      if (n.kind !== 'start' && parents.length === 0) throw new Error(`${n.label} is unreachable; connect it to Start.`)
      if (parents.length > 1 && n.kind !== 'join') throw new Error(`${n.label} needs an explicit Join for multiple inputs.`)
      const guarantees = incoming(n.id).map(e => {
        const inherited = new Set(dominators.get(e.source)!)
        if (['timed-out', 'interrupted', 'failed'].includes(e.outcome)) inherited.delete(e.source)
        return inherited
      })
      const common = n.kind === 'join' && n.mode === 'all' ? [...new Set(guarantees.flatMap(g => [...g]))] : guarantees.length ? [...guarantees[0]].filter(id => guarantees.every(g => g.has(id))) : []
      dominators.set(n.id, new Set([...common, n.id]))
      if (n.kind === 'call') { const target = program.definitions.find(d => d.id === n.flowId); if (!target) throw new Error(`${n.label} calls a missing automation.`); if (Object.keys(n.inputs).length !== target.inputs.length || target.inputs.some(c => n.inputs[c.id]?.unit !== c.unit)) throw new Error(`${n.label} has incompatible call inputs.`) }
      for (const b of nodeBindings(n)) {
        if (b.kind === 'result') {
          const source = byId.get(b.nodeId)
          if (!source || source.id === n.id || !dominators.get(n.id)!.has(source.id)) throw new Error(`${n.label} uses a result that is not available on every incoming path.`)
          if (outputUnit(source, b.output, program) !== b.unit) throw new Error(`${n.label} uses incompatible result units.`)
          // Results do not exist on timeout/interruption outputs.
          if (f.edges.some(e => e.source === source.id && ['timed-out', 'interrupted'].includes(e.outcome) && dominators.get(n.id)!.has(e.target))) throw new Error('A failed step cannot supply a successful result.')
        } else if (b.kind === 'input' && !f.inputs.some(c => c.id === b.inputId && c.unit === b.unit)) throw new Error('Missing or incompatible declared input.')
      }
      if (n.kind === 'condition' && n.left.unit !== n.right.unit) throw new Error('Condition units must match.')
      if (n.kind === 'action' && n.value && n.value.unit !== actionUnit(n.action)) throw new Error('Action value has incompatible units.')
      if (n.kind === 'expect' && n.expectation.kind === 'result' && n.expectation.value.unit !== n.expectation.expected.unit) throw new Error('Expectation units must match.')
      if (n.kind === 'finish' && (Object.keys(n.outputs).length !== f.outputs.length || f.outputs.some(o => n.outputs[o.id]?.unit !== o.unit))) throw new Error('Finish must supply every declared output.')
    }
  }
  for (const f of program.definitions) expandedSize(program, f.id)
  return program
}
export function expandedSize(program: AutomationProgram, flowId: string, parents: string[] = []): number {
  if (parents.includes(flowId)) throw new Error('Recursive automation calls are not supported.')
  if (parents.length >= GRAPH_LIMITS.depth) throw new Error('Automation call depth exceeds 4.')
  const f = program.definitions.find(d => d.id === flowId); if (!f) throw new Error('Missing flow.')
  const size = f.nodes.length + f.nodes.reduce((count, n) => count + (n.kind === 'call' ? expandedSize(program, n.flowId, [...parents, flowId]) : 0), 0)
  if (size > GRAPH_LIMITS.expanded) throw new Error('Expanded run exceeds 256 steps.')
  return size
}
export function emptyFlow(id = 'Capture', name = 'Capture'): FlowDefinition { return { id, name, inputs: [], outputs: [], nodes: [{ id: 'Start', label: 'Capture starts', kind: 'start', order: 0 }], edges: [], conflictPolicy: 'error', layout: {} } }
