import { useEffect, useRef, useState } from 'react'
import { PARTS, type CircuitDocument, type ComponentKind } from '@/lib/circuit'
import { buildKicadDocument, selectKicadComponent, type KicadImport, type KicadSelection, type KicadSources } from '@/lib/kicad-import'
import './KicadImportDialog.css'

function ComponentMatch({ component, selection, onChange }: { component: KicadImport['components'][number]; selection: KicadSelection; onChange: (selection: KicadSelection) => void }) {
  const [query, setQuery] = useState('')
  const options = Object.entries(PARTS).filter(([kind, definition]) => kind !== 'subcircuit' && (kind === selection.kind || `${kind} ${definition.label} ${definition.description}`.toLowerCase().includes(query.toLowerCase())))
  const definition = selection.kind ? PARTS[selection.kind] : null
  return <fieldset className="kicad-component"><legend>{component.reference} · {component.value}</legend>
    <p>{component.library} · {component.suggested ? 'Suggested match — verify below' : 'No automatic match — find a component below'}</p>
    <div className="kicad-fields">
      <label>Search library<input type="search" aria-label={`Search matches for ${component.reference}`} value={query} placeholder="Name, type, or description" onChange={event => setQuery(event.target.value)} /></label>
      <label>Labor component<select aria-label={`Component for ${component.reference}`} value={selection.kind} onChange={event => onChange(selectKicadComponent(component, event.target.value as ComponentKind | ''))}>
        <option value="">Choose a component…</option>{options.map(([kind, part]) => <option key={kind} value={kind}>{part.label}</option>)}
      </select></label>
    </div>
    {definition && <>
      <p>{definition.description}</p>
      <label>Value ({definition.unit || 'model setting'})<input aria-label={`Value for ${component.reference}`} type="number" step="any" value={selection.value} onChange={event => onChange({ ...selection, value: event.target.value })} /></label>
      <details><summary>Model assumptions</summary><p>{definition.model}</p></details>
      <p>Connect each Labor pin to a KiCad pin. All KiCad pins must be assigned once.</p>
      <div className="kicad-fields">{definition.pinNames.map((name, index) => <label key={`${selection.kind}:${index + 1}`}>{index + 1} · {name}<select aria-label={`${component.reference} pin ${index + 1}`} value={selection.pins[index] ?? ''} onChange={event => onChange({ ...selection, pins: selection.pins.map((pin, i) => i === index ? event.target.value : pin) })}>
        <option value="">Unconnected Labor pin</option>{component.pins.map(pin => <option key={pin.number} value={pin.number}>{pin.number} · {pin.name}</option>)}
      </select></label>)}</div>
    </>}
  </fieldset>
}

export function KicadImportDialog({ source, onImport, onCancel }: { source: KicadImport; onImport: (document: CircuitDocument) => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selections, setSelections] = useState(() => source.components.map(component => selectKicadComponent(component, component.suggested ?? '')))
  const [sources, setSources] = useState<KicadSources>({})
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null
    const element = dialog.current; element?.showModal()
    return () => { element?.close(); previous?.focus() }
  }, [])
  const remaining = selections.filter(selection => !selection.kind).length
  return <dialog ref={dialog} className="kicad-import" aria-labelledby="kicad-import-title" onCancel={onCancel} onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={event => {
      event.preventDefault()
      try { onImport(buildKicadDocument(source, selections, sources)) } catch (cause) { setError((cause as Error).message) }
    }}>
      <header><h2 id="kicad-import-title">Review KiCad import</h2><button type="button" onClick={onCancel} aria-label="Cancel KiCad import">×</button></header>
      <p><strong>{source.title}</strong> · {source.components.length} components · {remaining ? `${remaining} need a match` : 'All components matched'}</p>
      <p>Confirm components, values, and pin assignments. Labor uses educational models and arranges the circuit on a breadboard. The imported circuit replaces the current project; Undo restores it.</p>
      {source.components.map((component, index) => <ComponentMatch key={component.reference} component={component} selection={selections[index]} onChange={selection => { setSelections(previous => previous.map((item, i) => i === index ? selection : item)); setError('') }} />)}
      <fieldset><legend>Power and signal connections</legend><p>Net names alone do not supply voltage. Choose any workbench sources to connect using visible wires, including ground. Unassigned nets keep their original connections.</p>
        {source.nets.filter(net => net.labels.length).map(net => <label key={net.id}>{net.labels.join(' / ')}<select aria-label={`Source for ${net.labels.join(' / ')}`} value={sources[net.id] ?? ''} onChange={event => { setSources(previous => ({ ...previous, [net.id]: event.target.value })); setError('') }}>
          <option value="">No workbench source</option><option value="gnd">Ground (0 V)</option><option value="vplus">+12 V</option><option value="vminus">−12 V</option><option value="cv">CV (initially +5 V)</option><option value="osc">Signal generator</option><option value="eg">Envelope generator</option>
        </select></label>)}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={remaining > 0}>Confirm and import</button></footer>
    </form>
  </dialog>
}
