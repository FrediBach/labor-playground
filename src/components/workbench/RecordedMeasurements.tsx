import { curveIntegral, curveValue } from '@/lib/characteristic-curves'
import { useMemo } from 'react'
import { PARTS, formatValue, type CircuitDocument, type Part, type Wire } from '@/lib/circuit'
import { useRecording } from '@/lib/recording-context'
import { formatElectrical } from '@/lib/format-electrical'
import { InspectorSignals, type InspectorSignal } from './InspectorSignals'
import { useRecordedAutomationValue } from './useRecordedAutomationValue'

const PIN_COLORS = ['#9bdec8', '#efc17b', '#aebcff', '#e5a1c5', '#aace83', '#86d1ec', '#eaa78d', '#c4a6ed']

export function RecordedMeasurements({ document, part, nodeByTerminal }: { document: CircuitDocument; part: Part; nodeByTerminal: Record<string, string> }) {
  const { point, playback } = useRecording()
  const switchValue = useRecordedAutomationValue({ document, target: 'switch', partId: part.id }) ?? part.value
  const model = playback.capture?.recording?.parts.find(p => p.partId === part.id)?.customModel
  const signals = useMemo(() => {
    const pins: InspectorSignal[] = part.pins.map((pin, index) => ({
      id: `pin-${index}`, label: `Pin ${index + 1}`, detail: PARTS[part.kind].pinNames[index] === String(index + 1) ? pin.toUpperCase() : `${PARTS[part.kind].pinNames[index]} · ${pin.toUpperCase()}`,
      node: nodeByTerminal[pin], color: PIN_COLORS[index % PIN_COLORS.length],
      ariaLabel: `Recorded pin ${index + 1} voltage`, toggleLabel: `Toggle pin ${index + 1} trace`,
    }))
    if (part.pins.length === 2) pins.push({
      id: 'difference', label: 'Across component', detail: 'Pin 1 − Pin 2', node: nodeByTerminal[part.pins[0]], referenceNode: nodeByTerminal[part.pins[1]],
      color: '#aebcff', ariaLabel: 'Recorded component voltage', toggleLabel: 'Toggle voltage difference trace', differential: true,
    })
    return pins
  }, [part, nodeByTerminal])
  const measured = point?.parts[part.id]
  const voltage = (index: number) => point?.nodeVoltages[nodeByTerminal[part.pins[index]]]
  const a = voltage(0), b = voltage(1)
  const difference = a === undefined || b === undefined ? undefined : a - b
  const current = measured?.currents[0]?.value
  const storedEnergy = part.kind === 'capacitor' || part.kind === 'electrolytic'
    ? difference === undefined ? undefined : model ? curveIntegral(model.characteristic.points, difference, true) : part.customModelId ? undefined : 0.5 * part.value * difference ** 2
    : part.kind === 'inductor' && current !== undefined ? 0.5 * part.value * current ** 2 : undefined
  const state = !point ? undefined : part.kind === 'led' && current !== undefined ? current > 1e-6 ? 'On' : 'Off'
    : part.kind === 'spdt' || part.kind === 'dpdt' ? `Throw ${switchValue >= .5 ? 1 : 0}`
    : part.kind === 'switch' ? switchValue >= .5 ? 'Closed' : 'Open'
      : part.kind === 'timer555' && voltage(2) !== undefined && a !== undefined && voltage(7) !== undefined
        ? voltage(2)! > (a + voltage(7)!) / 2 ? 'Output high' : 'Output low' : undefined
  return <InspectorSignals signals={signals}>
    {point && <>
      {(state || measured?.currents.length || measured?.power != null || storedEnergy !== undefined) ? <div className="signal-metrics">
        {model && <div><span>Recorded model</span><output>{model.name}</output></div>}
        {model && difference !== undefined && (model.baseKind === 'capacitor' || current !== undefined) && <div><span>{model.baseKind === 'capacitor' ? 'Differential capacitance' : 'Resistance'}</span><output aria-label="Recorded model value">{formatValue(curveValue(model.characteristic.points, model.baseKind === 'capacitor' ? difference : Math.abs(current!)), model.baseKind)}</output></div>}
        {state && <div><span>State</span><output aria-label="Recorded component state">{state}</output></div>}
        {measured?.currents.map(item => <div key={item.label}><span>Current <small>{item.label}</small></span><output aria-label={`Recorded current ${item.label}`}>{formatElectrical(item.value, 'A')}</output></div>)}
        {measured?.power != null && <div><span>Power absorbed</span><output aria-label="Recorded component power">{formatElectrical(measured.power, 'W')}</output></div>}
        {storedEnergy !== undefined && <div><span>Stored energy</span><output aria-label="Recorded stored energy">{formatElectrical(storedEnergy, 'J')}</output></div>}
      </div> : null}
      <details className="signal-notes"><summary>About these readings</summary><p>Pin voltages are relative to GND.{part.pins.length === 2 && ' The dashed trace measures pin 1 minus pin 2.'} {PARTS[part.kind].package && part.kind !== 'vactrol' && part.kind !== 'pc817' && part.kind !== 'dpdt' ? 'Current and power are unavailable for this behavioral IC model.' : 'Positive current follows the labeled direction. Negative power returns energy to the circuit.'}</p></details>
    </>}
  </InspectorSignals>
}

export function RecordedWireVoltage({ wire, nodeByTerminal }: { wire: Wire; nodeByTerminal: Record<string, string> }) {
  const signals = useMemo(() => [{
    id: 'wire', label: 'Wire voltage', detail: `${wire.from.toUpperCase()} → ${wire.to.toUpperCase()}`,
    node: nodeByTerminal[wire.from], color: PIN_COLORS[0], ariaLabel: 'Recorded wire voltage', toggleLabel: 'Toggle wire voltage trace',
  }], [wire, nodeByTerminal])
  return <InspectorSignals signals={signals} wire />
}
