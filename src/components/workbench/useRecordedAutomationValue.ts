import { useMemo } from 'react'
import type { CircuitDocument } from '@/lib/circuit'
import { automationTargetKey, automationTimelines, automationValueAt, type Automation } from '@/lib/automations'
import { useRecording } from '@/lib/recording-context'

/** Playback is read-only; editable controls retain the next run's starting values. */
export function useRecordedAutomationValue({ document, target, partId }: {
  document: CircuitDocument
  target: Automation['action']['target']
  partId?: string
}) {
  const { playback, seconds } = useRecording()
  const events = playback.capture?.automationEvents
  const points = useMemo(() => events ? automationTimelines(playback.capture?.automationRun ? { ...document, ...playback.capture.automationInitialState, automations: playback.capture.automationRun.actions } : document, events, playback.capture!.duration).get(automationTargetKey({ target, partId, value: 0, durationMs: 0 })) : undefined, [document, events, playback.capture, target, partId])
  return points ? automationValueAt(points, seconds) : undefined
}
