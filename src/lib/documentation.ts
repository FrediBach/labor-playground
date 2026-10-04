import { PARTS, formatValue, type CircuitDocument, type CircuitExample } from './circuit.ts'
import { programFor } from './automation-migration.ts'

export const DOCUMENTATION_LIMITS = { sections: 192, title: 120, body: 8000, total: 60000 } as const
export const SECTION_KINDS = { explanation: 'Circuit explanation', component: 'Component note', automation: 'Automation note', experiment: 'Experiment', note: 'Additional note' } as const
export type SectionKind = keyof typeof SECTION_KINDS
export interface DocumentationSection {
  id: string
  kind: SectionKind
  title: string
  body: string
  /** References are retained when a part or flow is removed, so notes are never silently lost. */
  targetId?: string
}
export interface CircuitDocumentation { sections: DocumentationSection[] }

export function validateDocumentation(input: unknown): CircuitDocumentation {
  if (!input || typeof input !== 'object' || !('sections' in input) || !Array.isArray(input.sections) || input.sections.length > DOCUMENTATION_LIMITS.sections) throw new Error('Documentation requires at most 192 sections.')
  const ids = new Set<string>()
  let total = 0
  const sections = input.sections.map((entry: unknown): DocumentationSection => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid documentation section.')
    const s = entry as Record<string, unknown>
    if (typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id) || ids.has(s.id)) throw new Error('Documentation sections need unique short IDs.')
    ids.add(s.id)
    if (typeof s.kind !== 'string' || !Object.hasOwn(SECTION_KINDS, s.kind)) throw new Error('Unknown documentation section type.')
    if (typeof s.title !== 'string' || s.title.length > DOCUMENTATION_LIMITS.title || typeof s.body !== 'string' || s.body.length > DOCUMENTATION_LIMITS.body) throw new Error('Documentation titles allow 120 characters and notes allow 8,000 characters.')
    if (s.targetId !== undefined && (typeof s.targetId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.targetId) || !['component', 'automation'].includes(s.kind))) throw new Error('Invalid documentation reference.')
    total += s.title.length + s.body.length
    return { id: s.id, kind: s.kind as SectionKind, title: s.title, body: s.body, ...(s.targetId === undefined ? {} : { targetId: s.targetId as string }) }
  })
  if (total > DOCUMENTATION_LIMITS.total) throw new Error('Documentation allows 60,000 characters in total.')
  return { sections }
}

export function documentationTargets(document: CircuitDocument, kind: SectionKind): { id: string; name: string }[] {
  if (kind === 'component') return document.parts.map(part => ({ id: part.id, name: `${part.id} · ${PARTS[part.kind].label}` }))
  if (kind === 'automation') return programFor(document).definitions.map(flow => ({ id: flow.id, name: flow.name }))
  return []
}

export function sectionReference(document: CircuitDocument, section: DocumentationSection): string {
  if (!section.targetId) return SECTION_KINDS[section.kind]
  const target = documentationTargets(document, section.kind).find(t => t.id === section.targetId)
  return target ? `${SECTION_KINDS[section.kind]} · ${target.name}` : `${SECTION_KINDS[section.kind]} · ${section.targetId} (removed)`
}

/** Seed lessons from the same authored explanations used by the example guide. */
export function exampleDocumentation(example: CircuitExample): CircuitDocumentation {
  const sections: DocumentationSection[] = [
    { id: 'purpose', kind: 'explanation', title: 'What this circuit teaches', body: example.description },
    { id: 'operation', kind: 'explanation', title: 'How it works and why', body: example.why },
    { id: 'experiment', kind: 'experiment', title: 'Try it yourself', body: example.whatToChange },
    { id: 'observations', kind: 'experiment', title: 'What to observe', body: example.whatToObserve },
  ]
  for (const part of example.document.parts) {
    const relevant = [example.why, example.whatToChange, example.whatToObserve].filter(text => new RegExp(`\\b${part.id}\\b`).test(text))
    const model = example.document.customComponents?.find(model => model.id === part.customModelId)
    sections.push({ id: `part-${part.id}`, kind: 'component', targetId: part.id, title: `${part.id} · ${PARTS[part.kind].label}`, body: [model?.description || PARTS[part.kind].description, ...relevant, PARTS[part.kind].supplyHint].filter(Boolean).join('\n\n') })
  }
  if (example.document.automations?.length || example.document.automationProgram) {
    for (const flow of programFor(example.document).definitions) {
      const row = example.document.automations?.find(row => `Flow_${row.id}` === flow.id)
      const trigger = row?.trigger
      const timing = trigger?.kind === 'time' ? `Runs at ${trigger.atMs} ms into the capture.` : trigger ? `Watches ${trigger.channel} for a ${trigger.direction} crossing of ${trigger.threshold} V after ${trigger.afterMs} ms.` : 'Coordinates the experiment during a capture.'
      sections.push({ id: `flow-${flow.id}`, kind: 'automation', targetId: flow.id, title: flow.name, body: [timing, flow.description, example.why, example.whatToObserve].filter(Boolean).join('\n\n') })
    }
  }
  if (example.document.pico) sections.push({ id: 'code', kind: 'note', title: 'Pico code and circuit', body: `Read and edit the program in Pico Code, then run a new capture to compare the firmware with the measured signals.\n\n${example.why}\n\n${example.whatToChange}` })
  sections.push({ id: 'hardware', kind: 'note', title: 'Build on EDU LABOR', body: example.hardware })
  return { sections }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const escapeMarkdown = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1')

/** Both formats use the same ordered narrative and current circuit snapshot. */
export function documentationBlocks(document: CircuitDocument): { title: string; body: string; caption?: string; code?: boolean }[] {
  const blocks = (document.documentation?.sections ?? []).map(section => ({ title: section.title || SECTION_KINDS[section.kind], body: section.body, caption: sectionReference(document, section) }))
  const instruments = document.instruments
  return [
    ...blocks,
    { title: 'Circuit settings', body: `Oscillator: ${instruments.waveform}, ${instruments.frequency} Hz, ${instruments.amplitude} V peak\nCV: ${instruments.cv} V\nStimulus: ${document.stimulus ?? 'periodic'}\nCH1: ${document.probes.CH1 ?? 'Not connected'}\nCH2: ${document.probes.CH2 ?? 'Not connected'}${instruments.envelope ? `\nEnvelope: ${instruments.envelope.mode}, gate ${instruments.envelope.gateHigh ? 'high' : 'low'}, decay ${instruments.envelope.decayMs} ms` : ''}` },
    { title: 'Components and pin connections', body: document.parts.map(part => {
      const model = document.customComponents?.find(model => model.id === part.customModelId)
      return `${part.id} · ${model?.name ?? PARTS[part.kind].label} · ${formatValue(part.value, part.kind)}${part.kind === 'potentiometer' ? ` · ${Math.round((part.position ?? 0.5) * 100)}% wiper` : ''}\n${part.pins.map((pin, i) => `${PARTS[part.kind].pinNames[i]}: ${pin}`).join(', ')}${model ? `\nCustom model: ${JSON.stringify(model)}` : ''}`
    }).join('\n\n') || 'No components.' },
    { title: 'Wiring', body: document.wires.map(wire => `${wire.id}: ${wire.from} → ${wire.to}`).join('\n') || 'No wires.' },
    ...(document.automations?.length || document.automationProgram ? [{ title: 'Automation definitions', body: JSON.stringify(programFor(document), null, 2), code: true }] : []),
    ...(document.pico ? [{ title: 'Pico source', body: document.pico.source, code: true }] : []),
  ]
}

export function exportDocumentation(document: CircuitDocument, format: 'markdown' | 'html'): string {
  const blocks = documentationBlocks(document)
  if (format === 'markdown') return `# ${escapeMarkdown(document.title)}\n\nCircuit documentation\n\n${blocks.map(block => {
    const fence = '`'.repeat(Math.max(3, ...[...block.body.matchAll(/`+/g)].map(match => match[0].length + 1)))
    const body = block.code ? `${fence}\n${block.body}\n${fence}` : escapeMarkdown(block.body).replace(/\n/g, '  \n')
    return `## ${escapeMarkdown(block.title)}\n\n${block.caption ? `${escapeMarkdown(block.caption)}\n\n` : ''}${body}`
  }).join('\n\n')}\n`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(document.title)} — Circuit documentation</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#222;max-width:860px;margin:48px auto;padding:0 24px}h1{line-height:1.2}h2{margin:0 0 8px;font-size:21px}section{border-top:1px solid #ccc;padding:24px 0}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.caption{font-size:13px;color:#555}@media print{body{margin:0;max-width:none;font-size:11pt}h2,.caption{break-after:avoid}section{padding:14px 0}@page{margin:18mm}}</style></head><body><h1>${escapeHtml(document.title)}</h1><p>Circuit documentation</p>${blocks.map(block => `<section><h2>${escapeHtml(block.title)}</h2>${block.caption ? `<p class="caption">${escapeHtml(block.caption)}</p>` : ''}<p>${escapeHtml(block.body)}</p></section>`).join('')}</body></html>`
}
