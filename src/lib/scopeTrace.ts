import { createVoltageSampler } from './measurements.ts'
import type { CaptureFrame } from './trigger.ts'

const BLOCK_SIZE = 64

function bound(time: readonly number[], target: number, inclusive: boolean): number {
  let low = 0, high = time.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (time[middle] < target || (inclusive && time[middle] === target)) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Cache extrema in a small tree of 64-sample blocks. Each screen column then
 * reads only its boundary samples and O(log N) cached blocks, preserving even
 * one-sample pulses without rescanning a long recording on every redraw.
 * The capture arrays must remain immutable for the lifetime of the index.
 */
export function createScopeTrace(time: readonly number[], values: readonly number[]) {
  const sampleAt = createVoltageSampler(time, values)
  if (!sampleAt) return null
  let leafCount = 1
  while (leafCount < Math.ceil(values.length / BLOCK_SIZE)) leafCount *= 2
  const minima = new Float64Array(leafCount * 2).fill(Infinity)
  const maxima = new Float64Array(leafCount * 2).fill(-Infinity)
  for (let index = 0; index < values.length; index++) {
    const block = leafCount + Math.floor(index / BLOCK_SIZE)
    minima[block] = Math.min(minima[block], values[index])
    maxima[block] = Math.max(maxima[block], values[index])
  }
  for (let index = leafCount - 1; index > 0; index--) {
    minima[index] = Math.min(minima[index * 2], minima[index * 2 + 1])
    maxima[index] = Math.max(maxima[index * 2], maxima[index * 2 + 1])
  }

  function rangeExtrema(start: number, end: number) {
    let min = Infinity, max = -Infinity
    while (start < end && start % BLOCK_SIZE !== 0) {
      min = Math.min(min, values[start]); max = Math.max(max, values[start]); start++
    }
    while (end > start && end % BLOCK_SIZE !== 0) {
      end--; min = Math.min(min, values[end]); max = Math.max(max, values[end])
    }
    let left = leafCount + start / BLOCK_SIZE
    let right = leafCount + end / BLOCK_SIZE
    while (left < right) {
      if (left % 2 === 1) { min = Math.min(min, minima[left]); max = Math.max(max, maxima[left]); left++ }
      if (right % 2 === 1) { right--; min = Math.min(min, minima[right]); max = Math.max(max, maxima[right]) }
      left = Math.floor(left / 2); right = Math.floor(right / 2)
    }
    return Number.isFinite(min) ? { min, max } : null
  }

  return {
    sampleAt,
    envelope(start: number, end: number, columns: number) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(columns) || columns <= 0) return []
      const count = Math.ceil(columns)
      let index = bound(time, start, false)
      // Scanning a small visible window is cheaper than querying the tree.
      const scan = bound(time, end, true) - index <= count * 512
      return Array.from({ length: count }, (_, column) => {
        const until = Math.min(end, start + (column + 1) / columns * (end - start))
        if (scan) {
          let min = Infinity, max = -Infinity
          while (index < time.length && time[index] <= until) {
            min = Math.min(min, values[index]); max = Math.max(max, values[index]); index++
          }
          return Number.isFinite(min) ? { min, max } : null
        }
        const next = bound(time, until, true)
        const extrema = rangeExtrema(index, next)
        index = next
        return extrema
      })
    },
  }
}

/** Page at view boundaries instead of scrolling/redrawing the trace every frame. */
export function followCaptureFrame(base: CaptureFrame, first: number, last: number, seconds: number): CaptureFrame {
  if (!Number.isFinite(seconds) || seconds >= base.start && seconds <= base.end) return base
  const page = Math.floor((seconds - base.start) / base.duration)
  const start = Math.max(first, Math.min(last - base.duration, base.start + page * base.duration))
  return { start, end: Math.min(last, start + base.duration), duration: base.duration }
}
