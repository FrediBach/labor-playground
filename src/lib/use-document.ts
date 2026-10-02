import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { PROJECT_LIMITS } from './project-limits'
import { examples, validateDocument, type CircuitDocument } from './circuit'

const STORAGE_KEY = 'labor-playground.document.v1'
interface Entry { document: CircuitDocument; sourceId: number }
type History = { past: Entry[]; present: Entry; future: Entry[]; sources: Record<number, string>; nextId: number }
type Action = { type: 'change' | 'replace'; document: CircuitDocument } | { type: 'undo' | 'redo' } | { type: 'source'; source: string }
function initialHistory(): History {
  let document = structuredClone(examples[0].document)
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && new TextEncoder().encode(saved).length <= PROJECT_LIMITS.bytes) document = validateDocument(JSON.parse(saved))
  } catch { /* Recovery is optional; export remains available without storage. */ }
  return { past: [], present: { document, sourceId: 0 }, future: [], sources: { 0: document.pico?.source ?? '' }, nextId: 1 }
}
function withSource(entry: Entry, sources: History['sources']): CircuitDocument {
  return entry.document.pico ? { ...entry.document, pico: { ...entry.document.pico, source: sources[entry.sourceId] } } : entry.document
}
function reducer(state: History, action: Action): History {
  if (action.type === 'source') {
    if (!state.present.document.pico) return state
    return { ...state, sources: { ...state.sources, [state.present.sourceId]: action.source } }
  }
  if (action.type === 'change' || action.type === 'replace') {
    const current = withSource(state.present, state.sources)
    if (JSON.stringify(current) === JSON.stringify(action.document)) return state
    const sameSource = action.type !== 'replace' && current.pico && action.document.pico && current.pico.source === action.document.pico.source
    const sourceId = sameSource ? state.present.sourceId : state.nextId
    const past = [...state.past.slice(-79), state.present]
    const retained = new Set([...past.map(entry => entry.sourceId), sourceId])
    const sources = Object.fromEntries(Object.entries(state.sources).filter(([id]) => retained.has(Number(id))))
    sources[sourceId] = action.document.pico?.source ?? ''
    return { past, present: { document: action.document, sourceId }, future: [], sources, nextId: state.nextId + (sameSource ? 0 : 1) }
  }
  if (action.type === 'undo' && state.past.length) return { ...state, past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] }
  if (action.type === 'redo' && state.future.length) return { ...state, past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
  return state
}
export function useDocument() {
  const [history, dispatch] = useReducer(reducer, undefined, initialHistory)
  const document = useMemo(() => withSource(history.present, history.sources), [history.present, history.sources])
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        if (document.pico && new TextEncoder().encode(document.pico.source).length > PROJECT_LIMITS.sourceBytes) throw new Error('Source exceeds storage limit.')
        const serialized = JSON.stringify(document)
        if (new TextEncoder().encode(serialized).length > PROJECT_LIMITS.bytes) throw new Error('Project exceeds storage limit.')
        localStorage.setItem(STORAGE_KEY, serialized)
        setSaved(true)
      } catch { setSaved(false) }
    }, 150)
    return () => clearTimeout(timeout)
  }, [document])
  const change = useCallback((document: CircuitDocument) => dispatch({ type: 'change', document }), [])
  const replace = useCallback((document: CircuitDocument) => dispatch({ type: 'replace', document }), [])
  const changeSource = useCallback((source: string) => dispatch({ type: 'source', source }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  return { document, sourceSession: history.present.sourceId, change, replace, changeSource, undo, redo, canUndo: !!history.past.length, canRedo: !!history.future.length, saved }
}
