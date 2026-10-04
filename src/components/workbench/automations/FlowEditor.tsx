import { isSwitchKind } from '@/lib/utility-cell-models'
import { useRecording } from '@/lib/recording-context'
import { NumberField, ObservationFields } from './FlowFields'
import { memo, useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, type Node, type NodeProps, type Connection } from '@xyflow/react'
import { Workflow } from 'lucide-react'
import { NODE_LABELS, outcomes, actionUnit, outputUnit, nodeBindings, type AutomationProgram, type Binding, type FlowDefinition, type FlowNode, type Observation, type Outcome, type Unit, type Expectation } from '@/lib/automation-graph'
import { appendStep, arrangedLayout, flowId } from '@/lib/automation-editing'
import type { FlowRun, NodeResult } from '@/lib/automation-runtime'
import type { CircuitDocument } from '@/lib/circuit'
import '@xyflow/react/dist/style.css'
import './Flows.css'

type GraphNode = Node<{ step: FlowNode; result?: NodeResult; values: { id: string; unit: Unit }[] }, 'step'>
const Step = memo(function Step({ data, selected }: NodeProps<GraphNode>) {
  const { seconds } = useRecording()
  const result = data.result
  const status = result ? result.started !== undefined && seconds < result.started ? 'waiting' : result.ended !== undefined && seconds < result.ended ? 'running' : result.status : undefined
  return <div className={`flow-step${selected ? ' selected' : ''}`}>
    {data.step.kind !== 'start' && <Handle type="target" position={Position.Left} aria-label={`${data.step.label}, starts after`} />}
    <span className="flow-step-kind"><Workflow size={13} />{NODE_LABELS[data.step.kind]}</span><strong>{data.step.label}</strong>
    {status && <small>{status}</small>}
    <div className="flow-outputs">{outcomes(data.step).map((outcome, i, ports) => <span key={outcome}>{outcome}<Handle type="source" id={outcome} position={Position.Right} style={{ top: `${(i + 1) * 100 / (ports.length + data.values.length + 1)}%` }} aria-label={`${data.step.label}, ${outcome} output`} /></span>)}{data.values.map((value, i) => <span key={value.id}>{value.id} ({value.unit})<Handle type="source" id={`value:${value.id}`} position={Position.Right} style={{ top: `${(outcomes(data.step).length + i + 1) * 100 / (outcomes(data.step).length + data.values.length + 1)}%`, background: '#91bfad' }} aria-label={`${data.step.label}, ${value.id} ${value.unit} result`} /></span>)}</div>
  </div>
})
const nodeTypes = { step: Step }
const observation = (program: AutomationProgram): Observation => ({ signalId: program.signals[0]?.id ?? 'CH1', statistic: 'sample', from: 0, to: .005, reference: 'activation' })
function newNode(kind: FlowNode['kind'], program: AutomationProgram, order: number): FlowNode {
  const base = { id: flowId(), label: NODE_LABELS[kind], order }
  switch (kind) {
    case 'start': return { ...base, kind }
    case 'wait': return { ...base, kind, mode: 'delay', seconds: .005, reference: 'activation' }
    case 'watch': return { ...base, kind, signalId: program.signals[0]?.id ?? 'CH1', direction: 'rising', threshold: 2.5, after: 0, deadline: .05, reference: 'activation' }
    case 'action': return { ...base, kind, action: { target: 'cv', value: 2.5, durationMs: 0 } }
    case 'measure': return { ...base, kind, observation: observation(program), output: 'value' }
    case 'condition': return { ...base, kind, left: { kind: 'constant', value: 0, unit: 'V' }, operator: 'gte', right: { kind: 'constant', value: 2.5, unit: 'V' } }
    case 'expect': return { ...base, kind, required: true, expectation: { kind: 'range', observation: observation(program), min: 2.4, max: 2.6 } }
    case 'join': return { ...base, kind, mode: 'all' }
    case 'call': return { ...base, kind, flowId: program.definitions.find(f => f.id !== program.captureFlowId)?.id ?? '', enabled: true, inputs: {} }
    case 'finish': return { ...base, kind, outputs: {} }
  }
}
function BindingField({ label, value, flow, program, onChange }: { label: string; value: Binding; flow: FlowDefinition; program: AutomationProgram; onChange: (b: Binding) => void }) {
  const available = flow.nodes.flatMap(n => [...new Set(['time', 'value', ...(n.kind === 'measure' ? [n.output] : []), ...(n.kind === 'call' ? program.definitions.find(f => f.id === n.flowId)?.outputs.map(o => o.id) ?? [] : [])])].filter(o => outputUnit(n, o, program) === value.unit).map(output => ({ n, output })))
  return <fieldset><legend>{label} ({value.unit})</legend><label className="automation-field"><span>Use result from</span><select value={value.kind === 'result' ? `${value.nodeId}/${value.output}` : value.kind === 'input' ? `input/${value.inputId}` : 'constant'} onChange={e => { const [nodeId, output] = e.target.value.split('/'); onChange(e.target.value === 'constant' ? { kind: 'constant', unit: value.unit, value: 0 } : nodeId === 'input' ? { kind: 'input', inputId: output, unit: value.unit } : { kind: 'result', unit: value.unit, nodeId, output }) }}><option value="constant">Constant</option>{flow.inputs.filter(i => i.unit === value.unit).map(i => <option key={i.id} value={`input/${i.id}`}>Input: {i.id}</option>)}{available.map(({ n, output }) => <option key={`${n.id}/${output}`} value={`${n.id}/${output}`}>{n.label} · {output}</option>)}</select></label>{value.kind === 'constant' && <NumberField label={label} value={value.value} onChange={v => onChange({ ...value, value: v })} />}</fieldset>
}
function ExpectationFields({ value, program, flow, onChange }: { value: Expectation; program: AutomationProgram; flow: FlowDefinition; onChange: (v: Expectation) => void }) {
  const defaultObservation = observation(program)
  return <><label className="automation-field"><span>Requirement</span><select value={value.kind} onChange={e => {
    const kind = e.target.value as Expectation['kind']
    onChange(kind === 'range' ? { kind, observation: defaultObservation, min: 2.4, max: 2.6 } : kind === 'equal' ? { kind, observation: defaultObservation, expected: 2.5, absoluteTolerance: .05, relativeTolerance: 0 } : kind === 'result' ? { kind, value: { kind: 'constant', value: 0, unit: 'V' }, operator: 'gte', expected: { kind: 'constant', value: 1, unit: 'V' } } : kind === 'reaches' ? { kind, signalId: defaultObservation.signalId, from: 0, to: .025, reference: 'activation', threshold: 3, direction: 'rising' } : { kind, signalId: defaultObservation.signalId, from: 0, to: .025, reference: 'activation', min: 2.4, max: 2.6, hold: .005 })
  }}>{['range', 'equal', 'reaches', 'stays', 'settles', 'result'].map(k => <option key={k}>{k}</option>)}</select></label>
  {'observation' in value && <ObservationFields program={program} value={value.observation} onChange={v => onChange({ ...value, observation: v })} />}
  {'signalId' in value && <ObservationFields program={program} value={{ signalId: value.signalId, statistic: 'sample', from: value.from, to: value.to, reference: value.reference }} onChange={v => onChange({ ...value, signalId: v.signalId, from: v.from, to: v.to, reference: v.reference })} />}
  {'min' in value && <><NumberField label="Minimum (SI units)" value={value.min} onChange={min => onChange({ ...value, min })} /><NumberField label="Maximum (SI units)" value={value.max} onChange={max => onChange({ ...value, max })} /></>}
  {value.kind === 'equal' && <><NumberField label="Expected (SI units)" value={value.expected} onChange={expected => onChange({ ...value, expected })} /><NumberField label="Absolute tolerance" value={value.absoluteTolerance} onChange={absoluteTolerance => onChange({ ...value, absoluteTolerance })} /><NumberField label="Relative tolerance (fraction)" value={value.relativeTolerance} onChange={relativeTolerance => onChange({ ...value, relativeTolerance })} /></>}
  {value.kind === 'reaches' && <><NumberField label="Threshold (SI units)" value={value.threshold} onChange={threshold => onChange({ ...value, threshold })} /><label className="automation-field"><span>Direction</span><select value={value.direction} onChange={e => onChange({ ...value, direction: e.target.value as 'rising' | 'falling' })}><option value="rising">Rising</option><option value="falling">Falling</option></select></label></>}
  {value.kind === 'settles' && <NumberField label="Hold (ms)" value={value.hold * 1000} onChange={v => onChange({ ...value, hold: v / 1000 })} />}
  {value.kind === 'result' && <><label className="automation-field"><span>Units</span><select value={value.value.unit} onChange={e => onChange({ ...value, value: { kind: 'constant', value: 0, unit: e.target.value as Unit }, expected: { kind: 'constant', value: 0, unit: e.target.value as Unit } })}>{['V', 'A', 'Hz', 's', 'ratio', 'boolean'].map(u => <option key={u}>{u}</option>)}</select></label><BindingField label="Observed result" flow={flow} program={program} value={value.value} onChange={v => onChange({ ...value, value: v })} /><label className="automation-field"><span>Comparison</span><select value={value.operator} onChange={e => onChange({ ...value, operator: e.target.value as typeof value.operator })}>{['lt', 'lte', 'eq', 'gte', 'gt', 'ne'].map(op => <option key={op}>{op}</option>)}</select></label><BindingField label="Expected result" flow={flow} program={program} value={value.expected} onChange={expected => onChange({ ...value, expected })} /></>}
  </>
}
function Inspector({ initial, flow, program, document, save, close, drill }: { initial: FlowNode; flow: FlowDefinition; program: AutomationProgram; document: CircuitDocument; save: (n: FlowNode) => void; close: () => void; drill: (id: string) => void }) {
  const [node, setNode] = useState(initial)
  const input = <label className="automation-field"><span>Step name</span><input value={node.label} maxLength={80} onChange={e => setNode({ ...node, label: e.target.value })} /></label>
  return <aside className="flow-inspector" aria-label="Step inspector"><div className="flow-toolbar"><strong>{NODE_LABELS[node.kind]}</strong><button type="button" onClick={close}>Close</button></div><form onSubmit={e => { e.preventDefault(); save(node) }}>
    {input}<NumberField label="Execution order" value={node.order} min={0} onChange={v => setNode({ ...node, order: v })} />
    {node.kind === 'wait' && <><label className="automation-field"><span>Time reference</span><select value={node.reference} onChange={e => setNode({ ...node, reference: e.target.value as Observation['reference'], mode: e.target.value === 'activation' ? 'delay' : 'time' })}><option value="activation">After this step activates</option><option value="invocation">From automation start</option><option value="capture">At capture time</option></select></label><NumberField label="Wait (ms)" value={node.seconds * 1000} onChange={v => setNode({ ...node, seconds: v / 1000 })} /></>}
    {node.kind === 'watch' && <><ObservationFields program={program} value={{ signalId: node.signalId, statistic: 'sample', from: node.after, to: node.deadline, reference: node.reference }} onChange={v => setNode({ ...node, signalId: v.signalId, after: v.from, deadline: v.to, reference: v.reference })} /><label className="automation-field"><span>Watch for</span><select value={node.direction} onChange={e => setNode({ ...node, direction: e.target.value as typeof node.direction })}><option value="rising">Rising crossing</option><option value="falling">Falling crossing</option><option value="above">Is above</option><option value="below">Is below</option></select></label><NumberField label="Threshold (SI units)" value={node.threshold} onChange={v => setNode({ ...node, threshold: v })} /></>}
    {node.kind === 'action' && <><label className="automation-field"><span>Control</span><select value={node.action.partId ? `${node.action.target}:${node.action.partId}` : node.action.target} onChange={e => { const [target, partId] = e.target.value.split(':'); setNode({ ...node, value: undefined, action: { target: target as typeof node.action.target, ...(partId ? { partId } : {}), value: target === 'frequency' ? 440 : target === 'switch' || target === 'gate' ? 1 : .5, durationMs: 0 } }) }}><option value="cv">CV output</option><option value="amplitude">Oscillator amplitude</option><option value="frequency">Oscillator frequency</option><option value="gate">EG gate</option>{document.parts.filter(p => isSwitchKind(p.kind) || p.kind === 'potentiometer').map(p => <option key={p.id} value={`${isSwitchKind(p.kind) ? 'switch' : p.kind}:${p.id}`}>{p.id} {p.kind}</option>)}</select></label><BindingField label="Commanded value" flow={flow} program={program} value={node.value ?? { kind: 'constant', value: node.action.value, unit: actionUnit(node.action) }} onChange={b => setNode({ ...node, value: b.kind === 'constant' ? undefined : b, action: { ...node.action, value: b.kind === 'constant' ? b.value : node.action.value } })} /><NumberField label="Ramp / pulse duration (ms)" value={node.action.durationMs} onChange={v => setNode({ ...node, action: { ...node.action, durationMs: v } })} /></>}
    {node.kind === 'measure' && <><ObservationFields program={program} value={node.observation} onChange={v => setNode({ ...node, observation: v })} /><label className="automation-field"><span>Output name</span><input value={node.output} onChange={e => setNode({ ...node, output: e.target.value })} /></label></>}
    {node.kind === 'condition' && <><label className="automation-field"><span>Units</span><select value={node.left.unit} onChange={e => setNode({ ...node, left: { kind: 'constant', unit: e.target.value as Unit, value: 0 }, right: { kind: 'constant', unit: e.target.value as Unit, value: 0 } })}>{['V', 'A', 'Hz', 's', 'ratio', 'boolean'].map(u => <option key={u}>{u}</option>)}</select></label><BindingField label="Observed result" flow={flow} program={program} value={node.left} onChange={left => setNode({ ...node, left })} /><label className="automation-field"><span>Comparison</span><select value={node.operator} onChange={e => setNode({ ...node, operator: e.target.value as typeof node.operator })}>{['lt', 'lte', 'eq', 'gte', 'gt', 'ne'].map(op => <option key={op}>{op}</option>)}</select></label><BindingField label="Compare with" flow={flow} program={program} value={node.right} onChange={right => setNode({ ...node, right })} /></>}
    {node.kind === 'join' && <label className="automation-field"><span>Wait for</span><select value={node.mode} onChange={e => setNode({ ...node, mode: e.target.value as 'all' | 'first' })}><option value="all">All successful inputs</option><option value="first">First successful input</option></select></label>}
    {node.kind === 'call' && <><label className="automation-field"><span>Automation</span><select value={node.flowId} onChange={e => setNode({ ...node, flowId: e.target.value, inputs: {} })}>{program.definitions.filter(f => f.id !== flow.id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label><input type="checkbox" checked={node.enabled} onChange={e => setNode({ ...node, enabled: e.target.checked })} /> Enabled invocation</label>{Object.entries(node.inputs).map(([id, b]) => <BindingField key={id} label={id} value={b} flow={flow} program={program} onChange={value => setNode({ ...node, inputs: { ...node.inputs, [id]: value } })} />)}<button type="button" onClick={() => drill(node.flowId)}>Open automation</button></>}
    {node.kind === 'expect' && <><ExpectationFields value={node.expectation} program={program} flow={flow} onChange={expectation => setNode({ ...node, expectation })} /><label><input type="checkbox" checked={node.required} onChange={e => setNode({ ...node, required: e.target.checked })} /> Required expectation</label></>}
    {node.kind === 'finish' && <><p>Completion waits for every activated branch. Export measurements for callers to use.</p>{Object.entries(node.outputs).map(([name, value]) => <div key={name}><BindingField label={name} value={value} flow={flow} program={program} onChange={b => setNode({ ...node, outputs: { ...node.outputs, [name]: b } })} /><button type="button" onClick={() => setNode({ ...node, outputs: Object.fromEntries(Object.entries(node.outputs).filter(([id]) => id !== name)) })}>Remove {name}</button></div>)}<label className="automation-field"><span>Export measurement</span><select value="" onChange={e => { const producer = flow.nodes.find(n => n.id === e.target.value); if (producer?.kind === 'measure') setNode({ ...node, outputs: { ...node.outputs, [producer.output]: { kind: 'result', nodeId: producer.id, output: producer.output, unit: outputUnit(producer, producer.output, program)! } } }) }}><option value="">Choose a completed measurement</option>{flow.nodes.filter(n => n.kind === 'measure').map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label></>}
    <button className="automation-add" type="submit">Save step</button>
  </form></aside>
}

export default function FlowEditor({ program, flowId: selectedFlow, document, onChange, onOpen, run }: { program: AutomationProgram; flowId: string; document: CircuitDocument; onChange: (p: AutomationProgram) => void; onOpen: (id: string) => void; run?: FlowRun }) {
  const flow = program.definitions.find(f => f.id === selectedFlow) ?? program.definitions[0]
  const [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState(''), [kind, setKind] = useState<FlowNode['kind']>('wait'), [port, setPort] = useState<Outcome>('done')
  const [drag, setDrag] = useState<GraphNode[] | null>(null), [showValues, setShowValues] = useState(false), [inputUnit, setInputUnit] = useState<Unit>('V')
  const fallback = useMemo(() => arrangedLayout(flow), [flow])
  const nodes = useMemo<GraphNode[]>(() => flow.nodes.map(step => ({ id: step.id, type: 'step', position: flow.layout[step.id] ?? fallback[step.id], data: { step, values: step.kind === 'measure' ? [{ id: step.output, unit: outputUnit(step, step.output, program)! }] : step.kind === 'call' ? program.definitions.find(f => f.id === step.flowId)?.outputs ?? [] : step.kind === 'action' || step.kind === 'watch' ? [{ id: 'value', unit: outputUnit(step, 'value', program)! }] : [], result: run?.nodes.find(n => n.flowId === flow.id && n.nodeId === step.id) }, selected: step.id === selected, ariaLabel: `${step.label}, ${NODE_LABELS[step.kind]}` })), [flow, fallback, run, selected, program])
  const edges = useMemo(() => {
    const executionEdges = flow.edges.map(edge => ({ ...edge, sourceHandle: edge.outcome, label: edge.outcome, type: 'smoothstep' }))
    const nodesById = new Map(flow.nodes.map(node => [node.id, node]))
    const valueEdges = flow.nodes.flatMap(node => nodeBindings(node).flatMap((binding, index) => {
      if (binding.kind !== 'result' || !(showValues || selected === node.id || selected === binding.nodeId)) return []
      const source = nodesById.get(binding.nodeId)
      if (!source) return []
      return [{ id: `Value_${node.id}_${index}`, source: source.id, target: node.id, sourceHandle: binding.output === 'time' ? outcomes(source)[0] : `value:${binding.output}`, label: `${binding.output} (${binding.unit})`, type: 'smoothstep', style: { strokeDasharray: '5 4', stroke: '#91bfad' } }]
    }))
    return [...executionEdges, ...valueEdges]
  }, [flow, selected, showValues])
  const node = flow.nodes.find(n => n.id === selected)
  const commit = (next: FlowDefinition) => { try { onChange({ ...program, definitions: program.definitions.map(f => f.id === next.id ? next : f) }); setNotice('Flow saved.'); return true } catch (error) { setNotice((error as Error).message); return false } }
  function connect(connection: Connection) {
    if (!connection.source || !connection.target) return
    const target = flow.nodes.find(n => n.id === connection.target)
    const source = flow.nodes.find(n => n.id === connection.source)
    if (!source || !target) { setNotice('This step is no longer available. Select a current step and reconnect.'); return }
    if (connection.sourceHandle?.startsWith('value:')) {
      const output = connection.sourceHandle.slice(6), unit = outputUnit(source, output, program)
      if (!unit) { setNotice('This output is no longer available. Select a current output and reconnect.'); return }
      const value: Binding = { kind: 'result', nodeId: source.id, output, unit }
      const expectedUnit = target?.kind === 'action' ? actionUnit(target.action) : target?.kind === 'condition' ? target.left.unit : target?.kind === 'expect' && target.expectation.kind === 'result' ? target.expectation.value.unit : undefined
      if (expectedUnit !== unit) { setNotice(`${target?.label ?? 'This step'} needs ${expectedUnit ?? 'an execution connection'}; ${source.label} returns ${unit}.`); return }
      const updated = target?.kind === 'action' ? { ...target, value } : target?.kind === 'condition' ? { ...target, left: value } : target?.kind === 'expect' && target.expectation.kind === 'result' ? { ...target, expectation: { ...target.expectation, value } } : target
      if (updated) commit({ ...flow, nodes: flow.nodes.map(n => n.id === updated.id ? updated : n) })
      return
    }
    const next = { ...flow, edges: [...flow.edges.filter(e => target?.kind === 'join' || e.target !== connection.target), { id: flowId('E'), source: connection.source, target: connection.target, outcome: (connection.sourceHandle ?? 'done') as Outcome }] }
    commit(next)
  }
  function add(source?: string, outcome = port) {
    const predecessor = source ? flow.nodes.find(step => step.id === source) : node ?? flow.nodes.find(step => step.kind === 'start')
    if (!predecessor) { setNotice('Choose an existing step before adding the next step.'); return }
    const actual = outcomes(predecessor)
    if (!actual.length) { setNotice('This step has no execution output. Choose another predecessor.'); return }
    if (!actual.includes(outcome)) outcome = actual[0]
    const n = newNode(kind, program, Math.max(...flow.nodes.map(n => n.order)) + 1)
    if (commit(appendStep(flow, predecessor.id, outcome, n))) { setSelected(n.id); setPort(outcomes(n)[0]) }
  }
  function remove() {
    if (!node || node.kind === 'start') return
    const incoming = flow.edges.filter(e => e.target === node.id), outgoing = flow.edges.filter(e => e.source === node.id)
    const remaining = flow.edges.filter(e => e.source !== node.id && e.target !== node.id)
    // Preserve a linear sequence as one atomic edit; branching deletions require reconnecting first.
    if (incoming.length === 1 && outgoing.length === 1) remaining.push({ ...incoming[0], target: outgoing[0].target })
    if (commit({ ...flow, nodes: flow.nodes.filter(n => n.id !== node.id), edges: remaining, layout: Object.fromEntries(Object.entries(flow.layout).filter(([id]) => id !== node.id)) })) { setSelected(null); documentFocus() }
  }
  const documentFocus = () => requestAnimationFrame(() => window.document.querySelector<HTMLButtonElement>('.flow-add-step')?.focus())
  return <section className="flow-editor" onKeyDown={e => { if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement) && !(e.target instanceof HTMLTextAreaElement) && e.key === 'Delete') { e.preventDefault(); remove() } }}>
    <div className="flow-toolbar"><button onClick={() => { setSelected(null); onOpen(program.captureFlowId) }}>Capture</button>{flow.id !== program.captureFlowId && <span>/ {flow.name}</span>}<label>Open flow <select aria-label="Open flow" value={flow.id} onChange={e => { setSelected(null); setDrag(null); onOpen(e.target.value) }}>{program.definitions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><button onClick={() => commit({ ...flow, layout: arrangedLayout(flow) })}>Arrange flow</button><label><input type="checkbox" checked={showValues} onChange={e => setShowValues(e.target.checked)} />Show result connections</label><label>Conflicts <select value={flow.conflictPolicy} onChange={e => commit({ ...flow, conflictPolicy: e.target.value as 'error' | 'replace' })}><option value="error">Report error</option><option value="replace">Replace current action</option></select></label></div>
    <div className="flow-toolbar"><label>Next step <select value={kind} onChange={e => setKind(e.target.value as FlowNode['kind'])}>{Object.entries(NODE_LABELS).filter(([k]) => k !== 'start').map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label><label>Output <select value={node && outcomes(node).includes(port) ? port : node ? outcomes(node)[0] : 'done'} onChange={e => setPort(e.target.value as Outcome)}>{(node ? outcomes(node) : ['done']).map(o => <option key={o}>{o}</option>)}</select></label><button className="flow-add-step" onClick={() => add()}>Add next step</button>{node && <button disabled={node.kind === 'start'} onClick={remove}>Delete step</button>}</div>
    {flow.id !== program.captureFlowId && !program.tests.some(t => t.flowId === flow.id) && <details><summary>Shared definition · inputs and callers</summary><p>Used by: {program.definitions.flatMap(f => f.nodes.filter(n => n.kind === 'call' && n.flowId === flow.id).map(n => `${f.name} / ${n.label}`)).join(', ') || 'library only'}. Saving steps updates these callers.</p><ul>{flow.inputs.map(i => <li key={i.id}>{i.id} ({i.unit})</li>)}</ul><div className="flow-toolbar"><label>New input units <select value={inputUnit} onChange={e => setInputUnit(e.target.value as Unit)}>{['V', 'A', 'Hz', 's', 'ratio', 'boolean'].map(u => <option key={u}>{u}</option>)}</select></label><button onClick={() => {
      const id = `Input${flow.inputs.length + 1}`, value: Binding = { kind: 'constant', unit: inputUnit, value: inputUnit === 'Hz' ? 440 : 0 }
      try { onChange({ ...program, definitions: program.definitions.map(f => ({ ...f, ...(f.id === flow.id ? { inputs: [...f.inputs, { id, unit: inputUnit }] } : {}), nodes: f.nodes.map(n => n.kind === 'call' && n.flowId === flow.id ? { ...n, inputs: { ...n.inputs, [id]: value } } : n) })) }); setNotice(`${id} added; existing callers receive an explicit ${value.value} ${value.unit} default.`) } catch (error) { setNotice((error as Error).message) }
    }}>Add input</button></div></details>}
    <p role="status" className="flow-notice">{notice || 'Select a step to edit it. Connect labeled outputs or choose a predecessor in the ordered list.'}</p>
    <div className="flow-editor-body"><div className="flow-canvas"><ReactFlow key={flow.id} nodes={drag ?? nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes => {
        const selection = changes.find(c => c.type === 'select' && c.selected)
        if (selection?.type === 'select') setSelected(selection.id)
        if (changes.some(c => c.type === 'position')) {
          const positioned = applyNodeChanges(changes, drag ?? nodes)
          if (changes.some(c => c.type === 'position' && c.dragging === undefined)) {
            const layout = { ...flow.layout }
            for (const change of changes) if (change.type === 'position' && change.position) layout[change.id] = change.position
            commit({ ...flow, layout }); setDrag(null)
          } else setDrag(positioned)
        }
      }} onNodeDragStop={(_, changed) => { const previous = flow.layout[changed.id] ?? fallback[changed.id]; setDrag(null); if (previous.x !== changed.position.x || previous.y !== changed.position.y) commit({ ...flow, layout: { ...flow.layout, [changed.id]: changed.position } }) }} onNodeClick={(_, n) => { setSelected(n.id); setPort(outcomes(n.data.step)[0]) }} onNodeDoubleClick={(_, n) => { if (n.data.step.kind === 'call') onOpen(n.data.step.flowId) }} onConnect={connect} onConnectEnd={(_, state) => { if (!state.isValid && state.fromNode && !state.toNode) add(state.fromNode.id, (state.fromHandle?.id?.startsWith('value:') ? 'done' : state.fromHandle?.id ?? 'done') as Outcome) }} onEdgeClick={(_, edge) => { setSelected(edge.source); setPort(outcomes(flow.nodes.find(n => n.id === edge.source)!)[0]) }} fitView minZoom={.2} maxZoom={1.5} deleteKeyCode={null} colorMode="dark" ariaLabelConfig={{ 'node.a11yDescription.default': 'Press Enter to select a step. Use the ordered step list and inspector to edit settings or dependencies.' }}><Background gap={20} size={1} /><Controls showInteractive={false} />{nodes.length > 12 && <MiniMap />}</ReactFlow></div>
      {node && <Inspector key={`${flow.id}/${node.id}/${JSON.stringify(node)}`} initial={node} flow={flow} program={program} document={document} save={n => commit({ ...flow, ...(n.kind === 'finish' ? { outputs: Object.entries(n.outputs).map(([id, b]) => ({ id, unit: b.unit })) } : {}), nodes: flow.nodes.map(old => old.id === n.id ? n : n.kind === 'finish' && old.kind === 'finish' ? { ...old, outputs: Object.fromEntries(Object.entries(n.outputs).map(([key, b]) => [key, old.outputs[key]?.unit === b.unit ? old.outputs[key] : b])) } : old) })} close={() => { setSelected(null); documentFocus() }} drill={onOpen} />}
    </div>
    <details className="flow-step-list"><summary>Ordered steps · keyboard editing</summary><ol>{[...flow.nodes].sort((a, b) => a.order - b.order).map(n => { const incoming = flow.edges.find(e => e.target === n.id); return <li key={n.id}><button onClick={() => { setSelected(n.id); setPort(outcomes(n)[0]) }}>{n.label} · {NODE_LABELS[n.kind]}</button>{n.kind !== 'start' && <label>Starts after <select aria-label={`${n.label} starts after`} value={incoming ? `${incoming.source}/${incoming.outcome}` : ''} onChange={e => { const [source, sourceHandle] = e.target.value.split('/'); connect({ source, sourceHandle, target: n.id, targetHandle: null }) }}>{flow.nodes.filter(s => s.id !== n.id).flatMap(s => outcomes(s).map(o => <option key={`${s.id}/${o}`} value={`${s.id}/${o}`}>{s.label} · {o}</option>))}</select></label>}</li> })}</ol><p>Connections · choose the step type above before inserting.</p><ul>{flow.edges.map(edge => <li key={edge.id}>{flow.nodes.find(n => n.id === edge.source)?.label} → {flow.nodes.find(n => n.id === edge.target)?.label} ({edge.outcome}) <button onClick={() => {
      const inserted = newNode(kind, program, Math.max(...flow.nodes.map(n => n.order)) + 1)
      const next = appendStep({ ...flow, edges: flow.edges.filter(e => e.id !== edge.id) }, edge.source, edge.outcome, inserted)
      next.edges.push({ id: flowId('E'), source: inserted.id, target: edge.target, outcome: outcomes(inserted)[0] })
      if (commit(next)) setSelected(inserted.id)
    }}>Insert step</button><button onClick={() => commit({ ...flow, edges: flow.edges.filter(e => e.id !== edge.id) })}>Delete connection</button></li>)}</ul></details>
    {run && <details className="flow-run-details"><summary>Run details · {run.status} · {run.solverPasses} solver passes</summary><ol>{run.nodes.filter(n => n.flowId === flow.id).map(n => <li key={n.path}><button onClick={() => setSelected(n.nodeId)}>{n.label}: {n.status}</button> {n.ended !== undefined && `${(n.ended * 1000).toFixed(3)} ms`} {n.message}</li>)}</ol></details>}
  </section>
}
