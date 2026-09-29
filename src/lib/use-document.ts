import { useCallback, useEffect, useReducer, useState } from 'react'
import { examples, validateDocument, type CircuitDocument } from './circuit'

const STORAGE_KEY = 'labor-playground.document.v1'
type History = { past: CircuitDocument[]; present: CircuitDocument; future: CircuitDocument[] }
type Action = { type: 'change'; document: CircuitDocument } | { type: 'undo' | 'redo' }

function initialHistory(): History {
  let document = structuredClone(examples[0].document)
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && saved.length < 100_000) document = validateDocument(JSON.parse(saved))
  } catch { /* Recovery is optional; the workbench always works without storage. */ }
  return { past: [], present: document, future: [] }
}

function reducer(state: History, action: Action): History {
  if (action.type === 'change') {
    if (JSON.stringify(state.present) === JSON.stringify(action.document)) return state
    return { past: [...state.past.slice(-79), state.present], present: action.document, future: [] }
  }
  if (action.type === 'undo' && state.past.length) {
    return { past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] }
  }
  if (action.type === 'redo' && state.future.length) {
    return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
  }
  return state
}

export function useDocument() {
  const [history, dispatch] = useReducer(reducer, undefined, initialHistory)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.present))
        setSaved(true)
      } catch { setSaved(false) }
    }, 150)
    return () => clearTimeout(timeout)
  }, [history.present])
  const change = useCallback((document: CircuitDocument) => dispatch({ type: 'change', document }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  return { document: history.present, change, undo, redo, canUndo: !!history.past.length, canRedo: !!history.future.length, saved }
}
