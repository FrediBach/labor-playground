import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compileCircuit, type CircuitDocument } from './circuit'
import { stopAllAudio } from './audio'
import { SimulationClient, SupersededSimulation } from './simulation-client'
import { SIMULATION_LIMITS, type Capture, type SimulationStatus } from './simulation-types'

export type { Capture, Channel, SimulationStatus } from './simulation-types'

interface SimulationState {
  status: SimulationStatus
  capture: Capture | null
  error: string | null
  key: string
  captureKey: string
  requestKey: string
}

export function useSimulation(document: CircuitDocument, autoUpdate: boolean) {
  const key = useMemo(() => JSON.stringify(document), [document])
  // Scheduling follows saved document contents. Equivalent object replacements
  // must not cancel an in-flight manual capture while Auto update is disabled.
  const snapshot = useMemo(() => JSON.parse(key) as CircuitDocument, [key])
  const compiled = useMemo(() => compileCircuit(snapshot), [snapshot])
  const [state, setState] = useState<SimulationState>({ status: 'loading', capture: null, error: null, key: '', captureKey: '', requestKey: '' })
  const [trigger, setTrigger] = useState(0)
  const requestKey = `${key}:${autoUpdate}:${trigger}`
  const handledTrigger = useRef(0)
  const revision = useRef(0)
  const client = useRef<SimulationClient | null>(null)

  useEffect(() => {
    client.current = new SimulationClient()
    return () => { client.current?.dispose(); client.current = null; stopAllAudio() }
  }, [])

  useEffect(() => { stopAllAudio() }, [key])

  useEffect(() => {
    const instance = client.current!
    let cancelled = false
    const currentRevision = ++revision.current
    const manuallyRequested = handledTrigger.current !== trigger
    handledTrigger.current = trigger
    instance.discardQueued()

    if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return
    }
    if (!autoUpdate && !manuallyRequested) {
      return
    }
    const timer = setTimeout(() => {
      const resolveProbe = (terminal: string | null) => terminal ? compiled.nodeByTerminal[terminal] ?? null : null
      void instance.run(compiled.netlist, { CH1: resolveProbe(snapshot.probes.CH1), CH2: resolveProbe(snapshot.probes.CH2) }, currentRevision, (status) => {
        if (!cancelled) setState((previous) => ({ ...previous, key, requestKey, status, error: null }))
      }).then((capture) => {
        if (!cancelled && capture.revision === revision.current) setState({ key, captureKey: key, requestKey, status: 'ready', capture, error: null })
      }).catch((error: unknown) => {
        if (cancelled || error instanceof SupersededSimulation) return
        stopAllAudio()
        setState((previous) => ({ ...previous, key, requestKey, status: 'error', error: error instanceof Error ? error.message : 'Simulation failed. Check the circuit and capture again.' }))
      })
    }, manuallyRequested ? 0 : SIMULATION_LIMITS.debounceMs)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [key, requestKey, compiled, snapshot.probes, autoUpdate, trigger])

  const captureNow = useCallback(() => {
    stopAllAudio()
    setState((previous) => ({ ...previous, key, requestKey: `${key}:${autoUpdate}:${trigger + 1}`, status: 'calculating', error: null }))
    setTrigger(trigger + 1)
  }, [key, autoUpdate, trigger])
  const reset = useCallback(() => {
    stopAllAudio()
    client.current?.dispose()
    client.current = new SimulationClient()
    setState((previous) => ({ ...previous, key, requestKey: `${key}:${autoUpdate}:${trigger + 1}`, capture: null, error: null, status: 'loading' }))
    setTrigger(trigger + 1)
  }, [key, autoUpdate, trigger])

  // An edit invalidates the displayed status immediately, before the effect runs.
  let status: SimulationStatus = state.status
  if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) status = 'invalid'
  else if (state.requestKey !== requestKey) {
    status = autoUpdate
      ? (state.capture ? 'calculating' : 'loading')
      : state.key === key && state.status === 'error' ? 'error'
      : state.capture && state.captureKey === key ? 'ready' : 'stale'
  }

  return { status, capture: state.capture, error: status === 'error' ? state.error : null, diagnostics: compiled.diagnostics, netlist: compiled.netlist, captureNow, reset }
}
