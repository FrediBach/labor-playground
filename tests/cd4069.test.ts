import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, getPlacement, isValidFootprint, validateDocument, PARTS } from '../src/lib/circuit.ts'
import { synthDesignExamples } from '../src/lib/synth-design-examples.ts'
import { cd4069Lines, INVERTER_SECTIONS } from '../src/lib/cd4069.ts'
import { fatalSimulationMessages, requireAnalysisCompletion } from '../src/lib/simulation-results.ts'

const engine = new Simulation()
async function point(lines: string[]) {
  await engine.start()
  engine.setNetList(`CD4069 analog fixture\n${lines.join('\n')}\n.op\n.save all\n.end`)
  const result = await engine.runSim()
  requireAnalysisCompletion(result, engine.getInfo(), 'operating-point')
  assert.deepEqual(fatalSimulationMessages(engine.getError(), { analysis: 'operating-point', complete: true }), [])
  return (node: string) => result.data.find(v => v.name === `v(${node})`)!.values[0]
}

test('CD4069UB preserves DIP pinout, rotations, import and explicit supply/input checks', () => {
  for (const [hole, rotation] of [['e3', 0], ['f20', 180]] as const) assert.ok(isValidFootprint('cd4069', getPlacement('cd4069', hole, rotation)!))
  assert.equal(PARTS.cd4069.pinNames[6], 'VSS')
  assert.equal(PARTS.cd4069.pinNames[13], 'VDD')
  const original = synthDesignExamples.find(e => e.id === 'wasp-filter')!.document
  const serialized = JSON.stringify(original)
  assert.deepEqual(validateDocument(JSON.parse(serialized)), original)
  const badValue = structuredClone(original)
  badValue.parts[0].value = 2
  assert.throws(() => validateDocument(badValue), /value/)
  for (const index of [6, 13, 12]) {
    const doc = structuredClone(original)
    // Move the tested pin's external wires to an unused strip. This leaves
    // its own physical pin floating even when ground/supply fan out onward.
    const pin = doc.parts[0].pins[index]
    const nodes = compileCircuit(doc).nodeByTerminal
    const node = nodes[pin]
    const matching = doc.wires.flatMap(w => [w.from, w.to]).filter(p => nodes[p] === node && p.match(/\d+$/)?.[0] === pin.match(/\d+$/)?.[0])
    let replacement = 0
    for (const wire of doc.wires) for (const end of ['from', 'to'] as const) if (matching.includes(wire[end])) wire[end] = ['a59', 'b59'][replacement++]
    assert.ok(compileCircuit(doc).diagnostics.some(d => d.severity === 'error' && d.partId === 'U1'), `Pin ${index + 1} needs an external connection`)
  }
  const high = structuredClone(original)
  high.wires.find(w => w.from === 'vminus')!.from = 'a60'
  high.wires.find(w => w.from === 'gnd')!.from = 'vminus'
  high.wires.find(w => w.from === 'cv')!.from = 'vplus'
  assert.ok(compileCircuit(high).diagnostics.some(d => d.severity === 'error' && /3–18/.test(d.message)))
})

test('real ngspice: every unbuffered inverter has continuous midpoint gain and rail-relative behavior', async () => {
  for (const low of [0, -2]) {
    for (const input of [0, 2.49, 2.5, 2.51, 5]) {
      const pins = Array.from({ length: 14 }, (_, i) => `pin${i}`)
      pins[6] = 'low'; pins[13] = 'high'
      const lines = [`VL low 0 ${low}`, `VH high low 5`, `VI input low ${input}`]
      for (const [i, [a, out]] of INVERTER_SECTIONS.entries()) {
        pins[a] = 'input'; pins[out] = `out${i}`
      }
      const v = await point([...lines, ...cd4069Lines('U1', pins)])
      const expected = low + 2.5 * (1 - Math.tanh(40 * (input / 5 - 0.5)))
      for (let i = 0; i < 6; i++) assert.ok(Math.abs(v(`out${i}`) - expected) < 1e-6)
    }
  }
})

test('real ngspice: analog feedback self-biases at midrail and finite output resistance loads the output', async () => {
  const pins = Array.from({ length: 14 }, (_, i) => `pin${i}`)
  for (const [input] of INVERTER_SECTIONS) pins[input] = 'low'
  pins[6] = 'low'; pins[13] = 'high'; pins[0] = 'input'; pins[1] = 'out'
  const feedback = await point(['VL low 0 0', 'VH high low 5', 'RF out input 1meg', ...cd4069Lines('U1', pins)])
  assert.ok(Math.abs(feedback('out') - 2.5) < 1e-5)
  const loaded = await point(['VL low 0 0', 'VH high low 5', 'VI input low 0', 'RL out low 1k', ...cd4069Lines('U1', pins)])
  assert.ok(Math.abs(loaded('out') - 5 * 1000 / 1500) < 1e-6)
  for (const supply of [0, 2, 19]) {
    const disabled = await point(['VL low 0 -2', `VH high low ${supply}`, 'VI input low 0', ...cd4069Lines('U1', pins)])
    assert.ok(Math.abs(disabled('out') + 2) < 1e-6)
  }
})
