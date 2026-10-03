import { readFile, writeFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import type { Capture } from '../src/lib/simulation-types.ts'
import { validateDocument } from '../src/lib/circuit.ts'
import { runCircuitTestSuite, portableReport, junitReport } from '../src/lib/circuit-tests.ts'

const args = process.argv.slice(2)
const path = args[0]
if (!path || path.startsWith('--')) { console.error('Usage: npm run test:circuit -- project.json [--json report.json] [--junit report.xml]'); process.exitCode = 2 }
else {
  try {
    for (let i = 1; i < args.length; i += 2) if (!['--json', '--junit'].includes(args[i]) || !args[i + 1]) throw new Error('Unknown or incomplete report option.')
    const document = validateDocument(JSON.parse(await readFile(path, 'utf8')))
    const controller = new AbortController(); process.once('SIGINT', () => controller.abort())
      const result = await runCircuitTestSuite(document, (fixture, test, signal) => new Promise<Capture>((resolve, reject) => {
        const worker = new Worker(new URL('./circuit-test-worker.ts', import.meta.url), { workerData: { document: fixture, test } })
        let finished = false
        const timeout = () => finish(new Error('Circuit test exceeded the worker watchdog.'))
        let timer = setTimeout(timeout, fixture.pico ? 65_000 : 90_000)
        const abort = () => finish(new Error('Circuit suite canceled.'))
        const finish = (error?: Error, capture?: Capture) => {
          if (finished) return
          finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate()
          if (error) reject(error); else resolve(capture!)
        }
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        worker.on('message', message => {
          if (message.type === 'phase') { clearTimeout(timer); timer = setTimeout(timeout, 90_000) }
          if (message.type === 'error') finish(new Error(message.message))
          if (message.type === 'result') finish(undefined, message.capture)
        })
        worker.on('error', error => finish(error))
        worker.on('exit', code => { if (!finished) finish(new Error(`Circuit worker exited before returning a result (${code}).`)) })
      }), { signal: controller.signal, onCase: report => console.log(`${report.verdict.toUpperCase()} ${report.name}: ${report.message}`), recordingBudgetBytes: 0 })
      console.log(result.verdict === 'no-tests' ? 'No enabled circuit tests.' : `Suite ${result.verdict}: ${JSON.stringify(result.counts)}`)
      for (let i = 1; i < args.length; i += 2) await writeFile(args[i + 1], args[i] === '--json' ? JSON.stringify(portableReport(result), null, 2) + '\n' : junitReport(result))
      process.exitCode = result.verdict === 'passed' ? 0 : 1
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 2 }
}
