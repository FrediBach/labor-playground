import { useState, type ReactNode } from 'react'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'

const DENSITY_KEY = 'labor.instrument-density'

/** Instrument density is a browser preference, independent of project history. */
export function InstrumentRack({ children }: { children: ReactNode }) {
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem(DENSITY_KEY) === 'compact' }
    catch { return false }
  })

  function toggleDensity() {
    const next = !compact
    setCompact(next)
    try { localStorage.setItem(DENSITY_KEY, next ? 'compact' : 'full') }
    catch { /* The view still works when preference storage is unavailable. */ }
  }

  return <div className={`instrument-rack${compact ? ' is-compact' : ''}`}>
    <div className="chassis-brand">
      <div className="labor-wordmark"><strong>PICO LABOR</strong><span>EDU / VIRTUAL WORKBENCH</span></div>
      <button type="button" className="instrument-density-toggle" aria-label="Compact instruments" aria-pressed={compact} title={compact ? 'Restore full instrument controls' : 'Use compact instrument controls'} onClick={toggleDensity}>
        {compact ? <ChevronsUpDown size={14} aria-hidden="true" /> : <ChevronsDownUp size={14} aria-hidden="true" />}
        <span>Compact</span>
      </button>
    </div>
    <div className="instrument-panel">{children}</div>
  </div>
}
