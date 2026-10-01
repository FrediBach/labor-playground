import { PICO_PINS } from './pico/profile'
import { PicoClient } from './pico/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compileCircuit, type CircuitDocument } from './circuit'
import { stopAllAudio } from './audio'
import { SimulationClient, SupersededSimulation } from './simulation-client'
import { SIMULATION_LIMITS, type Capture, type SimulationStatus } from './simulation-types'
import { operatingPointDescriptors } from './simulation-descriptors'

export type { Capture, Channel, OperatingPoint, SimulationStatus } from './simulation-types'

interface SimulationState {
  status: SimulationStatus
  capture: Capture | null
  error: string | null
  key: string
  captureKey: string
  requestKey: string
  netlist?: string
}

export function useSimulation(document: CircuitDocument, requestedAutoUpdate: boolean, durationSeconds = 0.1) {
  const autoUpdate = requestedAutoUpdate && !document.pico
  const [picoState, setPicoState] = useState({ phase: '', console: '', key: '' })
  const picoClient = useRef<PicoClient | null>(null)
  const documentKey = useMemo(() => JSON.stringify(document), [document])
  const key = `${documentKey}:${durationSeconds}`
  // Scheduling follows saved document contents. Equivalent object replacements
  // must not cancel an in-flight manual capture while Auto update is disabled.
  const snapshot = useMemo(() => JSON.parse(documentKey) as CircuitDocument, [documentKey])
  const compiled = useMemo(() => compileCircuit(snapshot, 'transient', undefined, durationSeconds), [snapshot, durationSeconds])
  const dcCompiled = useMemo(() => compileCircuit(snapshot, 'operating-point', undefined, durationSeconds), [snapshot, durationSeconds])
  const [state, setState] = useState<SimulationState>({ status: 'loading', capture: null, error: null, key: '', captureKey: '', requestKey: '' })
  const [trigger, setTrigger] = useState(0)
  const requestKey = `${key}:${autoUpdate}:${trigger}`
  const handledTrigger = useRef(0)
  const revision = useRef(0)
  const client = useRef<SimulationClient | null>(null)

  useEffect(() => {
    client.current = new SimulationClient()
    picoClient.current = new PicoClient()
    return () => { client.current?.dispose(); picoClient.current?.stop(); client.current = null; stopAllAudio() }
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
    let runNetlist = compiled.netlist
    const timer = setTimeout(() => {
      const execute = async () => {
        if (currentRevision !== revision.current) throw new SupersededSimulation()
        let transient = compiled, operating = dcCompiled
        let picoTrace: Capture['picoTrace']
        if (snapshot.pico) {
          setPicoState({ phase: 'Preparing Pico…', console: '', key })
          const trace = await picoClient.current!.run(snapshot.pico.source, currentRevision, (phase, text) => {
            if (!cancelled && revision.current === currentRevision) setPicoState(previous => ({ phase: phase === 'preparing' ? 'Preparing Pico…' : `Recording ${durationSeconds} s…`, console: text ?? previous.console, key }))
          }, durationSeconds)
          picoTrace = trace
          if (cancelled) throw new SupersededSimulation()
          transient = compileCircuit(snapshot, 'transient', trace, durationSeconds)
          operating = compileCircuit(snapshot, 'operating-point', trace, durationSeconds)
          const failure = transient.diagnostics.find(item => item.severity === 'error')
          if (failure) throw new Error(failure.message)
          setPicoState({ phase: 'Calculating circuit…', console: trace.console, key })
        }
        runNetlist = transient.netlist
        const resolveProbe = (terminal: string | null) => terminal ? transient.nodeByTerminal[terminal] ?? null : null
        const voltageChecks = snapshot.parts.filter(part => part.kind === 'electrolytic').map(part => ({
          partId: part.id,
          positiveNode: transient.nodeByTerminal[part.pins[0]],
          negativeNode: transient.nodeByTerminal[part.pins[1]],
        }))
        const used = new Set([...snapshot.wires.flatMap(w => [transient.nodeByTerminal[w.from], transient.nodeByTerminal[w.to]]), ...Object.values(snapshot.probes).filter(Boolean).map(pin => transient.nodeByTerminal[pin!])])
        const picoChecks = snapshot.pico ? PICO_PINS.filter(pin => pin.gpio !== null && used.has(transient.nodeByTerminal[pin.id])).map(pin => ({ gpio: pin.gpio!, node: transient.nodeByTerminal[pin.id] })) : undefined
        const capture = await instance.run(transient.netlist, { CH1: resolveProbe(snapshot.probes.CH1), CH2: resolveProbe(snapshot.probes.CH2) }, currentRevision, (status) => {
          if (!cancelled && currentRevision === revision.current) setState((previous) => ({ ...previous, key, requestKey, status, error: null }))
        }, voltageChecks, { netlist: operating.netlist, parts: operatingPointDescriptors(snapshot, operating.nodeByTerminal) }, picoChecks, durationSeconds, snapshot.automations?.some(automation => automation.enabled) ? { document: snapshot, picoTrace } : undefined)
        if (capture.automationEvents) runNetlist = compileCircuit(snapshot, 'transient', picoTrace, durationSeconds, capture.automationEvents).netlist
        return picoTrace ? { ...capture, picoTrace } : capture
      }
      void execute().then((capture) => {
        if (!cancelled && capture.revision === revision.current) {
          if (snapshot.pico) setPicoState(previous => ({ ...previous, phase: 'Capture ready' }))
          setState({ key, captureKey: key, requestKey, status: 'ready', capture, error: null, netlist: runNetlist })
        }
      }).catch((error: unknown) => {
        if (cancelled || currentRevision !== revision.current || error instanceof SupersededSimulation) return
        stopAllAudio()
        if (snapshot.pico) setPicoState(previous => ({ ...previous, phase: 'Capture failed' }))
        setState((previous) => ({ ...previous, key, requestKey, status: 'error', error: error instanceof Error ? error.message : 'Simulation failed. Check the circuit and capture again.' }))
      })
    }, manuallyRequested ? 0 : SIMULATION_LIMITS.debounceMs)
    return () => { cancelled = true; clearTimeout(timer); if (snapshot.pico || snapshot.automations?.some(automation => automation.enabled)) { picoClient.current?.stop(); instance.dispose() } }
  }, [key, requestKey, compiled, dcCompiled, snapshot, autoUpdate, trigger, durationSeconds])

  const captureNow = useCallback(() => {
    stopAllAudio()
    setState((previous) => ({ ...previous, key, requestKey: `${key}:${autoUpdate}:${trigger + 1}`, status: 'calculating', error: null }))
    setTrigger(trigger + 1)
  }, [key, autoUpdate, trigger])
  const stop = useCallback(() => {
    stopAllAudio(); revision.current++; picoClient.current?.stop(); client.current?.dispose()
    setState(previous => ({ ...previous, key, requestKey, status: 'stale', capture: null, error: null }))
    setPicoState(previous => ({ ...previous, phase: 'Stopped' }))
  }, [key, requestKey])
  const reset = useCallback(() => {
    if (document.pico) { stop(); setPicoState({ key, phase: 'Reset — ready to Run', console: '' }); return }
    stopAllAudio()
    client.current?.dispose()
    client.current = new SimulationClient()
    setState((previous) => ({ ...previous, key, requestKey: `${key}:${autoUpdate}:${trigger + 1}`, capture: null, error: null, status: 'loading' }))
    setTrigger(trigger + 1)
  }, [key, autoUpdate, trigger, document.pico, stop])

  // An edit invalidates the displayed status immediately, before the effect runs.
  let status: SimulationStatus = state.status
  if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) status = 'invalid'
  else if (state.requestKey !== requestKey) {
    status = autoUpdate
      ? (state.capture ? 'calculating' : 'loading')
      : state.key === key && state.status === 'error' ? 'error'
      : state.capture && state.captureKey === key ? 'ready' : 'stale'
  }

  return { status, capture: state.capture, error: status === 'error' ? state.error : null, diagnostics: status === 'ready' ? [...compiled.diagnostics, ...(state.capture?.diagnostics ?? [])] : compiled.diagnostics, netlist: status === 'ready' ? state.netlist ?? compiled.netlist : compiled.netlist, nodeByTerminal: compiled.nodeByTerminal, captureNow, reset, stop, picoPhase: picoState.key === key ? picoState.phase : 'Source or wiring changed — Run to capture', serial: picoState.key === key ? picoState.console : '' }
}
