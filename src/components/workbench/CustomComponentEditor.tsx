import { useEffect, useRef, useState } from 'react'
import { PARTS, type CircuitDocument } from '@/lib/circuit'
import { saveCustomComponent, validateCustomComponents, CUSTOM_LIMITS, type CurveComponent } from '@/lib/custom-components'
import type { CurvePoint } from '@/lib/characteristic-curves'
import './CustomComponents.css'

export function CurvePreview({ points, xLabel, yLabel }: { points: CurvePoint[]; xLabel: string; yLabel: string }) {
  if (points.length < 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || points.at(-1)!.x <= points[0].x) return null
  const low = points[0].x, high = points.at(-1)!.x, min = Math.min(...points.map(p => p.y)), max = Math.max(...points.map(p => p.y))
  const ySpan = max - min || Math.max(max, 1e-12) * 0.2
  const x = (v: number) => 55 + (v - low) / (high - low) * 270
  const y = (v: number) => 150 - (v - min + ySpan * 0.15) / (ySpan * 1.3) * 105
  return <svg className="curve-preview" viewBox="0 0 380 195" role="img" aria-label={`${yLabel} versus ${xLabel}. Linear interpolation with constant endpoint extension.`}>
    <path d="M30 25V160H350" fill="none" stroke="currentColor" opacity=".35" />
    <path d={`M30 ${y(points[0].y)}H55M325 ${y(points.at(-1)!.y)}H350`} fill="none" stroke="#e5bd68" strokeDasharray="4 3" />
    <polyline points={points.map(p => `${x(p.x)},${y(p.y)}`).join(' ')} fill="none" stroke="#91bfad" strokeWidth="2" />
    {points.map((p, i) => <circle key={i} cx={x(p.x)} cy={y(p.y)} r="3" fill="#91bfad" />)}
    <text x="49" y={y(min) + 3} textAnchor="end">{Number(min.toPrecision(4))}</text>
    {max !== min && <text x="49" y={y(max) + 3} textAnchor="end">{Number(max.toPrecision(4))}</text>}
    <text x="35" y="18">{yLabel}</text><text x="190" y="190" textAnchor="middle">{xLabel}</text>
    <text x="55" y="174" textAnchor="middle">{Number(low.toPrecision(4))}</text><text x="325" y="174" textAnchor="middle">{Number(high.toPrecision(4))}</text>
  </svg>
}

export function CustomComponentEditor({ initial, document, editing, onSave, onCancel }: { initial: CurveComponent; document: CircuitDocument; editing: boolean; onSave: (document: CircuitDocument, model: CurveComponent) => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState(initial.baseKind)
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description ?? '')
  const [xFactor, setXFactor] = useState(kind === 'resistor' ? 0.001 : 1)
  const [yFactor, setYFactor] = useState(kind === 'resistor' ? 1000 : 1e-9)
  const nextPointId = useRef(initial.characteristic.points.length)
  const [rows, setRows] = useState(() => initial.characteristic.points.map((p, id) => ({ id, x: String(p.x / xFactor), y: String(p.y / yFactor) })))
  const [commitError, setCommitError] = useState('')
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null
    const element = dialog.current
    element?.showModal(); nameInput.current?.focus()
    return () => { element?.close(); previous?.focus() }
  }, [])
  const resistor = kind === 'resistor'
  const points = rows.map(p => ({ x: p.x.trim() ? Number(p.x) * xFactor : NaN, y: p.y.trim() ? Number(p.y) * yFactor : NaN }))
  const draft = { ...initial, name, description, baseKind: kind, characteristic: { type: resistor ? 'resistance-current' : 'capacitance-voltage', axis: resistor ? 'current-magnitude' : 'signed-voltage', interpolation: 'linear', extrapolation: 'constant', points } } as CurveComponent
  let error = ''
  try { validateCustomComponents([draft]) } catch (e) { error = (e as Error).message }
  const rowError = Number(/Row (\d+)/.exec(error)?.[1]) - 1
  const count = document.parts.filter(p => p.customModelId === initial.id).length
  const xUnits = resistor ? [[0.000001, 'µA'], [0.001, 'mA'], [1, 'A']] as const : [[0.001, 'mV'], [1, 'V']] as const
  const yUnits = resistor ? [[1, 'Ω'], [1000, 'kΩ'], [1e6, 'MΩ']] as const : [[1e-12, 'pF'], [1e-9, 'nF'], [1e-6, 'µF'], [1e-3, 'mF']] as const
  const xUnit = xUnits.find(u => u[0] === xFactor)?.[1] ?? '', yUnit = yUnits.find(u => u[0] === yFactor)?.[1] ?? ''
  return <dialog ref={dialog} className="custom-editor" aria-labelledby="custom-editor-title" onCancel={onCancel} onKeyDown={e => e.stopPropagation()}>
    <form noValidate onSubmit={e => {
      e.preventDefault()
      try {
        if (editing && !document.customComponents?.some(m => m.id === initial.id)) throw new Error('This model was removed. Cancel and create a new definition.')
        onSave(saveCustomComponent(document, draft), draft)
      } catch (cause) { setCommitError((cause as Error).message) }
    }}>
      <div className="custom-heading"><h2 id="custom-editor-title">{editing ? 'Edit custom component' : 'Create custom component'}</h2><button type="button" aria-label="Close custom editor" onClick={onCancel}>×</button></div>
      <label>Base component<select aria-label="Base component" value={kind} disabled={editing} onChange={e => {
        const next = e.target.value as typeof kind
        setKind(next); setXFactor(next === 'resistor' ? 0.001 : 1); setYFactor(next === 'resistor' ? 1000 : 1e-9)
        setRows((next === 'resistor' ? [{ x: '0', y: '10' }, { x: '10', y: '10' }] : [{ x: '-5', y: '100' }, { x: '0', y: '100' }, { x: '5', y: '100' }]).map(point => ({ ...point, id: nextPointId.current++ })))
      }}><option value="resistor">Resistor</option><option value="capacitor">Capacitor</option></select></label>
      <label>Name<input ref={nameInput} autoFocus aria-label="Model name" maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Description<textarea aria-label="Model description" maxLength={500} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <p>{resistor ? 'Resistance versus current magnitude: V = I × R(|I|). The same curve applies in both directions.' : 'Differential capacitance versus signed voltage: C = dQ/dV. Voltage is pin 1 minus pin 2; current enters pin 1.'}</p>
      <div className="custom-units"><label>{resistor ? 'Current' : 'Voltage'} unit<select aria-label="Axis unit" value={xFactor} onChange={e => { const next = Number(e.target.value); setRows(rows.map(p => ({ ...p, x: p.x.trim() ? String(Number((Number(p.x) * xFactor / next).toPrecision(12))) : '' }))); setXFactor(next) }}>{xUnits.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>{resistor ? 'Resistance' : 'Capacitance'} unit<select aria-label="Value unit" value={yFactor} onChange={e => { const next = Number(e.target.value); setRows(rows.map(p => ({ ...p, y: p.y.trim() ? String(Number((Number(p.y) * yFactor / next).toPrecision(12))) : '' }))); setYFactor(next) }}>{yUnits.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div>
      <div className="custom-table"><table aria-label="Characteristic points"><thead><tr><th>{resistor ? '|Current|' : 'Voltage'} ({xUnit})</th><th>{resistor ? 'Resistance' : 'Capacitance'} ({yUnit})</th><th>Actions</th></tr></thead><tbody>{rows.map((p, i) => <tr key={p.id}>
        <td><input type="number" step="any" aria-label={`Row ${i + 1} axis`} aria-invalid={rowError === i} aria-describedby={rowError === i ? 'custom-error' : undefined} value={p.x} onChange={e => setRows(rows.map((r, j) => j === i ? { ...r, x: e.target.value } : r))} /></td>
        <td><input type="number" step="any" aria-label={`Row ${i + 1} value`} aria-invalid={rowError === i} aria-describedby={rowError === i ? 'custom-error' : undefined} value={p.y} onChange={e => setRows(rows.map((r, j) => j === i ? { ...r, y: e.target.value } : r))} /></td>
        <td><button type="button" aria-label={`Remove row ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
      </tr>)}</tbody></table></div>
      <div className="custom-actions"><button type="button" disabled={rows.length >= CUSTOM_LIMITS.points} onClick={() => setRows([...rows, { id: nextPointId.current++, x: '', y: rows.at(-1)!.y }])}>Add point</button><button type="button" onClick={() => setRows([...rows].sort((a, b) => Number(a.x) - Number(b.x)))}>Sort by axis</button></div>
      {(error || commitError) && <p id="custom-error" role="alert">{error || commitError}</p>}
      {!error && <CurvePreview points={rows.map(p => ({ x: Number(p.x), y: Number(p.y) }))} xLabel={`${resistor ? '|Current|' : 'Voltage'} (${xUnit})`} yLabel={`${resistor ? 'Resistance' : 'Capacitance'} (${yUnit})`} />}
      <p className="micro-copy">Linear interpolation; dashed ends extend at constant values. {resistor ? 'Axis: 0–1 A, minimum spacing 1 µA. R: 10 Ω–10 MΩ; maximum slope 10⁹ Ω/A. Positive differential resistance is required.' : 'Axis: −100–100 V, minimum spacing 1 mV. C: 100 pF–10 mF; maximum slope 1 F/V. Include zero and both voltage signs.'}</p>
      <p>{editing ? `Saving updates ${count} placed instance${count === 1 ? '' : 's'} sharing this model.` : `Save this ${PARTS[kind].label.toLowerCase()} to the project and select it for placement.`}</p>
      <div className="custom-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={!!error}>Save model</button></div>
    </form>
  </dialog>
}
