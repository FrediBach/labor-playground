import { useEffect } from 'react'
import { useRecording } from '@/lib/recording-context'
import { interpolateVoltage } from '@/lib/measurements'
import type { TestReport } from '@/lib/circuit-tests'
export interface RecordingSeed { id: string; seconds: number; duration: number; channel: 'CH1' | 'CH2'; actual: number }
export function RecordingExpectationButton({ onAdd }: { onAdd: (seed: RecordingSeed) => void }) {
  const { playback, seconds } = useRecording(), capture = playback.capture
  const channel = capture?.channels.CH2.length ? 'CH2' : 'CH1'
  const actual = capture ? interpolateVoltage(capture.time, capture.channels[channel], seconds) : null
  return <button className="subtle-button" disabled={actual === null} onClick={() => { if (actual !== null) onAdd({ id: crypto.randomUUID(), seconds, duration: capture!.duration, channel, actual }) }}>Add expectation from recording</button>
}
export function SeekTestEvidence({ report }: { report: TestReport | null }) {
  const { playback } = useRecording()
  useEffect(() => {
    if (!report?.capture) return
    const failed = report.run?.nodes.find(n => n.kind === 'expect' && n.status !== 'done' && n.evidence)
    playback.seek(failed?.evidence?.time ?? failed?.evidence?.to ?? 0)
  }, [report, playback])
  return null
}
