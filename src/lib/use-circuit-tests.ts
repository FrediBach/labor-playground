import { useCallback, useEffect, useRef, useState } from 'react'
import { SimulationClient } from './simulation-client'
import { PicoClient } from './pico/client'
import { compileCircuit, oledConnections, type CircuitDocument } from './circuit'
import { runCircuitTestSuite, type SuiteReport, type TestReport } from './circuit-tests'
import { circuitTestRequest } from './circuit-test-request'

const SUMMARY_KEY = 'labor.circuit-test-summaries.v1'
function recoveredSummary(): SuiteReport | null {
  try {
    const saved = localStorage.getItem(SUMMARY_KEY)
    if (!saved || saved.length > 2_000_000) return null
    const rows: unknown = JSON.parse(saved)
    if (!Array.isArray(rows) || rows.length > 32) return null
    const reports = rows.filter((r): r is TestReport => !!r && typeof r === 'object' && typeof r.testId === 'string' && typeof r.name === 'string' && typeof r.fingerprint === 'string' && typeof r.startedAt === 'string' && typeof r.message === 'string' && ['passed', 'failed', 'error', 'inconclusive', 'canceled', 'disabled'].includes(r.verdict)).map(r => ({ ...r, run: undefined, capture: undefined, recordingEvicted: true }))
    const counts: SuiteReport['counts'] = { passed: 0, failed: 0, error: 0, inconclusive: 0, canceled: 0, disabled: 0 }
    for (const r of reports) counts[r.verdict]++
    return { reports, counts, verdict: reports.length ? reports.every(r => ['passed', 'disabled'].includes(r.verdict)) ? 'passed' : 'failed' : 'no-tests' }
  } catch { return null }
}
export function useCircuitTests(document: CircuitDocument) {
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [suite, setSuite] = useState<SuiteReport | null>(recoveredSummary)
  useEffect(() => {
    if (!suite) return
    try {
      const rows = suite.reports.slice(-32).map(({ capture: _capture, run: _run, ...report }) => ({ ...report, recordingEvicted: true }))
      while (rows.length && new TextEncoder().encode(JSON.stringify(rows)).length > 2_000_000) rows.shift()
      localStorage.setItem(SUMMARY_KEY, JSON.stringify(rows))
    } catch { /* Summary recovery is optional; project JSON never contains reports. */ }
  }, [suite])
  const active = useRef<{ controller: AbortController; client: SimulationClient; pico: PicoClient } | null>(null)
  const cancel = useCallback(() => { active.current?.controller.abort(); active.current?.client.dispose(); active.current?.pico.stop() }, [])
  useEffect(() => () => cancel(), [cancel])
  const run = useCallback(async (testIds?: string[], snapshot = document) => {
    if (active.current) return
    const job = { controller: new AbortController(), client: new SimulationClient(), pico: new PicoClient() }; active.current = job; setBusy(true)
    let revision = 0
    try {
      const result = await runCircuitTestSuite(snapshot, async (fixture, test) => {
        const current = ++revision
        const trace = fixture.pico ? await job.pico.run(fixture.pico.source, current, phase => setProgress(`${test.name} · ${phase}`), test.durationSeconds, oledConnections(fixture, compileCircuit(fixture).nodeByTerminal)) : undefined
        const r = circuitTestRequest(fixture, test, current, trace)
        const capture = await job.client.run(r.netlist, r.nodes, r.revision, undefined, r.voltageChecks, r.operatingPoint, r.picoChecks, r.durationSeconds, r.automation, node => { if (node.kind === 'start' && node.path.split('/').length === 2) setProgress(`${test.name} · analyzing circuit`) })
        return trace ? { ...capture, picoTrace: trace } : capture
      }, { signal: job.controller.signal, testIds, onStart: (t, i, total) => setProgress(`${i + 1} / ${total} · ${t.name}`) })
      setSuite(previous => ({ ...result, reports: [...(previous?.reports.filter(r => snapshot.automationProgram?.tests.some(t => t.id === r.testId) && !result.reports.some(next => next.testId === r.testId)).map(({ capture: _capture, ...r }) => ({ ...r, recordingEvicted: true })) ?? []), ...result.reports] })); setProgress(result.verdict === 'no-tests' ? 'No enabled tests' : `${testIds ? 'Run' : 'Suite'} ${result.verdict} · ${result.counts.passed} passed, ${result.counts.failed} failed, ${result.counts.error} errors, ${result.counts.inconclusive} inconclusive, ${result.counts.canceled} canceled, ${result.counts.disabled} disabled`)
    } finally { job.client.dispose(); job.pico.stop(); active.current = null; setBusy(false) }
  }, [document])
  return { busy, progress, suite, run, cancel }
}
