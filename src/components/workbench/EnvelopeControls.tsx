import type { EnvelopeSettings } from '@/lib/circuit'
import { RotaryControl } from './ParameterControls'

export function EnvelopeControls({ settings, busy, onChange, onFire }: {
  settings: Readonly<EnvelopeSettings>
  busy: boolean
  onChange: (settings: EnvelopeSettings) => void
  onFire: () => void
}) {
  return <div className="envelope-controls hardware-envelope" role="group" aria-label="Envelope generator">
    <div className="manual-gate-control">
      <div className="instrument-label">MANUAL GATE</div>
      {settings.mode === 'gate' ? <button className="gate-button" aria-label="Gate high" aria-pressed={settings.gateHigh} title="Click to latch the gate high or low" onClick={() => onChange({ ...settings, gateHigh: !settings.gateHigh })}><i aria-hidden="true" /><span>{settings.gateHigh ? 'HIGH · 5 V' : 'LOW · 0 V'}</span></button> :
        <button className="fire-button" aria-label="Fire envelope" disabled={busy} title="Capture a new event at 1 ms" onClick={onFire}><i aria-hidden="true" /><span>FIRE</span></button>}
    </div>
    <div className="envelope-decay-control">
      <div className="instrument-label">DECAY</div>
      <RotaryControl label="Envelope decay" value={settings.decayMs} min={1} max={40} step={1} unit="ms" disabled={settings.mode !== 'envelope'} onCommit={decayMs => onChange({ ...settings, decayMs })} />
    </div>
    <div className="envelope-type-control">
      <label className="instrument-label" htmlFor="envelope-mode">TYPE</label>
      <select id="envelope-mode" aria-label="Envelope mode" value={settings.mode} onChange={event => onChange({ ...settings, mode: event.target.value as EnvelopeSettings['mode'] })}>
        <option value="gate">Gate</option><option value="trigger">Trigger</option><option value="envelope">Envelope</option>
      </select>
      <span className="envelope-wave" aria-hidden="true">{settings.mode === 'envelope' ? '╱╲___' : settings.mode === 'trigger' ? '_┌┐___' : '_┌───'}</span>
    </div>
    <span className="source-caption">EG OUT · {settings.mode === 'trigger' ? '1 ms pulse' : settings.mode === 'envelope' ? 'Decay envelope' : 'Click to latch'} · 5 V / 100 Ω</span>
  </div>
}
