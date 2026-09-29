import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

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
    <label className="commit-slider">
      <span>{label}<output>{Number(draft.toFixed(2))}{unit}</output></span>
      <input
        aria-label={label} type="range" min={min} max={max} step={step} value={draft}
        onChange={event => setEditing({ source: value, value: Number(event.target.value) })}
        onPointerUp={event => onCommit(Number(event.currentTarget.value))}
        onPointerCancel={() => setEditing({ source: value, value })}
        onKeyUp={event => onCommit(Number(event.currentTarget.value))}
        onBlur={event => onCommit(Number(event.currentTarget.value))}
      />
    </label>
  )
}

export function FrequencyKnob({ value, disabled = false, onCommit }: {
  value: number
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const [editing, setEditing] = useState({ source: value, value })
  if (editing.source !== value) setEditing({ source: value, value })
  const draft = editing.source === value ? editing.value : value
  const cancelNumber = useRef(false)
  const drag = useRef<{ x: number; y: number; initial: number; current: number } | null>(null)
  const clamp = (next: number) => Math.round(Math.max(20, Math.min(2000, next)) * 100) / 100
  const setDraft = (next: number) => setEditing({ source: value, value: next })

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const { x, y, initial } = drag.current
    const delta = event.clientX - x + y - event.clientY
    const next = clamp(initial * 10 ** (delta / (event.shiftKey ? 1000 : 100)))
    drag.current.current = next
    setDraft(next)
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    const amount = event.shiftKey ? 1 : 10
    const values: Record<string, number> = {
      ArrowRight: value + amount, ArrowUp: value + amount,
      ArrowLeft: value - amount, ArrowDown: value - amount,
      Home: 20, End: 2000,
    }
    if (event.key in values) { event.preventDefault(); onCommit(clamp(values[event.key])) }
  }

  return (
    <div className={`frequency-knob ${disabled ? 'control-disabled' : ''}`}>
      <div
        className="knob-ring" role="slider" tabIndex={disabled ? -1 : 0}
        aria-label="Oscillator frequency" aria-valuemin={20} aria-valuemax={2000}
        aria-valuenow={draft} aria-valuetext={`${draft} hertz`} aria-disabled={disabled}
        title="Drag up or right to increase. Hold Shift for fine adjustment. Arrow keys adjust by 10 Hz, or 1 Hz with Shift."
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
        onPointerCancel={() => { drag.current = null; setDraft(value) }}
        onLostPointerCapture={() => { drag.current = null }}
      >
        <div className="knob-face" style={{ transform: `rotate(${-130 + Math.log10(clamp(draft) / 20) / 2 * 260}deg)` }}><i /></div>
      </div>
      <label className="knob-number">
        <input
          type="number" aria-label="Frequency in Hz" min={20} max={2000} step="any"
          disabled={disabled} value={draft}
          onChange={event => setDraft(Number(event.target.value))}
          onBlur={event => {
            if (cancelNumber.current) { cancelNumber.current = false; return }
            const parsed = event.currentTarget.valueAsNumber
            const committed = Number.isFinite(parsed) && parsed > 0 ? clamp(parsed) : value
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
        /><span>Hz</span>
      </label>
    </div>
  )
}
