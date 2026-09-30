import { useRef, useState } from 'react'
import { Cable, Check, ChevronDown, CircuitBoard, Crosshair, PanelLeftClose, Plus, Search, X } from 'lucide-react'
import { PARTS, formatValue, type ComponentKind } from '@/lib/circuit'
import { PartIcon } from './PartIcon'
import './PartsLibrary.css'

type Tool = 'select' | 'wire' | 'probe1' | 'probe2' | ComponentKind

const categories: { id: string; label: string; kinds: ComponentKind[] }[] = [
  { id: 'passive', label: 'Passive', kinds: ['resistor', 'capacitor', 'electrolytic', 'inductor'] },
  { id: 'diodes', label: 'Diodes & LEDs', kinds: ['diode', 'schottky', 'zener', 'led'] },
  { id: 'transistors', label: 'Transistors', kinds: ['npn', 'pnp'] },
  { id: 'controls', label: 'Controls & ICs', kinds: ['potentiometer', 'switch', 'opamp', 'quadopamp', 'timer555'] },
]
const keywords: Partial<Record<ComponentKind, string>> = {
  resistor: 'resistance ohm', capacitor: 'ceramic non-polarized capacitance farad',
  electrolytic: 'polarized capacitance farad', inductor: 'coil inductance henry',
  diode: 'silicon rectifier', schottky: 'rectifier low forward voltage', zener: 'voltage breakdown clamp',
  led: 'light emitting red', npn: 'bjt bipolar collector base emitter', pnp: 'bjt bipolar collector base emitter',
  potentiometer: 'pot variable resistance wiper', switch: 'spst on off', opamp: 'op amp operational amplifier dual dip8 tl072',
  quadopamp: 'op amp operational amplifier quad dip14 tl074 buffer mixer filter', timer555: '555 ne555 timer clock oscillator pulse astable monostable dip8',
}

export function PartsLibrary({ tool, onToolChange, onPlace, hasPico, onAddPico, wireColor, wireColors, onWireColorChange, partCount, onClear, onCollapse }: {
  tool: Tool
  onToolChange: (tool: Tool) => void
  onPlace: (kind: ComponentKind) => void
  hasPico: boolean
  onAddPico: () => void
  wireColor: string
  wireColors: string[]
  onWireColorChange: (color: string) => void
  partCount: number
  onClear: () => void
  onCollapse: () => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const catalog = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = categories.filter(group => category === 'all' || category === group.id).map(group => ({
    ...group,
    kinds: group.kinds.filter(kind => {
      const text = `${PARTS[kind].label} ${group.label} ${keywords[kind] ?? ''}`.toLowerCase()
      return terms.every(term => text.includes(term))
    }),
  })).filter(group => group.kinds.length > 0)
  const count = groups.reduce((sum, group) => sum + group.kinds.length, 0)
  const resetScroll = () => catalog.current?.scrollTo({ top: 0, left: 0 })
  const clearSearch = () => { setSearch(''); resetScroll(); searchInput.current?.focus() }

  return <aside className="parts-tray parts-library" aria-label="Parts library">
    <div className="panel-heading"><h2>Parts library</h2><button className="icon-button" aria-label="Collapse parts library" onClick={onCollapse}><PanelLeftClose size={16} /></button></div>
    <div className="connection-tools" role="group" aria-label="Boards and connections">
      <button className="connection-item add-pico" disabled={hasPico} onClick={onAddPico}><CircuitBoard size={18} /><span>Raspberry Pi Pico{hasPico && <small>Added to workbench</small>}</span>{hasPico ? <Check size={15} /> : <Plus size={15} />}</button>
      <button className={`connection-item ${tool === 'wire' ? 'active' : ''}`} onClick={() => onToolChange(tool === 'wire' ? 'select' : 'wire')} aria-pressed={tool === 'wire'}><Cable size={18} /><span>Jumper wire</span><kbd>W</kbd></button>
      <div className="wire-palette" role="group" aria-label="Wire colors">{wireColors.map(color => <button key={color} aria-label={`Wire color ${color}`} aria-pressed={wireColor === color} style={{ backgroundColor: color }} onClick={() => onWireColorChange(color)}>{wireColor === color && <Check size={12} />}</button>)}</div>
      <div className="library-probes">{(['probe1', 'probe2'] as const).map((probe, index) => <button key={probe} className={`connection-item ${tool === probe ? 'active' : ''}`} aria-label={`Scope probe CH${index + 1}`} title={`Attach scope probe CH${index + 1}`} aria-pressed={tool === probe} onClick={() => onToolChange(probe)}><Crosshair size={17} className={`ch${index + 1}-text`} /><span className={`ch${index + 1}-text`}>CH{index + 1}</span><small>Probe</small></button>)}</div>
    </div>
    <div className="library-filters">
      <div className="parts-search"><Search size={15} /><input ref={searchInput} placeholder="Find a component…" aria-label="Find a component" value={search} onChange={e => { setSearch(e.target.value); resetScroll() }} />{search && <button type="button" className="icon-button" aria-label="Clear component search" onClick={clearSearch}><X size={14} /></button>}</div>
      <label className="library-category"><select aria-label="Component category" value={category} onChange={e => { setCategory(e.target.value); resetScroll() }}><option value="all">All components</option>{categories.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select><ChevronDown size={14} /><span aria-live="polite">{count} parts</span></label>
    </div>
    <div className="parts-catalog" ref={catalog} tabIndex={0} role="region" aria-label="Components" key={category}>
      {groups.map(group => <section key={group.id} className="parts-category" aria-labelledby={`parts-${group.id}`}><h3 id={`parts-${group.id}`} className="tray-category">{group.label}<span>{group.kinds.length}</span></h3><div className="parts-list">{group.kinds.map(kind => <button key={kind} className={`part-item ${tool === kind ? 'active' : ''}`} aria-label={PARTS[kind].label} title={`${PARTS[kind].description} Click or drag to place.`} aria-pressed={tool === kind} draggable onDragStart={e => { e.dataTransfer.setData('application/labor-part', kind); onPlace(kind) }} onClick={() => { if (tool === kind) onToolChange('select'); else onPlace(kind) }}><span className="part-thumbnail"><PartIcon kind={kind} /></span><span><strong>{PARTS[kind].label}</strong><small>{formatValue(PARTS[kind].defaultValue, kind)}</small></span><Plus size={13} /></button>)}</div></section>)}
      {count === 0 && <div className="parts-empty" role="status"><p>No components match “{search}”{category !== 'all' ? ` in ${categories.find(group => group.id === category)?.label}` : ''}.</p><button className="subtle-button" onClick={clearSearch}>Clear search</button>{category !== 'all' && <button className="subtle-button" onClick={() => { setCategory('all'); resetScroll() }}>Show all categories</button>}</div>}
    </div>
    <div className="tray-bottom"><span>{partCount} / 30 parts placed</span><button className="subtle-button" onClick={onClear}>Clear board</button></div>
  </aside>
}
