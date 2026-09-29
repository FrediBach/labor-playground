import { Play } from 'lucide-react'
import type { EnvelopeSettings } from '@/lib/circuit'
import { NumberField } from './ParameterControls'

export function EnvelopeControls({ settings, busy, onChange, onFire }: {
  settings: Readonly<EnvelopeSettings>
  busy: boolean
  onChange: (settings: EnvelopeSettings) => void
  onFire: () => void
}) {
  return <div className="envelope-controls">
    <div className="instrument-label">ENVELOPE / EG</div>
    <select aria-label="Envelope mode" value={settings.mode} onChange={event => onChange({ ...settings, mode: event.target.value as EnvelopeSettings['mode'] })}>
      <option value="gate">Gate</option><option value="trigger">Trigger</option><option value="envelope">Envelope</option>
    </select>
    <div className="envelope-action">
      {settings.mode === 'gate' ? <button className="gate-button" aria-label="Gate high" aria-pressed={settings.gateHigh} onClick={() => onChange({ ...settings, gateHigh: !settings.gateHigh })}>{settings.gateHigh ? 'HIGH · 5 V' : 'LOW · 0 V'}</button> : <>
        {settings.mode === 'envelope' && <NumberField label="Envelope decay" value={settings.decayMs} min={1} max={40} unit="ms" onCommit={decayMs => onChange({ ...settings, decayMs })} />}
        <button className="fire-button" aria-label="Fire envelope" disabled={busy} title="Capture a new event at 1 ms" onClick={onFire}><Play size={10} fill="currentColor" />Fire</button>
      </>}
    </div>
    <span className="source-caption">{settings.mode === 'trigger' ? '1 ms pulse' : settings.mode === 'envelope' ? 'Decay τ' : 'Held level'} · 5 V / 100 Ω</span>
  </div>
}
