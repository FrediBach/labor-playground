import { useRef } from 'react'

const MIN_HEIGHT = 100
const MAX_HEIGHT = 640
const bounded = (height: number) => Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height)))

export function ScopeResizer({ height, value, onChange }: {
  height: number
  value: number | undefined
  onChange: (height: number | undefined) => void
}) {
  const drag = useRef<{ pointerId: number; y: number; height: number; previous: number | undefined } | null>(null)
  return <div
    className="scope-resizer" role="separator" tabIndex={0}
    aria-label="Scope height" aria-orientation="horizontal"
    aria-valuemin={MIN_HEIGHT} aria-valuemax={MAX_HEIGHT} aria-valuenow={Math.round(height)}
    aria-valuetext={`${Math.round(height)} pixels`}
    title="Drag to resize the scope. Arrow keys adjust height; Enter or double-click restores the default."
    onDoubleClick={() => onChange(undefined)}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.focus()
      drag.current = { pointerId: event.pointerId, y: event.clientY, height, previous: value }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      if (drag.current) onChange(bounded(drag.current.height + event.clientY - drag.current.y))
    }}
    onPointerUp={event => {
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => { if (drag.current) onChange(drag.current.previous); drag.current = null }}
    onLostPointerCapture={() => { if (drag.current) onChange(drag.current.previous); drag.current = null }}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault(); event.stopPropagation()
        const current = drag.current
        drag.current = null
        onChange(current.previous)
        if (event.currentTarget.hasPointerCapture(current.pointerId)) event.currentTarget.releasePointerCapture(current.pointerId)
        return
      }
      const next: Record<string, number | undefined> = {
        ArrowUp: bounded(height - (event.shiftKey ? 5 : 20)),
        ArrowDown: bounded(height + (event.shiftKey ? 5 : 20)),
        Home: MIN_HEIGHT, End: MAX_HEIGHT, Enter: undefined,
      }
      if (Object.hasOwn(next, event.key)) {
        event.preventDefault(); event.stopPropagation(); onChange(next[event.key])
      }
    }}
  ><span /></div>
}
