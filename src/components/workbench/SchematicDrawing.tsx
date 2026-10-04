import { useMemo, type ReactNode } from 'react'
import type { CircuitDocument } from '../../lib/circuit.ts'
import { formatElectrical } from '../../lib/format-electrical.ts'
import { buildSchematic, type SchematicLayout, type SchematicSymbol } from '../../lib/schematic.ts'

interface SchematicDrawingProps {
  document: CircuitDocument
  layout?: SchematicLayout
  nodeVoltages?: Record<string, number>
  voltageTime?: number
  selectedId?: string | null
  onSelect?: (id: string) => void
}

const sheetStyles = `
.schematic-sheet { background: #fffdf3; color: #803d39; }
.schematic-sheet text { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; fill: #803d39; font-size: 12px; }
.schematic-sheet .sch-symbol { fill: none; stroke: #93423e; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.schematic-sheet .sch-wire { fill: none; stroke: #218450; stroke-width: 1.8; stroke-linecap: square; stroke-linejoin: round; }
.schematic-sheet .sch-net { fill: #275d9b; font-size: 11px; }
.schematic-sheet .sch-pin { fill: #93423e; font-size: 10px; }
.schematic-sheet .sch-ref { font-size: 14px; font-weight: 600; }
.schematic-sheet .sch-value { font-size: 12px; }
.schematic-sheet .sch-muted { fill: #868275; font-size: 11px; }
.schematic-sheet .sch-voltage { fill: #9a5c15; font-size: 11px; font-weight: 600; }
.schematic-sheet .sch-part { outline: none; }
.schematic-sheet .sch-part:focus-visible .sch-focus { stroke: #c88e39; stroke-width: 2; }
`

function PassiveSymbol({ symbol }: { symbol: SchematicSymbol }): ReactNode {
  const kind = symbol.kind
  let body: ReactNode
  let lead = 28
  if (kind === 'resistor') body = <rect x={-27} y={-9} width={54} height={18} />
  else if (kind === 'capacitor' || kind === 'electrolytic') {
    lead = 7
    body = <><path d="M -7 -20 V 20 M 7 -20 V 20" />{kind === 'electrolytic' && <path d="M -24 -22 H -14 M -19 -27 V -17" />}</>
  } else if (kind === 'inductor') {
    lead = 32
    body = <path d="M -32 0 C -32 -23 -16 -23 -16 0 C -16 -23 0 -23 0 0 C 0 -23 16 -23 16 0 C 16 -23 32 -23 32 0" />
  } else if (kind === 'switch') {
    lead = 23
    body = <><circle cx={-23} cy={0} r={3} /><circle cx={23} cy={0} r={3} /><path d={symbol.part?.value === 1 ? 'M -20 0 H 20' : 'M -20 -1 L 18 -23'} /></>
  } else {
    lead = 18
    body = <>
      <path d="M -18 -18 L 18 0 L -18 18 Z M 18 -18 V 18" />
      {kind === 'zener' && <path d="M 11 -22 H 18 V -18 M 18 18 V 22 H 25" />}
      {kind === 'schottky' && <path d="M 11 -13 V -20 H 18 M 18 20 H 25 V 13" />}
      {kind === 'led' && <><path d="M -5 -25 L 9 -39 M 8 -25 L 22 -39" /><path d="M 3 -38 L 9 -39 L 8 -33 M 16 -38 L 22 -39 L 21 -33" /></>}
    </>
  }
  return <g className="sch-symbol" transform={`translate(${symbol.x} ${symbol.y}) rotate(${symbol.rotation})`}><path d={`M -60 0 H ${-lead} M ${lead} 0 H 60`} />{body}</g>
}

function TransistorSymbol({ symbol }: { symbol: SchematicSymbol }) {
  const bipolar = symbol.kind === 'npn' || symbol.kind === 'pnp'
  const inward = symbol.kind === 'pnp' || symbol.kind === 'pmos'
  return <g className="sch-symbol" transform={`translate(${symbol.x} ${symbol.y})`}>
    <circle cx={2} cy={0} r={35} />
    <path d="M -80 0 H -16 M 80 -35 H 25 M 25 35 H 80" />
    {bipolar ? <>
      <path d="M -16 -19 V 19 M -16 -11 L 25 -35 M -16 11 L 25 35" />
      <path fill="#93423e" d={inward ? 'M -4 18 L 6 19 L 1 27 Z' : 'M 21 32 L 11 30 L 15 23 Z'} />
    </> : <>
      <path d="M -16 -18 V 18 M -7 -20 V -9 M -7 -5 V 5 M -7 9 V 20 M -7 -16 H 25 V -35 M -7 16 H 25 V 35" />
      {symbol.kind === 'njfet' ? <path fill="#93423e" d="M -16 0 L -26 -5 V 5 Z" /> : <path fill="#93423e" d={inward ? 'M 3 0 L 12 -5 V 5 Z' : 'M 13 0 L 4 -5 V 5 Z'} />}
      {symbol.kind !== 'njfet' && <path d="M -7 0 H 25 V 35" />}
    </>}
  </g>
}

function PotentiometerSymbol({ symbol }: { symbol: SchematicSymbol }) {
  return <g className="sch-symbol" transform={`translate(${symbol.x} ${symbol.y})`}>
    <path d="M -60 0 H -27 M 27 0 H 60 M 0 60 V 13" />
    <rect x={-27} y={-9} width={54} height={18} />
    <path d="M -5 20 L 0 11 L 5 20" />
  </g>
}

function BlockSymbol({ symbol }: { symbol: SchematicSymbol }) {
  return <>
    <rect className="sch-symbol" x={symbol.x - 100} y={symbol.y - symbol.height / 2} width={200} height={symbol.height} fill="#fffdf3" />
    {symbol.pins.map(pin => <g key={pin.number}>
      <path className="sch-symbol" d={`M ${pin.x} ${pin.y} H ${symbol.x + (pin.side === 'left' ? -100 : 100)}`} />
      <text className="sch-pin" data-schema-pin={pin.number} data-schema-terminal={pin.terminal} x={symbol.x + (pin.side === 'left' ? -115 : 115)} y={pin.y - 6} textAnchor="middle">{pin.number}</text>
      <text x={symbol.x + (pin.side === 'left' ? -90 : 90)} y={pin.y + 4} textAnchor={pin.side === 'left' ? 'start' : 'end'} style={{ fontSize: 11 }}>{pin.name}</text>
    </g>)}
    {symbol.kind === 'pico' && !symbol.pins.length && <text className="sch-muted" x={symbol.x} y={symbol.y + 4} textAnchor="middle">No connected pins</text>}
  </>
}

function SymbolDrawing({ symbol }: { symbol: SchematicSymbol }) {
  const passive = symbol.pins.length === 2 && symbol.kind !== 'pico'
  const transistor = ['npn', 'pnp', 'nmos', 'pmos', 'njfet'].includes(symbol.kind)
  const simple = passive || transistor || symbol.kind === 'potentiometer'
  const vertical = Math.abs(symbol.rotation) === 90
  const labelX = vertical ? symbol.x + 23 : symbol.x
  const labelY = vertical ? symbol.y - 8 : passive ? symbol.y - (symbol.kind === 'led' ? 62 : 47) : simple ? symbol.y - 65 : symbol.y - symbol.height / 2 - 36
  return <>
    {passive ? <PassiveSymbol symbol={symbol} /> : transistor ? <TransistorSymbol symbol={symbol} /> : symbol.kind === 'potentiometer' ? <PotentiometerSymbol symbol={symbol} /> : <BlockSymbol symbol={symbol} />}
    <text className="sch-ref" x={labelX} y={labelY} textAnchor={vertical ? 'start' : 'middle'}>{symbol.id}</text>
    <text className="sch-value" x={labelX} y={labelY + 19} textAnchor={vertical ? 'start' : 'middle'}>{simple ? symbol.value : symbol.label}</text>
    {!simple && <text className="sch-muted" x={symbol.x} y={symbol.y + symbol.height / 2 + 24} textAnchor="middle">{symbol.value}</text>}
    {simple && symbol.pins.map(pin => <text key={pin.number} className="sch-pin" data-schema-pin={pin.number} data-schema-terminal={pin.terminal} x={pin.x + (pin.side === 'left' ? 14 : pin.side === 'right' ? -14 : -10)} y={pin.y - 7} textAnchor="middle">{pin.number}{transistor ? ` ${pin.name[0]}` : ''}</text>)}
    {symbol.pins.filter(pin => !pin.connected).map(pin => <circle key={pin.number} cx={pin.x} cy={pin.y} r={3} fill="#fffdf3" stroke="#93423e" strokeWidth={1.3}><title>{symbol.id} pin {pin.number} · {pin.name}: unconnected</title></circle>)}
  </>
}

export function SchematicDrawing({ document, layout: providedLayout, nodeVoltages, voltageTime, selectedId, onSelect }: SchematicDrawingProps) {
  const layout = useMemo(() => providedLayout ?? buildSchematic(document), [document, providedLayout])
  const netById = useMemo(() => new Map(layout.nets.map(net => [net.id, net])), [layout])
  const hasVoltages = nodeVoltages !== undefined
  const sourceNames = new Set(layout.nets.flatMap(net => net.sources))
  const sourceSettings = [
    sourceNames.has('SIGNAL') ? `SIGNAL ${document.stimulus === 'step' ? 'step' : `${document.instruments.waveform} · ${document.instruments.frequency} Hz`} · ${document.instruments.amplitude} V` : '',
    sourceNames.has('CV') ? `CV ${document.instruments.cv} V` : '',
    sourceNames.has('EG') ? `EG ${document.instruments.envelope?.mode ?? 'envelope'}` : '',
  ].filter(Boolean).join('     ')
  return <svg xmlns="http://www.w3.org/2000/svg" className="schematic-sheet" data-testid="schematic-drawing" viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role={onSelect ? 'group' : 'img'} aria-label={`${document.title} electrical schematic`}>
    <title>{document.title} — electrical schematic</title>
    <desc>Electrical connections include the breadboard’s internal strips. Matching net labels are connected. Pin numbers refer to the component pinout.{hasVoltages ? ' Voltage annotations show the selected simulation position.' : ''}</desc>
    <style>{sheetStyles}</style>
    <rect x={0} y={0} width={layout.width} height={layout.height} fill="#fffdf3" />
    <rect x={24} y={24} width={layout.width - 48} height={layout.height - 48} fill="none" stroke="#c7b8a3" strokeWidth={1} />
    <text x={48} y={62} textLength={document.title.length * 13.2 > layout.width - 215 ? layout.width - 215 : undefined} lengthAdjust="spacingAndGlyphs" style={{ fontSize: 22, fontWeight: 500 }}>{document.title}</text>
    <text x={48} y={84} className="sch-muted">Electrical schematic · IEC symbols · {layout.symbols.length} component{layout.symbols.length === 1 ? '' : 's'} · {layout.nets.length} nets</text>
    {sourceSettings && <text x={48} y={104} className="sch-muted">Source settings: {sourceSettings}</text>}
    <text x={layout.width - 48} y={60} textAnchor="end" style={{ fontSize: 16, letterSpacing: 3 }}>LABOR</text>
    {layout.groups.map(group => <g key={group.name} data-schema-group={group.name}>
      <rect x={group.x} y={group.y} width={group.width} height={group.height} fill="none" stroke="#b9ac97" strokeWidth={1.2} strokeDasharray="7 5" rx={5} />
      <rect x={group.x + 15} y={group.y - 9} width={Math.min(group.width - 30, group.name.length * 8 + 20)} height={19} fill="#fffdf3" />
      <text x={group.x + 24} y={group.y + 5} textLength={group.name.length * 7.3 > group.width - 48 ? group.width - 48 : undefined} lengthAdjust="spacingAndGlyphs" style={{ fill: '#76664c', fontWeight: 600 }}>{group.name}</text>
    </g>)}
    <g aria-label="Electrical wires">{layout.wires.map((wire, index) => <polyline key={index} className="sch-wire" data-schema-net={wire.node} points={wire.points.map(point => `${point.x},${point.y}`).join(' ')} />)}</g>
    {layout.junctions.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={3.3} fill="#218450" data-schema-junction={point.node} />)}
    {layout.symbols.map(symbol => {
      const minX = Math.min(symbol.x - symbol.width / 2, ...symbol.pins.map(pin => pin.x)) - 14
      const maxX = Math.max(symbol.x + symbol.width / 2, ...symbol.pins.map(pin => pin.x)) + 14
      const minY = Math.min(symbol.y - symbol.height / 2, ...symbol.pins.map(pin => pin.y)) - 20
      const maxY = Math.max(symbol.y + symbol.height / 2, ...symbol.pins.map(pin => pin.y)) + 16
      return <g key={symbol.id} className="sch-part" data-schema-part={symbol.id} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={`${symbol.id}, ${symbol.label}, ${symbol.value}`} aria-pressed={onSelect ? symbol.id === selectedId : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={onSelect ? event => { event.stopPropagation(); onSelect(symbol.id) } : undefined} onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(symbol.id) } } : undefined}>
        <title>{symbol.id} · {symbol.label} · {symbol.value}{symbol.part?.schemaGroup ? ` · Group: ${symbol.part.schemaGroup}` : ''}</title>
        <rect className="sch-focus" data-schema-selection="true" x={minX} y={minY} width={maxX - minX} height={maxY - minY} rx={5} fill={symbol.id === selectedId ? '#f2c66a22' : 'transparent'} stroke={symbol.id === selectedId ? '#c88e39' : 'transparent'} strokeWidth={1.5} />
        <SymbolDrawing symbol={symbol} />
      </g>
    })}
    {layout.labels.map(label => {
      const net = netById.get(label.node)
      if (!net) return null
      const value = nodeVoltages?.[label.node] ?? nodeVoltages?.[`v(${label.node})`] ?? (hasVoltages && label.node === '0' ? 0 : undefined)
      const labelY = label.y + (label.ground ? 16 : 0)
      const voltageText = formatElectrical(value, 'V')
      const voltageWidth = voltageText.length * 6.7 + 10
      const offsetVoltage = layout.mode === 'wired' && !label.ground
      const voltageAnchor = offsetVoltage ? 'start' : label.anchor
      const voltageLabelX = label.x + (offsetVoltage ? 12 : 0)
      const voltageX = voltageLabelX - (voltageAnchor === 'middle' ? voltageWidth / 2 : voltageAnchor === 'end' ? voltageWidth : 0)
      return <g key={`${label.node}:${label.x}:${label.y}:${label.anchor}`} data-schema-net-label={label.node}>
        {label.ground && <path className="sch-wire" d={`M ${label.x} ${label.y - 16} V ${label.y - 10} M ${label.x - 13} ${label.y - 10} H ${label.x + 13} M ${label.x - 8} ${label.y - 5} H ${label.x + 8} M ${label.x - 3} ${label.y} H ${label.x + 3}`} />}
        <text className="sch-net" x={label.x} y={labelY} textAnchor={label.anchor}>{net.label}{net.probes.length ? ` · ${net.probes.join(' / ')}` : ''}</text>
        {hasVoltages && value !== undefined && Number.isFinite(value) && <g data-schema-voltage={label.node}>
          <rect x={voltageX} y={labelY + 5} width={voltageWidth} height={18} rx={3} fill="#fff0cf" />
          <text className="sch-voltage" x={voltageLabelX + (voltageAnchor === 'start' ? 5 : voltageAnchor === 'end' ? -5 : 0)} y={labelY + 18} textAnchor={voltageAnchor}>{voltageText}</text>
        </g>}
      </g>
    })}
    {!layout.symbols.length && <text className="sch-muted" x={48} y={145} style={{ fontSize: 14 }}>Add components to the breadboard to build your schematic.</text>}
    {layout.warnings.length > 0 && <text x={48} y={layout.height - 104} style={{ fill: '#aa591e', fontSize: 11 }}>{layout.warnings.length} connection warning{layout.warnings.length === 1 ? '' : 's'} · {layout.warnings[0]}<title>{layout.warnings.join('\n')}</title></text>}
    <path d={`M 24 ${layout.height - 82} H ${layout.width - 24}`} stroke="#c7b8a3" strokeWidth={1} />
    <text className="sch-muted" x={48} y={layout.height - 57}>Matching net labels connect · Dots mark junctions · Open circles mark unconnected pins</text>
    <text className="sch-muted" x={48} y={layout.height - 39}>Automatic layout · Breadboard strips and wires resolved electrically</text>
    <text x={layout.width - 48} y={layout.height - 57} textAnchor="end" style={{ fontSize: 11 }}>{hasVoltages ? voltageTime === undefined ? 'VOLTAGES · operating point' : `VOLTAGES · t = ${(voltageTime * 1000).toFixed(3)} ms` : 'SCHEMA'}</text>
    <text className="sch-muted" x={layout.width - 48} y={layout.height - 39} textAnchor="end">Sheet 1 / 1</text>
  </svg>
}
