import { useState } from 'react'
import { ArrowDown, ArrowDownToLine, ArrowUp, BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { type CircuitDocument, validateDocument } from '@/lib/circuit'
import { DOCUMENTATION_LIMITS, SECTION_KINDS, documentationBlocks, documentationTargets, exportDocumentation, sectionReference, type DocumentationSection, type SectionKind } from '@/lib/documentation'
import './DocumentationPanel.css'

export function DocumentationPanel({ document, onChange, onMessage }: {
  document: CircuitDocument
  onChange: (document: CircuitDocument) => void
  onMessage: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [kind, setKind] = useState<SectionKind>('explanation')
  const [error, setError] = useState('')
  const sections = document.documentation?.sections ?? []
  const selected = sections.find(section => section.id === selectedId) ?? sections[0]
  const index = selected ? sections.indexOf(selected) : -1
  const targets = selected ? documentationTargets(document, selected.kind) : []

  function save(sections: DocumentationSection[]) {
    try {
      const next = validateDocument({ ...document, documentation: { sections } })
      onChange(next)
      setError('')
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save documentation.')
      return false
    }
  }
  function update(patch: Partial<DocumentationSection>) {
    save(sections.map(section => section.id === selected.id ? { ...section, ...patch } : section))
  }
  function add() {
    const id = crypto.randomUUID()
    if (save([...sections, { id, kind, title: SECTION_KINDS[kind], body: '' }])) { setSelectedId(id); setEditing(true) }
  }
  function move(offset: number) {
    const next = [...sections]
    ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
    save(next)
  }
  function download(format: 'markdown' | 'html') {
    const url = URL.createObjectURL(new Blob([exportDocumentation(document, format)], { type: format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8' }))
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `${document.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'circuit'}-documentation.${format === 'html' ? 'html' : 'md'}`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    onMessage(format === 'html' ? 'Documentation exported. Open the HTML file to read it or print to PDF.' : 'Circuit documentation exported as Markdown.')
  }

  return <div className="documentation-panel">
    <header className="documentation-heading">
      <div><span className="documentation-eyebrow"><BookOpen size={15} />CIRCUIT NOTEBOOK</span><h2>{document.title}</h2><p>Explain the ideas, annotate the parts, and share what you learn.</p></div>
      <div className="documentation-actions">
        <button type="button" onClick={() => setEditing(!editing)}>{editing ? <BookOpen size={14} /> : <Pencil size={14} />}{editing ? 'Read documentation' : 'Edit documentation'}</button>
        <button type="button" onClick={() => download('markdown')}><ArrowDownToLine size={14} />Export Markdown</button>
        <button type="button" onClick={() => download('html')}><ArrowDownToLine size={14} />Export HTML</button>
      </div>
    </header>
    <p className="documentation-hint">Notes are saved with the circuit and support Undo. Exports include current settings, parts, wiring, automations, and Pico code when present. Open the HTML export to print or save as PDF.</p>
    {error && <p role="alert" className="documentation-error">{error}</p>}
    {editing ? <>
      <div className="documentation-add"><label>Section type<select aria-label="Section type" value={kind} onChange={event => setKind(event.target.value as SectionKind)}>{Object.entries(SECTION_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" onClick={add} disabled={sections.length >= DOCUMENTATION_LIMITS.sections}><Plus size={14} />Add section</button><span>{sections.length} / {DOCUMENTATION_LIMITS.sections} sections</span></div>
      <div className="documentation-compose">
        <nav aria-label="Documentation sections">{sections.map((section, i) => <button key={section.id} type="button" aria-current={section.id === selected?.id ? 'true' : undefined} onClick={() => setSelectedId(section.id)}><span>{String(i + 1).padStart(2, '0')}</span><div>{section.title || SECTION_KINDS[section.kind]}<small>{SECTION_KINDS[section.kind]}</small></div></button>)}</nav>
        {selected ? <section className="documentation-editor" aria-label="Section editor">
          <div className="documentation-editor-tools"><span>{SECTION_KINDS[selected.kind]}</span><button type="button" aria-label="Move section up" disabled={index === 0} onClick={() => move(-1)}><ArrowUp size={14} /></button><button type="button" aria-label="Move section down" disabled={index === sections.length - 1} onClick={() => move(1)}><ArrowDown size={14} /></button><button type="button" aria-label="Delete section" onClick={() => { if (save(sections.filter(section => section.id !== selected.id))) setSelectedId(sections[index + 1]?.id ?? sections[index - 1]?.id ?? null) }}><Trash2 size={14} /></button></div>
          <label>Section title<input aria-label="Section title" maxLength={DOCUMENTATION_LIMITS.title} value={selected.title} onChange={event => update({ title: event.target.value })} /></label>
          {['component', 'automation'].includes(selected.kind) && <label>{selected.kind === 'component' ? 'Linked component' : 'Linked automation'}<select aria-label={selected.kind === 'component' ? 'Linked component' : 'Linked automation'} value={selected.targetId ?? ''} onChange={event => update({ targetId: event.target.value || undefined })}><option value="">General note</option>{selected.targetId && !targets.some(target => target.id === selected.targetId) && <option value={selected.targetId}>{selected.targetId} (removed)</option>}{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
          <label>Section notes<textarea aria-label="Section notes" rows={14} maxLength={DOCUMENTATION_LIMITS.body} placeholder="Describe what happens, why it happens, and what to try…" value={selected.body} onChange={event => update({ body: event.target.value })} /></label>
          <p className="documentation-hint">Plain text; paragraph breaks are preserved. {selected.body.length.toLocaleString()} / 8,000 characters.</p>
        </section> : <div className="documentation-empty"><BookOpen size={26} /><h3>Start your circuit notebook</h3><p>Add an explanation, a component note, an automation note, or an experiment using the controls above.</p></div>}
      </div>
    </> : <div className="documentation-reader">
      {!sections.length && <div className="documentation-empty"><BookOpen size={26} /><h3>A place for the why and how</h3><p>Document your circuit’s purpose, design choices, and experiments.</p><button type="button" onClick={() => setEditing(true)}><Pencil size={14} />Start writing</button></div>}
      {sections.map(section => <section className="documentation-section" key={section.id}><span className="documentation-caption">{sectionReference(document, section)}</span><h3>{section.title || SECTION_KINDS[section.kind]}</h3><p>{section.body || 'No notes yet.'}</p></section>)}
      <details className="documentation-snapshot"><summary>Current circuit reference · included in exports</summary>{documentationBlocks({ ...document, documentation: undefined }).map(block => <section className="documentation-section" key={block.title}><h3>{block.title}</h3><pre>{block.body}</pre></section>)}</details>
    </div>}
  </div>
}
