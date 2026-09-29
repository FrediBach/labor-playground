import { Simulation } from 'eecircuit-engine'
import type { SimulationRequest, SimulationResponse } from './simulation-types'
import { extractCapture } from './simulation-results'

// EEcircuit's asynchronous API runs ngspice in its caller's execution context.
// Import and initialize it here, so both WASM setup and solving stay off the UI thread.
const engine = new Simulation()
const send = (message: SimulationResponse) => self.postMessage(message)

const initialized = engine.start().then(() => send({ type: 'ready' }))

self.onmessage = async (event: MessageEvent<SimulationRequest>) => {
  const request = event.data
  if (request.type !== 'run') return
  try {
    await initialized
    const started = performance.now()
    engine.setNetList(request.netlist)
    const result = await engine.runSim()
    const errors = engine.getError().filter((line) => /error|failed|singular matrix|timestep too small|aborted/i.test(line))
    if (errors.length) throw new Error(errors.slice(0, 3).join(' '))
    const capture = extractCapture(result, request.nodes, request.revision, performance.now() - started)
    send({ type: 'result', revision: request.revision, capture })
  } catch (error) {
    send({ type: 'error', revision: request.revision, message: error instanceof Error ? error.message : 'ngspice could not complete this circuit.' })
  }
}

// The package's start() may leave a promise pending after a WASM failure.
// The main-thread watchdog still owns the final timeout and Worker.terminate().
void initialized.catch((error: unknown) => {
  send({ type: 'error', revision: -1, message: error instanceof Error ? error.message : 'Could not initialize ngspice.' })
})
