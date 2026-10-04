import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import './HardwareControls.css'

export function NumberField({ label, value, min, max, unit, onCommit }: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onCommit: (value: number) => void
}) {
  const [editing, setEditing] = useState({ source: value, text: String(value) })
  if (editing.source !== value) setEditing({ source: value, text: String(value) })
  const draft = editing.source === value ? editing.text : String(value)
  const cancelled = useRef(false)
  const setDraft = (text: string) => setEditing({ source: value, text })
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return }
    const parsed = Number(draft)
    if (draft.trim() && Number.isFinite(parsed) && parsed >= min && parsed <= max) onCommit(parsed)
    else setDraft(String(value))
  }
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label} type="number" min={min} max={max} step="any" value={draft}
          onChange={event => setDraft(event.target.value)} onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter') { commit(); event.currentTarget.blur() }
            if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; setDraft(String(value)); event.currentTarget.blur() }
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  )
}

/** Preview locally; each deliberate drag is a single document command. */
export function CommitSlider({ label, value, min, max, step, unit = '', onCommit }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onCommit: (value: number) => void
}) {
  const [editing, setEditing] = useState({ source: value, value })
  if (editing.source !== value) setEditing({ source: value, value })
  const draft = editing.source === value ? editing.value : value
  return (
    <div className="commit-slider">
      <span>{label}<output>{Number(draft.toFixed(2))}{unit}</output></span>
      <input
        aria-label={label} type="range" min={min} max={max} step={step} value={draft}
        onChange={event => setEditing({ source: value, value: Number(event.target.value) })}
        onPointerUp={event => onCommit(Number(event.currentTarget.value))}
        onPointerCancel={() => setEditing({ source: value, value })}
        onKeyUp={event => onCommit(Number(event.currentTarget.value))}
        onBlur={event => onCommit(Number(event.currentTarget.value))}
      />
    </div>
  )
}

export function RotaryControl({ label, value, min, max, step = 0.1, unit = '', disabled = false, logarithmic = false, numberLabel = label, sliderLabel = `${label} knob`, onCommit, onPreview }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  disabled?: boolean
  logarithmic?: boolean
  numberLabel?: string
  sliderLabel?: string
  onCommit: (value: number) => void
  onPreview?: (value: number) => void
}) {
  const [editing, setEditing] = useState({ source: value, value, text: String(value) })
  if (editing.source !== value) setEditing({ source: value, value, text: String(value) })
  const draft = editing.source === value ? editing.value : value
  const numberDraft = editing.source === value ? editing.text : String(value)
  const cancelNumber = useRef(false)
  const drag = useRef<{ x: number; y: number; initial: number; current: number } | null>(null)
  const clamp = (next: number) => Math.round(Math.max(min, Math.min(max, next)) * 1000) / 1000
  const setDraft = (next: number) => setEditing({ source: value, value: next, text: String(next) })
  const proportion = logarithmic ? Math.log(clamp(draft) / min) / Math.log(max / min) : (clamp(draft) - min) / (max - min)

  function move(event: PointerEvent<HTMLInputElement>) {
    if (!drag.current) return
    const { x, y, initial } = drag.current
    const delta = event.clientX - x + y - event.clientY
    const distance = delta / (event.shiftKey ? 1500 : 150)
    const next = clamp(logarithmic ? initial * (max / min) ** distance : initial + distance * (max - min))
    drag.current.current = next
    setDraft(next)
    onPreview?.(next)
  }
  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return
    const amount = event.shiftKey ? step / 10 : step
    const values: Record<string, number> = {
      ArrowRight: value + amount, ArrowUp: value + amount,
      ArrowLeft: value - amount, ArrowDown: value - amount,
      Home: min, End: max,
    }
    if (event.key in values) { event.preventDefault(); onCommit(clamp(values[event.key])) }
  }

  return (
    <div className={`rotary-control frequency-knob ${disabled ? 'control-disabled' : ''}`}>
      <div className="knob-ring">
        <svg className="knob-ticks" viewBox="0 0 52 52" aria-hidden="true">
          {Array.from({ length: 11 }, (_, index) => <path key={index} d="M26 3V6" transform={`rotate(${-130 + index * 26} 26 26)`} />)}
        </svg>
        <div className="knob-face" aria-hidden="true" style={{ transform: `rotate(${-130 + proportion * 260}deg)` }}><i /></div>
        <input
          className="knob-interaction" type="range" min={min} max={max} step="any" value={draft} disabled={disabled}
          aria-label={sliderLabel} aria-valuemin={min} aria-valuemax={max}
          aria-valuenow={draft} aria-valuetext={`${draft} ${unit}`} aria-disabled={disabled}
          title={`${label}: drag up or right to increase. Hold Shift for fine adjustment. Arrow keys adjust by ${step} ${unit}.`}
          onChange={event => onCommit(clamp(Number(event.currentTarget.value)))}
          onKeyDown={keyboard}
          onPointerDown={event => {
            if (disabled || event.button !== 0) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { x: event.clientX, y: event.clientY, initial: value, current: value }
          }}
          onPointerMove={move}
          onPointerUp={event => {
            if (!drag.current) return
            onCommit(drag.current.current)
            drag.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => { drag.current = null; setDraft(value); onPreview?.(value) }}
          onLostPointerCapture={() => { if (drag.current) { drag.current = null; setDraft(value); onPreview?.(value) } }}
        />
      </div>
      <label className="knob-number">
        <input
          type="number" aria-label={numberLabel} min={min} max={max} step="any"
          disabled={disabled} value={numberDraft}
          onChange={event => {
            const text = event.target.value
            setEditing({ source: value, value: text.trim() ? Number(text) : value, text })
          }}
          onBlur={event => {
            if (cancelNumber.current) { cancelNumber.current = false; return }
            const parsed = event.currentTarget.valueAsNumber
            const committed = Number.isFinite(parsed) && (!logarithmic || parsed > 0) ? clamp(parsed) : value
            setDraft(committed)
            onCommit(committed)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelNumber.current = true
              setDraft(value)
              event.currentTarget.blur()
            }
          }}
        /><span>{unit}</span>
      </label>
    </div>
  )
}

export function FrequencyKnob({ value, disabled = false, onCommit }: {
  value: number
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  return <RotaryControl label="Frequency" numberLabel="Frequency in Hz" sliderLabel="Oscillator frequency" value={value} min={20} max={2000} step={10} unit="Hz" logarithmic disabled={disabled} onCommit={onCommit} />
}
