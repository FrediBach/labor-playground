import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildKicadDocument, readKicadSchematic, selectKicadComponent, parseKicadValue } from '../src/lib/kicad-import.ts'
import { resolveTopology, validateDocument } from '../src/lib/circuit.ts'
const fixture = readFileSync(new URL('./fixtures/kicad/divider.kicad_sch', import.meta.url), 'utf8')

test('matches known parts, keeps unknown parts unresolved, and parses engineering values', () => {
  const source = readKicadSchematic(fixture)
  assert.equal(source.components[0].suggested, 'resistor')
  assert.equal(source.components[1].suggested, null)
  assert.equal(selectKicadComponent(source.components[1], '').kind, '')
  for (const [text, expected] of [['4k7', 4700], ['100nF', 1e-7], ['2.2u', 2.2e-6], ['1M', 1e6], ['1m', .001], ['1e3', 1000], ['10 kΩ', 10000]] as const) assert.ok(Math.abs(parseKicadValue(text)! / expected - 1) < 1e-12)
  assert.equal(parseKicadValue('unknown'), null)
})

test('converts nets to valid physical wiring without extra connections or implicit power', () => {
  const source = readKicadSchematic(fixture)
  const selections = source.components.map(c => selectKicadComponent(c, 'resistor'))
  const bare = buildKicadDocument(source, selections, {})
  const saved = JSON.stringify(bare)
  assert.deepEqual(validateDocument(JSON.parse(saved)), bare)
  assert.equal(bare.parts[1].value, 4700)
  const bareNodes = resolveTopology(bare).nodeByTerminal
  assert.equal(bareNodes[bare.parts[0].pins[1]], bareNodes[bare.parts[1].pins[0]])
  assert.notEqual(bareNodes[bare.parts[0].pins[0]], bareNodes[bare.parts[1].pins[1]])
  assert.notEqual(bareNodes[bare.parts[1].pins[1]], bareNodes.gnd)
  const sources = Object.fromEntries(source.nets.filter(n => n.labels.includes('VCC') || n.labels.includes('GND')).map(n => [n.id, n.labels.includes('GND') ? 'gnd' : 'cv']))
  const doc = buildKicadDocument(source, selections, sources), nodes = resolveTopology(doc).nodeByTerminal
  assert.equal(nodes[doc.parts[0].pins[0]], nodes.cv)
  assert.equal(nodes[doc.parts[1].pins[1]], nodes.gnd)
})

test('blocks unresolved components, missing pins, duplicate mappings and invalid values', () => {
  const source = readKicadSchematic(fixture), selections = source.components.map(c => selectKicadComponent(c, 'resistor'))
  assert.throws(() => buildKicadDocument(source, [selections[0]], {}), /matching component/)
  assert.throws(() => buildKicadDocument(source, [{ ...selections[0], pins: ['1', '1'] }, selections[1]], {}), /exactly once/)
  assert.throws(() => buildKicadDocument(source, [{ ...selections[0], value: '' }, selections[1]], {}), /enter a value/)
})

test('wire crossings stay separate unless an explicit junction is present; labels join distant nets', () => {
  const base = fixture.replace(/\(wire \(pts \(xy 50 53.81\) \(xy 50 66.19\)\)\)/, '').replace('(label "OUT" (at 50 60 0))', '')
  const wires = '(wire (pts (xy 50 53.81) (xy 70 53.81))) (wire (pts (xy 60 40) (xy 60 70))) (label "A" (at 50 53.81 0)) (label "B" (at 60 40 0))'
  const withExtra = (extra: string) => readKicadSchematic(base.slice(0, base.lastIndexOf(')')) + wires + extra + ')')
  assert.equal(withExtra('').nets.some(n => n.labels.includes('A') && n.labels.includes('B')), false)
  assert.equal(withExtra('(junction (at 60 53.81))').nets.some(n => n.labels.includes('A') && n.labels.includes('B')), true)
  assert.equal(withExtra('(label "A" (at 60 70 0))').nets.some(n => n.labels.includes('A') && n.labels.includes('B')), true)
})

test('rotation and mirroring transform embedded pin coordinates', () => {
  const source = readKicadSchematic(fixture.replace('(at 50 50 0)', '(at 50 50 90) (mirror x)').replace('(at 50 46.19 0)', '(at 46.19 50 0)'))
  assert.ok(source.nets.find(n => n.id === source.components[0].pins[0].net)!.labels.includes('VCC'))
})

test('rejects unsupported electrical structures, malformed files, and legacy files clearly', () => {
  for (const tag of ['sheet', 'bus', 'bus_entry', 'hierarchical_label']) assert.throws(() => readKicadSchematic(fixture.replace('(uuid "sheet")', `(${tag})`)), /not supported/)
  assert.throws(() => readKicadSchematic(fixture.slice(0, -3)), /complete/)
  assert.throws(() => readKicadSchematic('EESchema Schematic File Version 4'), /save it as .kicad_sch/)
  assert.throws(() => readKicadSchematic(' '.repeat(2_000_001)), /2 MB/)
})

test('diode mapping respects anode/cathode names rather than KiCad pin order', () => {
  const component = { reference: 'D1', library: 'Device:D', value: '1N4148', suggested: null, pins: [{ number: '1', name: 'K', net: 'a' }, { number: '2', name: 'A', net: 'b' }] }
  assert.deepEqual(selectKicadComponent(component, 'diode').pins, ['2', '1'])
})

test('multi-unit instances combine into one component while retaining physical pin numbers', () => {
  const source = readKicadSchematic(`(kicad_sch (lib_symbols (symbol "Custom:Multi"
    (symbol "Multi_1_1" (pin passive line (at 0 0) (name "A") (number "1")))
    (symbol "Multi_2_1" (pin passive line (at 0 0) (name "B") (number "2")))))
    (symbol (lib_id "Custom:Multi") (at 10 10) (unit 1) (property "Reference" "U1") (property "Value" "Custom"))
    (symbol (lib_id "Custom:Multi") (at 20 20) (unit 2) (property "Reference" "U1") (property "Value" "Custom")))`)
  assert.equal(source.components.length, 1)
  assert.deepEqual(source.components[0].pins.map(p => p.number), ['1', '2'])
  assert.notEqual(source.components[0].pins[0].net, source.components[0].pins[1].net)
  assert.throws(() => readKicadSchematic('(kicad_sch (title "broken))'), /quoted string/)
})

test('imported divider produces the analytical voltage in real ngspice', { timeout: 15000 }, async () => {
  const { Simulation } = await import('eecircuit-engine')
  const { compileCircuit } = await import('../src/lib/circuit.ts')
  const { runCircuitCapture } = await import('../src/lib/simulation-analysis.ts')
  const source = readKicadSchematic(fixture)
  const sources = Object.fromEntries(source.nets.filter(n => n.labels.includes('VCC') || n.labels.includes('GND')).map(n => [n.id, n.labels.includes('GND') ? 'gnd' : 'cv']))
  const doc = buildKicadDocument(source, source.components.map(c => selectKicadComponent(c, 'resistor')), sources)
  const compiled = compileCircuit(doc)
  assert.deepEqual(compiled.diagnostics.filter(d => d.severity === 'error'), [])
  const engine = new Simulation(); await engine.start()
  const capture = await runCircuitCapture(engine, { type: 'run', revision: 1, netlist: compiled.netlist, nodes: { CH1: compiled.nodeByTerminal[doc.parts[0].pins[1]], CH2: null } })
  for (const voltage of capture.channels.CH1) assert.ok(Math.abs(voltage - 5 * 4700 / 14700) < 1e-8)
})

test('all orthogonal rotations and sheet-axis mirrors preserve pin endpoints', () => {
  const expected = [[0, 3.81], [-3.81, 0], [0, -3.81], [3.81, 0]]
  for (const [index, angle] of [0, 90, 180, 270].entries()) for (const mirror of ['', 'x', 'y']) {
    const [dx, dy] = expected[index]
    const x = 50 + dx * (mirror === 'y' ? -1 : 1), y = 50 - dy * (mirror === 'x' ? -1 : 1)
    const source = readKicadSchematic(fixture.replace('(at 50 50 0)', `(at 50 50 ${angle}) ${mirror ? `(mirror ${mirror})` : ''}`).replace('(at 50 46.19 0)', `(at ${x} ${y} 0)`))
    assert.ok(source.nets.find(n => n.id === source.components[0].pins[0].net)!.labels.includes('VCC'), `${angle} ${mirror}`)
  }
})
