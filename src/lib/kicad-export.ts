import { envelopeSettings, type CircuitDocument } from './circuit.ts'
import { buildSchematic, type SchematicPoint } from './schematic.ts'
import { formatElectrical } from './format-electrical.ts'
import { KICAD_SCALE, legacySymbolDefinition } from './kicad-legacy-symbols.ts'
import type { ExportFile } from './zip-export.ts'

export interface KicadExportOptions { nodeVoltages?: Record<string, number>; voltageTime?: number }
const coordinate = (value: number) => Math.round(value * KICAD_SCALE)
const point = (position: SchematicPoint) => `${coordinate(position.x)} ${coordinate(position.y)}`
// Legacy fields are quoted, while notes occupy an unquoted physical line.
const singleLine = (value: string) => value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
const quoted = (value: string) => `"${singleLine(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const noteText = (value: string) => singleLine(value).replace(/\\n/g, ' / ')

/** Editable legacy KiCad schematic plus local symbols; no installed library dependency. */
export function buildKicadExport(document: CircuitDocument, options: KicadExportOptions = {}): { basename: string; files: ExportFile[] } {
  const layout = buildSchematic(document)
  const basename = (document.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'circuit') + '-schema'
  const lines = [
    'EESchema Schematic File Version 4', `LIBS:${basename}-cache`, 'EELAYER 29 0', 'EELAYER END',
    `$Descr User ${coordinate(layout.width)} ${coordinate(layout.height)}`, 'encoding utf-8', 'Sheet 1 1',
    `Title ${quoted(document.title)}`, 'Date ""', 'Rev "1"', 'Comp "Pico Labor"',
    'Comment1 "Electrical schematic; matching net labels are connected"',
    `Comment2 ${quoted(options.nodeVoltages && Number.isFinite(options.voltageTime) ? `Voltage snapshot at ${(options.voltageTime! * 1000).toFixed(3)} ms, relative to GND` : '')}`,
    'Comment3 "Generated symbols included in companion cache library"', 'Comment4 ""', '$EndDescr',
  ]
  const library = ['EESchema-LIBRARY Version 2.4', '#encoding utf-8']
  const note = (text: string, position: SchematicPoint, size = 70) => lines.push(`Text Notes ${point(position)} 0 ${size} ~ 0`, noteText(text))
  const segment = (a: SchematicPoint, b: SchematicPoint, electrical = true) => {
    if (point(a) !== point(b)) lines.push(`Wire ${electrical ? 'Wire' : 'Notes'} Line`, `\t${point(a)} ${point(b)}`)
  }
  const sourceNames: Record<string, string> = { GND: 'GND', SIGNAL: 'SIGNAL', CV: 'CV', EG: 'EG', '+12V': '+12V', '−12V': '-12V', '+3V3': '+3V3', 'PICO GND': 'PICO_GND' }
  const netNames = new Map(layout.nets.map(net => [net.id, sourceNames[net.sources[0]] ?? `NET_${net.id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`]))
  const label = (node: string, position: SchematicPoint, orientation = 0) => {
    lines.push(`Text Label ${point(position)} ${orientation} 60 ~ 0`, netNames.get(node)!)
  }
  note(document.title, { x: 48, y: 60 }, 120)
  note('Pico Labor electrical schematic · matching net labels are connected', { x: 48, y: 83 })
  const activeSources = new Set(layout.nets.flatMap(net => net.sources))
  const settings = [
    activeSources.has('SIGNAL') ? `SIGNAL: ${document.stimulus === 'step' ? 'step' : `${document.instruments.waveform}, ${document.instruments.frequency} Hz`}, ${document.instruments.amplitude} V` : '',
    activeSources.has('CV') ? `CV: ${document.instruments.cv} V` : '',
    activeSources.has('EG') ? `EG: ${envelopeSettings(document).mode}` : '',
  ].filter(Boolean).join('   |   ')
  if (settings) note(settings, { x: 48, y: 104 }, 60)

  layout.symbols.forEach((symbol, index) => {
    const alias = `PL_${index + 1}`, name = `PicoLabor_${alias}`
    library.push(legacySymbolDefinition(symbol, name, alias))
    const vertical = Math.abs(symbol.rotation) === 90
    const simple = symbol.pins.length <= 3 && symbol.kind !== 'pico' && symbol.kind !== 'lm4040'
    const labelX = vertical ? symbol.x + 30 : symbol.x
    const labelY = vertical ? symbol.y - 8 : simple ? symbol.y - 50 : symbol.y - symbol.height / 2 - 35
    lines.push('$Comp', `L PicoLabor:${alias} ${symbol.id}`, `U 1 1 ${(0x60000000 + index).toString(16).toUpperCase()}`,
      `P ${point(symbol)}`,
      `F 0 ${quoted(symbol.id)} H ${coordinate(labelX)} ${coordinate(labelY)} 75 0000 ${vertical ? 'L' : 'C'} CNN`,
      `F 1 ${quoted(simple ? symbol.value : symbol.label)} H ${coordinate(labelX)} ${coordinate(labelY + 20)} 60 0000 ${vertical ? 'L' : 'C'} CNN`,
      `F 2 "" H ${point(symbol)} 50 0001 C CNN`, `F 3 "" H ${point(symbol)} 50 0001 C CNN`,
      `F 4 ${quoted(symbol.label)} H ${point(symbol)} 50 0001 C CNN "Labor component"`,
      `F 5 ${quoted(symbol.part?.schemaGroup ?? '')} H ${point(symbol)} 50 0001 C CNN "Schema group"`,
      `\t1 ${point(symbol)}`, '\t1 0 0 -1', '$EndComp')
    if (!simple) note(symbol.value, { x: symbol.x - 70, y: symbol.y + symbol.height / 2 + 24 }, 60)
    if (layout.mode === 'labeled') for (const pin of symbol.pins) {
      if (!pin.connected) { lines.push(`NoConn ~ ${point(pin)}`); continue }
      const end = { x: pin.x + (pin.side === 'left' ? -20 : pin.side === 'right' ? 20 : 0), y: pin.y + (pin.side === 'top' ? -20 : pin.side === 'bottom' ? 20 : 0) }
      segment(pin, end)
      label(pin.node, end, pin.side === 'left' ? 2 : pin.side === 'top' ? 1 : pin.side === 'bottom' ? 3 : 0)
    }
  })
  for (const wire of layout.wires) wire.points.slice(1).forEach((end, index) => segment(wire.points[index], end))
  for (const junction of layout.junctions) lines.push(`Connection ~ ${point(junction)}`)
  for (const annotation of layout.labels) {
    const net = layout.nets.find(net => net.id === annotation.node)!
    if (layout.mode === 'wired') label(net.id, { x: annotation.x, y: annotation.y + (annotation.ground ? -16 : 6) })
    else if (!net.pins.length) label(net.id, annotation)
    const extras = [...net.sources.filter(name => sourceNames[name] !== netNames.get(net.id)), ...net.probes]
    if (extras.length) note(extras.join(' / '), { x: annotation.x, y: annotation.y - 12 }, 60)
    const voltage = options.nodeVoltages?.[net.id]
    if (voltage !== undefined && Number.isFinite(voltage)) note(`${formatElectrical(voltage, 'V')} @ ${(1000 * (options.voltageTime ?? 0)).toFixed(3)} ms`, { x: annotation.x + 12, y: annotation.y + 25 }, 60)
  }
  for (const group of layout.groups) {
    const corners = [group, { x: group.x + group.width, y: group.y }, { x: group.x + group.width, y: group.y + group.height }, { x: group.x, y: group.y + group.height }]
    corners.forEach((corner, index) => segment(corner, corners[(index + 1) % corners.length], false))
    note(group.name, { x: group.x + 24, y: group.y - 5 }, 80)
  }
  if (!layout.symbols.length) note('No components placed', { x: 48, y: 145 })
  if (layout.warnings.length) note(layout.warnings.join(' | '), { x: 48, y: layout.height - 104 }, 60)
  note('Virtual sources are named nets; exported voltages are snapshot notes.', { x: 48, y: layout.height - 58 }, 60)
  lines.push('$EndSCHEMATC', '')
  library.push('#End Library', '')
  return { basename, files: [
    { name: `${basename}.sch`, content: lines.join('\n') },
    { name: `${basename}-cache.lib`, content: library.join('\n') },
    { name: 'sym-lib-table', content: `(sym_lib_table\n  (lib (name "PicoLabor")(type "Legacy")(uri "\${KIPRJMOD}/${basename}-cache.lib")(options "")(descr "Pico Labor exported symbols"))\n)\n` },
    { name: 'README.txt', content: `Pico Labor - editable KiCad schematic\n\nExtract every file into the same folder, then open ${basename}.sch in KiCad.\nKeep ${basename}-cache.lib beside the schematic: legacy .sch files do not embed symbols.\nThe local sym-lib-table resolves the included PicoLabor library without installing symbols.\nModern KiCad may offer to convert this legacy schematic to .kicad_sch when saving.\n\nComponents, physical pin numbers, wires and named nets preserve the circuit topology.\nGroup boxes and any enabled voltage readings are editable graphical annotations.\nVoltage notes are snapshots of the selected simulation time, not live measurements.\nVirtual instruments are represented by named nets and source-setting notes.\nPico firmware, behavioral simulation models, footprints, and PCB layout are not included.\n` },
  ] }
}
