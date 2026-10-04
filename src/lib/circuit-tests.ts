import { isSwitchKind } from './utility-cell-models.ts'
import { validateDocument, type CircuitDocument } from './circuit.ts'
import type { CircuitTest, TestFixture } from './automation-graph.ts'
import type { Capture } from './simulation-types.ts'
import type { FlowRun } from './automation-runtime.ts'
import { executionFingerprint, ENGINE_VERSION, EVALUATOR_VERSION } from './execution-fingerprint.ts'

export type TestVerdict = 'passed' | 'failed' | 'error' | 'inconclusive' | 'canceled' | 'disabled'
export interface TestReport { testId: string; name: string; verdict: TestVerdict; fingerprint: string; startedAt: string; elapsedMs: number; durationSeconds: number; fixture: TestFixture; engineVersion: string; evaluatorVersion: string; message: string; run?: FlowRun; capture?: Capture; recordingEvicted?: boolean; samples?: number; maximumSampleStepSeconds?: number }
export type TestExecutor = (document: CircuitDocument, test: CircuitTest, signal?: AbortSignal) => Promise<Capture>
export function captureFixture(document: CircuitDocument): TestFixture { return { instruments: structuredClone(document.instruments), parts: document.parts.filter(p => p.kind === 'potentiometer' || isSwitchKind(p.kind)).map(p => ({ partId: p.id, kind: p.kind, ...(p.kind === 'potentiometer' ? { position: p.position ?? .5 } : { value: p.value }) })) } }
export function applyFixture(document: CircuitDocument, fixture: TestFixture): CircuitDocument {
  const snapshot = structuredClone(document); snapshot.instruments = structuredClone(fixture.instruments)
  const partsById = new Map(snapshot.parts.map(part => [part.id, part]))
  for (const override of fixture.parts) {
    const part = partsById.get(override.partId)
    if (!part || part.kind !== override.kind) throw new Error(`Fixture target ${override.partId} is missing or changed kind.`)
    if (override.position !== undefined && part.kind !== 'potentiometer') throw new Error(`Only potentiometers support a position override.`)
    if (override.value !== undefined) part.value = override.value
    if (override.position !== undefined) part.position = override.position
  }
  return validateDocument(snapshot)
}
export async function runCircuitTest(document: CircuitDocument, test: CircuitTest, execute: TestExecutor, signal?: AbortSignal): Promise<TestReport> {
  const start = performance.now()
  const report: TestReport = { testId: test.id, name: test.name, verdict: 'error', fingerprint: executionFingerprint(document, test.durationSeconds, test), startedAt: new Date().toISOString(), elapsedMs: 0, durationSeconds: test.durationSeconds, fixture: structuredClone(test.fixture), engineVersion: ENGINE_VERSION, evaluatorVersion: EVALUATOR_VERSION, message: '' }
  try {
    if (!test.enabled) { report.verdict = 'disabled'; report.message = 'Test is disabled.'; return report }
    if (signal?.aborted) { report.verdict = 'canceled'; report.message = 'Suite canceled.'; return report }
    const snapshot = applyFixture(document, test.fixture)
    const capture = await execute(snapshot, test, signal)
    if (signal?.aborted) { report.verdict = 'canceled'; report.message = 'Suite canceled.'; return report }
    report.capture = capture; report.run = capture.automationRun
    report.samples = capture.time.length; report.maximumSampleStepSeconds = 0
    for (let i = 1; i < capture.time.length; i++) report.maximumSampleStepSeconds = Math.max(report.maximumSampleStepSeconds, capture.time[i] - capture.time[i - 1])
    const run = report.run
    if (!run) throw new Error('The test produced no flow execution evidence.')
    const required = run.nodes.filter(n => n.kind === 'expect' && n.required)
    const executed = required.filter(n => n.status !== 'skipped')
    if (run.status === 'error') { report.verdict = 'error'; report.message = run.nodes.find(n => n.status === 'error')?.message ?? 'Flow execution failed.' }
    else if (run.status === 'inconclusive') { report.verdict = 'inconclusive'; report.message = 'The observation has insufficient data.' }
    else if (!executed.length) { report.verdict = 'inconclusive'; report.message = 'A pass requires at least one executed required expectation.' }
    else if (run.status !== 'done' || executed.some(n => n.status !== 'done')) { report.verdict = 'failed'; report.message = executed.find(n => n.status !== 'done')?.message ?? 'The required scenario did not complete.' }
    else { report.verdict = 'passed'; report.message = `${executed.length} required expectation${executed.length === 1 ? '' : 's'} passed.` }
  } catch (error) { report.verdict = signal?.aborted ? 'canceled' : 'error'; report.message = error instanceof Error ? error.message : String(error) }
  report.elapsedMs = performance.now() - start
  return report
}
export interface SuiteReport { reports: TestReport[]; verdict: 'no-tests' | 'passed' | 'failed'; counts: Record<TestVerdict, number> }
function recordingSize(capture: Capture | undefined): number {
  if (!capture) return 0
  const samples = capture.time.length + Object.values(capture.channels).reduce((sum, values) => sum + values.length, 0) + Object.values(capture.recording?.nodeVoltages ?? {}).reduce((sum, values) => sum + values.length, 0) + Object.values(capture.recording?.currents ?? {}).reduce((sum, values) => sum + values.length, 0)
  return samples * 8 + (capture.picoTrace ? new TextEncoder().encode(JSON.stringify(capture.picoTrace)).length : 0)
}
/** One immutable snapshot and one awaited request at a time: no replaceable queue. */
export async function runCircuitTestSuite(document: CircuitDocument, execute: TestExecutor, options: { signal?: AbortSignal; testIds?: string[]; onCase?: (report: TestReport, index: number, total: number) => void; onStart?: (test: CircuitTest, index: number, total: number) => void; recordingBudgetBytes?: number } = {}): Promise<SuiteReport> {
  const selectedIds = options.testIds ? new Set(options.testIds) : null
  const snapshot = structuredClone(document), tests = snapshot.automationProgram?.tests.filter(t => !selectedIds || selectedIds.has(t.id)) ?? [], reports: TestReport[] = []
  const recordingSizes = new Map<TestReport, number>()
  let bytes = 0
  for (const [index, test] of tests.entries()) {
    options.onStart?.(test, index, tests.length)
    const report = await runCircuitTest(snapshot, test, execute, options.signal); reports.push(report)
    const size = recordingSize(report.capture)
    recordingSizes.set(report, size); bytes += size
    for (const old of reports) { if (bytes <= (options.recordingBudgetBytes ?? 64 * 1024 * 1024)) break; bytes -= recordingSizes.get(old) ?? 0; recordingSizes.delete(old); delete old.capture; old.recordingEvicted = true }
    options.onCase?.(report, index, tests.length)
  }
  const counts: SuiteReport['counts'] = { passed: 0, failed: 0, error: 0, inconclusive: 0, canceled: 0, disabled: 0 }
  for (const r of reports) counts[r.verdict]++
  return { reports, counts, verdict: !reports.length || reports.every(r => r.verdict === 'disabled') ? 'no-tests' : reports.every(r => r.verdict === 'passed' || r.verdict === 'disabled') ? 'passed' : 'failed' }
}
export function junitReport(suite: SuiteReport): string {
  const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="LABOR circuit tests" tests="${suite.reports.length}" failures="${suite.reports.filter(r => !['passed', 'disabled'].includes(r.verdict)).length}">\n${suite.reports.map(r => `  <testcase name="${escape(r.name)}" time="${r.elapsedMs / 1000}">${r.verdict === 'disabled' ? '<skipped/>' : r.verdict === 'passed' ? '' : `<failure type="${r.verdict}" message="${escape(r.message)}"/>`}</testcase>`).join('\n')}\n</testsuite>\n`
}
export function portableReport(suite: SuiteReport) { return { ...suite, reports: suite.reports.map(({ capture: _capture, ...r }) => r) } }
