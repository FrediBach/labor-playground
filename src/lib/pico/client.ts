import type { PicoTrace } from './runtime'
export class PicoClient {
  private worker: Worker | null = null
  private reject: ((error: Error) => void) | undefined
  stop() { this.worker?.terminate(); this.worker = null; this.reject?.(new Error('Pico capture cancelled.')); this.reject = undefined }
  run(source: string, runId: number, onProgress: (phase: string, console?: string) => void, durationSeconds = 0.1): Promise<PicoTrace> {
    this.stop()
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./pico.worker.ts', import.meta.url), { type: 'module' })
      this.worker = worker
      const timer = setTimeout(() => finish(new Error('Pico worker timed out. Reset and try again.')), 65_000)
      const finish = (error?: Error, trace?: PicoTrace) => { clearTimeout(timer); this.reject = undefined; worker.terminate(); if (this.worker === worker) this.worker = null; if (error) reject(error); else resolve(trace!) }
      this.reject = error => finish(error)
      worker.onmessage = ({ data }) => {
        if (data.runId !== runId || this.worker !== worker) return
        if (data.type === 'phase') onProgress(data.phase)
        if (data.type === 'console') onProgress('running', data.text)
        if (data.type === 'error') finish(new Error(data.message))
        if (data.type === 'result') finish(undefined, data.trace)
      }
      worker.onerror = () => finish(new Error('Pico worker failed. Reset and try again.'))
      worker.onmessageerror = () => finish(new Error('Pico worker message failed. Reset and try again.'))
      worker.postMessage({ type: 'run', source, runId, durationSeconds })
    })
  }
}
