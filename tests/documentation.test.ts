import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyDocument, examples, validateDocument } from '../src/lib/circuit.ts'
import { DOCUMENTATION_LIMITS, documentationTargets, exportDocumentation, sectionReference, validateDocumentation } from '../src/lib/documentation.ts'
import { executionFingerprint } from '../src/lib/execution-fingerprint.ts'
import { programFor, withProgram } from '../src/lib/automation-migration.ts'

test('every example includes an editable lesson and linked notes for each component and automation', () => {
  for (const example of examples) {
    const document = validateDocument(JSON.parse(JSON.stringify(example.document)))
    assert.deepEqual(document.documentation, example.document.documentation, example.id)
    const sections = document.documentation!.sections
    for (const text of [example.description, example.why, example.whatToChange, example.whatToObserve, example.hardware]) assert.ok(sections.some(section => section.body === text), example.id)
    for (const part of document.parts) assert.ok(sections.some(section => section.kind === 'component' && section.targetId === part.id && section.body.length > 20), `${example.id}: ${part.id}`)
    if (document.automations?.length || document.automationProgram) for (const flow of programFor(document).definitions) assert.ok(sections.some(section => section.kind === 'automation' && section.targetId === flow.id), `${example.id}: ${flow.id}`)
  }
})

test('legacy projects stay unchanged and documentation does not affect simulation semantics', () => {
  const legacy = createEmptyDocument()
  assert.equal(Object.hasOwn(validateDocument(legacy), 'documentation'), false)
  const document = structuredClone(examples[0].document)
  const key = executionFingerprint(document, 0.1)
  document.documentation!.sections.reverse()
  document.documentation!.sections[0].body = 'Changed narrative, unchanged circuit.'
  assert.equal(executionFingerprint(document, 0.1), key)
  const automation = examples.find(example => example.id === 'automated-pot-sweep')!.document
  assert.deepEqual(withProgram(automation, programFor(automation)).documentation, automation.documentation)
  const section = automation.documentation!.sections.find(section => section.kind === 'automation')!
  assert.ok(documentationTargets(withProgram(automation, programFor(automation)), 'automation').some(target => target.id === section.targetId))
})

test('notes retain missing references and reject malformed, duplicate, or oversized content', () => {
  const section = { id: 'one', kind: 'component', title: 'Part notes', body: 'Keep this explanation.', targetId: 'R9' } as const
  const document = validateDocument({ ...createEmptyDocument(), documentation: { sections: [section] } })
  assert.match(sectionReference(document, section), /R9 \(removed\)/)
  for (const sections of [[section, section], [{ ...section, kind: '__proto__' }], [{ ...section, body: null }], [{ ...section, targetId: {} }], [{ ...section, title: 'x'.repeat(121) }], [{ ...section, body: 'x'.repeat(DOCUMENTATION_LIMITS.body + 1) }], Array.from({ length: 101 }, (_, i) => ({ ...section, id: String(i) }))]) assert.throws(() => validateDocumentation({ sections }))
  assert.throws(() => validateDocumentation({ sections: Array.from({ length: 8 }, (_, i) => ({ ...section, id: String(i), body: 'x'.repeat(8000) })) }), /60,000/)
})

test('documentation export preserves section order, live circuit values, source, and escapes active content', () => {
  const document = structuredClone(examples.find(example => example.id === 'pico-console')!.document)
  document.title = '<script>alert("title")</script>'
  document.documentation = { sections: [
    { id: 'one', kind: 'explanation', title: 'First', body: '<img src=x onerror=alert(1)>\nSecond line' },
    { id: 'two', kind: 'note', title: 'Second', body: '[click](javascript:alert(1))' },
  ] }
  document.instruments.frequency = 777
  document.pico!.source = '# ```\nprint("<hello>")'
  const html = exportDocumentation(document, 'html')
  assert.doesNotMatch(html, /<script|<img/)
  assert.match(html, /&lt;img/)
  assert.match(html, /777 Hz/)
  assert.ok(html.indexOf('<h2>First</h2>') < html.indexOf('<h2>Second</h2>'))
  const markdown = exportDocumentation(document, 'markdown')
  assert.match(markdown, /&lt;script/)
  assert.ok(markdown.includes('\\[click\\]\\(javascript:alert\\(1\\)\\)'))
  assert.ok(markdown.includes('````\n# ```\nprint("<hello>")\n````'))
  assert.match(markdown, /Components and pin connections/)
  const automated = exportDocumentation(examples.find(example => example.id === 'automated-pot-sweep')!.document, 'markdown')
  assert.match(automated, /Automation definitions/)
  assert.match(automated, /"durationMs": 40/)
})
