import type { OledConnection } from '../ssd1306'
import { loadPicoAsset } from './assets'
import { runPico } from './runtime'
let controller: AbortController | undefined
self.onmessage = async ({ data }: MessageEvent<{ type: 'run' | 'stop'; runId: number; source: string; durationSeconds?: number; displays?: OledConnection[] }>) => {
  controller?.abort()
  if (data.type === 'stop') return
  const current = new AbortController()
  controller = current
  const send = (payload: object) => { if (!current.signal.aborted) self.postMessage({ ...payload, runId: data.runId }) }
  try {
    const [bootrom, firmware] = await Promise.all([loadPicoAsset('bootrom.bin', current.signal), loadPicoAsset('micropython.uf2', current.signal)])
    const trace = await runPico({ source: data.source, displays: data.displays, bootrom, firmware, durationSeconds: data.durationSeconds, signal: current.signal, onPhase: phase => send({ type: 'phase', phase }), onConsole: text => send({ type: 'console', text }) })
    send({ type: 'result', trace })
  } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
