import { checkPicoEnvelope } from './pico/checks.ts'
import type { Simulation } from 'eecircuit-engine'
import type { Capture, SimulationRequest } from './simulation-types.ts'
import { extractCapture, extractOperatingPoint, fatalSimulationMessages, requireAnalysisCompletion, requireCompleteCapture } from './simulation-results.ts'

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
  let operatingPoint: Capture['operatingPoint']
  if (request.operatingPoint) {
    const result = await executeAnalysis(engine, request.operatingPoint.netlist)
    if (request.picoChecks) checkPicoEnvelope(result, request.picoChecks)
    operatingPoint = extractOperatingPoint(result, request.operatingPoint.parts, performance.now() - started)
    requireAnalysisCompletion(result, engine.getInfo(), 'operating-point')
    const errors = fatalSimulationMessages(engine.getError(), { analysis: 'operating-point', complete: true })
    if (errors.length) throw new Error(errors.slice(0, 3).join(' '))
  }

  const result = await executeAnalysis(engine, request.netlist)
  if (request.picoChecks) checkPicoEnvelope(result, request.picoChecks)
  const capture = extractCapture(result, request.nodes, request.revision, performance.now() - started, request.voltageChecks)
  requireCompleteCapture(capture)
  requireAnalysisCompletion(result, engine.getInfo(), 'transient')
  const errors = fatalSimulationMessages(engine.getError(), capture)
  if (errors.length) throw new Error(errors.slice(0, 3).join(' '))
  return { ...capture, ...(operatingPoint ? { operatingPoint } : {}) }
}
