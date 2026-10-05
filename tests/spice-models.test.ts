import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { parseSpiceModels, spiceModelText, validateSpiceModel } from '../src/lib/spice-models.ts'
import { assignCustomComponent, deleteCustomComponent, duplicateCustomComponent, saveCustomComponent, type SpiceComponent } from '../src/lib/custom-components.ts'
import { compileCircuit, createEmptyDocument, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { executionFingerprint } from '../src/lib/execution-fingerprint.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { programFor } from '../src/lib/automation-migration.ts'
import { sampleRecording } from '../src/lib/recording.ts'

const close = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`)
const wire = (id: string, from: string, to: string) => ({ id, from, to, color: '#ffffff' })
function definition(source = '.model 1N_test D(IS=1n N=1.5 RS=2 CJO=4p)'): SpiceComponent {
  const spice = parseSpiceModels(source)[0]
  return { id: 'imported', name: spice.entryPoint, modelVersion: 1, baseKind: spice.device === 'D' ? 'diode' : spice.device === 'NPN' ? 'npn' : 'pnp', spice }
}
function diode(): CircuitDocument {
  return saveCustomComponent({ ...createEmptyDocument(), parts: [
    { id: 'R1', kind: 'resistor', value: 1000, pins: ['a6', 'a16'] },
    { id: 'D-a_b', kind: 'diode', value: 1, pins: ['c16', 'c26'], customModelId: 'imported' },
  ], wires: [wire('W1', 'cv', 'b6'), wire('W2', 'gnd', 'b26')], probes: { CH1: 'd6', CH2: 'd16' } }, definition())
}
const engine = new Simulation()
async function solve(doc: CircuitDocument) {
  const tr = compileCircuit(doc, 'transient', undefined, .002), dc = compileCircuit(doc, 'operating-point', undefined, .002)
  assert.deepEqual(tr.diagnostics.filter(d => d.severity === 'error'), [])
  await engine.start()
  return runCircuitCapture(engine, { type: 'run', revision: 1, durationSeconds: .002, netlist: tr.netlist, nodes: { CH1: tr.nodeByTerminal[doc.probes.CH1!], CH2: tr.nodeByTerminal[doc.probes.CH2!] }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) } })
}

test('SPICE import reads case, comments, continuation lines, multiple entries and engineering suffixes', () => {
  const models = parseSpiceModels('\uFEFF* Library\r\n.model 1N4148 d (is=2.52n\r\n+ n=1.752, rs=568m cjo=4p) ; comment\r\n.MODEL Q_TEST NPN BF=200 VAF=100Meg $ comment')
  assert.equal(models.length, 2)
  close(models[0].parameters.IS, 2.52e-9, 1e-22)
  close(models[0].parameters.RS, .568, 1e-14)
  assert.equal(models[1].parameters.VAF, 1e8)
  assert.deepEqual(parseSpiceModels(spiceModelText(models[0]))[0], models[0])
  assert.equal(parseSpiceModels('.model M D')[0].device, 'D')
})

test('unsupported or malformed models fail explicitly without dropping parameters or executing directives', () => {
  for (const source of ['', '+ IS=1n', '.include "x.lib"', '.subckt X A B\n.ends', '.model X NMOS(VTO=2)', '.model X D(IS={a})', '.model X D(IS=1e999)', '.model X D(IS=1n IS=2n)', '.model X D(UNKNOWN=2)', '.model X D(LEVEL=2)', '.model X D(N=0)', '.model X D(RS=-1)', '.model X D(FC=1)', '.model X D(TNOM=-274)', '.model X D(IS=1n)\n.control\nquit', '.model X D\n.model x D', '.model X D(IS=1n))', '.model X D(IS=1nan)', '*'.repeat(64001)]) assert.throws(() => parseSpiceModels(source), undefined, source.slice(0, 70))
  assert.throws(() => validateSpiceModel({ device: 'D', entryPoint: 'X\n.end', parameters: {} }))
  assert.throws(() => validateSpiceModel({ device: 'D', entryPoint: 'X', parameters: { IS: '1n' } }))
  assert.throws(() => validateSpiceModel({ device: '__proto__', entryPoint: 'X', parameters: {} }))
})

test('models use the shared project lifecycle, validation, isolated solver names and semantic identity', () => {
  const doc = diode()
  const exported = JSON.stringify(doc)
  assert.deepEqual(validateDocument(JSON.parse(exported)), doc)
  for (const schemaVersion of [3, 4]) assert.equal(validateDocument({ ...doc, schemaVersion, ...(schemaVersion === 4 ? { automationProgram: programFor(doc) } : {}) }).customComponents!.length, 1)
  assert.throws(() => validateDocument({ ...doc, schemaVersion: 2 }), /schema version 3/)
  assert.throws(() => saveCustomComponent(doc, { ...definition(), baseKind: 'npn' }), /match/)
  assert.throws(() => assignCustomComponent(doc, 'R1', 'imported'), /incompatible/)
  assert.throws(() => deleteCustomComponent(doc, 'imported'), /Reassign/)
  const copied = duplicateCustomComponent(doc, 'imported', 'D-a_b')
  assert.notEqual(copied.model.id, 'imported')
  assert.equal(deleteCustomComponent(copied.document, 'imported').customComponents!.length, 1)
  const renamed = saveCustomComponent(doc, { ...definition(), name: 'Display\n.end', description: '.control\nquit', spice: { ...definition().spice, entryPoint: 'renamed' } })
  assert.equal(executionFingerprint(doc, .1), executionFingerprint(renamed, .1))
  assert.equal(compileCircuit(doc).netlist, compileCircuit(renamed).netlist)
  assert.ok(!compileCircuit(renamed).netlist.includes('.control'))
  const changed = saveCustomComponent(doc, definition('.model 1N_test D(IS=1n N=2 RS=2 CJO=4p)'))
  assert.notEqual(executionFingerprint(doc, .1), executionFingerprint(changed, .1))
  assert.notEqual(compileCircuit(doc).netlist, compileCircuit(changed).netlist)
  assert.equal(assignCustomComponent(doc, 'D-a_b').parts[1].customModelId, undefined)
})

test('real imported diode matches its exponential law, signed currents, power and transient KCL', { timeout: 30_000 }, async () => {
  const doc = diode()
  const capture = await solve(doc)
  const reading = capture.operatingPoint!.parts['D-a_b']
  const current = reading.currents[0].value
  const voltage = capture.operatingPoint!.nodeVoltages[compileCircuit(doc).nodeByTerminal.d16]
  close(current, (5 - voltage) / 1000, 1e-8)
  // ngspice defaults to 27 °C. Series resistance adds I*Rs to junction voltage.
  const expected = 1.5 * 8.617333262e-5 * 300.15 * Math.log(current / 1e-9 + 1) + current * 2
  close(voltage, expected, 2e-5)
  close(reading.power!, voltage * current, 1e-8)
  doc.parts[1].pins.reverse()
  const reverse = await solve(doc)
  close(reverse.operatingPoint!.parts['D-a_b'].currents[0].value, -1e-9, 1e-11)
  doc.parts[1].pins.reverse(); doc.wires[0].from = 'osc'; doc.instruments.frequency = 1000
  const transient = await solve(doc)
  for (let i = 0; i < transient.time.length; i += 19) {
    const point = sampleRecording(transient, transient.time[i])!
    close(point.parts.R1.currents[0].value, point.parts['D-a_b'].currents[0].value, 1e-8)
  }
})

test('real imported NPN and PNP preserve gain, signed terminal currents, power and cutoff', { timeout: 30_000 }, async () => {
  for (const kind of ['npn', 'pnp'] as const) {
    const sign = kind === 'npn' ? 1 : -1
    const doc = saveCustomComponent({ ...createEmptyDocument(), instruments: { ...createEmptyDocument().instruments, cv: sign * 5 }, parts: [
      { id: 'Q-a_b', kind, value: 1, pins: ['a10', 'a11', 'a12'], customModelId: 'imported' },
      { id: 'RC', kind: 'resistor', value: 1000, pins: ['c5', 'c10'] },
      { id: 'RB', kind: 'resistor', value: 100000, pins: ['c20', 'c11'] },
    ], wires: [wire('W1', sign === 1 ? 'vplus' : 'vminus', 'b5'), wire('W2', 'cv', 'b20'), wire('W3', 'gnd', 'b12')], probes: { CH1: 'd11', CH2: 'd10' } }, definition(`.model TEST ${kind}(IS=10f BF=150 BR=1 CJE=10p CJC=4p CJS=10n TF=0.5n TR=10n)`))
    const capture = await solve(doc)
    const reading = capture.operatingPoint!.parts['Q-a_b'], [ic, ib] = reading.currents.map(c => c.value)
    const nodes = compileCircuit(doc).nodeByTerminal
    const collector = capture.operatingPoint!.nodeVoltages[nodes.d10], base = capture.operatingPoint!.nodeVoltages[nodes.d11]
    close(ic / ib, 150, .01)
    close(ic, (sign * 12 - collector) / 1000, 1e-8)
    close(ib, (sign * 5 - base) / 100000, 1e-8)
    close(reading.power!, collector * ic + base * ib, 1e-8)
    const point = sampleRecording(capture, .002)!
    close(point.parts['Q-a_b'].currents[0].value, ic, 1e-8)
    doc.instruments.cv = 0
    const cutoff = await solve(doc)
    assert.ok(Math.abs(cutoff.operatingPoint!.parts['Q-a_b'].currents[0].value) < 1e-8)
    // Move the emitter with a signal: substrate current must return through the
    // explicit emitter terminal, not an implicit global-ground connection.
    doc.instruments.cv = sign * 5
    doc.instruments.amplitude = .2; doc.instruments.frequency = 1000
    doc.parts.push({ id: 'RE', kind: 'resistor', value: 10, pins: ['c12', 'c25'] })
    doc.wires[2] = wire('W3', 'osc', 'b25')
    const dynamic = await solve(validateDocument(doc))
    for (let i = 0; i < dynamic.time.length; i += 19) {
      const parts = sampleRecording(dynamic, dynamic.time[i])!.parts
      const [collectorCurrent, baseCurrent] = parts['Q-a_b'].currents.map(current => current.value)
      close(parts.RE.currents[0].value, collectorCurrent + baseCurrent, 1e-8)
      close(parts.RC.currents[0].value, collectorCurrent, 1e-8)
      close(parts.RB.currents[0].value, baseCurrent, 1e-8)
    }
  }
})
