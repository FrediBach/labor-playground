import type { PicoElectricalCheck } from './pico/checks.ts'
import type { Capture, OperatingPointRequest, ProbeNodes, SimulationRequest, SimulationResponse, VoltageCheck } from './simulation-types.ts'
import { SIMULATION_LIMITS } from './simulation-types.ts'

interface PendingRun {
  request: SimulationRequest
  resolve: (capture: Capture) => void
  reject: (error: Error) => void
  phase?: (phase: 'loading' | 'calculating') => void
}

export class SupersededSimulation extends Error {
  constructor() { super('A newer circuit revision replaced this capture.') }
}

/** One running job plus one replaceable pending job; never a queue of intermediate edits. */
export class SimulationClient {
  private worker: Worker | null = null
  private ready = false
  private active: PendingRun | null = null
  private pending: PendingRun | null = null
  private timeout: ReturnType<typeof setTimeout> | null = null

  get isReady() { return this.ready }

  run(netlist: string, nodes: ProbeNodes, revision: number, phase?: PendingRun['phase'], voltageChecks: VoltageCheck[] = [], operatingPoint?: OperatingPointRequest, picoChecks?: PicoElectricalCheck[], durationSeconds = 0.1): Promise<Capture> {
    this.discardQueued()
    return new Promise((resolve, reject) => {
      this.pending = { request: { type: 'run', netlist, nodes, revision, voltageChecks, operatingPoint, picoChecks, durationSeconds }, resolve, reject, phase }
      phase?.(this.ready ? 'calculating' : 'loading')
      if (!this.worker) this.initialize()
      this.pump()
    })
  }

  discardQueued() {
    this.pending?.reject(new SupersededSimulation())
    this.pending = null
  }

  dispose() {
    this.discardQueued()
    this.active?.reject(new SupersededSimulation())
    this.active = null
    this.destroyWorker()
  }

  private initialize() {
    try {
      this.worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module', name: 'labor-ngspice' })
      this.timeout = setTimeout(() => this.fail('ngspice took too long to start. Press Capture to retry.'), SIMULATION_LIMITS.startupTimeoutMs)
      this.worker.onerror = (event) => {
        event.preventDefault()
        this.fail(event.message || 'The simulation worker stopped. Press Capture to start it again.')
      }
      this.worker.onmessageerror = () => this.fail('Could not read the simulation result. Press Capture to retry.')
      this.worker.onmessage = (event: MessageEvent<SimulationResponse>) => {
        const message = event.data
        if (message.type === 'ready') {
          this.clearTimeout()
          this.ready = true
          this.pump()
          return
        }
        if (message.type === 'error' && message.revision === -1) {
          this.fail(message.message)
          return
        }
        if (!this.active || message.revision !== this.active.request.revision) return
        this.clearTimeout()
        const active = this.active
        this.active = null
        if (message.type === 'result') active.resolve(message.capture)
        else {
          active.reject(new Error(message.message))
          // A failed ngspice run may leave an old out.raw behind. Start clean next time.
          this.destroyWorker()
        }
        if (this.pending && !this.worker) this.initialize()
        this.pump()
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Web Workers are unavailable in this browser.')
    }
  }

  private pump() {
    if (!this.ready || this.active || !this.pending || !this.worker) return
    this.active = this.pending
    this.pending = null
    this.active.phase?.('calculating')
    const timeoutMs = (this.active.request.durationSeconds ?? 0.1) > 0.1 ? SIMULATION_LIMITS.longRunTimeoutMs : SIMULATION_LIMITS.runTimeoutMs
    this.timeout = setTimeout(() => this.fail(`The simulation exceeded ${timeoutMs / 1000} seconds and was stopped. Your circuit is preserved. Shorten the recording or simplify the circuit, then press Capture.`), timeoutMs)
    this.worker.postMessage(this.active.request)
  }

  private clearTimeout() {
    if (this.timeout !== null) clearTimeout(this.timeout)
    this.timeout = null
  }

  private destroyWorker() {
    this.clearTimeout()
    if (this.worker) {
      this.worker.onmessage = null
      this.worker.onerror = null
      this.worker.onmessageerror = null
      this.worker.terminate()
    }
    this.worker = null
    this.ready = false
  }

  private fail(message: string) {
    const error = new Error(message)
    this.active?.reject(error)
    this.pending?.reject(error)
    this.active = null
    this.pending = null
    this.destroyWorker()
  }
}
