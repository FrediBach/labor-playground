import { useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Code2, Search, X } from 'lucide-react'
import { useRecording } from '@/lib/recording-context'
import type { PicoStateSnapshot, PicoStateValue } from '@/lib/pico/state'
import './PicoStateInspector.css'

function formatTime(ns: number) {
  return `${Number((ns / 1e6).toFixed(3)).toLocaleString(undefined, { maximumFractionDigits: 3 })} ms`
}

function snapshotIndexAt(snapshots: PicoStateSnapshot[], ns: number) {
  let low = 0, high = snapshots.length - 1, found = -1
  while (low <= high) {
    const middle = (low + high) >>> 1
    if (snapshots[middle].ns <= ns) { found = middle; low = middle + 1 }
    else high = middle - 1
  }
  return found
}

function sameValue(value: PicoStateValue, previous: PicoStateValue) {
  return JSON.stringify(value) === JSON.stringify(previous)
}

export function PicoStateInspector({ enabled = false }: { enabled?: boolean }) {
  const { playback, seconds } = useRecording()
  const [collapsed, setCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const trace = playback.capture?.picoTrace?.state
  const snapshots = trace?.snapshots
  const ns = Math.round(seconds * 1e9)
  const index = snapshots ? snapshotIndexAt(snapshots, ns) : -1
  const snapshot = snapshots?.[index]
  const previous = snapshots?.[index - 1]
  const rows = useMemo(() => {
    if (!snapshot) return []
    const before = new Map(previous?.variables.map(variable => [variable.name, variable.value]))
    const current = new Map(snapshot.variables.map(variable => [variable.name, variable.value]))
    return [...new Set([...current.keys(), ...before.keys()])].sort((a, b) => a.localeCompare(b)).map(name => ({ name, value: current.get(name), previous: before.get(name) }))
  }, [snapshot, previous])
  const normalizedQuery = query.trim().toLowerCase()
  const visible = rows.filter(row => row.name.toLowerCase().includes(normalizedQuery))
  const previousIndex = snapshot && snapshot.ns < ns ? index : index - 1
  const next = snapshots?.[index + 1]
  const changedCount = previous ? rows.filter(row => !row.value || !row.previous || !sameValue(row.value, row.previous)).length : 0
  const stopped = trace?.truncated && trace.sampledThroughNs !== undefined && ns > trace.sampledThroughNs
  if (!enabled && !playback.capture?.picoTrace) return null

  return <section className="pico-state-inspector" aria-label="Pico application state" data-testid="pico-state-inspector" onKeyDown={event => event.stopPropagation()}>
    <div className="pico-state-heading">
      <div className="pico-state-title"><Code2 size={16} aria-hidden="true" /><div><h2>Pico variables</h2><p>Recorded application state · follows the recording cursor</p></div></div>
      <button type="button" className="pico-state-collapse" aria-label={collapsed ? 'Expand Pico variables' : 'Collapse Pico variables'} aria-expanded={!collapsed} aria-controls="pico-state-content" onClick={() => setCollapsed(value => !value)}><ChevronDown size={16} aria-hidden="true" /></button>
    </div>
    <div id="pico-state-content" hidden={collapsed}>
      {!trace ? <p className="pico-state-empty">Run your Pico code, then open Results and scrub the recording to inspect variables. Global variables are captured automatically; no logging code needed.</p>
        : !snapshots?.length ? <p className="pico-state-empty">{trace.unavailable || 'No application state was captured. Run your Pico code again to record global variables.'}</p>
          : <>
            <div className="pico-state-timing">
              <div className="pico-state-cursor"><span>At cursor</span><output aria-label="Pico variables recording time">{formatTime(ns)}</output></div>
              <p>{snapshot ? <>{index === 0 ? 'First snapshot' : 'Last recorded change'} <strong data-testid="pico-state-snapshot-time">{formatTime(snapshot.ns)}</strong></> : <>First snapshot at <strong>{formatTime(snapshots[0].ns)}</strong></>}<span>Sampled every {formatTime(trace.intervalNs)} · changes between samples may be missed</span></p>
              <div className="pico-state-navigation" aria-label="Navigate recorded variable changes">
                <button type="button" aria-label="Previous variable change" title="Previous recorded change" disabled={previousIndex < 0} onClick={() => playback.seek(snapshots[previousIndex].ns / 1e9)}><ChevronLeft size={14} aria-hidden="true" /><span>Previous</span></button>
                <button type="button" aria-label="Next variable change" title="Next recorded change" disabled={!next} onClick={() => { if (next) playback.seek(next.ns / 1e9) }}><span>Next change</span><ChevronRight size={14} aria-hidden="true" /></button>
              </div>
            </div>
            {trace.truncated && <p className="pico-state-warning" role="note">State recording reached its size limit{trace.sampledThroughNs !== undefined ? ` at ${formatTime(trace.sampledThroughNs)}` : ''}. {stopped ? 'Showing the last captured values; later values are unavailable.' : 'Later changes may be missing. Use a shorter run to capture more detail.'}</p>}
            {trace.unavailable && <p className="pico-state-warning" role="note">{trace.unavailable}</p>}
            {!snapshot ? <p className="pico-state-empty">No variables recorded at this time. Use Next change or scrub forward to the first snapshot.</p> : <>
              <div className="pico-state-tools">
                <label className="pico-state-search"><Search size={14} aria-hidden="true" /><input type="search" value={query} aria-label="Filter Pico variables" placeholder="Filter variables by name…" onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear variable filter" onClick={() => setQuery('')}><X size={13} aria-hidden="true" /></button>}</label>
                <span>{normalizedQuery ? `${visible.length} matching` : `${snapshot.variables.length} ${snapshot.variables.length === 1 ? 'variable' : 'variables'}`}{changedCount > 0 && <> · <i />{changedCount} changed</>}</span>
              </div>
              {visible.length ? <div className="pico-state-table-scroll" tabIndex={0} aria-label="Recorded variable values">
                <table className="pico-state-table"><colgroup><col className="pico-state-name-column" /><col className="pico-state-type-column" /><col /></colgroup><thead><tr><th scope="col">Variable</th><th scope="col">Type</th><th scope="col">Recorded value</th></tr></thead><tbody>
                  {visible.map(row => <VariableRow key={row.name} {...row} path={row.name} depth={0} compare={!!previous} />)}
                </tbody></table>
              </div> : <p className="pico-state-empty">{normalizedQuery ? `No variables match “${query}”.` : 'No global variables were defined at this time.'}</p>}
              {changedCount > 0 && <p className="pico-state-change-note">Highlighted values differ from the previous recorded snapshot.</p>}
            </>}
          </>}
      <details className="pico-state-help"><summary>What is captured?</summary><p>Global variables in <code>main.py</code> are sampled with the simulation clock. Expand containers to inspect their captured items. Function-local variables are not captured. Some values have limited previews or are unavailable. Use <code>scope.log()</code> to record a specific value exactly where your code logs it.</p></details>
    </div>
  </section>
}

function VariableRow({ name, value, previous, path, depth, compare }: {
  name: string; value?: PicoStateValue; previous?: PicoStateValue; path: string; depth: number; compare: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const children = value?.children
  const change = !compare ? undefined : !value ? 'Removed' : !previous ? 'New' : !sameValue(value, previous) ? 'Changed' : undefined
  const previousChildren = new Map(previous?.children?.map(child => [child.name, child.value]))
  return <>
    <tr data-variable={path} data-state-variable={path} data-changed={change ? 'true' : 'false'} className={change ? 'pico-state-row-changed' : undefined}>
      <th scope="row" style={{ paddingLeft: 12 + depth * 16 }}>
        <div className="pico-state-name">{children?.length ? <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${path}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><ChevronRight size={14} aria-hidden="true" /></button> : <span className="pico-state-leaf" />}<code>{name}</code>{change && <span className="pico-state-change" title={`${change} since the previous recorded snapshot`}>{change}</span>}</div>
      </th>
      <td className="pico-state-type">{value?.type ?? '—'}</td>
      <td className="pico-state-value"><code data-testid={`pico-variable-${path}`}>{value?.value ?? '—'}</code>{value?.truncated && <span className="pico-state-limited" title="Only a limited preview of this value was captured">Limited preview</span>}</td>
    </tr>
    {expanded && children?.map((child, index) => <VariableRow key={`${index}:${child.name}`} name={child.name} value={child.value} previous={previous?.children?.[index]?.name === child.name ? previous.children[index].value : previousChildren.get(child.name)} path={`${path}.${child.name}`} depth={depth + 1} compare={compare} />)}
  </>
}
