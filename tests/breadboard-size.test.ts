import assert from 'node:assert/strict'
import test from 'node:test'
import { boardGeometry, boardConfiguration, createEmptyDocument, getPlacement, isValidFootprint, resolveTopology, resizeBoard, validateDocument, type CircuitDocument } from '../src/lib/circuit.ts'
import { leadPlacementError, previewLeadPins } from '../src/lib/part-editing.ts'
import { executionFingerprint } from '../src/lib/execution-fingerprint.ts'
import { programFor } from '../src/lib/automation-migration.ts'
import { buildSchematic } from '../src/lib/schematic.ts'

const large = (): CircuitDocument => ({ ...createEmptyDocument(), board: { columns: 60, rows: 3 } })

test('legacy geometry stays unchanged and all bounded board sizes round-trip', () => {
  const legacy = createEmptyDocument()
  assert.deepEqual(validateDocument(legacy), legacy)
  assert.deepEqual(boardConfiguration(legacy), { columns: 30, rows: 1 })
  for (const columns of [30, 45, 60] as const) for (const rows of [1, 2, 3] as const) {
    const doc = { ...legacy, board: { columns, rows } }
    const exported = JSON.stringify(doc)
    assert.deepEqual(validateDocument(JSON.parse(exported)), doc)
    const geometry = boardGeometry(doc)
    assert.equal(geometry.holes.length, columns * rows * 14)
    assert.equal(new Set(geometry.holes.map(hole => hole.id)).size, geometry.holes.length)
    for (const hole of boardGeometry().holes) assert.deepEqual(geometry.terminalById[hole.id], hole)
  }
  for (const board of [null, {}, { columns: 31, rows: 1 }, { columns: 60, rows: 4 }, { columns: 45, rows: 1.5 }, { columns: '60', rows: 1 }]) {
    assert.throws(() => validateDocument({ ...legacy, board }), /Breadboard|breadboard/)
  }
})

test('every row, trench and 15-column rail segment stays isolated until wired', () => {
  const doc = large()
  const nodes = resolveTopology(doc).nodeByTerminal
  for (const prefix of ['', 'r2:', 'r3:']) {
    assert.equal(nodes[`${prefix}a60`], nodes[`${prefix}e60`])
    assert.equal(nodes[`${prefix}f60`], nodes[`${prefix}j60`])
    assert.notEqual(nodes[`${prefix}e60`], nodes[`${prefix}f60`])
    for (const rail of ['tp', 'tn', 'bp', 'bn']) {
      for (const start of [1, 16, 31, 46]) assert.equal(nodes[`${prefix}${rail}${start}`], nodes[`${prefix}${rail}${start + 14}`])
      for (const end of [15, 30, 45]) assert.notEqual(nodes[`${prefix}${rail}${end}`], nodes[`${prefix}${rail}${end + 1}`])
      assert.notEqual(nodes[`${prefix}${rail}1`], nodes.gnd)
    }
  }
  assert.notEqual(nodes.a60, nodes['r2:a60'])
  assert.notEqual(nodes['r2:a60'], nodes['r3:a60'])
  assert.notEqual(nodes.tp1, nodes['r2:tp1'])
  doc.wires = [{ id: 'W1', from: 'e60', to: 'r2:a60', color: '#ffffff' }]
  const wired = resolveTopology(doc).nodeByTerminal
  assert.equal(wired.a60, wired['r2:e60'])
  assert.notEqual(wired.a60, wired['r3:e60'])
  assert.deepEqual(buildSchematic(doc).warnings, [])
})

test('placement and lead editing support extended columns and rows without crossing rigid footprints', () => {
  const doc = large()
  assert.deepEqual(getPlacement('resistor', 'r3:a57', 0, doc), ['r3:a57', 'r3:a60'])
  assert.equal(getPlacement('resistor', 'r3:a58', 0, doc), null)
  assert.equal(getPlacement('resistor', 'r3:a1'), null)
  const dip = getPlacement('opamp', 'r2:e57', 0, doc)!
  assert.deepEqual(dip, ['r2:e57', 'r2:e58', 'r2:e59', 'r2:e60', 'r2:f60', 'r2:f59', 'r2:f58', 'r2:f57'])
  assert.ok(isValidFootprint('opamp', dip, doc))
  assert.ok(isValidFootprint('opamp', getPlacement('opamp', 'r3:f60', 180, doc)!, doc))
  assert.equal(isValidFootprint('opamp', [...dip.slice(0, 4), ...dip.slice(4).map(pin => pin.replace('r2:', 'r3:'))], doc), false)
  assert.equal(getPlacement('npn', 'r2:e40', 90, doc), null)
  const part = { id: 'R1', kind: 'resistor' as const, value: 1000, pins: ['r3:c40', 'r3:c43'] }
  doc.parts = [part]
  assert.deepEqual(previewLeadPins(part, 1, 'r3:c44', doc), ['r3:c40', 'r3:c44'])
  assert.equal(leadPlacementError(doc, part, 1, 'r3:c44'), null)
  assert.match(leadPlacementError(doc, part, 1, 'r2:c44')!, /spacings/)
  assert.deepEqual(validateDocument(doc), doc)
  assert.throws(() => validateDocument({ ...doc, board: { columns: 30, rows: 1 } }), /Unknown terminal/)
})

test('shrinking preserves attachments and resizing invalidates captures with different node mappings', () => {
  const doc = large()
  doc.probes.CH1 = 'r3:a60'
  assert.throws(() => resizeBoard(doc, { columns: 60, rows: 2 }), /R3:A60.*in use/)
  assert.throws(() => resizeBoard(doc, { columns: 45, rows: 3 }), /R3:A60.*in use/)
  doc.probes.CH1 = null
  assert.deepEqual(resizeBoard(doc, { columns: 30, rows: 1 }).board, { columns: 30, rows: 1 })
  const legacy = createEmptyDocument()
  assert.equal(executionFingerprint(legacy, 0.1), executionFingerprint({ ...legacy, board: { columns: 30, rows: 1 } }, 0.1))
  assert.notEqual(executionFingerprint(legacy, 0.1), executionFingerprint(doc, 0.1))
  assert.equal(boardGeometry(doc).terminalById['pico:1'].x - boardGeometry().terminalById['pico:1'].x, 720)
})


test('shrinking refuses occupied holes and physical flow signal references', () => {
  const doc = large()
  doc.parts = [{ id: 'R1', kind: 'resistor', value: 1000, pins: ['r2:a40', 'r2:a43'] }]
  assert.throws(() => resizeBoard(doc, { columns: 30, rows: 3 }), /R2:A40.*in use/)
  doc.parts = []
  doc.wires = [{ id: 'W1', from: 'gnd', to: 'r2:tp40', color: '#ffffff' }]
  assert.throws(() => resizeBoard(doc, { columns: 30, rows: 3 }), /R2:TP40.*in use/)
  doc.wires = []
  doc.schemaVersion = 4
  doc.automationProgram = programFor(doc)
  doc.automationProgram.signals = [{ id: 'Sense', name: 'Sense', kind: 'voltage', positive: 'r3:a1', negative: 'r2:a60' }]
  assert.throws(() => resizeBoard(doc, { columns: 60, rows: 2 }), /R3:A1.*in use/)
  assert.throws(() => resizeBoard(doc, { columns: 45, rows: 3 }), /R2:A60.*in use/)
})
