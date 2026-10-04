import { isSwitchKind } from '@/lib/utility-cell-models'
import { useId, useRef, useState } from 'react'
import { resolvePartModel, partDisplayName, partValueSummary, assignCustomComponent, duplicateCustomComponent, type CustomComponent } from '@/lib/custom-components'
import { CurvePreview } from './CustomComponentEditor'
import { Cable, Check, Info, MousePointer2, RotateCcw, Trash2 } from 'lucide-react'
import { assignSchemaGroup, PARTS, SCHEMA_GROUP_NAME_LIMIT, type CircuitDocument } from '@/lib/circuit'
import { CommitSlider, NumberField } from './ParameterControls'
import { PartIcon } from './PartIcon'
import type { OperatingPoint } from '@/lib/simulation-types'
import { formatElectrical } from '@/lib/format-electrical'
import { hasEditableLeads, type LeadEdit } from '@/lib/part-editing'
import { RecordedMeasurements, RecordedWireVoltage } from './RecordedMeasurements'
import './InspectorSchemaGroup.css'

function SchemaGroupField({ value, groups, onCommit }: { value: string; groups: string[]; onCommit: (value: string) => void }) {
  const listId = useId()
  const [editing, setEditing] = useState({ source: value, text: value })
  if (editing.source !== value) setEditing({ source: value, text: value })
  const cancelled = useRef(false)
  const draft = editing.source === value ? editing.text : value
  return <div className="inspector-section schema-group-field">
    <label>
      <span>Schema group</span>
      <input
        type="text" value={draft} list={listId} maxLength={SCHEMA_GROUP_NAME_LIMIT} placeholder="Ungrouped"
        aria-describedby={`${listId}-hint`}
        onChange={event => setEditing({ source: value, text: event.target.value })}
        onBlur={() => {
          if (cancelled.current) { cancelled.current = false; return }
          const name = draft.trim()
          setEditing({ source: name, text: name })
          if (name !== value) onCommit(name)
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancelled.current = true
            setEditing({ source: value, text: value })
            event.currentTarget.blur()
          }
        }}
      />
    </label>
    <datalist id={listId}>{groups.map(group => <option key={group} value={group} />)}</datalist>
    <p className="micro-copy" id={`${listId}-hint`}>Components with the same group appear together in Schema. Leave empty to ungroup.</p>
  </div>
}

interface InspectorProps {
  onEditModel: (model: CustomComponent) => void
  onCreateModel: (part: import('@/lib/circuit').Part) => void
  document: CircuitDocument
  selectedId: string | null
  onChange: (document: CircuitDocument) => void
  onDelete: () => void
  colors: string[]
  operatingPoint?: OperatingPoint
  nodeByTerminal?: Record<string, string>
  editingLead?: LeadEdit | null
  onStartLeadEdit: (edit: LeadEdit) => void
  onFinishLeadEdit: () => void
}

const EMPTY_NODE_BY_TERMINAL: Record<string, string> = {}

export function Inspector({ onEditModel, onCreateModel, document, selectedId, onChange, onDelete, colors, operatingPoint, nodeByTerminal = EMPTY_NODE_BY_TERMINAL, editingLead, onStartLeadEdit, onFinishLeadEdit }: InspectorProps) {
  const [modelError, setModelError] = useState('')
  const modelAction = (action: () => CircuitDocument) => { try { onChange(action()); setModelError('') } catch (e) { setModelError((e as Error).message) } }
  const part = document.parts.find(item => item.id === selectedId)
  const wire = document.wires.find(item => item.id === selectedId)
  const definition = part ? PARTS[part.kind] : null
  const model = part ? resolvePartModel(document, part) : undefined
  const integratedCircuit = !!definition?.package
  const resistive = part?.kind === 'resistor' || part?.kind === 'potentiometer'
  const capacitive = part?.kind === 'capacitor' || part?.kind === 'electrolytic'
  const inductive = part?.kind === 'inductor'
  const zener = part?.kind === 'zener'
  const fet = part?.kind === 'njfet' || part?.kind === 'nmos' || part?.kind === 'pmos'
  const transistor = fet || part?.kind === 'npn' || part?.kind === 'pnp'
  const polarized = part?.kind === 'electrolytic' || part?.kind === 'diode' || part?.kind === 'schottky' || zener || part?.kind === 'led'
  const dc = part ? operatingPoint?.parts[part.id] : undefined
  const unit = resistive ? 'kΩ' : inductive ? 'mH' : zener ? 'V' : part?.kind === 'electrolytic' ? 'µF' : 'nF'
  const factor = resistive ? 1e3 : inductive ? 1e-3 : zener ? 1 : part?.kind === 'electrolytic' ? 1e-6 : 1e-9
  const presets = resistive ? [1, 4.7, 10, 22, 100] : inductive ? [1, 4.7, 10, 47, 100] : zener ? [2.7, 3.3, 5.1, 6.8, 12] : part?.kind === 'electrolytic' ? [0.47, 1, 2.2, 4.7, 10] : [10, 47, 100, 220, 470]
  const updatePart = (patch: Partial<NonNullable<typeof part>>) => {
    if (part) onChange({ ...document, parts: document.parts.map(item => item.id === part.id ? { ...item, ...patch } : item) })
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="panel-heading"><h2>Inspector</h2><span className="tiny-tag">{part?.id ?? wire?.id ?? '—'}</span></div>
      {part && definition ? <>
        <div className="selected-part-summary">
          <div className="selected-part-art"><PartIcon kind={part.kind} value={part.value} position={part.position} large /></div>
          <span className="eyebrow">{part.id} · {part.kind === 'lm4040' ? 'SHUNT REFERENCE · TO-92' : integratedCircuit ? `EDUCATIONAL MODEL · ${definition.package}` : transistor ? `GENERIC ${part.kind.toUpperCase()} · ${fet ? 'D / G / S' : 'C / B / E'}` : polarized ? 'POLARIZED' : part.kind === 'capacitor' ? 'NON-POLARIZED' : 'COMPONENT'}</span>
          <h2>{partDisplayName(document, part)}</h2><p>{model ? model.description || `Custom ${model.baseKind} characteristic` : definition.description}</p>
        </div>
        <div className="inspector-section">
          <div className="section-overline">{integratedCircuit ? 'POWER & MODEL' : 'COMPONENT VALUE'}</div>
          {model ? <p>{partValueSummary(document, part)}. Resistor bands show the nominal value.</p> : isSwitchKind(part.kind) ? (
            <label className="switch-value"><input type="checkbox" checked={!!part.value} onChange={event => updatePart({ value: event.target.checked ? 1 : 0 })} />{part.kind === 'switch' ? part.value ? 'Closed (on)' : 'Open (off)' : `Throw ${part.value}`}</label>
          ) : part.kind === 'lm4040' ? <label>Reference voltage<select aria-label="Reference voltage" value={part.value} onChange={e => updatePart({ value: Number(e.target.value) })}><option value={2.5}>2.5 V</option><option value={5}>5 V</option></select></label> : part.kind === 'pc817' ? <>
            <NumberField key={part.id} label="Current transfer ratio" value={part.value} min={definition.min} max={definition.max} unit="%" onCommit={value => updatePart({ value })} />
            <p className="muted-copy">{definition.supplyHint}</p>
          </> : resistive || capacitive || inductive || zener ? <>
            <NumberField
              key={part.id} label={resistive ? 'Resistance' : inductive ? 'Inductance' : zener ? 'Zener voltage' : 'Capacitance'}
              value={Number((part.value / factor).toPrecision(10))}
              min={definition.min / factor} max={definition.max / factor} unit={unit}
              onCommit={value => updatePart({ value: value * factor })}
            />
            <div className="value-presets">{presets.map(value => (
              <button key={value} className={Math.abs(part.value / factor - value) < 1e-8 ? 'active' : ''} onClick={() => updatePart({ value: value * factor })}>{value}</button>
            ))}</div>
            {part.kind === 'potentiometer' && <div className="wiper-control">
              <CommitSlider label="Wiper position" value={(part.position ?? 0.5) * 100} min={0} max={100} step={1} unit="%" onCommit={position => updatePart({ position: position / 100 })} />
              <NumberField label="Wiper percentage" value={(part.position ?? 0.5) * 100} min={0} max={100} unit="%" onCommit={position => updatePart({ position: position / 100 })} />
              <p className="micro-copy">0% is at CCW; 100% is at CW. Each end has a minimum 1 Ω resistance.</p>
            </div>}
          </> : definition.supplyHint ? (
            <p className="muted-copy">{definition.supplyHint}</p>
          ) : <p className="muted-copy">Fixed generic {transistor ? `${part.kind.toUpperCase()} transistor` : definition.label.toLowerCase()} model.</p>}
        </div>
        {(part.kind === 'resistor' || part.kind === 'capacitor') && <div className="inspector-section custom-model">
          <label>Component model<select aria-label="Component model" value={part.customModelId ?? ''} onChange={e => modelAction(() => assignCustomComponent(document, part.id, e.target.value || undefined))}><option value="">Linear built-in at nominal value</option>{document.customComponents?.filter(m => m.baseKind === part.kind).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          {model ? <><CurvePreview points={model.characteristic.points} xLabel={model.baseKind === 'resistor' ? '|Current| (A)' : 'Voltage (V)'} yLabel={model.baseKind === 'resistor' ? 'Resistance (Ω)' : 'Capacitance (F)'} /><button onClick={() => onEditModel(model)}>Edit model</button><button onClick={() => modelAction(() => duplicateCustomComponent(document, model.id, part.id).document)}>Make independent copy</button></> : <button onClick={() => onCreateModel(part)}>Create custom model from this value</button>}
          {modelError && <p role="alert">{modelError}</p>}
        </div>}
        <SchemaGroupField
          key={`schema-group-${part.id}`} value={part.schemaGroup ?? ''}
          groups={[...new Set(document.parts.flatMap(item => item.schemaGroup ? [item.schemaGroup] : []))].sort((a, b) => a.localeCompare(b))}
          onCommit={name => onChange(assignSchemaGroup(document, [part.id], name))}
        />
        <RecordedMeasurements key={part.id} document={document} part={part} nodeByTerminal={nodeByTerminal} />
        <div className="inspector-section">
          <div className="section-overline">{integratedCircuit || transistor ? 'PIN CONNECTIONS' : 'CONNECTIONS'}</div>
          <div className={integratedCircuit || transistor ? 'ic-pin-list' : undefined}>
            {part.pins.map((pin, index) => (
              <div className="pin-row" key={index}>
                <span><i />{(integratedCircuit || transistor) && <b>{index + 1}</b>}{definition.pinNames[index]}</span>
                <div className="pin-actions"><code>{pin.toUpperCase()}</code>{hasEditableLeads(part) && <button className="move-lead-button" aria-label={`Move ${part.id} lead ${definition.pinNames[index]}`} aria-pressed={editingLead?.partId === part.id && editingLead.pinIndex === index} onClick={() => onStartLeadEdit({ partId: part.id, pinIndex: index })}>Move</button>}</div>
              </div>
            ))}
          </div>
          <p className="micro-copy">{integratedCircuit ? 'The notch marks the pin 1 end. The package must straddle the center trench.' : 'Drag the component to move it. Jumper wires stay attached to their holes.'}</p>
          {fet && <p className="micro-copy">D = Drain, G = Gate, S = Source. The three leads move together. This virtual pin order is D–G–S; check the pinout of your physical device.</p>}
          {transistor && !fet && <p className="micro-copy">C = Collector, B = Base, E = Emitter. The three leads move together. This virtual pin order is C–B–E; physical transistor pinouts vary.</p>}
          {hasEditableLeads(part) && <p className="micro-copy">Move one lead to change its spacing. Choose holes 1–8 spacings apart; polarity stays with the lead.</p>}
          {editingLead?.partId === part.id && <button className="subtle-button cancel-lead-edit" onClick={onFinishLeadEdit}>Cancel lead move <kbd>esc</kbd></button>}
          {polarized && (
            <button className="subtle-button reverse-polarity" onClick={() => updatePart({ pins: [...part.pins].reverse() })}><RotateCcw size={12} />Reverse polarity</button>
          )}
        </div>
        <div className="inspector-section component-dc" aria-label="Component DC measurements">
          <div className="section-overline">DC OPERATING POINT</div>
          {integratedCircuit && part.kind !== 'vactrol' && part.kind !== 'pc817' && part.kind !== 'dpdt' ? <p className="micro-copy">Current and power are unavailable for this behavioral IC model.{(part.kind === 'timer555' || part.kind === 'cd40106' || part.kind === 'cd4013' || part.kind === 'cd4024' || part.kind === 'cd4093') && ' DC voltages show the initial 1 µs startup state; use the scope to inspect timing.'}</p> : dc ? <>
            {dc.currents.map(current => <div className="dc-part-row" key={current.label}><span>{current.label}</span><output aria-label={`DC current ${current.label}`}>{formatElectrical(current.value, 'A')}</output></div>)}
            <div className="dc-part-row"><span>Power absorbed</span><output aria-label="DC component power">{formatElectrical(dc.power, 'W')}</output></div>
            <p className="micro-copy">{capacitive ? 'An ideal capacitor carries no steady DC current.' : 'Positive current flows in the labeled direction. Readings use the initial DC solution.'}</p>
          </> : <p className="micro-copy">Capture the current circuit to read DC current and power.</p>}
        </div>
        <div className="inspector-section">
          <details className="model-details"><summary>Model details <Info size={13} /></summary><p>{model ? `${model.baseKind === 'resistor' ? 'V = I × R(|I|), an instantaneous law without thermal memory.' : 'C(V) = dQ/dV. Charge and energy are integrated from zero voltage; each capture starts at its DC operating point.'} Linear interpolation and constant endpoint extension. Shared by ${document.parts.filter(p => p.customModelId === model.id).length} placed instances.` : definition.model}</p></details>
        </div>
        <button className="delete-part" onClick={onDelete}><Trash2 size={14} />Remove component<kbd>⌫</kbd></button>
      </> : wire ? <>
        <div className="selected-part-summary"><Cable size={42} style={{ color: wire.color }} /><h2>Jumper wire</h2><p>A direct electrical connection between two terminals.</p></div>
        <div className="inspector-section"><div className="section-overline">ENDPOINTS</div><div className="pin-row"><span>From</span><code>{wire.from.toUpperCase()}</code></div><div className="pin-row"><span>To</span><code>{wire.to.toUpperCase()}</code></div></div>
        <RecordedWireVoltage key={wire.id} wire={wire} nodeByTerminal={nodeByTerminal} />
        <div className="inspector-section"><div className="section-overline">WIRE COLOR</div><div className="wire-palette">{colors.map(color => (
          <button key={color} style={{ backgroundColor: color }} aria-label={`Change wire color to ${color}`} onClick={() => onChange({ ...document, wires: document.wires.map(item => item.id === wire.id ? { ...item, color } : item) })}>{wire.color === color && <Check size={12} />}</button>
        ))}</div></div>
        <button className="delete-part" onClick={onDelete}><Trash2 size={14} />Remove wire<kbd>⌫</kbd></button>
      </> : (
        <div className="inspector-empty"><MousePointer2 size={28} /><h2>No selection</h2><p>Select a component or a wire to inspect its values and connections.</p></div>
      )}
    </aside>
  )
}
