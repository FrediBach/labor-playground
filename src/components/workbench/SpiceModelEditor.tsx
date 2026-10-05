import { useEffect, useRef, useState } from 'react'
import type { CircuitDocument } from '@/lib/circuit'
import { saveCustomComponent, type SpiceComponent } from '@/lib/custom-components'
import { SPICE_IMPORT_BYTES } from '@/lib/spice-models'
import { parseSpiceLibrary, importedSpiceText, subcircuitTerminals, subcircuitPackagePins, type ImportedSpice, type SpiceSubcircuit } from '@/lib/spice-subcircuits'
import './CustomComponents.css'

function reviewSource(source: string, entry: string, initial: SpiceComponent | undefined, mapping: number[]) {
  let models: ImportedSpice[] = [], error = ''
  try { models = parseSpiceLibrary(source) } catch (cause) { error = (cause as Error).message }
  const selected = models.find(model => model.entryPoint === entry) ?? models[0]
  const baseKind = selected?.device === 'SUBCKT' ? 'subcircuit' : selected?.device === 'D' ? 'diode' : selected?.device === 'NPN' ? 'npn' : 'pnp'
  if (initial && selected && initial.baseKind !== baseKind) error = 'An existing model must keep its device type. Import a new model to change type.'
  const terminalCount = selected?.device === 'SUBCKT' ? subcircuitTerminals(selected).length : 0
  const pinMap = mapping.length === terminalCount ? mapping : Array.from({ length: terminalCount }, (_, i) => i)
  if (selected?.device === 'SUBCKT' && (new Set(pinMap).size !== pinMap.length || pinMap.some(pin => pin >= subcircuitPackagePins(selected)))) error = 'Map every terminal to a different package pin.'
  return { models, selected, pinMap, error } as const
}

function saveDraft(document: CircuitDocument, selected: ImportedSpice, name: string, description: string, pinMap: number[], initial?: SpiceComponent) {
  if (initial && !document.customComponents?.some(model => model.id === initial.id)) throw new Error('This model was removed. Cancel and import it again.')
  const base = { id: initial?.id ?? `model_${crypto.randomUUID().slice(0, 20)}`, name: name.trim() || selected.entryPoint, description, modelVersion: 1 as const }
  const model: SpiceComponent = selected.device === 'SUBCKT' ? { ...base, baseKind: 'subcircuit', spice: selected, pinMap } : { ...base, baseKind: selected.device === 'D' ? 'diode' : selected.device === 'NPN' ? 'npn' : 'pnp', spice: selected }
  return { document: saveCustomComponent(document, model), model }
}

export function SpiceModelEditor({ initial, document, onSave, onCancel }: { initial?: SpiceComponent; document: CircuitDocument; onSave: (document: CircuitDocument, model: SpiceComponent) => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const sourceInput = useRef<HTMLTextAreaElement>(null)
  const fileRequest = useRef(0)
  const [source, setSource] = useState(initial ? importedSpiceText(initial.spice) : '')
  const [entry, setEntry] = useState(initial?.spice.entryPoint ?? '')
  const [mapping, setMapping] = useState<number[]>(initial?.baseKind === 'subcircuit' ? initial.pinMap : [])
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [commitError, setCommitError] = useState('')
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null
    const element = dialog.current
    element?.showModal(); sourceInput.current?.focus()
    return () => { element?.close(); previous?.focus() }
  }, [])
  const { models, selected, pinMap, error } = reviewSource(source, entry, initial, mapping)
  return <dialog ref={dialog} className="custom-editor" aria-labelledby="spice-editor-title" onCancel={onCancel} onKeyDown={event => event.stopPropagation()}>
    <form noValidate onSubmit={event => {
      event.preventDefault()
      if (error || !selected) return
      try {
        const saved = saveDraft(document, selected, name, description, pinMap, initial)
        onSave(saved.document, saved.model)
      } catch (cause) { setCommitError((cause as Error).message) }
    }}>
      <div className="custom-heading"><h2 id="spice-editor-title">{initial ? 'Edit SPICE model' : 'Import SPICE model'}</h2><button type="button" aria-label="Close SPICE editor" onClick={onCancel}>×</button></div>
      <p>Import a .MODEL device or a self-contained .SUBCKT component. Choose one definition from a file, or paste its text below.</p>
      <label>Model file (.lib, .mod, .cir, .txt)<input type="file" accept=".lib,.mod,.cir,.txt" onChange={async event => {
        const file = event.target.files?.[0], request = ++fileRequest.current
        if (!file) return
        try {
          if (file.size > SPICE_IMPORT_BYTES) throw new Error('SPICE files must be at most 64 kB.')
          const text = await file.text()
          if (request !== fileRequest.current) return
          setSource(text); setEntry(''); setMapping([]); setCommitError('')
        } catch (cause) { if (request === fileRequest.current) setCommitError((cause as Error).message) }
        event.target.value = ''
      }} /></label>
      <label>SPICE source<textarea ref={sourceInput} aria-label="SPICE source" rows={7} spellCheck={false} value={source} maxLength={SPICE_IMPORT_BYTES} placeholder=".model MY_DIODE D(IS=2.52n N=1.752 RS=0.568 CJO=4p)" onChange={event => { fileRequest.current++; setSource(event.target.value); setCommitError('') }} /></label>
      {models.length > 0 && <label>Model entry point<select value={selected.entryPoint} onChange={event => { setEntry(event.target.value); setCommitError('') }}>{models.map(model => <option key={model.entryPoint} value={model.entryPoint}>{model.entryPoint} ({model.device})</option>)}</select></label>}
      <label>Display name<input aria-label="Model name" maxLength={80} value={name} placeholder={selected?.entryPoint ?? 'Uses the selected model name'} onChange={event => { setName(event.target.value); setCommitError('') }} /></label>
      <label>Source and limitations<textarea aria-label="Model description" maxLength={500} value={description} onChange={event => { setDescription(event.target.value); setCommitError('') }} placeholder="Manufacturer, source URL, intended operating range and known limitations" /></label>
      <ModelPinMapping model={selected} pinMap={pinMap} onChange={next => { setMapping(next); setCommitError('') }} />
      <p className="micro-copy">Supports numeric ngspice level-1 parameters, engineering suffixes (M = milli, Meg = mega), comments and + continuation lines. Subcircuits support R/C/L, D/Q, DC voltage/current sources, linear controlled sources and X calls within the same file. Expressions, parameters, includes and encrypted models are unsupported. Captures use DC and transient analyses; model accuracy depends on the supplied parameters.</p>
      {initial && <p>Saving updates {document.parts.filter(part => part.customModelId === initial.id).length} placed instances sharing this model.</p>}
      {(error || commitError) && <p role="alert">{commitError || error}</p>}
      <div className="custom-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={!!error || !!commitError}>{initial ? 'Save model' : 'Import model'}</button></div>
    </form>
  </dialog>
}

function ModelPinMapping({ model, pinMap, onChange }: { model?: ImportedSpice; pinMap: number[]; onChange: (mapping: number[]) => void }) {
  if (!model) return null
  if (model.device === 'SUBCKT') return <SubcircuitPinMapping model={model} pinMap={pinMap} onChange={onChange} />
  return <p><strong>Workbench pin mapping:</strong> {model.device === 'D' ? '1 = Anode, 2 = Cathode.' : '1 = Collector, 2 = Base, 3 = Emitter.'} Check the physical device’s datasheet; package pin numbers may differ.</p>
}

function SubcircuitPinMapping({ model, pinMap, onChange }: { model: SpiceSubcircuit; pinMap: number[]; onChange: (mapping: number[]) => void }) {
  const count = subcircuitPackagePins(model)
  return <fieldset className="subcircuit-pin-map"><legend>Workbench pin mapping</legend>
    <p>{count === 2 ? 'Two-lead component' : `Virtual DIP-${count} package`}. Map each declared terminal to a physical pin. Unassigned pins are NC. This does not identify the manufacturer’s package.</p>
    {subcircuitTerminals(model).map((terminal, index) => <label key={terminal}>{terminal}<select aria-label={`Package pin for ${terminal}`} value={pinMap[index]} onChange={event => onChange(pinMap.map((pin, i) => i === index ? Number(event.target.value) : pin))}>{Array.from({ length: count }, (_, pin) => <option key={pin} value={pin}>Pin {pin + 1}</option>)}</select></label>)}
    {model.ground && <p>The model uses global SPICE node 0. Its reference pin must be wired to workbench GND.</p>}
  </fieldset>
}
