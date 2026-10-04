import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { boardGeometry, compileCircuit, examples, getPlacement, isValidFootprint, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { circuitTestRequest } from '../src/lib/circuit-test-request.ts'
import { applyFixture, runCircuitTest, runCircuitTestSuite } from '../src/lib/circuit-tests.ts'
import { buildKicadExport } from '../src/lib/kicad-export.ts'
import { interpolateVoltage } from '../src/lib/measurements.ts'
import { PROJECT_LIMITS } from '../src/lib/project-limits.ts'
import { sampleRecording } from '../src/lib/recording.ts'
import { buildSchematic } from '../src/lib/schematic.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { extractCapture } from '../src/lib/simulation-results.ts'
import { SIMULATION_LIMITS, type Capture } from '../src/lib/simulation-types.ts'
import { changeoverPoles, ssi2162Lines } from '../src/lib/utility-cell-models.ts'

const example = () => structuredClone(examples.find(e => e.id === 'cascadable-utility-cell')!.document)
const part = (doc: CircuitDocument, id: string) => doc.parts.find(p => p.id === id)!
const engine = new Simulation()
async function capture(doc: CircuitDocument, automate = false, duration = .1) {
  const tran = compileCircuit(doc, 'transient', undefined, duration), dc = compileCircuit(doc, 'operating-point', undefined, duration)
  assert.deepEqual(tran.diagnostics, [])
  await engine.start()
  return runCircuitCapture(engine, { type: 'run', revision: 1, netlist: tran.netlist, durationSeconds: duration,
    nodes: { CH1: tran.nodeByTerminal[doc.probes.CH1!], CH2: tran.nodeByTerminal[doc.probes.CH2!] },
    operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) },
    ...(automate ? { automation: { document: doc } } : {}),
  })
}
function at(doc: CircuitDocument, c: Capture, signal: string, seconds: number) {
  const binding = doc.automationProgram!.signals.find(s => s.id === signal)!
  assert.equal(binding.kind, 'voltage')
  if (binding.kind !== 'voltage') throw new Error('Expected terminal signal')
  const node = compileCircuit(doc).nodeByTerminal[binding.positive]
  return interpolateVoltage(c.time, c.recording!.nodeVoltages[node], seconds)!
}

test('the utility document preserves the proposal, physical wiring, saved suite and exports', () => {
  const doc = example()
  const serialized = JSON.stringify(doc, null, 2)
  assert.deepEqual(validateDocument(JSON.parse(serialized)), doc)
  assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/examples/cascadable-utility-cell.json', import.meta.url), 'utf8')), doc)
  assert.deepEqual(compileCircuit(doc).diagnostics, [])
  assert.equal(doc.parts.length, 112)
  assert.ok(new TextEncoder().encode(serialized).length < PROJECT_LIMITS.bytes)
  const occupied = [...doc.parts.flatMap(p => p.pins), ...doc.wires.flatMap(w => [w.from, w.to])]
  assert.equal(new Set(occupied).size, occupied.length, 'Every lead and jumper has its own physical hole')
  const geometry = boardGeometry(doc)
  for (const p of doc.parts) {
    assert.ok(isValidFootprint(p.kind, p.pins, doc), p.id)
    if (p.pins.length === 2) {
      const [a, b] = p.pins.map(pin => geometry.terminalById[pin])
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= 192, `${p.id} editable lead span`)
    }
  }
  const nodes = compileCircuit(doc).nodeByTerminal
  const net = (id: string, pin: number) => nodes[part(doc, id).pins[pin - 1]]
  for (const cell of ['A', 'B']) {
    assert.equal(part(doc, `${cell}_R6`).value, 110)
    assert.equal(part(doc, `${cell}_C1`).value, 2.2e-9)
    assert.equal(net(`${cell}_R6`, 2), net(`${cell}_C1`, 1), 'Input shunt is series RC')
    assert.equal(net(`${cell}_R16`, 2), net(`${cell}_R17`, 1), 'Local feedback senses after protection')
    assert.equal(net(`${cell}_R23`, 1), net(`${cell}_R21`, 1), 'SUM feedback senses before protection')
    assert.equal(net(`${cell}_C15`, 1), nodes.gnd, 'Negative bulk capacitor positive lead is grounded')
    assert.equal(net(`${cell}_C15`, 2), nodes.vminus)
  }
  assert.equal(net('B_IN', 1), net('A_U1', 1), 'SOURCE is taken before processing')
  assert.equal(net('B_R18', 1), net('A_SUM', 2), 'MIX goes through the SUM normal contact')
  assert.notEqual(net('B_IN', 1), net('A_R16', 2), 'OUT load cannot become the SOURCE link')
  assert.equal(buildSchematic(doc).symbols.length, doc.parts.length)
  const exported = buildKicadExport(doc).files.map(f => f.content).join('\n')
  for (const name of ['SSI2162', 'OPA4197', 'OPA197', 'A~common', 'Throw~0']) assert.ok(exported.includes(name), name)
})

test('new parts validate rotated placement, explicit supplies, omitted pins and bounded controls', () => {
  for (const kind of ['ssi2162', 'opa197', 'opa4197', 'spdt', 'dpdt'] as const) for (const [pin, rotation] of [['e12', 0], ['f20', 180]] as const) {
    assert.ok(isValidFootprint(kind, getPlacement(kind, pin, rotation)!), `${kind} ${rotation}`)
  }
  for (const [id, pin] of [['A_U4', 5], ['A_U4', 6], ['A_U4', 10], ['A_U1', 4], ['A_U3', 7]] as const) {
    const doc = example()
    const lead = part(doc, id).pins[pin - 1]
    const strip = boardGeometry(doc).terminalById[lead].group
    doc.wires = doc.wires.filter(w => ![w.from, w.to].some(t => boardGeometry(doc).terminalById[t].group === strip))
    assert.ok(compileCircuit(doc).diagnostics.some(d => d.severity === 'error' && d.partId === id), `${id} supply pin ${pin}`)
  }
  const invalid = example()
  part(invalid, 'A_SW1').value = .5
  assert.throws(() => validateDocument(invalid), /either open/)
  part(invalid, 'A_SW1').value = 0
  part(invalid, 'DREF').value = 3
  assert.throws(() => validateDocument(invalid), /2.5 V or 5 V/)
  assert.throws(() => validateDocument({ ...example(), parts: Array(PROJECT_LIMITS.parts + 1).fill({}) }), /128 components/)
  assert.throws(() => validateDocument({ ...example(), wires: Array(PROJECT_LIMITS.wires + 1).fill({}) }), /384 wires/)
})

test('real ngspice: all saved utility tests pass and a broken gain ratio fails', { timeout: 120_000 }, async () => {
  const doc = example(), saved = structuredClone(doc)
  await engine.start()
  const suite = await runCircuitTestSuite(doc, (d, t) => runCircuitCapture(engine, circuitTestRequest(d, t, 1)))
  assert.deepEqual(suite.reports.map(r => [r.name, r.verdict]), doc.automationProgram!.tests.map(t => [t.name, 'passed']))
  assert.deepEqual(doc, saved, 'Fixtures and automation leave the saved circuit unchanged')
  part(doc, 'B_R9').value = 20_000
  const broken = await runCircuitTest(doc, doc.automationProgram!.tests[0], (d, t) => runCircuitCapture(engine, circuitTestRequest(d, t, 2)))
  assert.equal(broken.verdict, 'failed', broken.message)
})

test('real ngspice: default audio capture obeys every routing event and stays within recording budgets', { timeout: 60_000 }, async context => {
  const doc = example(), saved = structuredClone(doc), started = performance.now()
  const c = await capture(doc, true)
  assert.equal(c.automationRun!.status, 'done')
  assert.equal(c.time.at(-1), .1)
  assert.equal(c.automationEvents!.length, 6)
  const state = (t: number) => sampleRecording(c, t)!
  for (const seconds of [.0025, .0225, .0425, .0525, .0625, .0725, .0925]) {
    const x = at(doc, c, 'A_x', seconds)
    const direct = seconds > .045 && seconds < .06
    const a = seconds < .01 ? .5 : 1, offset = seconds < .03 ? 0 : 1
    const p = a * x + offset
    assert.ok(Math.abs(at(doc, c, 'A_out', seconds) - (direct ? x : p)) < .01)
    const bx = seconds < .085 ? x : 2
    const expected = .5 * bx + (seconds >= .07 || direct ? 0 : p)
    assert.ok(Math.abs(at(doc, c, 'B_sum', seconds) - expected) < .01, `${seconds}: positive sum ${expected}`)
  }
  assert.equal(state(.05).parts.A_U4.power, null, 'VCA supply consumption is not inferred')
  for (const [pole] of changeoverPoles('dpdt').entries()) {
    const before = state(.04).parts.A_SW1.currents[pole * 2 + 1].value
    const after = state(.05).parts.A_SW1.currents[pole * 2].value
    assert.ok(Math.abs(before) < 1e-7 && Math.abs(after) < 1e-7, 'Unselected contacts retain only modeled leakage')
  }
  const values = c.time.length + Object.values(c.recording!.nodeVoltages).reduce((sum, a) => sum + a.length, 0) + Object.values(c.recording!.currents).reduce((sum, a) => sum + a.length, 0)
  assert.ok(values < SIMULATION_LIMITS.maxRecordedValues)
  assert.deepEqual(doc, saved)
  context.diagnostic(`Two cells: ${doc.parts.length} parts, ${doc.wires.length} wires, ${c.time.length} samples, ${(values * 8 / 1e6).toFixed(2)} MB numeric recording, ${Math.round(performance.now() - started)} ms including flow solves`)
})

test('real ngspice: OUT DC feedback compensates loading, while SUM retains its series loss and finite headroom', { timeout: 30_000 }, async () => {
  const base = example()
  const doc = applyFixture(base, base.automationProgram!.tests[0].fixture)
  part(doc, 'B_TAP').value = 1
  const loaded = await capture(doc)
  assert.ok(Math.abs(at(doc, loaded, 'B_out', .09) - 2) < .005)
  const raw = at(doc, loaded, 'B_S', .09), sum = at(doc, loaded, 'B_sum', .09)
  assert.ok(Math.abs(sum / raw - 1_000_001 / 1_000_101) < 2e-7, '100 Ω R23 and 1 Ω contact load a 1 MΩ next MIX input')
  doc.instruments.cv = 5
  // Start in the specified linear operating region, then drive an earlier
  // accumulated sum beyond its rails within one continuous trajectory.
  doc.automationProgram!.captureFlowId = 'Headroom'
  doc.automationProgram!.definitions.push({
    id: 'Headroom', name: 'Overload accumulated SUM', inputs: [], outputs: [], conflictPolicy: 'error', layout: {},
    nodes: [
      { id: 'Start', kind: 'start', label: 'Start', order: 0 },
      { id: 'A', kind: 'action', label: 'A offset to +5 V', order: 1, action: { target: 'potentiometer', partId: 'A_P2', value: 1, durationMs: 20 } },
      { id: 'B', kind: 'action', label: 'B offset to +5 V', order: 2, action: { target: 'potentiometer', partId: 'B_P2', value: 1, durationMs: 20 } },
      { id: 'End', kind: 'finish', label: 'Finish', order: 3, outputs: {} },
    ],
    edges: [['Start', 'A'], ['A', 'B'], ['B', 'End']].map(([source, target], i) => ({ id: `E${i}`, source, target, outcome: 'done' })),
  })
  const clipped = await capture(doc, true)
  assert.ok(at(doc, clipped, 'B_S', .09) > 11 && at(doc, clipped, 'B_S', .09) < 12, 'An accumulated 15 V demand clips on ±12 V')
})

test('real ngspice: SSI2162 reference loop gives gains 0, 0.5, 1 and 2 including +10 V CV', { timeout: 15_000 }, async () => {
  // Independent current-mode fixture: the same R3/R4/R5, Q1 and compensation
  // as the proposal. Ideal lab references isolate the VCA law from pot error.
  for (const cv of [-2, 0, 2.5, 5, 10]) {
    const nodes = ['mode', 'refin', 'ctl', 'sum', '0', 'vn', 'tia', 'ctl', 'signal', 'vp']
    await engine.start()
    engine.setNetList(['SSI2162 linear control fixture', 'VP vp 0 12', 'VN vn 0 -12', 'VREF ref 0 -5', `VCV cv 0 ${cv}`, 'VIN input 0 1', 'VCLAMP clamp 0 2.71',
      'R3 cv sum 100k', 'R4 ref refin 100k', 'R5 drive ctl 1k', 'R6 refin shunt1 110', 'C1 shunt1 0 2.2n', 'R7 signal shunt2 110', 'C2 shunt2 0 2.2n', 'C3 sum drive 100p',
      '.model PNP PNP(Is=1e-14 Bf=100 Vaf=100)', 'Q1 sum clamp ctl PNP',
      'BCTRL control 0 V=(-1e4*v(sum))/sqrt(1+pow(1e4*v(sum)/11.9,2))', 'RCP control cpole 1k', 'CCP cpole 0 159.154943n', 'RCO cpole drive 50',
      'R8 input signal 10k', 'R9 output tia 10k', 'C4 output tia 100p', 'BTIA transimpedance 0 V=(-1e4*v(tia))/sqrt(1+pow(1e4*v(tia)/11.9,2))', 'RTP transimpedance tpole 1k', 'CTP tpole 0 159.154943n', 'RTO tpole output 50',
      ...ssi2162Lines('U4', nodes), '.tran 10u 1m', '.save all', '.end'].join('\n'))
    const c = extractCapture(await engine.runSim(), { CH1: 'input', CH2: 'output' }, 1, 0)
    assert.equal(c.time.at(-1), .001, 'Fixture completes; stale or partial results are not evidence')
    const expected = -Math.max(0, cv / 5)
    assert.ok(Math.abs(c.channels.CH2.at(-1)! - expected) < .002, `${cv} V control: expected ${expected}, got ${c.channels.CH2.at(-1)}`)
  }
})
