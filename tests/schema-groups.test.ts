import assert from 'node:assert/strict'
import test from 'node:test'
import { assignSchemaGroup, compileCircuit, examples, SCHEMA_GROUP_NAME_LIMIT, validateDocument } from '../src/lib/circuit.ts'
import { executionFingerprint } from '../src/lib/execution-fingerprint.ts'

const example = () => structuredClone(examples.find(item => item.id === 'voltage-divider')!.document)

test('schema groups survive project JSON round trips, normalize whitespace, and leave legacy documents unchanged', () => {
  const document = example()
  assert.deepEqual(validateDocument(document), document)
  document.parts[0].schemaGroup = '  Input stage  '
  document.parts[1].schemaGroup = 'Output stage'
  const restored = validateDocument(JSON.parse(JSON.stringify(document)))
  assert.equal(restored.parts[0].schemaGroup, 'Input stage')
  assert.equal(restored.parts[1].schemaGroup, 'Output stage')
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(restored))), restored)
})

test('schema group validation rejects non-text and overlong names, and removes empty names', () => {
  for (const schemaGroup of [null, false, 12, [], {}, 'x'.repeat(SCHEMA_GROUP_NAME_LIMIT + 1)]) {
    const document = example()
    Object.assign(document.parts[0], { schemaGroup })
    assert.throws(() => validateDocument(document), /Schema group/)
  }
  const document = example()
  document.parts[0].schemaGroup = ' '.repeat(4)
  document.parts[1].schemaGroup = 'x'.repeat(SCHEMA_GROUP_NAME_LIMIT)
  const restored = validateDocument(document)
  assert.equal(Object.hasOwn(restored.parts[0], 'schemaGroup'), false)
  assert.equal(restored.parts[1].schemaGroup?.length, SCHEMA_GROUP_NAME_LIMIT)
})

test('assigning groups moves selected parts, clears membership, and preserves no-op document identity', () => {
  const document = example()
  const grouped = assignSchemaGroup(document, ['R1', 'R2'], '  Filter  ')
  assert.deepEqual(grouped.parts.map(part => part.schemaGroup), ['Filter', 'Filter'])
  assert.ok(document.parts.every(part => !Object.hasOwn(part, 'schemaGroup')))
  assert.equal(assignSchemaGroup(grouped, ['R1'], 'Filter'), grouped)
  assert.equal(assignSchemaGroup(grouped, ['missing'], 'Other'), grouped)
  const moved = assignSchemaGroup(grouped, ['R2'], 'Output')
  assert.deepEqual(moved.parts.map(part => part.schemaGroup), ['Filter', 'Output'])
  assert.equal(moved.parts[0], grouped.parts[0])
  const cleared = assignSchemaGroup(moved, ['R2'], ' ')
  assert.equal(Object.hasOwn(cleared.parts[1], 'schemaGroup'), false)
  assert.equal(cleared.parts[0].schemaGroup, 'Filter')
})

test('schema grouping leaves simulation fingerprints, compiled netlists, and connectivity unchanged', () => {
  const document = example()
  const grouped = assignSchemaGroup(document, ['R1', 'R2'], 'Divider')
  assert.equal(executionFingerprint(grouped, 0.1), executionFingerprint(document, 0.1))
  assert.deepEqual(compileCircuit(grouped), compileCircuit(document))
  const moved = assignSchemaGroup(grouped, ['R2'], 'Output')
  assert.equal(executionFingerprint(moved, 0.1), executionFingerprint(document, 0.1))
  const ungrouped = assignSchemaGroup(moved, ['R1', 'R2'], '')
  assert.deepEqual(ungrouped, document)
  assert.equal(executionFingerprint(ungrouped, 0.1), executionFingerprint(document, 0.1))
})
