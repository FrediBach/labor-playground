import { readFileSync } from 'node:fs'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, examples } from '../src/lib/circuit.ts'

// Snapshotted compiler output from before recording/long-duration support.
// Extending only its stop time demonstrates the old solver/storage policy;
// the old application itself rejected these >50,000-sample results.
const before = JSON.parse(readFileSync(new URL('./fixtures/simulation-before.json', import.meta.url), 'utf8')) as Record<string, string>
const engine = new Simulation()
await engine.start()
const seconds = Number(process.argv[2] ?? 10)
for (const [id, baseline] of Object.entries(before)) {
  const document = examples.find(example => example.id === id)!.document
  const compiled = compileCircuit(document, 'transient', undefined, seconds)
  const error = compiled.diagnostics.find(item => item.severity === 'error')
  if (error) throw new Error(error.message)
  for (const [variant, netlist] of [
    ['before', baseline.replace(/(\.tran \S+) 0\.1/, `$1 ${seconds}`)],
    ['after', compiled.netlist],
  ]) {
    engine.setNetList(netlist)
    const started = performance.now()
    const result = await engine.runSim()
    const elapsedMs = performance.now() - started
    if (result.dataType !== 'real') throw new Error('Expected a real transient recording.')
    const time = result.data.find(vector => vector.type === 'time')!.values
    if (Math.abs(time.at(-1)! - seconds) > 1e-9) throw new Error('Incomplete benchmark recording.')
    console.log(JSON.stringify({ id, variant, seconds, elapsedMs: Math.round(elapsedMs), samples: result.numPoints,
      vectors: result.numVariables, numericMiB: Number((result.numPoints * result.numVariables * 8 / 1024 ** 2).toFixed(3)) }))
  }
}
