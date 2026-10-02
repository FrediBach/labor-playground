import assert from 'node:assert/strict'
import test from 'node:test'
import { Simulation } from 'eecircuit-engine'
import { compileCircuit, createEmptyDocument, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { customTemplate, saveCustomComponent, assignCustomComponent, duplicateCustomComponent, deleteCustomComponent, validateCustomComponents } from '../src/lib/custom-components.ts'
import { curveValue, curveIntegral } from '../src/lib/characteristic-curves.ts'
import { operatingPointDescriptors } from '../src/lib/simulation-descriptors.ts'
import { runCircuitCapture } from '../src/lib/simulation-analysis.ts'
import { sampleRecording } from '../src/lib/recording.ts'

const close = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`)
function fixture(kind: 'resistor' | 'capacitor', points: { x: number; y: number }[]) {
  const model = customTemplate(kind)
  model.characteristic.points = points
  const document = saveCustomComponent({ ...createEmptyDocument(), parts: [{ id: 'X-a_b', kind, value: kind === 'resistor' ? 1000 : 1e-6, pins: ['a1', 'a4'], customModelId: model.id }], wires: [{ id: 'W1', from: 'cv', to: 'b1', color: '#ffffff' }, { id: 'W2', from: 'gnd', to: 'b4', color: '#ffffff' }], probes: { CH1: 'c1', CH2: 'c4' } }, model)
  return document
}
const engine = new Simulation()
async function solve(document: CircuitDocument, durationSeconds = 0.002, automation = false) {
  const tr = compileCircuit(document, 'transient', undefined, durationSeconds), dc = compileCircuit(document, 'operating-point', undefined, durationSeconds)
  assert.deepEqual(tr.diagnostics.filter(d => d.severity === 'error'), [])
  assert.deepEqual(dc.diagnostics.filter(d => d.severity === 'error'), [])
  await engine.start()
  return runCircuitCapture(engine, { type: 'run', revision: 1, netlist: tr.netlist, durationSeconds, nodes: { CH1: tr.nodeByTerminal[document.probes.CH1!], CH2: tr.nodeByTerminal[document.probes.CH2!] }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(document, dc.nodeByTerminal) }, ...(automation ? { automation: { document } } : {}) })
}

test('schema 3 validates references, nominal values, versions and atomic model lifecycle', () => {
  const doc = fixture('resistor', [{ x: 0, y: 1234 }, { x: 0.01, y: 2000 }])
  assert.equal(doc.schemaVersion, 3)
  assert.equal(doc.parts[0].value, 1234)
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))), doc)
  for (const schemaVersion of [1, 2]) assert.throws(() => validateDocument({ ...doc, schemaVersion }), /schema version 3/)
  assert.throws(() => validateDocument({ ...doc, customComponents: [] }), /Missing or incompatible/)
  assert.throws(() => validateDocument({ ...doc, parts: [{ ...doc.parts[0], kind: 'capacitor', value: 1e-6 }] }), /incompatible/)
  assert.throws(() => validateCustomComponents([{ ...doc.customComponents![0], modelVersion: 2 }]), /version/)
  assert.throws(() => deleteCustomComponent(doc, doc.customComponents![0].id), /Reassign or remove/)
  const copied = duplicateCustomComponent(doc, doc.customComponents![0].id, doc.parts[0].id)
  assert.equal(copied.document.parts[0].customModelId, copied.model.id)
  assert.equal(copied.document.customComponents!.length, 2)
  const linear = assignCustomComponent(doc, doc.parts[0].id)
  assert.equal(linear.parts[0].customModelId, undefined)
  assert.equal(linear.parts[0].value, 1234)
  assert.equal(deleteCustomComponent(linear, doc.customComponents![0].id).customComponents!.length, 0)
})

test('curve interpolation and signed charge/energy integrals', () => {
  const points = [{ x: -2, y: 1e-6 }, { x: 0, y: 2e-6 }, { x: 2, y: 3e-6 }]
  for (const v of [-4, -2, -1, 0, 1, 2, 4]) {
    const h = 1e-5
    close((curveIntegral(points, v + h) - curveIntegral(points, v - h)) / (2 * h), curveValue(points, v), 1e-10)
    close((curveIntegral(points, v + h, true) - curveIntegral(points, v - h, true)) / (2 * h), v * curveValue(points, v), 1e-10)
    assert.ok(curveIntegral(points, v, true) >= 0)
  }
  close(curveIntegral(points, 2), 5e-6)
  close(curveIntegral(points, -2), -3e-6)
})

test('invalid tables reject order, zero, nonfinite values and negative differential resistance', () => {
  const model = customTemplate('resistor')
  for (const points of [[{ x: 0, y: 1000 }, { x: 0.01, y: 100 }], [{ x: 0, y: 1000 }, { x: 0, y: 1000 }], [{ x: 0.001, y: 1000 }, { x: 0.01, y: 1000 }], [{ x: 0, y: NaN }, { x: 0.01, y: 1000 }]]) assert.throws(() => validateCustomComponents([{ ...model, characteristic: { ...model.characteristic, points } }]))
})

test('real bounded R(I) uses solved currents in DC and transient, for either sign and endpoint extension', { timeout: 30_000 }, async () => {
  for (const points of [[{ x: 0, y: 1000 }, { x: 0.002, y: 1200 }, { x: 0.004, y: 2000 }], [{ x: 0, y: 2000 }, { x: 0.005, y: 1500 }]]) {
    for (const cv of [-5, 0, 2.4, 5]) {
      const doc = fixture('resistor', points); doc.instruments.cv = cv
      const capture = await solve(doc)
      const current = capture.operatingPoint!.parts['X-a_b'].currents[0].value
      close(current * curveValue(points, Math.abs(current)), cv, 2e-4)
      const sample = sampleRecording(capture, capture.duration)!
      close(sample.parts['X-a_b'].currents[0].value, current, 1e-7)
    }
    const doc = fixture('resistor', points); doc.wires[0].from = 'osc'; doc.instruments.frequency = 1000
    const capture = await solve(doc)
    for (let i = 0; i < capture.time.length; i += 19) {
      const sample = sampleRecording(capture, capture.time[i])!
      const current = sample.parts['X-a_b'].currents[0].value
      close(current * curveValue(points, Math.abs(current)), capture.channels.CH1[i], 0.001)
    }
  }
})

test('real bounded C(V) conserves integrated charge and energy across both polarities and knots', { timeout: 30_000 }, async () => {
  const points = [{ x: -2, y: 1e-6 }, { x: 0, y: 2e-6 }, { x: 2, y: 3e-6 }]
  const doc = fixture('capacitor', points); doc.wires[0].from = 'osc'; doc.instruments.waveform = 'triangle'; doc.instruments.frequency = 1000
  const capture = await solve(doc)
  close(capture.operatingPoint!.parts['X-a_b'].currents[0].value, 0)
  let charge = 0, energy = 0
  for (let i = 1; i < capture.time.length; i++) {
    const previous = sampleRecording(capture, capture.time[i - 1])!.parts['X-a_b'], current = sampleRecording(capture, capture.time[i])!.parts['X-a_b']
    const dt = capture.time[i] - capture.time[i - 1]
    charge += dt * (previous.currents[0].value + current.currents[0].value) / 2
    energy += dt * (previous.power! + current.power!) / 2
    close(charge, curveIntegral(points, capture.channels.CH1[i]) - curveIntegral(points, capture.channels.CH1[0]), 1e-7)
    close(energy, curveIntegral(points, capture.channels.CH1[i], true) - curveIntegral(points, capture.channels.CH1[0], true), 5e-7)
  }
})

test('constant models match ideal R/C and support DC bias, reversed pins, bypasses and automations', { timeout: 30_000 }, async () => {
  for (const kind of ['resistor', 'capacitor'] as const) {
    const value = kind === 'resistor' ? 1000 : 1e-6
    const points = (kind === 'resistor' ? [0, 0.01] : [-5, 0, 5]).map(x => ({ x, y: value }))
    const doc = fixture(kind, points)
    doc.wires[0].from = 'osc'; doc.instruments.waveform = 'square'
    const custom = await solve(doc), linear = await solve(assignCustomComponent(doc, 'X-a_b'))
    for (const seconds of [0, 0.0005, 0.001, 0.002]) close(sampleRecording(custom, seconds)!.parts['X-a_b'].currents[0].value, sampleRecording(linear, seconds)!.parts['X-a_b'].currents[0].value, 1e-6)
    for (const cv of [-5, 5]) {
      doc.wires[0].from = 'cv'; doc.instruments.cv = cv; doc.parts[0].pins.reverse()
      const capture = await solve(doc)
      close(capture.operatingPoint!.parts['X-a_b'].currents[0].value, kind === 'resistor' ? -cv / value : 0)
      doc.parts[0].pins.reverse()
    }
    doc.automations = [{ id: 'A1', name: 'Ramp', enabled: true, trigger: { kind: 'time', atMs: 0.5 }, action: { target: 'cv', value: -5, durationMs: 1 } }]
    const capture = await solve(doc, 0.002, true)
    assert.equal(capture.automationEvents!.length, 1)
    assert.equal(capture.recording!.parts[0].customModel!.name, doc.customComponents![0].name)
    delete doc.automations
    doc.wires = [{ id: 'W2', from: 'gnd', to: 'b4', color: '#ffffff' }, { id: 'W3', from: 'c1', to: 'c4', color: '#ffffff' }]
    const bypassed = await solve(doc)
    close(bypassed.operatingPoint!.parts['X-a_b'].currents[0].value, 0)
  }
})

test('real engine handles limits, 64 knots and 30 mixed shared instances within capture budgets', { timeout: 60_000 }, async (context) => {
  for (const [kind, values, axis] of [['resistor', [10, 1e7], [0, 1]], ['capacitor', [1e-10, 0.01], [-100, 0, 100]]] as const) {
    for (const value of values) {
      const doc = fixture(kind, axis.map(x => ({ x, y: value })))
      const capture = await solve(doc)
      close(capture.operatingPoint!.parts['X-a_b'].currents[0].value, kind === 'resistor' ? 5 / value : 0, 1e-7)
    }
  }
  for (const [kind, points] of [
    ['resistor', [{ x: 0, y: 1000 }, { x: 1e-6, y: 2000 }, { x: 1, y: 2000 }]],
    ['capacitor', [{ x: -100, y: 1e-6 }, { x: 0, y: 1e-6 }, { x: 0.001, y: 0.001001 }, { x: 100, y: 0.001001 }]],
  ] as const) await solve(fixture(kind, [...points]))
  const doc = fixture('resistor', Array.from({ length: 64 }, (_, i) => ({ x: i / 6300, y: 1000 + i * 10 })))
  const capacitor = customTemplate('capacitor', 1e-6)
  capacitor.characteristic.points = Array.from({ length: 64 }, (_, i) => ({ x: (i - 31) / 6.4, y: 1e-6 + i * 1e-8 }))
  const mixed = saveCustomComponent(doc, capacitor)
  mixed.parts = Array.from({ length: 30 }, (_, i) => ({ id: `P${i}`, kind: i % 2 ? 'capacitor' : 'resistor', value: i % 2 ? 1e-6 : 1000, customModelId: i % 2 ? capacitor.id : doc.customComponents![0].id, pins: [`a${i + 1}`, `f${i + 1}`] }))
  mixed.wires = [{ id: 'W0', from: 'osc', to: 'b1', color: '#ffffff' }, { id: 'W1', from: 'gnd', to: 'g1', color: '#ffffff' }, ...Array.from({ length: 29 }, (_, i) => [{ id: `WT${i}`, from: `c${i + 1}`, to: `b${i + 2}`, color: '#ffffff' }, { id: `WB${i}`, from: `h${i + 1}`, to: `g${i + 2}`, color: '#ffffff' }]).flat()]
  mixed.probes = { CH1: 'd1', CH2: 'i1' }; mixed.instruments.frequency = 20
  for (const duration of [0.1, 10]) {
    const started = performance.now(), capture = await solve(mixed, duration)
    assert.equal(capture.recording!.parts.length, 30)
    assert.ok(capture.time.length * (Object.keys(capture.recording!.currents).length + Object.keys(capture.recording!.nodeVoltages).length + 1) < 12_000_000)
    context.diagnostic(`${duration}s: ${capture.time.length} samples, ${(performance.now() - started).toFixed(0)}ms; netlist ${compileCircuit(mixed).netlist.length} bytes`)
  }
})

test('schema compatibility, malformed definitions, formatted size and safe display text', () => {
  for (const schemaVersion of [1, 2, 3] as const) {
    const doc = { ...createEmptyDocument(), schemaVersion }
    assert.deepEqual(validateDocument(doc), doc)
  }
  const doc = fixture('capacitor', [{ x: -5, y: 1e-6 }, { x: 0, y: 1e-6 }, { x: 5, y: 2e-6 }])
  const model = doc.customComponents![0]
  for (const mutate of [
    (d: any) => { d.customComponents.push(structuredClone(d.customComponents[0])) },
    (d: any) => { d.customComponents[0].name = 'x'.repeat(81) },
    (d: any) => { d.customComponents[0].description = 'x'.repeat(501) },
    (d: any) => { d.customComponents[0].characteristic.type = 'code' },
    (d: any) => { d.customComponents[0].characteristic.points[0].y = 0 },
    (d: any) => { d.customComponents[0].characteristic.points[1].x = 1 },
    (d: any) => { d.customComponents[0].characteristic.points[0].x = -101 },
    (d: any) => { d.customComponents[0].characteristic.points[1].y = Infinity },
    (d: any) => { d.customComponents[0].characteristic.extrapolation = 'linear' },
    (d: any) => { d.parts[0].customModelId = {} },
  ]) { const invalid = structuredClone(doc); mutate(invalid); assert.throws(() => validateDocument(invalid)) }
  const unsafe = saveCustomComponent(doc, { ...model, name: 'Hello\n.end', description: '.control\nquit' })
  assert.ok(!compileCircuit(unsafe).netlist.includes('Hello'))
  assert.ok(!compileCircuit(unsafe).netlist.includes('.control'))
  const tooLarge = { ...doc, customComponents: Array.from({ length: 32 }, (_, i) => ({ ...model, id: `M${i}`, description: 'a'.repeat(500), characteristic: { ...model.characteristic, points: Array.from({ length: 64 }, (_, j) => ({ x: (j - 31) * 1.23456789123456, y: 0.000000123456789012345 })) } })), parts: [] }
  assert.ok(JSON.stringify(tooLarge).length < 200000)
  assert.throws(() => validateDocument(tooLarge), /Formatted project/)
})

test('recordings freeze models, report excursions and reject missing or nonfinite saved currents', { timeout: 15_000 }, async () => {
  const doc = fixture('resistor', [{ x: 0, y: 1000 }, { x: 0.001, y: 1000 }])
  const capture = await solve(doc)
  assert.ok(capture.diagnostics?.some(d => d.partId === 'X-a_b' && /endpoint/.test(d.message)))
  doc.customComponents![0].characteristic.points[0].y = 2000
  assert.equal(capture.recording!.parts[0].customModel!.characteristic.points[0].y, 1000)
  const { extractRecording } = await import('../src/lib/recording.ts')
  const descriptor = capture.recording!.parts[0]
  const result = { header: 'Plotname: Transient Analysis', dataType: 'real' as const, numPoints: 1, numVariables: 1, variableNames: [], data: descriptor.nodes.filter(n => n !== '0').map(n => ({ name: `v(${n})`, type: 'voltage', values: [0] })) }
  assert.throws(() => extractRecording(result, [descriptor]), /no saved transient current/)
  result.data.push({ name: (descriptor.branches[0] as { vector: string }).vector, type: 'current', values: [NaN] })
  assert.throws(() => extractRecording(result, [descriptor]), /invalid or incomplete/)
})

test('shorter timesteps preserve R and C trajectories', { timeout: 30_000 }, async () => {
  for (const kind of ['resistor', 'capacitor'] as const) {
    const points = kind === 'resistor' ? [{ x: 0, y: 1000 }, { x: 0.01, y: 4000 }] : [{ x: -2, y: 1e-6 }, { x: 0, y: 2e-6 }, { x: 2, y: 3e-6 }]
    const doc = fixture(kind, points); doc.wires[0].from = 'osc'; doc.instruments.frequency = 1000
    const baseline = await solve(doc)
    const tr = compileCircuit(doc, 'transient', undefined, 0.002), dc = compileCircuit(doc, 'operating-point', undefined, 0.002)
    const refined = await runCircuitCapture(engine, { type: 'run', revision: 2, durationSeconds: 0.002, netlist: tr.netlist.replace(/\.tran (\S+) (\S+) 0 (\S+)/, (_, step, duration) => `.tran ${Number(step) / 2} ${duration} 0 ${Number(step) / 2}`), nodes: { CH1: tr.nodeByTerminal[doc.probes.CH1!], CH2: tr.nodeByTerminal[doc.probes.CH2!] }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) } })
    for (const time of [0.00013, 0.00034, 0.00081, 0.00115, 0.0017]) close(sampleRecording(baseline, time)!.parts['X-a_b'].currents[0].value, sampleRecording(refined, time)!.parts['X-a_b'].currents[0].value, kind === 'resistor' ? 1e-6 : 5e-5)
  }
})

test('schema 3 custom models coexist with Pico outputs, a built-in resistor and an automation', { timeout: 15_000 }, async () => {
  const { createPico } = await import('../src/lib/pico/profile.ts')
  const doc = fixture('resistor', [{ x: 0, y: 1000 }, { x: 0.01, y: 4000 }])
  doc.pico = createPico(); doc.wires[0].from = 'pico:1'
  doc.parts.push({ id: 'R2', kind: 'resistor', value: 1000, pins: ['a8', 'a12'] })
  doc.wires.push({ id: 'W3', from: 'cv', to: 'b8', color: '#ffffff' }, { id: 'W4', from: 'c4', to: 'b12', color: '#ffffff' }, { id: 'WG', from: 'pico:3', to: 'd4', color: '#ffffff' })
  doc.automations = [{ id: 'A1', name: 'Ramp', enabled: true, trigger: { kind: 'time', atMs: 0.5 }, action: { target: 'cv', value: -5, durationMs: 1 } }]
  const state = { gpio: 0, state: 1, function: 5, enabled: true, pullUp: false, pullDown: false }
  const trace = { initial: [state], events: [{ ...state, state: 0, ns: 1_000_000 }], durationNs: 2_000_000, console: '', instructions: 0, elapsedMs: 0 }
  const tr = compileCircuit(doc, 'transient', trace, 0.002), dc = compileCircuit(doc, 'operating-point', trace, 0.002)
  assert.deepEqual(tr.diagnostics.filter(d => d.severity === 'error'), [])
  const capture = await runCircuitCapture(engine, { type: 'run', revision: 3, durationSeconds: 0.002, netlist: tr.netlist, nodes: { CH1: tr.nodeByTerminal.a1, CH2: tr.nodeByTerminal.a8 }, operatingPoint: { netlist: dc.netlist, parts: operatingPointDescriptors(doc, dc.nodeByTerminal) }, automation: { document: doc, picoTrace: trace } })
  assert.equal(capture.automationEvents!.length, 1)
  assert.ok(sampleRecording(capture, 0.0005)!.parts['X-a_b'].currents[0].value > 0.001)
  close(sampleRecording(capture, 0.002)!.parts['X-a_b'].currents[0].value, 0, 1e-7)
  close(sampleRecording(capture, 0.002)!.parts.R2.currents[0].value, -0.005, 1e-6)
})
