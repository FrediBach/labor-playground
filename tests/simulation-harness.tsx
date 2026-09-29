import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { examples } from '../src/lib/circuit'
import { useSimulation } from '../src/lib/simulation'
import type { SimulationRequest, SimulationResponse } from '../src/lib/simulation-types'

class ControlledWorker {
  static instances: ControlledWorker[] = []
  onmessage: ((event: { data: SimulationResponse }) => void) | null = null
  onerror = null
  onmessageerror = null
  requests: SimulationRequest[] = []
  terminated = false
  constructor() {
    ControlledWorker.instances.push(this)
    queueMicrotask(() => this.send({ type: 'ready' }))
  }
  postMessage(request: SimulationRequest) { this.requests.push(request) }
  terminate() { this.terminated = true }
  send(message: SimulationResponse) { this.onmessage?.({ data: message }) }
  static finish(fail = false) {
    const worker = ControlledWorker.instances.at(-1)!
    const revision = worker.requests.at(-1)!.revision
    worker.send(fail ? { type: 'error', revision, message: 'Controlled solver failure.' } : {
      type: 'result', revision,
      capture: { revision, time: [0, 0.1], channels: { CH1: [1, 1], CH2: [0.5, 0.5] }, duration: 0.1, elapsedMs: 1 },
    })
  }
}

Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ControlledWorker })

export function Harness() {
  const [document, setDocument] = useState(() => structuredClone(examples[0].document))
  const [auto, setAuto] = useState(false)
  const simulation = useSimulation(document, auto)
  return <>
    <div data-testid="status">{simulation.status}</div>
    <div data-testid="error">{simulation.error}</div>
    <div data-testid="capture">{simulation.capture?.revision ?? 'none'}</div>
    <button onClick={simulation.captureNow}>Capture</button>
    <button onClick={simulation.reset}>Reset</button>
    <button onClick={() => setAuto((value) => !value)}>Toggle auto</button>
    <button onClick={() => setDocument((value) => structuredClone(value))}>Equivalent document</button>
    <button onClick={() => setDocument((value) => ({ ...value, instruments: { ...value.instruments, frequency: value.instruments.frequency + 10 } }))}>Edit document</button>
    <button onClick={() => ControlledWorker.finish()}>Complete</button>
    <button onClick={() => ControlledWorker.finish(true)}>Fail</button>
  </>
}

createRoot(document.getElementById('fixture')!).render(<Harness />)
