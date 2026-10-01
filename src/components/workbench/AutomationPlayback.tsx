import { useMemo } from 'react'
import type { CircuitDocument } from '@/lib/circuit'
import { automationTargetKey, automationTimelines, automationValueAt, type Automation } from '@/lib/automations'
import { useRecording } from '@/lib/recording-context'

/** Playback is read-only; the editable controls retain the next run's starting values. */
export function RecordedAutomationValue({ document, target, partId }: {
  document: CircuitDocument
  target: Automation['action']['target']
  partId?: string
}) {
  const { playback, seconds } = useRecording()
  const events = playback.capture?.automationEvents
  const points = useMemo(() => events ? automationTimelines(document, events, playback.capture!.duration).get(automationTargetKey({ target, partId, value: 0, durationMs: 0 })) : undefined, [document, events, playback.capture, target, partId])
  if (!points) return null
  const value = automationValueAt(points, seconds)
  const label = partId ?? ({ cv: 'CV', amplitude: 'Amplitude', frequency: 'Frequency', gate: 'Gate', potentiometer: 'Potentiometer', switch: 'Switch' }[target])
  const formatted = target === 'potentiometer' ? `${(value * 100).toFixed(1)}%`
    : target === 'switch' ? value >= 0.5 ? 'Closed' : 'Open'
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
      const name = document.automations?.find(row => row.id === event.automationId)?.name ?? event.automationId
      const label = `${name} at ${Number((event.time * 1000).toFixed(3))} ms`
      return <button key={event.automationId} className={seconds >= event.time ? 'occurred' : ''} style={{ left: `${Math.max(0, Math.min(100, (event.time - playback.start) / (playback.end - playback.start) * 100))}%` }} title={label} aria-label={`Seek ${label}`} onClick={() => playback.seek(event.time)} />
  })}</div>
  </div>
}
