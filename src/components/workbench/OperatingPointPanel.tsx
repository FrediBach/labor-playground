import { formatElectrical } from '@/lib/format-electrical'
import type { CircuitDocument } from '@/lib/circuit'
import type { Channel, OperatingPoint } from '@/lib/simulation-types'


export function OperatingPointPanel({ operatingPoint, probes, nodeByTerminal, onHighlight }: {
  operatingPoint?: OperatingPoint
  probes: CircuitDocument['probes']
  nodeByTerminal: Record<string, string>
  onHighlight: (channel: Channel) => void
}) {
  function voltage(channel: Channel) {
    const terminal = probes[channel]
    const node = terminal ? nodeByTerminal[terminal] : undefined
    return node == null ? undefined : operatingPoint?.nodeVoltages[node]
  }
  const ch1 = voltage('CH1')
  const ch2 = voltage('CH2')
  return <details className="operating-point-panel">
    <summary>DC operating point<span>{operatingPoint ? 'INITIAL STATE' : 'AWAITING CAPTURE'}</span></summary>
    <div className="dc-meter-readings">
      {(['CH1', 'CH2'] as const).map(channel => <div key={channel}>
        <button className={channel === 'CH1' ? 'ch1-text' : 'ch2-text'} disabled={!probes[channel]} aria-label={`Highlight ${channel} DC connection`} onClick={() => onHighlight(channel)}>{channel} · {probes[channel]?.toUpperCase() ?? 'UNCONNECTED'}</button>
        <output aria-label={`${channel} DC voltage`}>{formatElectrical(voltage(channel), 'V')}</output><small>relative to GND</small>
      </div>)}
      <div><span>CH1 − CH2</span><output aria-label="DC differential voltage">{formatElectrical(ch1 == null || ch2 == null ? undefined : ch1 - ch2, 'V')}</output><small>differential</small></div>
    </div>
    <p>The initial DC solution before the transient starts. Select a component for its DC current and power. Floating probes have no reading.</p>
  </details>
}
