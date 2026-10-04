import type { CircuitDocument } from '@/lib/circuit'
import type { Automation } from '@/lib/automations'
import { useRecording } from '@/lib/recording-context'
import { useRecordedAutomationValue } from './useRecordedAutomationValue'

export function RecordedAutomationValue({ document, target, partId }: {
  document: CircuitDocument
  target: Automation['action']['target']
  partId?: string
}) {
  const value = useRecordedAutomationValue({ document, target, partId })
  if (value === undefined) return null
  const kind = document.parts.find(part => part.id === partId)?.kind
  const label = partId ?? ({ cv: 'CV', amplitude: 'Amplitude', frequency: 'Frequency', gate: 'Gate', potentiometer: 'Potentiometer', switch: 'Switch' }[target])
  const formatted = target === 'potentiometer' ? `${(value * 100).toFixed(1)}%`
    : target === 'switch' ? kind === 'spdt' || kind === 'dpdt' ? `Throw ${value >= 0.5 ? 1 : 0}` : value >= 0.5 ? 'Closed' : 'Open'
    : target === 'gate' ? value >= 0.5 ? 'High' : 'Low'
    : target === 'frequency' ? `${value.toFixed(1)} Hz` : `${value.toFixed(2)} V`
  return <span className="automation-recorded-value" title="Value at the recording playhead. The control above sets the next run’s starting value."><span>PLAYBACK</span><output aria-label={`${label} automated value`}>{formatted}</output></span>
}

export function AutomationTimeline({ document }: { document: CircuitDocument }) {
  const { playback, seconds } = useRecording()
  const events = playback.capture?.automationEvents
  if (!events?.length) return null
  return <div className="automation-event-strip" aria-label="Automation events in recording">
    <div className="automation-event-labels"><span>EVENTS</span><span>Click to inspect</span></div><div className="automation-event-track">{events.map(event => {
      const name = (playback.capture?.automationRun?.actions ?? document.automations)?.find(row => row.id === event.automationId)?.name ?? event.automationId
      const label = `${name} at ${Number((event.time * 1000).toFixed(3))} ms`
      return <button key={event.automationId} className={seconds >= event.time ? 'occurred' : ''} style={{ left: `${Math.max(0, Math.min(100, (event.time - playback.start) / (playback.end - playback.start) * 100))}%` }} title={label} aria-label={`Seek ${label}`} onClick={() => playback.seek(event.time)} />
  })}</div>
  </div>
}
