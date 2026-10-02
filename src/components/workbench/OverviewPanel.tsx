import { partDisplayName, partValueSummary } from '@/lib/custom-components'
import { Activity, ArrowUpRight, CircleCheck, CircuitBoard, RotateCcw, TriangleAlert } from 'lucide-react'
import { type CircuitDocument, type CircuitExample, type Diagnostic, type Part } from '@/lib/circuit'
import type { SimulationStatus } from '@/lib/simulation-types'
import './OverviewPanel.css'

interface OverviewPanelProps {
  document: CircuitDocument
  example?: CircuitExample
  onRestore: (id: string) => void
  status: SimulationStatus
  diagnostics: Diagnostic[]
  netlist: string
  onInspect: (id: string) => void
  onOpenCircuit: () => void
  onViewResults: () => void
}

const CAPTURE_STATUS: Record<SimulationStatus, { label: string; detail: string }> = {
  ready: { label: 'Capture complete', detail: 'Results are up to date for this circuit.' },
  loading: { label: 'Starting simulation engine…', detail: 'Circuit checks are available while the engine starts.' },
  calculating: { label: 'Calculating circuit…', detail: 'Results will update when the capture finishes.' },
  stale: { label: 'Capture needed', detail: 'Capture the current circuit to update Results.' },
  invalid: { label: 'Circuit needs attention', detail: 'Check the circuit and source settings before capturing again.' },
  error: { label: 'Capture failed', detail: 'Open the circuit to review its settings and try another capture.' },
}

function partValue(document: CircuitDocument, part: Part) {
  const value = partValueSummary(document, part)
  return part.kind === 'potentiometer' ? `${value} · ${Math.round((part.position ?? 0.5) * 100)}% wiper` : value
}

export function OverviewPanel({ document, example, onRestore, status, diagnostics, netlist, onInspect, onOpenCircuit, onViewResults }: OverviewPanelProps) {
  const probeCount = Object.values(document.probes).filter(Boolean).length
  const emptyCircuit = !document.parts.length && !document.wires.length && !document.pico
  const captureStatus = CAPTURE_STATUS[status]
  const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error')
  const inspectableIds = new Set([...document.parts, ...document.wires].map(item => item.id))

  return <div className="overview-panel">
    <header className="overview-heading">
      <div className="overview-title">
        <h2>{document.title}</h2>
        <div className="overview-meta">
          <span className="overview-level">{example?.level ?? 'Custom circuit'}</span>
          <span className="overview-counts">
            <span>{document.parts.length} {document.parts.length === 1 ? 'part' : 'parts'}</span>
            <span>{document.wires.length} {document.wires.length === 1 ? 'wire' : 'wires'}</span>
            <span>{probeCount} {probeCount === 1 ? 'probe' : 'probes'}</span>
          </span>
          {document.pico && <span className="overview-pico">Pico installed</span>}
        </div>
      </div>
      <div className="overview-actions">
        <button type="button" className="overview-button" onClick={onOpenCircuit}><CircuitBoard size={14} aria-hidden="true" />Open circuit</button>
        {status === 'ready' && <button type="button" className="overview-button overview-primary" onClick={onViewResults}><Activity size={14} aria-hidden="true" />View results</button>}
      </div>
    </header>

    <section className="overview-section overview-checks" aria-label="Circuit checks">
      <div className="overview-section-heading">
        <h3>Circuit checks</h3>
        <span className={`overview-status ${status}`}>{captureStatus.label}</span>
      </div>
      {diagnostics.length ? <ul className="overview-diagnostics">
        {diagnostics.map((diagnostic, index) => <li key={`${diagnostic.severity}-${diagnostic.partId ?? ''}-${index}`} className={`diagnostic ${diagnostic.severity}`}>
          <TriangleAlert size={15} aria-hidden="true" />
          <p><strong>{diagnostic.severity === 'error' ? 'Error' : 'Warning'}</strong><span>{diagnostic.message}</span></p>
          {diagnostic.partId && inspectableIds.has(diagnostic.partId) && <button type="button" className="overview-inspect" aria-label={`Inspect ${diagnostic.partId}`} onClick={() => onInspect(diagnostic.partId!)}>Inspect {diagnostic.partId}<ArrowUpRight size={13} aria-hidden="true" /></button>}
        </li>)}
      </ul> : <p className="overview-check-detail">
        {status === 'ready' && <CircleCheck size={15} aria-hidden="true" />}
        {captureStatus.detail}
      </p>}
      {diagnostics.length > 0 && !hasErrors && status !== 'ready' && <p className="overview-check-detail">{captureStatus.detail}</p>}
    </section>

    <section className="overview-section overview-guide" aria-label="Example guide">
      {example ? <>
        <div className="overview-section-heading">
          <h3>What to try</h3>
          <button type="button" className="overview-text-button" onClick={() => onRestore(example.id)}><RotateCcw size={13} aria-hidden="true" />Restore example</button>
        </div>
        <div className="overview-lesson">
          <div><h4>Change</h4><p>{example.whatToChange}</p></div>
          <div><h4>Observe</h4><p>{example.whatToObserve}</p></div>
          <div><h4>Why it happens</h4><p>{example.why}</p></div>
        </div>
        <details className="overview-hardware">
          <summary>Build on EDU LABOR</summary>
          <div>
            <p>{example.hardware}</p>
            <p>Use full-kit parts or equivalent separately sourced components. Recreate the electrical connections on LABOR’s breadboard; virtual hole names are not hardware coordinates. Use non-polarized capacitors rated at least 25 V unless a polarized part is specified.</p>
            <p>Connect a common GND. Measure physical source levels and attenuate where needed; virtual amplitude and timing settings are illustrative. Send audio through LABOR AUDIO IN and its output amplifier.</p>
            <a href="https://www.ericasynths.lv/service/file/download/product_id/804/file_id/534/" target="_blank" rel="noreferrer">LABOR manual <ArrowUpRight size={13} aria-hidden="true" /></a>
          </div>
        </details>
      </> : <>
        <h3>Custom circuit</h3>
        <p className="overview-custom-copy">{emptyCircuit
          ? 'Open the circuit to add components, connect a source and ground, and place probes for a capture.'
          : document.parts.length
            ? 'Inspect a part below, or open the circuit to edit its wiring and capture a result.'
            : 'Open the circuit to edit connections, place probes, and capture a result.'}</p>
      </>}
    </section>

    <section className="overview-section overview-parts-section" aria-label="Parts inventory">
      <div className="overview-section-heading"><h3>Parts on this circuit</h3><span className="overview-section-note">Current values</span></div>
      {document.parts.length ? <div className="overview-table-wrap">
        <table className="overview-parts" aria-label="Circuit parts">
          <thead><tr><th scope="col">ID</th><th scope="col">Component</th><th scope="col">Value / model</th><th scope="col"><span className="overview-visually-hidden">Actions</span></th></tr></thead>
          <tbody>{document.parts.map(part => <tr key={part.id}>
            <th scope="row">{part.id}</th>
            <td>{partDisplayName(document, part)}</td>
            <td className="overview-part-value">{partValue(document, part)}</td>
            <td><button type="button" className="overview-inspect" aria-label={`Inspect ${part.id}`} onClick={() => onInspect(part.id)}>Inspect<ArrowUpRight size={13} aria-hidden="true" /></button></td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="overview-empty-parts">{document.pico ? 'Pico is installed. No additional components on the breadboard.' : 'No components yet.'} Add parts from the library in the Circuit tab.</p>}
    </section>

    <details className="overview-netlist">
      <summary>Generated netlist</summary>
      {netlist.trim() ? <pre tabIndex={0} aria-label="Generated SPICE netlist">{netlist}</pre> : <p>No netlist generated for this circuit yet.</p>}
    </details>
  </div>
}
