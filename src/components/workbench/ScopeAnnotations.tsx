import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Capture } from '@/lib/simulation-types'
import { createPicoStateTimeline, type PicoStateAnnotation, type PicoStateChange, type PicoStateMarker } from '@/lib/pico/state-timeline'
import './ScopeAnnotations.css'

const formatTime = (seconds: number) => `${Number((seconds * 1000).toFixed(3))} ms`
const describeChange = (change: PicoStateChange) => `${change.name}: ${change.before === undefined ? 'new → ' : `${change.before} → `}${change.after ?? 'removed'}`
const describeAnnotation = (annotation: PicoStateAnnotation) => `${formatTime(annotation.seconds)} · ${annotation.changes.length ? annotation.changes.slice(0, 8).map(describeChange).join('; ') : 'No global variables defined'}${annotation.changes.length > 8 ? `; ${annotation.changes.length - 8} more changes` : ''}`

function VariableMarker({ marker: { annotation, count }, position, onSeek, onHoverTime }: {
  marker: PicoStateMarker; position: string; onSeek?: (seconds: number) => void; onHoverTime?: (seconds: number | null) => void
}) {
  const summary = describeAnnotation(annotation)
  const groupHint = count > 1 ? `\n${count} snapshots grouped here. Zoom in or use the arrows to inspect each change.` : '\nClick to seek to this snapshot.'
  return <button type="button" className="scope-variable-marker" data-testid="scope-variable-marker" data-time={annotation.seconds} style={{ left: position }} disabled={!onSeek} aria-label={`Variable change at ${summary}${count > 1 ? `; ${count} snapshots in this group` : ''}`} title={`${summary}${groupHint}`} onClick={() => onSeek?.(annotation.seconds)} onPointerEnter={() => onHoverTime?.(annotation.seconds)} onPointerLeave={() => onHoverTime?.(null)} onFocus={() => onHoverTime?.(annotation.seconds)} onBlur={() => onHoverTime?.(null)}><i />{count > 1 && <small>{count}</small>}</button>
}

function ChangeSummary({ annotation, stopped, unavailable }: { annotation: PicoStateAnnotation | null; stopped: boolean | undefined; unavailable?: string }) {
  if (stopped) return <>Later values unavailable · state recording reached its limit</>
  if (!annotation) return <>{unavailable || 'No variables recorded at this time'}</>
  if (!annotation.changes.length) return <>No global variables defined</>
  return <>{annotation.changes.slice(0, 3).map(change => <span key={change.name} title={describeChange(change)}><code>{change.name}</code> {change.after === undefined ? 'removed' : `= ${change.after}`}</span>)}{annotation.changes.length > 3 && <small>+{annotation.changes.length - 3} changes · inspect below</small>}</>
}

export function ScopeAnnotations({ capture, windowStart, windowEnd, seconds, onSeek, hoverTime, onHoverTime }: {
  capture: Capture | null
  windowStart: number
  windowEnd: number
  seconds: number
  onSeek?: (seconds: number) => void
  hoverTime?: number | null
  onHoverTime?: (seconds: number | null) => void
}) {
  const trace = capture?.picoTrace?.state
  const track = useRef<HTMLDivElement>(null)
  const [markerLimit, setMarkerLimit] = useState(24)
  useEffect(() => {
    if (!track.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setMarkerLimit(Math.max(1, Math.min(48, Math.floor(entry.contentRect.width / 24))))
    })
    observer.observe(track.current)
    return () => observer.disconnect()
  }, [trace])
  const timeline = useMemo(() => createPicoStateTimeline(trace), [trace])
  const markers = useMemo(() => timeline.window(windowStart, windowEnd, markerLimit), [timeline, windowStart, windowEnd, markerLimit])
  const inspectedTime = hoverTime ?? seconds
  const annotation = timeline.at(inspectedTime)
  const previous = timeline.before(seconds), next = timeline.after(seconds)
  const stopped = trace?.truncated && inspectedTime * 1e9 > trace.sampledThroughNs
  const position = (time: number) => `${(time - windowStart) / (windowEnd - windowStart || 1) * 100}%`
  if (!trace) return null

  return <section className="scope-annotations" aria-label="Pico variable annotations" onKeyDown={event => event.stopPropagation()}>
    <div className="scope-annotations-heading">
      <strong><i />Variable changes</strong>
      <span title="Variables are sampled, so changes between snapshots may be missed. Use scope.log() for explicit numeric observations.">Sampled every {formatTime(trace.intervalNs / 1e9)}</span>
      <div className="scope-annotations-navigation">
        <button type="button" aria-label="Previous annotated variable change" title="Seek to the previous recorded variable change" disabled={!previous || !onSeek} onClick={() => previous && onSeek?.(previous.seconds)}><ChevronLeft size={14} aria-hidden="true" /></button>
        <button type="button" aria-label="Next annotated variable change" title="Seek to the next recorded variable change" disabled={!next || !onSeek} onClick={() => next && onSeek?.(next.seconds)}><ChevronRight size={14} aria-hidden="true" /></button>
      </div>
    </div>
    {timeline.annotations.length > 0 && <div ref={track} className="scope-annotations-track" data-window-start={windowStart} data-window-end={windowEnd}>
      {markers.map(marker => <VariableMarker key={marker.annotation.seconds} marker={marker} position={position(marker.annotation.seconds)} onSeek={onSeek} onHoverTime={onHoverTime} />)}
      {seconds >= windowStart && seconds <= windowEnd && <span className="scope-annotation-playhead" style={{ left: position(seconds) }} />}
      {hoverTime != null && hoverTime >= windowStart && hoverTime <= windowEnd && <span className="scope-annotation-hover" style={{ left: position(hoverTime) }} />}
      {!markers.length && <span className="scope-annotations-track-empty">No recorded changes in this window</span>}
    </div>}
    <div className="scope-annotation-readout">
      <span>{hoverTime != null ? 'Change before hover' : 'Last change'}{annotation && <> <time>{formatTime(annotation.seconds)}</time></>}</span>
      <output aria-label="Pico variable change summary"><ChangeSummary annotation={annotation} stopped={stopped} unavailable={trace.unavailable} /></output>
    </div>
    {(trace.unavailable || trace.truncated) && <p className="scope-annotation-warning">{trace.unavailable || `Incomplete state recording · sampled through ${formatTime(trace.sampledThroughNs / 1e9)}`}</p>}
  </section>
}
