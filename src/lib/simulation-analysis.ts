import { signalNodeMap } from './automation-signals.ts'
import { migrateAutomations } from './automation-migration.ts'
import { runAutomationFlow } from './automation-runtime.ts'
import { checkPicoEnvelope } from './pico/checks.ts'
import type { Simulation } from 'eecircuit-engine'
import type { Capture, SimulationRequest } from './simulation-types.ts'
import { extractCapture, extractOperatingPoint, fatalSimulationMessages, requireAnalysisCompletion, requireCompleteCapture } from './simulation-results.ts'
import { SIMULATION_LIMITS } from './simulation-types.ts'
import { extractRecording } from './recording.ts'
import { compileCircuit, validateDocument, spiceDeviceId } from './circuit.ts'
import { automationIssue } from './automations.ts'
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
async function captureCircuit(engine: Engine, request: SimulationRequest, resolved?: { actions: import('./automations.ts').Automation[]; events: import('./automations.ts').AutomationEvent[] }): Promise<Capture> {
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
  const events = resolved?.events ?? []
  // Every pass is a continuous SPICE trajectory from the original DC state.
  // Commit only the earliest causal event, then resolve future events again
  // against the changed circuit. Never splice captures or reset stored charge.
  {
    const compiled = document ? compileCircuit(document, 'transient', request.automation?.picoTrace, durationSeconds, events, resolved?.actions) : undefined
    const failure = compiled?.diagnostics.find(item => item.severity === 'error')
    if (failure) throw new Error(failure.message)
    const result = await executeAnalysis(engine, compiled?.netlist ?? request.netlist)
    const capture = extractCapture(result, request.nodes, request.revision, performance.now() - started, request.voltageChecks)
    requireCompleteCapture(capture, durationSeconds)
    requireAnalysisCompletion(result, engine.getInfo(), 'transient')
    const errors = fatalSimulationMessages(engine.getError(), capture, durationSeconds)
    if (errors.length) throw new Error(errors.slice(0, 3).join(' '))
    if (request.picoChecks) checkPicoEnvelope(result, request.picoChecks)
    const descriptors = document && compiled ? operatingPointDescriptors(resolved ? { ...document, automations: resolved.actions } : document, compiled.nodeByTerminal, true, durationSeconds) : request.operatingPoint?.parts ?? []
    const recording = extractRecording(result, descriptors)
    for (const descriptor of descriptors) {
      const model = descriptor.customModel
      if (!model) continue
      const branch = descriptor.branches[0]
      let low = Infinity, high = -Infinity
      const currents = branch.kind === 'saved-current' ? recording.currents[branch.vector] : undefined
      for (let i = 0; i < capture.time.length; i++) {
        const voltage = (branch.fromNode === '0' ? 0 : recording.nodeVoltages[branch.fromNode][i]) - (branch.toNode === '0' ? 0 : recording.nodeVoltages[branch.toNode][i])
        const axis = model.baseKind === 'resistor' ? Math.abs(currents![i]) : voltage
        low = Math.min(low, axis); high = Math.max(high, axis)
      }
      const points = model.characteristic.points
      if (low < points[0].x - 1e-12 || high > points.at(-1)!.x + 1e-12) (capture.diagnostics ??= []).push({ severity: 'warning', partId: descriptor.partId, message: `${descriptor.partId} (${model.name}) used constant endpoint values: observed ${low.toPrecision(4)} to ${high.toPrecision(4)} ${model.baseKind === 'resistor' ? 'A' : 'V'}; supplied range ${points[0].x} to ${points.at(-1)!.x}.` })
    }
    return { ...capture, recording, elapsedMs: performance.now() - started, ...(operatingPoint ? { operatingPoint } : {}), ...(document ? { automationEvents: events.sort((a, b) => a.time - b.time) } : {}) }
  }
}

/** Keep circuit-level recovery advice when ngspice cannot identify a device. */
export async function runCircuitCapture(engine: Engine, request: SimulationRequest, onProgress?: (node: import('./automation-runtime.ts').NodeResult) => void): Promise<Capture> {
  try {
    const document = request.automation?.document
    if (document) {
      const program = document.automationProgram ?? migrateAutomations((document.automations ?? []).map(row => ({ ...row, enabled: row.enabled && !automationIssue(row, document, request.durationSeconds ?? .1) })))
      const result = await runAutomationFlow(document, program, request.automation?.flowId ?? program.captureFlowId, request.durationSeconds ?? 0.1, async (actions, events) => {
        const compiled = compileCircuit(document, 'transient', request.automation?.picoTrace, request.durationSeconds ?? 0.1, events, actions)
        const capture = await captureCircuit(engine, request, { actions, events })
        return { capture, nodeByTerminal: signalNodeMap(document, compiled.nodeByTerminal) }
      }, { runId: request.runId ?? crypto.randomUUID(), onProgress })
      return result.capture
    }
    return await captureCircuit(engine, request)
  } catch (error) {
    const custom = request.operatingPoint?.parts.filter(part => part.customModel) ?? []
    if (!custom.length || !(error instanceof Error)) throw error
    const matching = custom.filter(part => error.message.toLowerCase().includes(spiceDeviceId({ id: part.partId }).toLowerCase()))
    const affected = (matching.length ? matching : custom).map(part => `${part.partId} (${part.customModel!.name})`).join(', ')
    throw new Error(`${error.message} Check custom component curves and their connections: ${affected}. Try a shorter capture or gentler curve slopes.`)
  }
}
