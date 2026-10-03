import { createVoltageSampler } from './measurements.ts'
import { AUTOMATION_EDGE_SECONDS, automationIssue, automationTargetKey, validateAutomations, type Automation, type AutomationEvent } from './automations.ts'
import { GRAPH_LIMITS, validateAutomationProgram, type AutomationProgram, type Binding, type FlowDefinition, type FlowNode, type Outcome } from './automation-graph.ts'
import { compare, crossing, evaluateExpectation, measureObservation, ObservationUnavailable, referenceTime, signalValues, type Evidence } from './automation-signals.ts'
import type { CircuitDocument } from './circuit.ts'
import type { Capture } from './simulation-types.ts'

export type NodeStatus = 'waiting' | 'running' | 'done' | 'failed' | 'timed-out' | 'interrupted' | 'skipped' | 'error' | 'inconclusive'
export interface NodeResult { path: string; flowId: string; nodeId: string; label: string; kind: FlowNode['kind']; status: NodeStatus; started?: number; ended?: number; outcome?: Outcome; values: Record<string, number>; message?: string; evidence?: Evidence; required?: boolean }
export interface FlowRun { runId: string; flowId: string; status: 'done' | 'failed' | 'error' | 'inconclusive'; nodes: NodeResult[]; solverPasses: number; actions: Automation[]; events: AutomationEvent[] }
export interface FlowSolve { capture: Capture; nodeByTerminal: Record<string, string> }
export type FlowSolver = (actions: Automation[], events: AutomationEvent[]) => Promise<FlowSolve>
interface State { node: FlowNode; result: NodeResult; invocation: Invocation; child?: Invocation; actionId?: string; completeAt?: number; disabled?: boolean }
interface Invocation { path: string; definition: FlowDefinition; start: number; inputs: Record<string, number>; states: State[] }
interface Candidate { state: State; at: number; outcome?: Outcome; evidence?: Evidence; value?: number; activate?: boolean; message?: string; status?: NodeStatus }
const terminal = (s: State) => !['waiting', 'running'].includes(s.result.status)
const successful = (s: State) => s.result.status === 'done'
export function actionCompletion(action: Automation['action'], start: number): number {
  if (action.target === 'gate' && action.value === 1 && action.durationMs > 0) return start + action.durationMs / 1000 + Math.min(AUTOMATION_EDGE_SECONDS, action.durationMs / 2000)
  return start + (action.target === 'gate' || action.target === 'switch' ? AUTOMATION_EDGE_SECONDS : Math.max(AUTOMATION_EDGE_SECONDS, action.durationMs / 1000))
}

/** Headless, bounded event scheduler. Every solve restarts the complete trajectory
 * with the committed control schedule; no circuit state is spliced between steps. */
export async function runAutomationFlow(document: CircuitDocument, raw: AutomationProgram, flowId: string, duration: number, solve: FlowSolver, options: { signal?: AbortSignal; runId?: string; onProgress?: (result: NodeResult) => void } = {}): Promise<{ capture: Capture; run: FlowRun }> {
  const startedAt = performance.now()
  const program = validateAutomationProgram(raw)
  if (!Number.isFinite(duration) || duration < 0.001 || duration > 10) throw new Error('Flow duration must be between 1 ms and 10 s.')
  const all: State[] = [], actions: Automation[] = [], events: AutomationEvent[] = []
  // Register reachable controls before the first solve. Their electrical models
  // and native waveform breakpoints must not change when a later event is found.
  const reachable = new Set<string>()
  const collect = (id: string) => { if (reachable.has(id)) return; reachable.add(id); for (const n of program.definitions.find(f => f.id === id)!.nodes) if (n.kind === 'call') collect(n.flowId) }
  if (!program.definitions.some(f => f.id === flowId)) throw new Error('The selected flow does not exist.')
  collect(flowId)
  for (const definition of program.definitions.filter(f => reachable.has(f.id))) for (const n of definition.nodes) if (n.kind === 'action') {
    const planned: Automation = { id: `Planned${actions.length}`, name: n.label, enabled: true, trigger: { kind: 'time', atMs: 0 }, action: n.action }
    if (!automationIssue(planned, document, duration)) actions.push(planned)
  }
  const run: FlowRun = { runId: options.runId ?? crypto.randomUUID(), flowId, status: 'done', nodes: [], solverPasses: 0, actions, events }
  let committed = 0, cursor = 0, solved: FlowSolve | undefined, dirty = true
  const instantiate = (id: string, path: string, start: number, inputs: Record<string, number>): Invocation => {
    const definition = program.definitions.find(f => f.id === id)
    if (!definition) throw new Error('The selected flow does not exist.')
    const invocation: Invocation = { path, definition, start, inputs, states: [] }
    invocation.states = definition.nodes.map(node => ({ node, invocation, result: { path: `${path}/${node.id}`, flowId: id, nodeId: node.id, label: node.label, kind: node.kind, status: 'waiting', values: {}, ...(node.kind === 'expect' ? { required: node.required } : {}) } }))
    all.push(...invocation.states)
    return invocation
  }
  const root = instantiate(flowId, flowId, 0, {})
  if (root.definition.inputs.length) throw new Error('An entry flow cannot require call inputs.')
  const getSignal = (id: string) => { const signal = program.signals.find(s => s.id === id); if (!signal) throw new Error(`Signal ${id} is missing.`); return signal }
  const binding = (b: Binding, s: State): number => {
    const value = b.kind === 'constant' ? b.value : b.kind === 'input' ? s.invocation.inputs[b.inputId] : s.invocation.states.find(row => row.node.id === b.nodeId)?.result.values[b.output]
    if (value === undefined || !Number.isFinite(value)) throw new Error(`${s.node.label} needs an unavailable ${b.unit} result.`)
    return value
  }
  function finish(s: State, outcome: Outcome, at: number, message?: string, status?: NodeStatus) {
    if (++committed > GRAPH_LIMITS.events) throw new Error('Flow exceeded the 512 event limit.')
    s.result.status = status ?? (outcome === 'timed-out' || outcome === 'interrupted' || outcome === 'failed' ? outcome : 'done')
    s.result.ended = at; s.result.outcome = outcome; s.result.message = message
    if (s.result.status === 'done') s.result.values.time = at
    options.onProgress?.(structuredClone(s.result))
  }
  function invocationFailure(inv: Invocation): State | undefined {
    return inv.states.find(s => {
      if (s.disabled) return true
      if (s.result.status === 'skipped' || s.result.status === 'done') return false
      if (s.node.kind === 'expect' && s.node.required) return true
      if (s.result.status === 'error' || s.result.status === 'inconclusive') return true
      return !inv.definition.edges.some(e => e.source === s.node.id && e.outcome === s.result.outcome && successful(inv.states.find(t => t.node.id === e.target)!))
    })
  }
  function ready(s: State): Candidate | undefined {
    if (s.result.status !== 'waiting') return
    if (s.node.kind === 'start') return { state: s, at: s.invocation.start, activate: true }
    const edges = s.invocation.definition.edges.filter(e => e.target === s.node.id)
    const sources = edges.map(e => ({ edge: e, state: s.invocation.states.find(t => t.node.id === e.source)! }))
    const hits = sources.filter(({ edge, state }) => terminal(state) && state.result.status !== 'skipped' && state.result.outcome === edge.outcome)
    const closed = sources.filter(({ edge, state }) => terminal(state) && (state.result.status === 'skipped' || state.result.outcome !== edge.outcome))
    const first = s.node.kind === 'join' && s.node.mode === 'first'
    if (hits.length && (first || hits.length === sources.length)) return { state: s, at: first ? Math.min(...hits.map(h => h.state.result.ended!)) : Math.max(...hits.map(h => h.state.result.ended!)), activate: true }
    if ((!first && closed.length) || closed.length === sources.length) {
      return { state: s, at: Math.max(cursor, ...closed.map(h => h.state.result.ended ?? 0)), status: 'skipped', message: 'The selected predecessor output did not occur.' }
    }
  }
  function candidate(s: State): Candidate | undefined {
    const activation = ready(s); if (activation) return activation
    if (s.result.status !== 'running') return
    const node = s.node, started = s.result.started!
    const base = (reference: 'capture' | 'activation' | 'invocation') => referenceTime(reference, started, s.invocation.start)
    if (node.kind === 'action') return { state: s, at: Math.min(s.completeAt!, duration), outcome: s.completeAt! <= duration ? 'done' : 'timed-out', message: s.completeAt! > duration ? 'Action did not finish before the recording ended.' : undefined }
    if (node.kind === 'call') {
      if (!s.child || !s.child.states.every(terminal)) return
      const failure = invocationFailure(s.child), finished = s.child.states.find(t => t.node.kind === 'finish' && successful(t))
      if (failure || (!finished && s.child.definition.id !== program.captureFlowId)) return { state: s, at: cursor, outcome: failure?.result.outcome === 'interrupted' ? 'interrupted' : 'timed-out', message: failure?.result.message ?? 'The automation did not reach Finish.' }
      s.result.values = { ...finished?.result.values }
      return { state: s, at: cursor, outcome: 'done' }
    }
    if (node.kind === 'wait') {
      const at = base(node.reference) + node.seconds
      return { state: s, at: at < started || at > duration ? Math.min(Math.max(started, at), duration) : at, outcome: at < started || at > duration ? 'timed-out' : 'done', message: at < started ? 'The absolute time was already missed.' : at > duration ? 'Wait exceeds the recording duration.' : undefined }
    }
    if (node.kind === 'watch') {
      const from = base(node.reference) + node.after, to = Math.min(duration, base(node.reference) + node.deadline)
      if (to < started || from > to) return { state: s, at: started, outcome: 'timed-out', message: 'The watch deadline was already missed.' }
      const signal = getSignal(node.signalId), values = signalValues(signal, solved!.capture, solved!.nodeByTerminal)
      const at = crossing(solved!.capture.time, values, Math.max(started, from), to, node.threshold, node.direction)
      return { state: s, at: at ?? to, outcome: at === null ? 'timed-out' : 'done', message: at === null ? 'The signal did not meet the watch condition before its deadline.' : undefined }
    }
    if (node.kind === 'measure' || node.kind === 'expect') {
      if (node.kind === 'expect' && node.expectation.kind === 'result') {
        const actual = binding(node.expectation.value, s), expected = binding(node.expectation.expected, s), passed = compare(actual, node.expectation.operator, expected)
        return { state: s, at: started, outcome: passed ? 'passed' : 'failed', evidence: { from: started, to: started, actual, unit: node.expectation.value.unit, passed, message: `Expected ${node.expectation.operator} ${expected}; observed ${actual}.` } }
      }
      const spec = node.kind === 'measure' ? node.observation : node.expectation
      const signalId = 'observation' in spec ? spec.observation.signalId : 'signalId' in spec ? spec.signalId : ''
      try {
        const evidence = node.kind === 'measure' ? measureObservation(node.observation, getSignal(signalId), solved!.capture, solved!.nodeByTerminal, started, s.invocation.start) : evaluateExpectation(node.expectation as Exclude<typeof node.expectation, { kind: 'result' }>, getSignal(signalId), solved!.capture, solved!.nodeByTerminal, started, s.invocation.start)
        return { state: s, at: evidence.to, outcome: node.kind === 'measure' ? 'done' : evidence.passed ? 'passed' : 'failed', evidence, value: evidence.actual }
      } catch (error) {
        if (!(error instanceof ObservationUnavailable)) throw error
        return { state: s, at: duration, status: 'inconclusive', message: error.message }
      }
    }
  }
  async function ensureSolved() {
    if (!dirty) return
    if (run.solverPasses >= GRAPH_LIMITS.passes) throw new Error('Flow exceeded the 32 causal solver pass limit.')
    run.solverPasses++
    solved = await solve(structuredClone(actions), structuredClone(events)); dirty = false
    if (options.signal?.aborted) throw new Error('Flow run canceled.')
  }
  try {
    while (all.some(s => !terminal(s))) {
      if (options.signal?.aborted) throw new Error('Flow run canceled.')
      await ensureSolved()
      const candidates = all.flatMap(s => { const c = candidate(s); return c ? [c] : [] }).sort((a, b) => a.at - b.at || a.state.node.order - b.state.node.order || (a.state.result.path < b.state.result.path ? -1 : a.state.result.path > b.state.result.path ? 1 : 0))
      const next = candidates[0]
      if (!next) { for (const s of all.filter(s => !terminal(s))) finish(s, 'timed-out', duration, 'Required path did not finish.'); break }
      const s = next.state, node = s.node
      cursor = Math.max(cursor, next.at)
      if (next.status === 'skipped') { s.result.status = 'skipped'; s.result.ended = cursor; s.result.message = next.message; continue }
      if (!next.activate) {
        if (next.evidence) s.result.evidence = next.evidence
        if (node.kind === 'watch' && next.outcome === 'done') s.result.values.value = createVoltageSampler(solved!.capture.time, signalValues(getSignal(node.signalId), solved!.capture, solved!.nodeByTerminal))!(cursor)!
        if (node.kind === 'measure' && next.value !== undefined) s.result.values[node.output] = next.value
        if (node.kind === 'action' && next.outcome === 'done') s.result.values.value = actions.find(a => a.id === s.actionId)!.action.value
        finish(s, next.outcome ?? 'failed', cursor, next.message ?? next.evidence?.message, next.status)
        continue
      }
      s.result.status = 'running'; s.result.started = cursor
      if (node.kind === 'wait' || node.kind === 'watch') {
        const successors = s.invocation.definition.edges.filter(e => e.source === node.id).map(e => s.invocation.states.find(t => t.node.id === e.target)!)
        if (successors.length && successors.every(t => t.node.kind === 'call' && !t.node.enabled)) { s.disabled = true; finish(s, 'interrupted', cursor, 'Invocation is disabled.', 'skipped'); continue }
      }
      if (node.kind === 'call') {
        if (!node.enabled) { s.disabled = true; finish(s, 'interrupted', cursor, 'Invocation is disabled.', 'skipped'); continue }
        s.child = instantiate(node.flowId, s.result.path, cursor, Object.fromEntries(Object.entries(node.inputs).map(([key, b]) => [key, binding(b, s)])))
      } else if (node.kind === 'action') {
        if (cursor >= duration) { finish(s, 'timed-out', duration, 'Action starts at or after recording end.'); continue }
        const action = { ...node.action, ...(node.value ? { value: binding(node.value, s) } : {}) }
        const parent = all.find(t => t.child === s.invocation)
        const legacyId = parent?.node.kind === 'call' ? parent.node.legacyId : undefined
        const id = legacyId && !actions.some(a => a.id === legacyId) ? legacyId : `Run${actions.length}`
        const automation: Automation = { id, name: node.label, enabled: true, trigger: { kind: 'time', atMs: cursor * 1000 }, action }
        validateAutomations([automation])
        const issue = automationIssue(automation, document, duration); if (issue) throw new Error(issue)
        const overlapping = all.filter(t => t !== s && t.node.kind === 'action' && t.result.status === 'running' && t.completeAt! > cursor && automationTargetKey(t.node.action) === automationTargetKey(action))
        if (overlapping.length && s.invocation.definition.conflictPolicy === 'error' && root.definition.conflictPolicy !== 'replace') throw new Error(`Concurrent actions write ${automationTargetKey(action)}. Choose Replace current action explicitly.`)
        for (const previous of overlapping) finish(previous, 'interrupted', cursor, `Replaced by ${node.label}.`)
        s.actionId = id; s.completeAt = actionCompletion(action, cursor); actions.push(automation); events.push({ automationId: id, time: cursor }); dirty = true
      } else if (node.kind === 'condition') finish(s, compare(binding(node.left, s), node.operator, binding(node.right, s)) ? 'yes' : 'no', cursor)
      else if (node.kind === 'finish') { s.result.values = Object.fromEntries(Object.entries(node.outputs).map(([id, b]) => [id, binding(b, s)])); finish(s, 'done', cursor) }
      else if (node.kind === 'start' || node.kind === 'join') finish(s, 'done', cursor)
    }
    await ensureSolved()
    // Recheck committed measurement evidence against the final waveform. A change
    // larger than evaluator precision is a causal-consistency error, never a pass.
    for (const s of all) if (s.node.kind === 'measure' && s.result.status === 'done') {
      const final = measureObservation(s.node.observation, getSignal(s.node.observation.signalId), solved!.capture, solved!.nodeByTerminal, s.result.started!, s.invocation.start)
      if (Math.abs(final.actual! - s.result.evidence!.actual!) > Math.max(1e-6, Math.abs(final.actual!) * 1e-4)) throw new Error(`Final waveform changed the committed measurement ${s.node.label}.`)
    }
    for (const s of all) {
      if (s.node.kind === 'watch' && s.result.status === 'done') {
        const values = signalValues(getSignal(s.node.signalId), solved!.capture, solved!.nodeByTerminal)
        const at = s.result.ended!, actual = createVoltageSampler(solved!.capture.time, values)?.(at)
        const tolerance = Math.max(1e-6, Math.abs(s.node.threshold) * 1e-3)
        const valid = actual !== null && actual !== undefined && (s.node.direction === 'above' ? actual >= s.node.threshold - tolerance : s.node.direction === 'below' ? actual <= s.node.threshold + tolerance : Math.abs(actual - s.node.threshold) <= tolerance)
        if (!valid) throw new Error(`Final waveform changed the committed watch ${s.node.label}: expected ${s.node.threshold}, observed ${actual}.`)
      }
      if (s.node.kind === 'expect' && s.node.expectation.kind !== 'result' && s.result.evidence) {
        const spec = s.node.expectation, signalId = 'observation' in spec ? spec.observation.signalId : spec.signalId
        const final = evaluateExpectation(spec, getSignal(signalId), solved!.capture, solved!.nodeByTerminal, s.result.started!, s.invocation.start)
        if (final.passed !== s.result.evidence.passed) throw new Error(`Final waveform changed the committed expectation ${s.node.label}.`)
      }
    }
    run.status = all.some(s => s.result.status === 'inconclusive') ? 'inconclusive' : invocationFailure(root) || all.some(s => s.node.kind === 'expect' && s.node.required && s.result.status === 'failed') ? 'failed' : 'done'
  } catch (error) {
    run.status = 'error'
    const s = all.find(s => s.result.status === 'running') ?? all.find(s => !terminal(s))
    const errorState = s ?? root.states[0]
    finish(errorState, 'failed', cursor, error instanceof Error ? error.message : String(error), 'error')
    for (const waiting of all.filter(s => !terminal(s))) { waiting.result.status = 'skipped'; waiting.result.message = 'Run stopped after an error.'; waiting.result.ended = cursor }
    if (!solved) throw error
  }
  run.nodes = all.map(s => s.result)
  return { capture: { ...solved!.capture, ...(run.status === 'error' ? { diagnostics: [...(solved!.capture.diagnostics ?? []), { severity: 'error' as const, message: run.nodes.find(n => n.status === 'error')?.message ?? 'Flow execution failed.' }] } : {}), elapsedMs: performance.now() - startedAt, automationEvents: events, automationRun: run, automationInitialState: { instruments: structuredClone(document.instruments), parts: structuredClone(document.parts) } }, run }
}
