import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { parseSpiceLibrary, subcircuitText, validateSubcircuit, subcircuitTerminals, type SpiceSubcircuit } from '../src/lib/spice-subcircuits.ts'
import { saveCustomComponent, assignCustomComponent, duplicateCustomComponent, type SubcircuitComponent } from '../src/lib/custom-components.ts'
import { compileCircuit, createEmptyDocument, getPlacement, partDefinition, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { executionFingerprint } from '../src/lib/execution-fingerprint.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { sampleRecording } from '../src/lib/recording.ts'
import { buildSchematic } from '../src/lib/schematic.ts'

const divider = '.SUBCKT DIV IN OUT RET\nR1 IN OUT 1k\nR2 OUT RET 1k\n.ENDS DIV'
const capacitor = '.SUBCKT EXAMPLE_CAP P N\nR_ESR P internal 10\nC_MAIN internal N 1u\nR_LEAK internal N 1Meg\n.ENDS EXAMPLE_CAP'
const parse = (source: string) => parseSpiceLibrary(source).find(m => m.device === 'SUBCKT') as SpiceSubcircuit
const close = (a: number, b: number, tol = 1e-8) => assert.ok(Math.abs(a - b) < tol, `${a} differs from ${b}`)
const wire = (id: string, from: string, to: string) => ({ id, from, to, color: '#ffffff' })
function model(source = divider, pinMap?: number[]): SubcircuitComponent {
  const spice = parse(source)
  return { id: 'submodel', modelVersion: 1, baseKind: 'subcircuit', name: spice.entryPoint, spice, pinMap: pinMap ?? subcircuitTerminals(spice).map((_, index) => index) }
}
function fixture(source = divider, pinMap?: number[]): CircuitDocument {
  const def = model(source, pinMap)
  let doc = saveCustomComponent(createEmptyDocument(), def)
  const pins = getPlacement('subcircuit', subcircuitTerminals(def.spice).length === 2 ? 'a10' : 'e10', 0, doc, def.id)!
  doc = validateDocument({ ...doc, parts: [{ id: 'X1', kind: 'subcircuit', value: 1, pins, customModelId: def.id }] })
  const at = (index: number) => pins[def.pinMap[index]].replace('e', 'd').replace('f', 'g').replace('a', 'b')
  doc.wires = [wire('W1', 'cv', at(0)), wire('W2', 'gnd', at(def.pinMap.length - 1))]
  doc.probes = { CH1: pins[def.pinMap[0]], CH2: pins[def.pinMap[1]] }
  return validateDocument(doc)
}
const engine = new Simulation()
async function solve(doc: CircuitDocument, duration = .01) {
  const tr = compileCircuit(doc, 'transient', undefined, duration), dc = compileCircuit(doc, 'operating-point', undefined, duration)
  assert.deepEqual(tr.diagnostics.filter(d => d.severity === 'error'), [])
  await engine.start()
  return runCircuitCapture(engine, { type: 'run', revision: 1, durationSeconds: duration, netlist: tr.netlist, nodes: { CH1: tr.nodeByTerminal[doc.probes.CH1!], CH2: tr.nodeByTerminal[doc.probes.CH2!] }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) } })
}

test('subcircuit parser preserves local models, continuation, suffixes and independent nested scopes', () => {
  const source = '* library\n.SUBCKT ROOT A B\nX1 A mid CHILD\nX2 mid B CHILD\n.ENDS\n.SUBCKT CHILD IN OUT\nD1 IN mid DM\nR1 mid OUT 1k\n.model DM D(IS=1n\n+ N=1.5)\n.ENDS CHILD'
  const parsed = parse(source)
  assert.equal(parsed.elements.length, 4)
  assert.equal(new Set(parsed.elements.map(e => e.name)).size, 4)
  assert.equal(parsed.models.length, 2)
  assert.notEqual(parsed.elements[0].nodes[1], parsed.elements[2].nodes[1])
  assert.deepEqual(validateSubcircuit(parsed), validateSubcircuit(validateSubcircuit(parsed)))
  assert.deepEqual(validateSubcircuit(parsed), parse(subcircuitText(parsed)))
  assert.equal(parse(capacitor).elements[1].value, 1e-6)
})

test('reject malformed, recursive, unbounded or executable source and invalid saved models', () => {
  for (const source of [
    '.SUBCKT X A B\nR1 A B 1k', '.SUBCKT X A a\nR1 A a 1k\n.ENDS', '.SUBCKT X A B\nR1 A B 1k\n.ENDS OTHER',
    '.SUBCKT X A B\n.include secret\n.ENDS', '.SUBCKT X A B\nB1 A B V={v(A)}\n.ENDS', '.SUBCKT X A B\nR1 A B {R}\n.ENDS',
    '.SUBCKT X A B\nX1 A B X\n.ENDS', '.SUBCKT X A B\nX1 A B MISSING\n.ENDS', '.SUBCKT X A B\nD1 A B MISSING\n.ENDS',
    '.SUBCKT X A B\nR1 A B 1k\nr1 A B 2k\n.ENDS', '.SUBCKT X A B\nF1 A B V_MISSING 2\n.ENDS',
    '.SUBCKT X A B\nR1 A B -1\n.ENDS', '.SUBCKT X A B\nR1 A B 1k\n.control\nquit\n.endc\n.ENDS',
    `.SUBCKT X A B\n${Array.from({ length: 257 }, (_, i) => `R${i} A B 1k`).join('\n')}\n.ENDS`,
  ]) assert.throws(() => parseSpiceLibrary(source), undefined, source.slice(0, 100))
  const invalid = parse(divider); invalid.elements[0].nodes[0] = 'A\n.control'
  assert.throws(() => validateSubcircuit(invalid))
  assert.throws(() => validateSubcircuit({ ...parse(divider), ground: true }), /ground/)
  assert.throws(() => saveCustomComponent(createEmptyDocument(), model(divider, [0, 0, 2])), /unique/)
})

test('custom pin mapping, NC pins, schema roundtrip and execution identity stay coherent', () => {
  const doc = fixture(divider, [2, 0, 1]), def = doc.customComponents![0] as SubcircuitComponent
  assert.deepEqual(partDefinition(doc, doc.parts[0]).pinNames, ['OUT', 'RET', 'IN', 'NC'])
  const exported = JSON.stringify(doc)
  assert.deepEqual(validateDocument(JSON.parse(exported)), doc)
  assert.throws(() => assignCustomComponent(doc, 'X1'), /no built-in model/)
  const copy = duplicateCustomComponent(doc, def.id, 'X1')
  assert.equal(copy.document.customComponents!.length, 2)
  assert.notEqual(copy.document.parts[0].customModelId, def.id)
  const renamed = saveCustomComponent(doc, { ...def, name: 'Renamed', description: 'Notes', spice: { ...def.spice, entryPoint: 'RENAMED' } })
  assert.equal(executionFingerprint(doc, .1), executionFingerprint(renamed, .1))
  assert.equal(compileCircuit(doc).netlist, compileCircuit(renamed).netlist)
  const remapped = saveCustomComponent(doc, { ...def, pinMap: [0, 2, 1] })
  assert.notEqual(executionFingerprint(doc, .1), executionFingerprint(remapped, .1))
  assert.deepEqual(buildSchematic(doc).symbols[0].pins.map(p => p.name), ['OUT', 'RET', 'IN', 'NC'])
  assert.deepEqual(getPlacement('subcircuit', 'f11', 180, doc, def.id), ['f11', 'f10', 'e10', 'e11'])
})

test('real imported divider measures every port current and total power without requiring unused package pins', async () => {
  const doc = fixture(divider, [2, 0, 1])
  const capture = await solve(doc), reading = capture.operatingPoint!.parts.X1
  close(capture.channels.CH2.at(-1)!, 2.5)
  assert.deepEqual(reading.currents.map(c => c.label), ['Into pin 3 (IN)', 'Into pin 1 (OUT)', 'Into pin 2 (RET)'])
  close(reading.currents[0].value, .0025); close(reading.currents[1].value, 0); close(reading.currents[2].value, -.0025)
  close(reading.power!, .0125)
  assert.equal(capture.recording!.parts[0].nodes.length, 3)
})

test('real capacitor macromodel retains ESR, leakage, charge trajectory and signed terminal currents', async () => {
  const doc = fixture(capacitor)
  doc.parts.push({ id: 'R1', kind: 'resistor', value: 1000, pins: ['a3', 'a7'] })
  doc.wires[0] = wire('W1', 'osc', 'b3')
  doc.wires.push(wire('W3', 'b7', 'b10'))
  doc.probes = { CH1: 'a3', CH2: 'a10' }; doc.stimulus = 'step'
  const capture = await solve(validateDocument(doc))
  const amp = doc.instruments.amplitude, initial = amp * 10 / 1110, final = amp * 1000010 / 1001110, tau = 1e-6 * 1e6 * 1110 / 1001110
  for (const t of [.0015, .002, .003, .005]) {
    const point = sampleRecording(capture, t)!
    const voltage = point.nodeVoltages[compileCircuit(doc).nodeByTerminal.a10]
    close(voltage, final + (initial - final) * Math.exp(-(t - .0010005) / tau), .001)
    close(point.parts.X1.currents[0].value, point.parts.R1.currents[0].value)
    close(point.parts.X1.currents[1].value, -point.parts.R1.currents[0].value)
  }
  const dcDoc = fixture(capacitor), dc = await solve(dcDoc)
  close(dc.operatingPoint!.parts.X1.currents[0].value, 5 / 1000010)
})

test('global node 0 requires a visible reference and linear controlled sources solve with correct port power', async () => {
  const doc = fixture('.SUBCKT AMP IN OUT\nRIN IN 0 1Meg\nEGAIN OUT 0 IN 0 2\nROUT OUT 0 10k\n.ENDS')
  assert.equal((doc.customComponents![0] as SubcircuitComponent).spice.ground, true)
  const capture = await solve(doc)
  close(capture.channels.CH2.at(-1)!, 10)
  const disconnected = structuredClone(doc); disconnected.wires.pop()
  assert.ok(compileCircuit(disconnected).diagnostics.some(d => d.severity === 'error' && /reference pin/.test(d.message)))
  const floating = fixture('.SUBCKT FLOAT A B\nR1 A B 1k\nC1 A floating 1u\n.ENDS')
  assert.ok(compileCircuit(floating).diagnostics.some(d => /internal subcircuit node/.test(d.message)))
})

test('real linear E/G/F/H sources and inductors preserve their numeric laws', async () => {
  for (const [body, expected] of [
    ['RIN IN RET 1Meg\nE1 OUT RET IN RET 2\nRO OUT RET 1k', 10],
    ['RIN IN RET 1Meg\nG1 OUT RET IN RET 1m\nRO OUT RET 1k', -5],
    ['VS IN inner 0\nRI inner RET 1k\nF1 OUT RET VS 2\nRO OUT RET 1k', -10],
    ['VS IN inner DC 0\nRI inner RET 1k\nH1 OUT RET VS 1k\nRO OUT RET 1k', 5],
    ['RIN IN RET 1Meg\nI1 OUT RET DC 1m\nRO OUT RET 1k', -1],
    ['L1 IN OUT 1m\nRO OUT RET 1k', 5],
  ] as const) {
    const capture = await solve(fixture(`.SUBCKT CELL IN OUT RET\n${body}\n.ENDS`))
    close(capture.channels.CH2.at(-1)!, expected, 1e-6)
  }
})

test('real nested instances remain independent and expanded circuits retain resource limits', async () => {
  const nested = '.SUBCKT ROOT IN OUT RET\nX1 IN OUT CHILD\nX2 OUT RET CHILD\n.ENDS\n.SUBCKT CHILD P N\nR1 P N 1k\n.ENDS'
  const doc = fixture(nested)
  const capture = await solve(doc)
  close(capture.channels.CH2.at(-1)!, 2.5)
  const source = `.SUBCKT MANY P N\n${Array.from({ length: 250 }, (_, i) => `R${i} P N 1Meg`).join('\n')}\n.ENDS`
  let many = saveCustomComponent(createEmptyDocument(), model(source))
  many = validateDocument({ ...many, parts: Array.from({ length: 5 }, (_, i) => ({ id: `X${i}`, kind: 'subcircuit', value: 1, customModelId: 'submodel', pins: [`a${i + 1}`, `f${i + 1}`] })) })
  assert.ok(compileCircuit(many).diagnostics.some(d => /netlist resource limit/.test(d.message)))
})

test('embedded diode and bipolar models retain their nonlinear laws and substrate reference', async () => {
  const diode = fixture('.model DM D(IS=1n N=1.5)\n.SUBCKT CELL IN OUT RET\nR1 IN OUT 1k\nD1 OUT RET DM\n.ENDS')
  const diodeCapture = await solve(diode), voltage = diodeCapture.channels.CH2.at(-1)!
  const current = (5 - voltage) / 1000
  close(voltage, 1.5 * 8.617333262e-5 * 300.15 * Math.log(current / 1e-9 + 1), 2e-5)
  close(diodeCapture.operatingPoint!.parts.X1.currents[0].value, current)
  for (const [kind, sign, substrate] of [['NPN', 1, ''], ['PNP', -1, 'RET']] as const) {
    // Keep the collector above the base so BF is tested in forward-active operation.
    const doc = fixture(`.SUBCKT AMP VCC OUT BASE RET\nRC VCC OUT 1k\nRB VCC BASE 200k\nQ1 OUT BASE RET ${substrate} QM\n.model QM ${kind}(IS=10f BF=150)\n.ENDS`)
    const def = doc.customComponents![0] as SubcircuitComponent
    assert.equal(def.spice.ground, substrate === '')
    if (def.spice.ground) doc.wires.push(wire('WE', doc.parts[0].pins[def.pinMap[4]].replace('f', 'h'), doc.parts[0].pins[def.pinMap[3]].replace('f', 'g')))
    doc.instruments.cv = sign * 5
    const capture = await solve(doc), reading = capture.operatingPoint!.parts.X1
    const collector = capture.channels.CH2.at(-1)!
    const baseNode = compileCircuit(doc).nodeByTerminal[doc.parts[0].pins[def.pinMap[2]]]
    const base = capture.operatingPoint!.nodeVoltages[baseNode]
    const ic = (sign * 5 - collector) / 1000, ib = (sign * 5 - base) / 200000
    close(ic / ib, 150, .01)
    close(reading.currents[0].value, ic + ib)
    close(reading.currents.reduce((sum, port) => sum + port.value, 0), 0)
    close(reading.power!, sign * 5 * (ic + ib))
  }
})
