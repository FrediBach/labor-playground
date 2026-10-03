import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, oledConnections, type CircuitDocument } from '../src/lib/circuit.ts'
import type { CircuitTest } from '../src/lib/automation-graph.ts'
import { circuitTestRequest } from '../src/lib/circuit-test-request.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { runPico } from '../src/lib/pico/runtime.ts'

const { document, test } = workerData as { document: CircuitDocument; test: CircuitTest }
try {
  const buffer = async (name: string) => { const bytes = await readFile(new URL(`../public/pico/${name}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
  const trace = document.pico ? await runPico({ source: document.pico.source, bootrom: await buffer('bootrom.bin'), firmware: await buffer('micropython.uf2'), durationSeconds: test.durationSeconds, displays: oledConnections(document, compileCircuit(document).nodeByTerminal) }) : undefined
  parentPort!.postMessage({ type: 'phase', phase: 'circuit' })
  const engine = new Simulation(); await engine.start()
  const capture = await runCircuitCapture(engine, circuitTestRequest(document, test, 1, trace))
  parentPort!.postMessage({ type: 'result', capture })
} catch (error) { parentPort!.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
