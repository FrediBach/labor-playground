import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyDocument, examples } from '../src/lib/circuit.ts'
import { buildSchematic } from '../src/lib/schematic.ts'
import { buildKicadExport } from '../src/lib/kicad-export.ts'
import { createPico } from '../src/lib/pico/profile.ts'
import { createZip } from '../src/lib/zip-export.ts'

test('exported symbol pins land exactly on the schematic endpoints for every bundled circuit', () => {
  for (const example of examples) {
    const layout = buildSchematic(example.document)
    const output = buildKicadExport(example.document)
    const sch = output.files.find(file => file.name.endsWith('.sch'))!.content
    const lib = output.files.find(file => file.name.endsWith('.lib'))!.content
    const instances = [...sch.matchAll(/\$Comp\n([\s\S]*?)\$EndComp/g)]
    assert.equal(instances.length, layout.symbols.length, example.id)
    const definitions = new Map([...lib.matchAll(/^DEF (\S+) .*\n([\s\S]*?)^ENDDEF/gm)].map(match => [match[1], match[2]]))
    for (const instance of instances) {
      const body = instance[1], [, alias, reference] = /^L PicoLabor:(\S+) (\S+)$/m.exec(body)!
      const symbol = layout.symbols.find(symbol => symbol.id === reference)!
      const [, cx, cy] = /^P (\d+) (\d+)$/m.exec(body)!.map(Number)
      const definition = definitions.get(`PicoLabor_${alias}`)!
      assert.ok(definition.includes(`ALIAS ${alias}\n`))
      const pins = [...definition.matchAll(/^X \S+ (\d+) (-?\d+) (-?\d+) /gm)]
      assert.equal(pins.length, symbol.pins.length, `${example.id}/${reference}`)
      for (const [, number, dx, dy] of pins) {
        const pin = symbol.pins.find(pin => pin.number === Number(number))!
        assert.deepEqual([cx + Number(dx), cy - Number(dy)], [Math.round(pin.x * 10), Math.round(pin.y * 10)], `${example.id}/${reference}/${number}`)
      }
    }
    assert.match(sch, /^EESchema Schematic File Version 4\n/)
    assert.match(sch, /\n\$EndSCHEMATC\n$/)
    assert.match(output.files.find(file => file.name === 'sym-lib-table')!.content, /\$\{KIPRJMOD\}/)
  }
})

test('groups and voltage snapshots export as notes without changing electrical records', () => {
  const document = structuredClone(examples[0].document)
  document.parts.forEach(part => { part.schemaGroup = 'Input filter' })
  const layout = buildSchematic(document)
  const plain = buildKicadExport(document)
  const values = Object.fromEntries(layout.nets.map((net, index) => [net.id, index * 1.25]))
  const snapshot = buildKicadExport(document, { nodeVoltages: values, voltageTime: 0.0375 })
  const content = (output: typeof snapshot) => output.files.find(file => file.name.endsWith('.sch'))!.content
  const electrical = (text: string) => text.replace(/^Text Notes[^\n]*\n[^\n]*\n/gm, '').replace(/^Comment2[^\n]*\n/gm, '')
  assert.equal(electrical(content(snapshot)), electrical(content(plain)))
  assert.match(content(snapshot), /Wire Notes Line/)
  assert.match(content(snapshot), /"Input filter".*"Schema group"/)
  assert.match(content(snapshot), /V @ 37\.500 ms/)
  assert.doesNotMatch(content(plain), /V @ /)
  assert.deepEqual(snapshot.files.filter(file => !file.name.endsWith('.sch')), plain.files.filter(file => !file.name.endsWith('.sch')))
})

test('quoted metadata and hostile line breaks cannot inject schematic or library records', () => {
  const document = structuredClone(examples[0].document)
  document.title = 'A "filter" \\ output\n$EndSCHEMATC'
  document.parts.forEach(part => { part.schemaGroup = 'A "group"\n$Comp\nL fake R99\n\\name' })
  const output = buildKicadExport(document)
  const content = output.files.find(file => file.name.endsWith('.sch'))!.content
  assert.equal(content.match(/^\$EndSCHEMATC$/gm)?.length, 1)
  assert.equal(content.match(/^\$Comp$/gm)?.length, document.parts.length)
  assert.match(content, /^Title "A \\"filter\\" \\\\ output \$EndSCHEMATC"$/m)
  assert.ok(output.files.every(file => !file.name.includes('/') && !file.name.includes('\\') && !file.name.includes('\n')))
  assert.doesNotThrow(() => createZip(output.files))
})

test('ZIP preserves UTF-8 payloads, known CRC32 and central-directory offsets', () => {
  const files = [{ name: 'circuit.sch', content: '123456789' }, { name: 'symbols.lib', content: 'µF Ω – pin\n' }]
  const zip = Buffer.from(createZip(files))
  assert.equal(zip.readUInt32LE(0), 0x04034b50)
  assert.equal(zip.readUInt32LE(14), 0xcbf43926)
  const end = zip.length - 22, central = zip.readUInt32LE(end + 16)
  assert.equal(zip.readUInt32LE(end), 0x06054b50)
  assert.equal(zip.readUInt16LE(end + 10), files.length)
  let entryOffset = central
  for (const file of files) {
    assert.equal(zip.readUInt32LE(entryOffset), 0x02014b50)
    const local = zip.readUInt32LE(entryOffset + 42), size = zip.readUInt32LE(local + 18)
    const nameSize = zip.readUInt16LE(local + 26), start = local + 30 + nameSize
    assert.equal(zip.readUInt16LE(local + 6), 0x0800)
    assert.equal(zip.readUInt16LE(local + 8), 0)
    assert.equal(zip.subarray(local + 30, start).toString('utf8'), file.name)
    assert.equal(zip.subarray(start, start + size).toString('utf8'), file.content)
    assert.equal(zip.readUInt32LE(local + 14), zip.readUInt32LE(entryOffset + 16))
    entryOffset += 46 + zip.readUInt16LE(entryOffset + 28)
  }
  assert.equal(entryOffset, end)
  assert.throws(() => createZip([{ name: '../circuit.sch', content: '' }]))
  assert.throws(() => createZip([files[0], files[0]]))
})

test('serialized wires and labels preserve every connected and isolated pin pair in all examples', () => {
  for (const example of examples) {
    const layout = buildSchematic(example.document), files = buildKicadExport(example.document).files
    const sch = files.find(file => file.name.endsWith('.sch'))!.content
    const lib = files.find(file => file.name.endsWith('.lib'))!.content
    const definitions = new Map<string, { number: number; x: number; y: number }[]>()
    for (const match of lib.matchAll(/^DEF (\S+)[\s\S]*?^ENDDEF/gm)) {
      const pins = [...match[0].matchAll(/^X \S+ (\d+) (-?\d+) (-?\d+) /gm)].map(pin => ({ number: +pin[1], x: +pin[2], y: +pin[3] }))
      definitions.set(match[1], pins)
      for (const alias of (match[0].match(/^ALIAS (.+)$/m)?.[1] ?? '').split(' ')) if (alias) definitions.set(alias, pins)
    }
    const pins: { id: string; x: number; y: number }[] = []
    for (const match of sch.matchAll(/^\$Comp\n([\s\S]*?)^\$EndComp/gm)) {
      const [, libraryId, reference] = /^L (\S+) (\S+)$/m.exec(match[1])!
      const [, x, y] = /^P (-?\d+) (-?\d+)$/m.exec(match[1])!
      const definition = definitions.get(libraryId.split(':')[1])!
      assert.ok(definition)
      assert.deepEqual(definition, definitions.get(libraryId.replace(':', '_')), 'cache fallback resolves the same symbol as the library table')
      for (const pin of definition) pins.push({ id: `${reference}:${pin.number}`, x: +x + pin.x, y: +y - pin.y })
    }
    const parent = new Map<string, string>()
    const find = (key: string): string => {
      if (!parent.has(key)) parent.set(key, key)
      const next = parent.get(key)!
      if (next !== key) parent.set(key, find(next))
      return parent.get(key)!
    }
    const join = (a: string, b: string) => parent.set(find(a), find(b))
    const points: { x: number; y: number; key: string }[] = []
    const add = (x: number, y: number) => { const key = `${x},${y}`; points.push({ x, y, key }); find(key) }
    pins.forEach(pin => add(pin.x, pin.y))
    const wires = [...sch.matchAll(/^Wire Wire Line\n\s*(-?\d+) (-?\d+) (-?\d+) (-?\d+)$/gm)].map(match => match.slice(1).map(Number))
    wires.forEach(([x1, y1, x2, y2]) => { add(x1, y1); add(x2, y2) })
    const labels = [...sch.matchAll(/^Text Label (-?\d+) (-?\d+) .*\n(.*)$/gm)].map(match => ({ x: +match[1], y: +match[2], text: match[3] }))
    labels.forEach(label => add(label.x, label.y))
    for (const junction of sch.matchAll(/^Connection ~ (-?\d+) (-?\d+)$/gm)) add(+junction[1], +junction[2])
    for (const [x1, y1, x2, y2] of wires) for (const point of points) {
      if ((point.x - x1) * (y2 - y1) === (point.y - y1) * (x2 - x1) && point.x >= Math.min(x1, x2) && point.x <= Math.max(x1, x2) && point.y >= Math.min(y1, y2) && point.y <= Math.max(y1, y2)) join(`${x1},${y1}`, point.key)
    }
    const labelRoots = new Map<string, string>()
    for (const label of labels) {
      const key = `${label.x},${label.y}`, existing = labelRoots.get(label.text)
      if (existing) join(key, existing)
      else labelRoots.set(label.text, key)
    }
    const expected = new Map(layout.symbols.flatMap(symbol => symbol.pins.map(pin => [`${symbol.id}:${pin.number}`, pin.node] as const)))
    assert.equal(pins.length, expected.size)
    for (const a of pins) for (const b of pins) assert.equal(find(`${a.x},${a.y}`) === find(`${b.x},${b.y}`), expected.get(a.id) === expected.get(b.id), `${example.id}: ${a.id} / ${b.id}`)
  }
})

const bomHeader = '"Quantity","References","Component","Value","Custom model"\r\n'

test('BOM groups exact component values and ignores placement, groups and switch state', () => {
  const document = createEmptyDocument()
  document.parts = [
    { id: 'R1', kind: 'resistor', value: 10000, pins: ['a1', 'a2'] },
    { id: 'R2', kind: 'resistor', value: 10000, pins: ['a3', 'a4'], schemaGroup: 'Other' },
    { id: 'R3', kind: 'resistor', value: 10001, pins: ['a5', 'a6'] },
    { id: 'S1', kind: 'switch', value: 0, pins: ['a7', 'a8'] },
    { id: 'S2', kind: 'switch', value: 1, pins: ['a9', 'a10'] },
  ]
  const before = structuredClone(document)
  const output = buildKicadExport(document)
  const bom = output.files.find(file => file.name === `${output.basename}.bom`)!.content
  assert.ok(bom.startsWith(bomHeader))
  assert.match(bom, /"2","R1, R2","Resistor","10 kΩ",""/)
  assert.match(bom, /"1","R3","Resistor","10 kΩ",""/)
  assert.match(bom, /"2","S1, S2","[^"]+","",""/)
  assert.equal(bom.split('\r\n').length, 5)
  assert.deepEqual(document, before)
})

test('BOM preserves custom model identities and CSV quotes, commas and newlines', () => {
  const document = createEmptyDocument()
  document.customComponents = ['model1', 'model2'].map(id => ({
    id, name: 'Custom, "R"\nΩ', modelVersion: 1, baseKind: 'resistor',
    characteristic: { type: 'resistance-current', axis: 'current-magnitude', interpolation: 'linear', extrapolation: 'constant', points: [{ x: 0, y: 1000 }, { x: 1, y: 1000 }] },
  }))
  document.parts = ['model1', 'model2'].map((customModelId, index) => ({ id: `R${index + 1}`, kind: 'resistor', value: 1000, pins: [`a${index * 2 + 1}`, `a${index * 2 + 2}`], customModelId }))
  const bom = buildKicadExport(document).files.find(file => file.name.endsWith('.bom'))!.content
  for (const index of [1, 2]) assert.ok(bom.includes(`"1","R${index}","Custom, ""R""\nΩ","1 kΩ","model${index}"\r\n`))
})

test('empty BOM has only headers; Pico is included once without virtual instruments', () => {
  const document = createEmptyDocument()
  const bom = () => buildKicadExport(document).files.find(file => file.name.endsWith('.bom'))!.content
  assert.equal(bom(), bomHeader)
  document.pico = createPico()
  assert.equal(bom(), bomHeader + '"1","Pico","Raspberry Pi Pico","Connected pins · RP2040",""\r\n')
})
