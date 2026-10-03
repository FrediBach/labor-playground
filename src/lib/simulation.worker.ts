import { Simulation } from 'eecircuit-engine'
import type { SimulationRequest, SimulationResponse } from './simulation-types'
import { runCircuitCapture } from './simulation-analysis'

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
    const runId = request.runId ?? crypto.randomUUID()
    const capture = await runCircuitCapture(engine, { ...request, runId }, node => send({ type: 'progress', revision: request.revision, runId, node }))
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
