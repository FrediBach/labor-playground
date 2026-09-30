import { Cable, Check, Info, MousePointer2, RotateCcw, Trash2, Zap } from 'lucide-react'
import { PARTS, formatValue, type CircuitDocument, type CircuitExample, type Diagnostic } from '@/lib/circuit'
import { CommitSlider, NumberField } from './ParameterControls'
import { PartIcon } from './PartIcon'
import type { OperatingPoint } from '@/lib/simulation-types'
import { formatElectrical } from '@/lib/format-electrical'
import { hasEditableLeads, type LeadEdit } from '@/lib/part-editing'

interface InspectorProps {
  document: CircuitDocument
  selectedId: string | null
  onChange: (document: CircuitDocument) => void
  onSelect: (id: string | null) => void
  onDelete: () => void
  example?: CircuitExample
  onRestore: (id: string) => void
  colors: string[]
  status: string
  error: string | null
  diagnostics: Diagnostic[]
  netlist: string
  operatingPoint?: OperatingPoint
  editingLead?: LeadEdit | null
  onStartLeadEdit: (edit: LeadEdit) => void
  onFinishLeadEdit: () => void
}

export function Inspector({ document, selectedId, onChange, onSelect, onDelete, example, onRestore, colors, status, error, diagnostics, netlist, operatingPoint, editingLead, onStartLeadEdit, onFinishLeadEdit }: InspectorProps) {
  const part = document.parts.find(item => item.id === selectedId)
  const wire = document.wires.find(item => item.id === selectedId)
  const definition = part ? PARTS[part.kind] : null
  const resistive = part?.kind === 'resistor' || part?.kind === 'potentiometer'
  const capacitive = part?.kind === 'capacitor' || part?.kind === 'electrolytic'
  const inductive = part?.kind === 'inductor'
  const zener = part?.kind === 'zener'
  const transistor = part?.kind === 'npn' || part?.kind === 'pnp'
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
      <div className="panel-heading"><h2>Inspector</h2><span className="tiny-tag">{part ? part.id : wire ? 'WIRE' : 'WORKBENCH'}</span></div>
      {part && definition ? <>
        <div className="selected-part-summary">
          <div className="selected-part-art"><PartIcon kind={part.kind} value={part.value} position={part.position} large /></div>
          <span className="eyebrow">{part.id} · {part.kind === 'opamp' ? 'GENERIC DUAL · DIP-8' : transistor ? `GENERIC ${part.kind.toUpperCase()} · C / B / E` : polarized ? 'POLARIZED' : part.kind === 'capacitor' ? 'NON-POLARIZED' : 'COMPONENT'}</span>
          <h2>{definition.label}</h2><p>{definition.description}</p>
        </div>
        <div className="inspector-section">
          <div className="section-overline">{part.kind === 'opamp' ? 'POWER & MODEL' : 'COMPONENT VALUE'}</div>
          {part.kind === 'switch' ? (
            <label className="switch-value"><input type="checkbox" checked={!!part.value} onChange={event => updatePart({ value: event.target.checked ? 1 : 0 })} />{part.value ? 'Closed (on)' : 'Open (off)'}</label>
          ) : resistive || capacitive || inductive || zener ? <>
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
          </> : part.kind === 'opamp' ? (
            <p className="muted-copy">Connect pin 8 to the positive supply and pin 4 to the negative supply. Both amplifiers share these rails.</p>
          ) : <p className="muted-copy">Fixed generic {transistor ? `${part.kind.toUpperCase()} transistor` : definition.label.toLowerCase()} model.</p>}
        </div>
        <div className="inspector-section">
          <div className="section-overline">{part.kind === 'opamp' || transistor ? 'PIN CONNECTIONS' : 'CONNECTIONS'}</div>
          <div className={part.kind === 'opamp' || transistor ? 'ic-pin-list' : undefined}>
            {part.pins.map((pin, index) => (
              <div className="pin-row" key={index}>
                <span><i />{(part.kind === 'opamp' || transistor) && <b>{index + 1}</b>}{definition.pinNames[index]}</span>
                <div className="pin-actions"><code>{pin.toUpperCase()}</code>{hasEditableLeads(part) && <button className="move-lead-button" aria-label={`Move ${part.id} lead ${definition.pinNames[index]}`} aria-pressed={editingLead?.partId === part.id && editingLead.pinIndex === index} onClick={() => onStartLeadEdit({ partId: part.id, pinIndex: index })}>Move</button>}</div>
              </div>
            ))}
          </div>
          <p className="micro-copy">{part.kind === 'opamp' ? 'The notch marks the pin 1 end. The package must straddle the center trench.' : 'Drag the component to move it. Jumper wires stay attached to their holes.'}</p>
          {transistor && <p className="micro-copy">C = Collector, B = Base, E = Emitter. The three leads move together. This virtual pin order is C–B–E; physical transistor pinouts vary.</p>}
          {hasEditableLeads(part) && <p className="micro-copy">Move one lead to change its spacing. Choose holes 1–8 spacings apart; polarity stays with the lead.</p>}
          {editingLead?.partId === part.id && <button className="subtle-button cancel-lead-edit" onClick={onFinishLeadEdit}>Cancel lead move <kbd>esc</kbd></button>}
          {polarized && (
            <button className="subtle-button reverse-polarity" onClick={() => updatePart({ pins: [...part.pins].reverse() })}><RotateCcw size={12} />Reverse polarity</button>
          )}
        </div>
        <div className="inspector-section component-dc" aria-label="Component DC measurements">
          <div className="section-overline">DC OPERATING POINT</div>
          {part.kind === 'opamp' ? <p className="micro-copy">Current and power are unavailable for this behavioral op-amp model.</p> : dc ? <>
            {dc.currents.map(current => <div className="dc-part-row" key={current.label}><span>{current.label}</span><output aria-label={`DC current ${current.label}`}>{formatElectrical(current.value, 'A')}</output></div>)}
            <div className="dc-part-row"><span>Power absorbed</span><output aria-label="DC component power">{formatElectrical(dc.power, 'W')}</output></div>
            <p className="micro-copy">{capacitive ? 'An ideal capacitor carries no steady DC current.' : 'Positive current flows in the labeled direction. Readings use the initial DC solution.'}</p>
          </> : <p className="micro-copy">Capture the current circuit to read DC current and power.</p>}
        </div>
        <div className="inspector-section">
          <details className="model-details"><summary>Model details <Info size={13} /></summary><p>{definition.model}</p></details>
        </div>
        <button className="delete-part" onClick={onDelete}><Trash2 size={14} />Remove component<kbd>⌫</kbd></button>
      </> : wire ? <>
        <div className="selected-part-summary"><Cable size={42} style={{ color: wire.color }} /><h2>Jumper wire</h2><p>A direct electrical connection between two terminals.</p></div>
        <div className="inspector-section"><div className="section-overline">ENDPOINTS</div><div className="pin-row"><span>From</span><code>{wire.from.toUpperCase()}</code></div><div className="pin-row"><span>To</span><code>{wire.to.toUpperCase()}</code></div></div>
        <div className="inspector-section"><div className="section-overline">WIRE COLOR</div><div className="wire-palette">{colors.map(color => (
          <button key={color} style={{ backgroundColor: color }} aria-label={`Change wire color to ${color}`} onClick={() => onChange({ ...document, wires: document.wires.map(item => item.id === wire.id ? { ...item, color } : item) })}>{wire.color === color && <Check size={12} />}</button>
        ))}</div></div>
        <button className="delete-part" onClick={onDelete}><Trash2 size={14} />Remove wire<kbd>⌫</kbd></button>
      </> : (
        <div className="inspector-empty"><MousePointer2 size={28} /><h2>A closer look.</h2><p>Select a component or a wire to inspect its values and connections.</p></div>
      )}
      <div className="experiment-card">
        <span className="eyebrow"><Zap size={12} /> {example ? `${example.level} · ${example.document.parts.length} ${example.document.parts.length === 1 ? 'part' : 'parts'}` : 'THE EXPERIMENT'}</span>
        <h3>{example?.name ?? 'A blank canvas'}</h3>
        {example ? <>
          <p>{example.description}</p>
          <details className="experiment-lesson">
            <summary>What to try</summary>
            <h4>Change</h4><p>{example.whatToChange}</p>
            <h4>Observe</h4><p>{example.whatToObserve}</p>
            <h4>Why it happens</h4><p>{example.why}</p>
          </details>
          <details className="experiment-lesson">
            <summary>Build on EDU LABOR</summary>
            <p>{example.hardware}</p>
            <h4>Parts on this board</h4>
            <ul className="experiment-parts">{document.parts.map(item => <li key={item.id}><strong>{item.id}</strong> {PARTS[item.kind].label} · {formatValue(item.value, item.kind)}</li>)}</ul>
            <p>Use full-kit parts or equivalent separately sourced components. Recreate the electrical connections on LABOR’s breadboard; virtual hole names are not hardware coordinates. Use non-polarized capacitors rated at least 25 V unless a polarized part is specified.</p>
            <p>Connect a common GND. Measure physical source levels and use attenuation where needed; virtual amplitude and timing settings are illustrative. Send audio through LABOR AUDIO IN and its output amplifier.</p>
            <a href="https://www.ericasynths.lv/service/file/download/product_id/804/file_id/534/" target="_blank" rel="noreferrer">LABOR manual ↗</a>
          </details>
          <button className="subtle-button" onClick={() => onRestore(example.id)}><RotateCcw size={12} />Restore example</button>
        </> : <p>Add components, wire them to a source and ground, and measure what you build.</p>}
      </div>
      <div className="diagnostics">
        <div className="section-overline">CIRCUIT STATUS</div>
        {error ? <p className="error-copy">{error}</p> : diagnostics.length ? diagnostics.map((diagnostic, index) => (
          <button key={index} className={`diagnostic ${diagnostic.severity}`} onClick={() => { if (diagnostic.partId) onSelect(diagnostic.partId) }}><Info size={13} />{diagnostic.message}</button>
        )) : <p className="healthy-status"><span />{status === 'ready' ? 'Capture complete' : status === 'loading' ? 'Starting simulation engine…' : status === 'calculating' ? 'Calculating your circuit…' : 'Ready to capture'}</p>}
        <details className="debug-details"><summary>View generated netlist</summary><pre>{netlist}</pre></details>
      </div>
    </aside>
  )
}
