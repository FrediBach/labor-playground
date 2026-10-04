import type { PicoStateTrace, PicoStateValue, PicoStateVariable } from './state.ts'

export interface PicoStateChange { name: string; before?: string; after?: string }
export interface PicoStateAnnotation { seconds: number; changes: PicoStateChange[] }
export interface PicoStateMarker { annotation: PicoStateAnnotation; count: number }

function changesBetween(before: PicoStateVariable[], after: PicoStateVariable[], prefix = ''): PicoStateChange[] {
  const previous = new Map(before.map(variable => [variable.name, variable.value]))
  const current = new Map(after.map(variable => [variable.name, variable.value]))
  return [...new Set([...current.keys(), ...previous.keys()])].flatMap(name => {
    const oldValue = previous.get(name), value = current.get(name)
    const path = prefix ? `${prefix}.${name}` : name
    if (JSON.stringify(oldValue) === JSON.stringify(value)) return []
    // Existing containers get useful leaf annotations; additions and removals
    // retain the parent summary instead of filling the timeline with children.
    if (oldValue?.children && value?.children && oldValue.type === value.type) {
      const children = changesBetween(oldValue.children, value.children, path)
      if (children.length) return children
    }
    const display = (item: PicoStateValue | undefined) => item ? `${item.value}${item.truncated ? ' (limited preview)' : ''}` : undefined
    return [{ name: path, before: display(oldValue), after: display(value) }]
  })
}

/** Build once per immutable capture. Cursor and frame queries use binary
 * searches; dense marker groups never require another full snapshot scan. */
export function createPicoStateTimeline(trace: PicoStateTrace | undefined) {
  const annotations: PicoStateAnnotation[] = (trace?.snapshots ?? []).map((snapshot, index, snapshots) => ({
    seconds: snapshot.ns / 1e9,
    changes: changesBetween(snapshots[index - 1]?.variables ?? [], snapshot.variables),
  }))
  const lowerBound = (seconds: number) => {
    let low = 0, high = annotations.length
    while (low < high) { const middle = (low + high) >>> 1; if (annotations[middle].seconds < seconds) low = middle + 1; else high = middle }
    return low
  }
  const upperBound = (seconds: number) => {
    let low = 0, high = annotations.length
    while (low < high) { const middle = (low + high) >>> 1; if (annotations[middle].seconds <= seconds) low = middle + 1; else high = middle }
    return low
  }
  return {
    annotations,
    at: (seconds: number) => Number.isFinite(seconds) ? annotations[upperBound(seconds) - 1] ?? null : null,
    before: (seconds: number) => Number.isFinite(seconds) ? annotations[lowerBound(seconds) - 1] ?? null : null,
    after: (seconds: number) => Number.isFinite(seconds) ? annotations[upperBound(seconds)] ?? null : null,
    window: (start: number, end: number, requestedLimit = 48): PicoStateMarker[] => {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(requestedLimit) || requestedLimit < 1) return []
      const limit = Math.min(48, Math.floor(requestedLimit))
      const first = lowerBound(start), last = upperBound(end)
      const markers: PicoStateMarker[] = []
      let from = first
      for (let bin = 0; bin < limit; bin++) {
        const to = bin === limit - 1 ? last : lowerBound(start + (bin + 1) / limit * (end - start))
        if (to > from) markers.push({ annotation: annotations[from], count: to - from })
        from = to
      }
      return markers
    },
  }
}
