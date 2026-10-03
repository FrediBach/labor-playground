import type { RecordingSeed } from '../tests/RecordingExpectation'
import { lazy, Suspense, useState } from 'react'
import { AutomationsPanel } from '../AutomationsPanel'
import { TestsPanel } from '../tests/TestsPanel'
import { programFor, withProgram } from '@/lib/automation-migration'
import { simpleRows, flowId } from '@/lib/automation-editing'
import { validateDocument, type CircuitDocument } from '@/lib/circuit'
import type { Capture, SimulationStatus } from '@/lib/simulation-types'
import type { useCircuitTests } from '@/lib/use-circuit-tests'
import type { TestReport } from '@/lib/circuit-tests'
import './Flows.css'
const FlowEditor = lazy(() => import('./FlowEditor'))
export function AutomationWorkspace({ document, onChange, durationSeconds, capture, status, onViewResults, visible, tests, onInspect, recordingSeed, onSeedConsumed }: {
  recordingSeed?: RecordingSeed; onSeedConsumed: () => void; document: CircuitDocument; onChange: (d: CircuitDocument) => void; durationSeconds: number; capture: Capture | null; status: SimulationStatus; onViewResults: () => void; visible: boolean; tests: ReturnType<typeof useCircuitTests>; onInspect: (r: TestReport) => void
}) {
  const program = programFor(document)
  const [section, setSection] = useState<'automations' | 'tests'>('automations'), [view, setView] = useState<'simple' | 'flow'>(() => { try { return localStorage.getItem('labor.automation-view') === 'flow' ? 'flow' : 'simple' } catch { return 'simple' } }), [selectedFlow, setSelectedFlow] = useState(program.captureFlowId), [testCall, setTestCall] = useState<string | undefined>(), [notice, setNotice] = useState('')
  const [seenSeed, setSeenSeed] = useState<string | undefined>()
  if (recordingSeed && seenSeed !== recordingSeed.id) { setSeenSeed(recordingSeed.id); setSection('tests') }
  const openFlow = (id = program.captureFlowId) => { setSelectedFlow(id); setView('flow'); setSection('automations'); try { localStorage.setItem('labor.automation-view', 'flow') } catch { /* Preference only. */ } }
  const rows = simpleRows(program), captureFlow = program.definitions.find(f => f.id === program.captureFlowId)!
  const advanced = captureFlow.nodes.filter(n => n.kind === 'call' && !rows.some(r => r.callId === n.id))
  const library = program.definitions.filter(f => f.id !== program.captureFlowId && !program.tests.some(t => t.flowId === f.id) && !captureFlow.nodes.some(n => n.kind === 'call' && n.flowId === f.id))
  return <div className="automation-workspace"><div className="flow-toolbar" role="group" aria-label="Automation workspace"><button aria-pressed={section === 'automations'} onClick={() => setSection('automations')}>Automations</button><button aria-pressed={section === 'tests'} onClick={() => setSection('tests')}>Tests ({program.tests.length})</button>{section === 'automations' && <><button aria-pressed={view === 'simple'} onClick={() => { setView('simple'); try { localStorage.setItem('labor.automation-view', 'simple') } catch { /* Preference only. */ } }}>Simple</button><button aria-pressed={view === 'flow'} onClick={() => openFlow()}>Flow</button></>}</div>
    {section === 'automations' && view === 'simple' && <><AutomationsPanel document={document} onChange={d => onChange(validateDocument(d))} durationSeconds={durationSeconds} capture={capture} status={status} onViewResults={onViewResults} onFlow={openFlow} onUseTest={id => { setTestCall(id); setSection('tests') }} />{advanced.length > 0 && <section><h3>Advanced capture invocations</h3>{advanced.map(n => <div className="automation-row" key={n.id}><span>{n.label}</span><button onClick={() => openFlow(n.kind === 'call' ? n.flowId : undefined)}>Edit flow</button></div>)}</section>}{library.length > 0 && <section><h3>Automation library</h3>{library.map(f => <div className="automation-row" key={f.id}><span>{f.name}</span><button onClick={() => openFlow(f.id)}>Edit flow</button><button onClick={() => { try { const id = flowId('Call'), start = captureFlow.nodes.find(n => n.kind === 'start')!; onChange(validateDocument(withProgram(document, { ...program, definitions: program.definitions.map(d => d.id === captureFlow.id ? { ...d, nodes: [...d.nodes, { id, kind: 'call', label: f.name, flowId: f.id, enabled: true, inputs: {}, order: d.nodes.length }], edges: [...d.edges, { id: flowId('E'), source: start.id, target: id, outcome: 'done' }] } : d) }))) } catch (error) { setNotice((error as Error).message) } }}>Add to capture</button></div>)}</section>}</>}
    {section === 'automations' && view === 'flow' && visible && <Suspense fallback={<p>Loading flow editor…</p>}><FlowEditor document={document} program={program} flowId={selectedFlow} onOpen={openFlow} onChange={p => onChange(validateDocument(withProgram(document, p)))} run={capture?.automationRun} /></Suspense>}
    {section === 'tests' && <TestsPanel key={testCall ?? recordingSeed?.id ?? 'tests'} recordingSeed={recordingSeed} document={document} onChange={onChange} onRun={(ids, snapshot) => { void tests.run(ids, snapshot) }} onCancel={tests.cancel} busy={tests.busy} progress={tests.progress} suite={tests.suite} onInspect={onInspect} onFlow={openFlow} initialCall={testCall} onWizardClose={() => { setTestCall(undefined); onSeedConsumed() }} />}
    <p role="status">{notice}</p>
  </div>
}
