import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyDocument, examples, PARTS, resolveTopology, type ComponentKind } from '../src/lib/circuit.ts'
import { createPico } from '../src/lib/pico/profile.ts'
import { buildSchematic, type SchematicLayout, type SchematicPoint, type SchematicWire } from '../src/lib/schematic.ts'

const wireSegments = (layout: SchematicLayout) => layout.wires.flatMap(wire => wire.points.slice(1).map((b, index) => {
  const a = wire.points[index]
  return { node: wire.node, a, b, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) }
}))
const intersects = (a: { left: number; right: number; top: number; bottom: number }, b: typeof a) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom
const contains = (line: ReturnType<typeof wireSegments>[number], point: SchematicPoint) => intersects(line, { left: point.x, right: point.x, top: point.y, bottom: point.y })

/** Check a continuous geometric path without relying on matching labels. */
function assertWired(layout: SchematicLayout, from: string, fromPin: number, to: string, toPin: number) {
  const a = layout.symbols.find(symbol => symbol.id === from)!.pins.find(pin => pin.number === fromPin)!
  const b = layout.symbols.find(symbol => symbol.id === to)!.pins.find(pin => pin.number === toPin)!
  assert.equal(a.node, b.node)
  const lines = wireSegments(layout).filter(line => line.node === a.node)
  const reached = new Set(lines.filter(line => contains(line, a)))
  for (const line of reached) for (const other of lines) if (intersects(line, other)) reached.add(other)
  assert.ok([...reached].some(line => contains(line, b)), `${from}:${fromPin} to ${to}:${toPin} has a continuous wire`)
}

test('schematic resolves shared breadboard strips and split rails with the simulation topology', () => {
  const document = createEmptyDocument()
  document.parts = [
    { id: 'R1', kind: 'resistor', value: 1000, pins: ['a1', 'a2'] },
    { id: 'R2', kind: 'resistor', value: 1000, pins: ['e2', 'tn15'] },
    { id: 'R3', kind: 'resistor', value: 1000, pins: ['tn16', 'f2'] },
  ]
  const layout = buildSchematic(document)
  const nodes = resolveTopology(document).nodeByTerminal
  for (const symbol of layout.symbols) for (const pin of symbol.pins) assert.equal(pin.node, nodes[pin.terminal])
  assert.equal(layout.symbols[0].pins[1].node, layout.symbols[1].pins[0].node)
  assert.notEqual(layout.symbols[1].pins[1].node, layout.symbols[2].pins[0].node)
  assert.notEqual(layout.symbols[0].pins[1].node, layout.symbols[2].pins[1].node)
})

test('a small RC circuit has explicit connected wires and an independent ground shunt', () => {
  const document = examples.find(example => example.id === 'rc-filter')!.document
  const layout = buildSchematic(document)
  const nodes = resolveTopology(document).nodeByTerminal
  assert.equal(layout.mode, 'wired')
  const capacitor = layout.symbols.find(symbol => symbol.id === 'C1')!
  assert.equal(capacitor.rotation, 90)
  assert.equal(capacitor.pins[1].node, '0')
  assert.ok(layout.labels.some(label => label.node === '0' && label.ground))
  assert.equal(layout.nets.find(net => net.id === nodes.osc)?.label, 'SIGNAL')
  assert.deepEqual(layout.nets.find(net => net.id === nodes.a17)?.probes, ['CH2'])
  for (const symbol of layout.symbols) for (const pin of symbol.pins) {
    assert.ok(layout.wires.some(wire => wire.node === pin.node && wire.points.some(point => point.x === pin.x && point.y === pin.y)), `${symbol.id} pin ${pin.number} is wired to its own net`)
  }
})

test('parallel branches have no geometric crossings between unrelated nets', () => {
  const document = examples.find(example => example.id === 'diode-clipper')!.document
  const layout = buildSchematic(document)
  assert.equal(layout.mode, 'wired')
  const segments = (wire: SchematicWire) => wire.points.slice(1).map((end, index) => ({ a: wire.points[index], b: end, node: wire.node }))
  const all = layout.wires.flatMap(segments)
  for (const first of all) for (const second of all) {
    if (first.node === second.node) continue
    const bounds = (segment: typeof first) => ({ left: Math.min(segment.a.x, segment.b.x), right: Math.max(segment.a.x, segment.b.x), top: Math.min(segment.a.y, segment.b.y), bottom: Math.max(segment.a.y, segment.b.y) })
    const a = bounds(first), b = bounds(second)
    const intersects = Math.max(a.left, b.left) <= Math.min(a.right, b.right) && Math.max(a.top, b.top) <= Math.min(a.bottom, b.bottom)
    assert.equal(intersects, false, `${first.node} and ${second.node} must not cross`)
  }
})

test('grouped components stay inside their own enclosure without changing nets', () => {
  const document = structuredClone(examples.find(example => example.id === 'opamp-amplifier')!.document)
  document.parts[0].schemaGroup = 'Amplifier'
  document.parts[1].schemaGroup = 'Feedback'
  document.parts[2].schemaGroup = 'Feedback'
  const layout = buildSchematic(document)
  assert.equal(layout.groups.length, 2)
  for (const symbol of layout.symbols) {
    const group = layout.groups.find(group => group.name === symbol.part?.schemaGroup)!
    assert.ok(symbol.x - symbol.width / 2 >= group.x)
    assert.ok(symbol.x + symbol.width / 2 <= group.x + group.width)
    assert.ok(symbol.y - symbol.height / 2 >= group.y)
    assert.ok(symbol.y + symbol.height / 2 <= group.y + group.height)
  }
  const plain = structuredClone(document)
  plain.parts.forEach(part => { delete part.schemaGroup })
  assert.deepEqual(layout.nets, buildSchematic(plain).nets)
})

test('a single group preserves direct wiring and encloses the ground voltage annotations', () => {
  const document = structuredClone(examples.find(example => example.id === 'rc-filter')!.document)
  const before = buildSchematic(document)
  document.parts.forEach(part => { part.schemaGroup = 'Low-pass filter' })
  const grouped = buildSchematic(document)
  assert.equal(grouped.mode, 'wired')
  assert.deepEqual(grouped.wires, before.wires)
  assert.deepEqual(grouped.nets, before.nets)
  assert.equal(grouped.groups.length, 1)
  const group = grouped.groups[0]
  assert.equal(group.name, 'Low-pass filter')
  for (const symbol of grouped.symbols) for (const pin of symbol.pins) {
    assert.ok(pin.x > group.x && pin.x < group.x + group.width)
    assert.ok(pin.y > group.y && pin.y < group.y + group.height)
  }
  for (const label of grouped.labels.filter(label => label.ground)) assert.ok(label.y + 39 < group.y + group.height)
})

test('all supported kinds preserve their physical pin numbers, names and nets', () => {
  for (const kind of Object.keys(PARTS) as ComponentKind[]) {
    const document = createEmptyDocument()
    const definition = PARTS[kind]
    document.parts = [{ id: 'DUT1', kind, value: definition.defaultValue, pins: definition.pinNames.map((_, index) => `a${index + 1}`) }]
    const symbol = buildSchematic(document).symbols[0]
    assert.equal(symbol.pins.length, definition.pinNames.length, kind)
    symbol.pins.forEach((pin, index) => {
      assert.equal(pin.number, index + 1, kind)
      assert.equal(pin.name, definition.pinNames[index], kind)
      assert.equal(pin.node, resolveTopology(document).nodeByTerminal[`a${index + 1}`], kind)
    })
  }
})

test('Pico exposes connected pins with actual physical numbers and shared ground topology', () => {
  const document = createEmptyDocument()
  document.pico = createPico()
  document.parts = [{ id: 'R1', kind: 'resistor', value: 1000, pins: ['a1', 'a2'] }]
  document.wires = [
    { id: 'W1', from: 'pico:1', to: 'b1', color: '#fff' },
    { id: 'W2', from: 'pico:38', to: 'b2', color: '#fff' },
    { id: 'W3', from: 'pico:36', to: 'a3', color: '#fff' },
  ]
  const layout = buildSchematic(document)
  const pico = layout.symbols.find(symbol => symbol.kind === 'pico')!
  assert.deepEqual(pico.pins.map(pin => [pin.number, pin.name]), [[1, 'GP0'], [36, '3V3'], [38, 'GND']])
  const ground = pico.pins.find(pin => pin.number === 38)!
  assert.equal(layout.nets.find(net => net.id === ground.node)?.label, 'PICO GND')
  assert.notEqual(ground.node, '0', 'Pico ground is not implicitly LABOR ground')
  assert.equal(ground.node, layout.symbols.find(symbol => symbol.id === 'R1')!.pins[1].node)
})

test('small Pico circuits wire the signal chain and shared ground instead of falling back to labels only', () => {
  for (const id of ['pico-led', 'pico-pwm', 'pico-pulse']) {
    const layout = buildSchematic(examples.find(example => example.id === id)!.document)
    const load = id === 'pico-led' ? 'D1' : id === 'pico-pwm' ? 'C1' : 'R2'
    assertWired(layout, 'Pico', 1, 'R1', 1)
    assertWired(layout, 'R1', 2, load, 1)
    assertWired(layout, 'Pico', 3, 'Pico', 8)
    assertWired(layout, 'Pico', 8, load, 2)
    assert.ok(layout.junctions.some(point => point.node === '0'), 'shared ground branch has a junction dot')
  }
})

test('multi-pin devices, cycles and disconnected islands retain routable connections', () => {
  for (const id of ['opamp-amplifier', '555-astable', 'jfet-buffer', 'pico-oled']) {
    const layout = buildSchematic(examples.find(example => example.id === id)!.document)
    assert.ok(layout.wires.length > 0, `${id} has direct wires`)
  }
  const document = createEmptyDocument()
  document.parts = [
    { id: 'R1', kind: 'resistor', value: 1000, pins: ['a1', 'a2'] },
    { id: 'R2', kind: 'resistor', value: 1000, pins: ['b2', 'a3'] },
    { id: 'R3', kind: 'resistor', value: 1000, pins: ['b3', 'b1'] },
  ]
  const cycle = buildSchematic(document)
  assert.ok(cycle.wires.length > 0)
  document.parts[2].pins = ['a5', 'a6']
  document.parts.push({ id: 'R4', kind: 'resistor', value: 1000, pins: ['b6', 'a7'] })
  const islands = buildSchematic(document)
  assertWired(islands, 'R1', 2, 'R2', 1)
  assertWired(islands, 'R3', 2, 'R4', 1)
})

test('groups keep internal wiring and retain labels for connections to other groups', () => {
  const document = structuredClone(examples.find(example => example.id === 'pico-led')!.document)
  document.parts.forEach(part => { part.schemaGroup = 'LED output' })
  const layout = buildSchematic(document)
  assertWired(layout, 'R1', 2, 'D1', 1)
  const group = layout.groups[0]
  const inside = (point: SchematicPoint) => point.x > group.x && point.x < group.x + group.width && point.y > group.y && point.y < group.y + group.height
  for (const wire of layout.wires) {
    if (wire.points.some(inside)) assert.ok(wire.points.every(inside), 'a wire stays within its section')
  }
  const gpio = layout.symbols.find(symbol => symbol.id === 'Pico')!.pins[0]
  assert.equal(layout.labels.filter(label => label.node === gpio.node).length, 2)
})

test('routed examples avoid unrelated nets, component bodies, text and sheet margins', () => {
  for (const example of examples) {
    const layout = buildSchematic(example.document)
    if (layout.mode !== 'labeled') continue
    const lines = wireSegments(layout)
    for (const line of lines) {
      assert.ok(line.a.x === line.b.x || line.a.y === line.b.y, `${example.id}: orthogonal wires`)
      assert.ok(line.left > 24 && line.right < layout.width - 24 && line.top > 110 && line.bottom < layout.height - 82, `${example.id}: wires stay on sheet`)
      for (const other of lines) if (line.node !== other.node) assert.ok(!intersects(line, other), `${example.id}: unrelated wires cannot cross`)
      for (const symbol of layout.symbols) {
        const block = symbol.width === 200
        const body = { left: symbol.x - (block ? 99 : 28), right: symbol.x + (block ? 99 : 28), top: symbol.y - (block ? symbol.height / 2 - 1 : 25), bottom: symbol.y + (block ? symbol.height / 2 - 1 : 25) }
        assert.ok(!intersects(line, body), `${example.id}: wire avoids ${symbol.id} body`)
      }
      for (const label of layout.labels) {
        const net = layout.nets.find(net => net.id === label.node)!
        const width = (net.label + (net.probes.length ? ` · ${net.probes.join(' / ')}` : '')).length * 6.7
        const left = label.x - (label.anchor === 'end' ? width : label.anchor === 'middle' ? width / 2 : 0)
        assert.ok(!intersects(line, { left, right: left + width, top: label.y - 11, bottom: label.y }), `${example.id}: wire avoids net text`)
      }
    }
  }
})

test('every bundled example yields a bounded, deterministic electrical drawing', () => {
  for (const example of examples) {
    const original = structuredClone(example.document)
    const layout = buildSchematic(example.document)
    assert.deepEqual(example.document, original, 'layout must not mutate the project')
    assert.deepEqual(layout.warnings, [], example.id)
    assert.equal(layout.symbols.length, example.document.parts.length + Number(!!example.document.pico), example.id)
    for (const symbol of layout.symbols) for (const pin of symbol.pins) {
      assert.ok(pin.x > 24 && pin.x < layout.width - 24, `${example.id}: pin stays on sheet`)
      assert.ok(pin.y > 100 && pin.y < layout.height - 82, `${example.id}: pin stays on sheet`)
    }
    const reversed = { ...example.document, parts: [...example.document.parts].reverse(), wires: [...example.document.wires].reverse() }
    assert.deepEqual(buildSchematic(reversed), layout, example.id)
  }
})

test('empty, wire-only, invalid-terminal and shorted circuits remain inspectable', () => {
  const document = createEmptyDocument()
  assert.deepEqual(buildSchematic(document).symbols, [])
  document.wires = [{ id: 'W1', from: 'cv', to: 'gnd', color: '#fff' }]
  const shorted = buildSchematic(document)
  assert.equal(shorted.nets[0].label, 'GND / CV')
  assert.equal(shorted.labels.length, 1)
  document.parts = [{ id: 'R1', kind: 'resistor', value: 1000, pins: ['missing', 'a1'] }]
  document.wires.push({ id: 'W2', from: 'unavailable', to: 'a1', color: '#fff' })
  const invalid = buildSchematic(document)
  assert.equal(invalid.warnings.length, 2)
  assert.equal(invalid.symbols[0].pins[0].node, 'unconnected:R1:1')
  assert.notEqual(invalid.symbols[0].pins[0].node, invalid.symbols[0].pins[1].node)
})
