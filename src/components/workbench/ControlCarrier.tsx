import { Plus } from 'lucide-react'
import { RotaryControl } from './ParameterControls'
import { formatValue, type CircuitDocument, type Part } from '@/lib/circuit'
import { RecordedAutomationValue } from './AutomationPlayback'

/** Front-panel access to the controls placed in the circuit. */
export function ControlCarrier({ document, onChange, onSelect, onPlace }: {
  document: CircuitDocument
  onChange: (document: CircuitDocument) => void
  onSelect: (id: string) => void
  onPlace: (kind: 'potentiometer' | 'switch') => void
}) {
  const update = (part: Part, changes: Partial<Part>) => onChange({
    ...document, parts: document.parts.map(item => item.id === part.id ? { ...item, ...changes } : item),
  })
  return <section className="control-carrier" aria-label="Multipurpose control board">
    <div className="carrier-heading"><span>MULTIPURPOSE CONTROL BOARD</span><span>CONTROLS ↔ BREADBOARD</span></div>
    <div className="carrier-modules">
      {(['potentiometer', 'switch'] as const).map(kind => {
        const parts = document.parts.filter(part => part.kind === kind)
        return <div className="carrier-module" key={kind}>
          <div className="carrier-module-heading"><h3>{kind === 'potentiometer' ? 'POTENTIOMETERS' : 'SWITCHES'}</h3><button onClick={() => onPlace(kind)} aria-label={`Place ${kind} on breadboard`}><Plus size={11} />Place</button></div>
          {parts.length ? <div className="carrier-controls">{parts.map(part => <div className="carrier-control" key={part.id}>
            {kind === 'potentiometer'
              ? <RotaryControl label={`${part.id} wiper`} value={(part.position ?? 0.5) * 100} min={0} max={100} step={1} unit="%" onCommit={position => update(part, { position: position / 100 })} />
              : <button className="hardware-toggle" aria-label={`${part.id} closed`} aria-pressed={!!part.value} onClick={() => update(part, { value: part.value ? 0 : 1 })}><span aria-hidden="true" /><small>{part.value ? 'CLOSED' : 'OPEN'}</small></button>}
            <button className="carrier-part-link" onClick={() => onSelect(part.id)} title={`Inspect ${part.id}`}>{part.id} <span>{kind === 'potentiometer' ? formatValue(part.value, kind) : 'SPST'}</span></button>
            <span className="carrier-pins">{part.pins.map(pin => pin.toUpperCase()).join(' · ')}</span>
            <RecordedAutomationValue document={document} target={kind} partId={part.id} />
          </div>)}</div> : <p className="carrier-empty">{kind === 'potentiometer' ? 'Place a pot, wire its three pins, then turn it here.' : 'Place a switch, wire its two pins, then toggle it here.'}</p>}
        </div>
      })}
    </div>
    <div className="carrier-caption">Each control operates its matching part on the breadboard.</div>
  </section>
}
