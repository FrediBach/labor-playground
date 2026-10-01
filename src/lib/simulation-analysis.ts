import { checkPicoEnvelope } from './pico/checks.ts'
import type { Simulation } from 'eecircuit-engine'
import type { Capture, SimulationRequest } from './simulation-types.ts'
import { extractCapture, extractOperatingPoint, fatalSimulationMessages, requireAnalysisCompletion, requireCompleteCapture } from './simulation-results.ts'
import { SIMULATION_LIMITS } from './simulation-types.ts'
import { extractRecording } from './recording.ts'
import { compileCircuit, validateDocument } from './circuit.ts'
import { automationCrossing, automationIssue, scheduledAutomationEvents } from './automations.ts'
import { operatingPointDescriptors } from './simulation-descriptors.ts'

type Engine = Pick<Simulation, 'setNetList' | 'runSim' | 'getError' | 'getInfo'>

async function executeAnalysis(engine: Engine, netlist: string) {
  engine.setNetList(netlist)
  // The upstream wrapper can leave runSim() pending after a failed analysis
  // cannot write out.raw. Report only irreversible abort/write failures here;
  // gmin warnings must be allowed to reach ngspice's later recovery steps.
  let monitor: ReturnType<typeof setInterval> | undefined
  try {
    return await Promise.race([
      engine.runSim(),
      new Promise<never>((_, reject) => {
        monitor = setInterval(() => {
          const lines = engine.getError()
          if (lines.some((line) => /run simulation\(s\) aborted|Error during ['"]write['"]:\s*no writable vector found|Error:\s*The operating point could not be simulated successfully/i.test(line))) {
            reject(new Error(lines.filter((line) => /error|aborted|timestep too small/i.test(line)).slice(0, 3).join(' ').trim()))
          }
        }, 50)
      }),
    ])
  } finally {
    if (monitor !== undefined) clearInterval(monitor)
  }
}

/** Both analyses belong to one worker request, timeout, and circuit revision. */
export async function runCircuitCapture(engine: Engine, request: SimulationRequest): Promise<Capture> {
  const started = performance.now()
  const durationSeconds = request.durationSeconds ?? 0.1
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.001 || durationSeconds > SIMULATION_LIMITS.maxDurationSeconds) throw new Error('The requested recording duration is outside the supported 1 ms to 10 s range.')
  let operatingPoint: Capture['operatingPoint']
  if (request.operatingPoint) {
    const result = await executeAnalysis(engine, request.operatingPoint.netlist)
    if (request.picoChecks) checkPicoEnvelope(result, request.picoChecks)
    operatingPoint = extractOperatingPoint(result, request.operatingPoint.parts, performance.now() - started)
    requireAnalysisCompletion(result, engine.getInfo(), 'operating-point')
    const errors = fatalSimulationMessages(engine.getError(), { analysis: 'operating-point', complete: true })
    if (errors.length) throw new Error(errors.slice(0, 3).join(' '))
  }

  const document = request.automation ? validateDocument(request.automation.document) : undefined
  const events = document ? scheduledAutomationEvents(document, durationSeconds) : []
  const pending = document?.automations?.filter(row => row.enabled && row.trigger.kind === 'voltage' && !automationIssue(row, document, durationSeconds)) ?? []
  let causalCursor = 0
  // Every pass is a continuous SPICE trajectory from the original DC state.
  // Commit only the earliest causal event, then resolve future events again
  // against the changed circuit. Never splice captures or reset stored charge.
  for (;;) {
    const compiled = document ? compileCircuit(document, 'transient', request.automation?.picoTrace, durationSeconds, events) : undefined
    const failure = compiled?.diagnostics.find(item => item.severity === 'error')
    if (failure) throw new Error(failure.message)
    const result = await executeAnalysis(engine, compiled?.netlist ?? request.netlist)
    const capture = extractCapture(result, request.nodes, request.revision, performance.now() - started, request.voltageChecks)
    requireCompleteCapture(capture, durationSeconds)
    requireAnalysisCompletion(result, engine.getInfo(), 'transient')
    const errors = fatalSimulationMessages(engine.getError(), capture, durationSeconds)
    if (errors.length) throw new Error(errors.slice(0, 3).join(' '))
    const candidates = pending.map(row => ({ automationId: row.id, time: automationCrossing(row, capture, causalCursor) }))
      .filter((event): event is { automationId: string; time: number } => event.time !== null && event.time < durationSeconds)
      .sort((a, b) => a.time - b.time)
    if (candidates.length) {
      causalCursor = candidates[0].time
      for (const event of candidates.filter(candidate => candidate.time <= causalCursor + 1e-12)) {
        events.push(event)
        pending.splice(pending.findIndex(row => row.id === event.automationId), 1)
      }
      continue
    }
    if (request.picoChecks) checkPicoEnvelope(result, request.picoChecks)
    const descriptors = document && compiled ? operatingPointDescriptors(document, compiled.nodeByTerminal, true, durationSeconds) : request.operatingPoint?.parts ?? []
    const recording = extractRecording(result, descriptors)
    return { ...capture, recording, elapsedMs: performance.now() - started, ...(operatingPoint ? { operatingPoint } : {}), ...(document ? { automationEvents: events.sort((a, b) => a.time - b.time) } : {}) }
  }
}
