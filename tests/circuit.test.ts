import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canPlace, compileCircuit, createEmptyDocument, examples, formatValue, getPlacement, HOLES, validateDocument } from '../src/lib/circuit.ts'

test('breadboard strips, trench, and split rails have explicit connectivity', () => {
  const { nodeByTerminal: nodes } = compileCircuit(createEmptyDocument())
  assert.equal(HOLES.length, 420)
  assert.equal(nodes.a1, nodes.e1)
  assert.equal(nodes.f1, nodes.j1)
  assert.notEqual(nodes.e1, nodes.f1)
  assert.notEqual(nodes.a1, nodes.a2)
  assert.equal(nodes.tp1, nodes.tp15)
  assert.equal(nodes.tp16, nodes.tp30)
  assert.notEqual(nodes.tp15, nodes.tp16)
  assert.notEqual(nodes.tn1, nodes.gnd)
  assert.notEqual(nodes.bp1, nodes.tp1)
  assert.equal(nodes.gnd, '0')
})

test('all bundled examples validate and compile without structural errors', () => {
  assert.equal(examples.length, 23)
  assert.equal(new Set(examples.map(example => example.id)).size, examples.length)
  assert.deepEqual(new Set(examples.map(example => example.level)), new Set(['Basic', 'Intermediate', 'Advanced']))
  for (const example of examples) {
    const doc = validateDocument(example.document)
    const compilation = compileCircuit(doc)
    assert.deepEqual(compilation.diagnostics, [], example.name)
    assert.match(compilation.netlist, /\.tran .* 0\.1 0 /)
    assert.match(compilation.netlist, /\.save v\(/)
    assert.doesNotMatch(compilation.netlist, /\.save all/)
  }
})

test('wire crossings do not create junctions; only endpoints merge nodes', () => {
  const doc = createEmptyDocument()
  doc.wires = [{ id: 'W1', from: 'a1', to: 'j10', color: '#ffffff' }, { id: 'W2', from: 'j1', to: 'a10', color: '#ffffff' }]
  const { nodeByTerminal: nodes } = compileCircuit(doc)
  assert.equal(nodes.a1, nodes.j10)
  assert.equal(nodes.j1, nodes.a10)
  assert.notEqual(nodes.a1, nodes.j1)
})

test('components do not merge nets and probes retain their physical attachment', () => {
  const doc = structuredClone(examples[0].document)
  const before = compileCircuit(doc)
  assert.notEqual(before.nodeByTerminal.a6, before.nodeByTerminal.a17)
  doc.wires.push({ id: 'W4', from: 'a1', to: 'j2', color: '#ffffff' })
  const after = compileCircuit(doc)
  assert.equal(doc.probes.CH2, 'd17')
  assert.equal(after.nodeByTerminal[doc.probes.CH2!], after.nodeByTerminal.a17)
})

test('an explicit rail jumper bridges the break without powering any other rail', () => {
  const doc = createEmptyDocument()
  doc.wires = [{ id: 'W1', from: 'gnd', to: 'bn1', color: '#ffffff' }, { id: 'W2', from: 'bn15', to: 'bn16', color: '#ffffff' }]
  const { nodeByTerminal: nodes } = compileCircuit(doc)
  assert.equal(nodes.bn30, '0')
  assert.notEqual(nodes.tn1, '0')
})

test('compiler diagnoses bypassed parts, floating nodes, and direct source shorts', () => {
  const doc = createEmptyDocument()
  doc.parts = [{ id: 'R1', kind: 'resistor', value: 10_000, pins: ['a1', 'b1'] }]
  assert.ok(compileCircuit(doc).diagnostics.some((item) => item.message.includes('both leads')))
  assert.ok(compileCircuit(doc).diagnostics.some((item) => item.severity === 'error' && item.message.includes('DC path')))
  doc.parts = []
  doc.wires = [{ id: 'W1', from: 'vplus', to: 'vminus', color: '#ffffff' }]
  assert.ok(compileCircuit(doc).diagnostics.some((item) => item.message.includes('Supply short')))
})

test('a capacitor does not silently provide a DC ground path', () => {
  const doc = createEmptyDocument()
  doc.parts = [{ id: 'C1', kind: 'capacitor', value: 1e-7, pins: ['e1', 'f1'] }]
  doc.wires = [{ id: 'W1', from: 'gnd', to: 'j1', color: '#ffffff' }]
  assert.ok(compileCircuit(doc).diagnostics.some((item) => item.severity === 'error' && item.partId === 'C1'))
})

test('occupancy includes wires and ignores measurement probes', () => {
  const doc = structuredClone(examples[0].document)
  assert.equal(canPlace(doc, ['a6', 'a9']), false)
  assert.equal(canPlace(doc, ['b6', 'b9']), false)
  assert.equal(canPlace(doc, ['d6', 'd9']), true)
  assert.equal(canPlace(doc, ['a6', 'a17'], 'R1'), true)
  assert.equal(canPlace(doc, ['a1', 'a1']), false)
  assert.equal(canPlace(doc, ['a1', 'unknown']), false)
})

test('placement rotates, crosses the trench, and rejects outside holes', () => {
  assert.deepEqual(getPlacement('resistor', 'a1'), ['a1', 'a4'])
  assert.deepEqual(getPlacement('capacitor', 'e10', 90), ['e10', 'f10'])
  assert.deepEqual(getPlacement('resistor', 'a4', 180), ['a4', 'a1'])
  assert.equal(getPlacement('resistor', 'a29'), null)
  assert.equal(getPlacement('resistor', 'a1', 270), null)
  assert.equal(getPlacement('capacitor', 'gnd'), null)
})

test('malformed imports and unbounded values fail before compilation', () => {
  const cases: [string, (doc: any) => void][] = [
    ['version', (doc) => { doc.schemaVersion = 3 }],
    ['terminal', (doc) => { doc.parts[0].pins[0] = 'missing' }],
    ['occupancy', (doc) => { doc.wires[0].to = 'a6' }],
    ['duplicate ID', (doc) => { doc.wires[0].id = 'r1' }],
    ['unknown kind', (doc) => { doc.parts[0].kind = 'transistor' }],
    ['nonfinite', (doc) => { doc.parts[0].value = Infinity }],
    ['out of range', (doc) => { doc.instruments.frequency = 100_000 }],
    ['netlist injection', (doc) => { doc.parts[0].id = 'R1\n.control' }],
    ['oversize', (doc) => { doc.extra = 'x'.repeat(200_000) }],
    ['prototype key', (doc) => { doc.parts[0].kind = '__proto__' }],
  ]
  for (const [name, mutate] of cases) {
    const doc = structuredClone(examples[0].document)
    mutate(doc)
    assert.throws(() => validateDocument(doc), undefined, name)
    assert.equal(compileCircuit(doc).netlist, '', name)
  }
})

test('unknown import properties cannot introduce simulation directives', () => {
  const doc = { ...createEmptyDocument(), netlist: '.control\nshell command' }
  assert.equal('netlist' in validateDocument(doc), false)
})

test('netlists remain deterministic after wire and part array reordering', () => {
  const doc = structuredClone(examples[2].document)
  const first = compileCircuit(doc)
  doc.parts.reverse()
  doc.wires.reverse()
  assert.equal(compileCircuit(doc).netlist, first.netlist)
})

test('valid document IDs cannot collide when encoded as SPICE device names', () => {
  const doc = structuredClone(examples[1].document)
  doc.parts[0].id = 'R-1'
  doc.parts[1].id = 'R_1'
  const { netlist } = compileCircuit(doc)
  assert.match(netlist, /R_R_2d1 /)
  assert.match(netlist, /R_R_5f1 /)
})

test('component values use engineering units', () => {
  assert.equal(formatValue(10_000, 'resistor'), '10 kΩ')
  assert.equal(formatValue(100e-9, 'capacitor'), '100 nF')
  assert.equal(formatValue(1e-6, 'capacitor'), '1 µF')
  assert.equal(formatValue(0, 'switch'), 'Open')
})
