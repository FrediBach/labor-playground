import { oledPixelPath, type OledFrame } from '@/lib/ssd1306'
import { PARTS, type ComponentKind } from '@/lib/circuit'

interface PartGlyphProps {
  kind: ComponentKind
  span?: number
  selected?: boolean
  value?: number
  position?: number
  ledLevel?: number
  oledFrame?: OledFrame
  /** Lead coordinates relative to the center, before the parent rotates the part. */
  pins?: { x: number; y: number }[]
  pinNames?: string[]
}

/** Original SVG component artwork, oriented from the first lead toward the last lead in its row. */
export function PartGlyph({ kind, span = 72, selected = false, value = 0, position = 0.5, pins, pinNames, ledLevel, oledFrame }: PartGlyphProps) {
  const half = span / 2
  const resistance = value > 0 ? value : 10000
  let multiplier = Math.floor(Math.log10(resistance)) - 1
  let digits = Math.round(resistance / 10 ** multiplier)
  if (digits >= 100) { digits = 10; multiplier++ }
  const bandColors = ['#302d28', '#795037', '#b54934', '#d58236', '#d2b341', '#638553', '#456e99', '#86618e', '#929189', '#ebe5cf']
  const bands = [bandColors[Math.floor(digits / 10)], bandColors[digits % 10], multiplier < 0 ? '#c6aa53' : bandColors[multiplier]]
  if (kind === 'ssd1306') {
    const leads = pins ?? [-36, -12, 12, 36].map(x => ({ x, y: 0 }))
    return <g>
      {selected && <rect x={-78} y={-6} width={156} height={121} rx={7} fill="#d5f278" fillOpacity={0.13} stroke="#a8c55e" strokeWidth={1.5} strokeDasharray="4 3" />}
      <rect x={-73} y={9} width={146} height={101} rx={5} fill="#254e69" stroke="#17364c" strokeWidth={1.5} />
      {[-65, 65].flatMap(x => [17, 102].map(y => <circle key={`${x}:${y}`} cx={x} cy={y} r={3} fill="#e8e7d7" stroke="#ae9c69" strokeWidth={1.5} />))}
      {leads.map((pin, index) => <g key={index} data-pin={index + 1}>
        <title>{index + 1}: {PARTS.ssd1306.pinNames[index]}</title>
        <path d={`M${pin.x} ${pin.y}V17`} stroke="#c8c9bd" strokeWidth={3} />
        <circle cx={pin.x} cy={pin.y} r={3} fill="#353d35" />
        <text x={pin.x} y={25} textAnchor="middle" fill="#d6e3e9" fontFamily="monospace" fontSize={6}>{PARTS.ssd1306.pinNames[index]}</text>
      </g>)}
      <rect x={-68} y={29} width={136} height={70} rx={3} fill="#060f17" stroke="#15232d" />
      <path data-oled-pixels="true" d={oledPixelPath(oledFrame)} transform="translate(-64 32)" fill="#b7efff" opacity={oledFrame ? 0.25 + oledFrame.contrast / 340 : 0} shapeRendering="crispEdges" />
      <text x={0} y={107} textAnchor="middle" fill="#bed8e7" fontFamily="monospace" fontSize={5.5}>SSD1306 · 128×64 · I²C 0x3C</text>
    </g>
  }
  if (PARTS[kind].package) {
    const labels = pinNames ?? PARTS[kind].pinNames
    const rowPins = labels.length / 2
    const rowHalf = (rowPins - 1) * 12
    const leads = pins ?? Array.from({ length: labels.length }, (_, index) => ({
      x: index < rowPins ? -rowHalf + index * 24 : rowHalf - (index - rowPins) * 24,
      y: index < rowPins ? -30 : 30,
    }))
    const bodyHalf = Math.max(...leads.map(pin => Math.abs(pin.x))) + 11
    const inscription = kind === 'pc817' ? '817' : kind === 'cd4013' ? 'CD4013 STYLE' : kind === 'cd4070' ? 'CD4070 STYLE' : kind === 'cd4081' ? 'CD4081 STYLE' : kind === 'cd40106' ? 'CD40106 STYLE' : kind === 'cd4053' ? 'CD4053 STYLE' : kind === 'vactrol' ? 'LED / LDR' : kind === 'lm393' ? 'LM393 STYLE' : kind === 'cd4066' ? 'CD4066 STYLE' : kind === 'timer555' ? '555 TIMER' : kind === 'quadopamp' ? 'TL074 STYLE' : kind === 'lm13700' ? 'LM13700 STYLE' : 'TL072 STYLE'
    return <g>
      {selected && <rect x={-bodyHalf - 7} y={-38} width={bodyHalf * 2 + 14} height={76} rx={10} fill="#d5f278" fillOpacity={0.13} stroke="#a8c55e" strokeWidth={1.5} strokeDasharray="4 3" />}
      {leads.map((pin, index) => <g key={index} data-pin={index + 1}>
        <title>{index + 1}: {labels[index]}</title>
        <path d={`M${pin.x} ${pin.y}V${pin.y < 0 ? -17 : 17}`} stroke="#62685d" strokeWidth={6} strokeLinecap="round" />
        <path d={`M${pin.x - 1} ${pin.y}V${pin.y < 0 ? -17 : 17}`} stroke="#bdc1b5" strokeWidth={2} strokeLinecap="round" />
        <circle cx={pin.x} cy={pin.y} r={3} fill="#353d35" />
      </g>)}
      <rect x={-bodyHalf} y={-20} width={bodyHalf * 2} height={44} rx={4} fill="#28312a" opacity={0.2} transform="translate(1 2)" />
      <rect x={-bodyHalf} y={-22} width={bodyHalf * 2} height={44} rx={4} fill={kind === 'vactrol' ? '#344440' : '#343b37'} stroke="#202a23" strokeWidth={1.4} />
      <path d={`M${-bodyHalf + 4}-18H${bodyHalf - 4}`} stroke="#697068" strokeWidth={1.2} />
      <path d={`M${-bodyHalf}-7 A7 7 0 0 1 ${-bodyHalf} 7`} fill="#17231d" stroke="#657164" strokeWidth={0.8} />
      <circle cx={-bodyHalf + 4} cy={-17} r={2} fill="#c3c9b7" />
      <text x={3} y={3} fill="#d0d2c3" textAnchor="middle" fontFamily="monospace" fontSize={kind === 'vactrol' ? 6 : 8} fontWeight={700} letterSpacing={kind === 'vactrol' ? 0 : 0.4}>{inscription}</text>
      {leads.map((pin, index) => <g key={index} pointerEvents="none">
        <text x={pin.x} y={pin.y < 0 ? -25 : 36} textAnchor="middle" fill="#53604f" fontFamily="monospace" fontSize={6.5}>{index + 1}</text>
        <text x={pin.x} y={pin.y < 0 ? -10 : 15} textAnchor="middle" fill="#bac4af" fontFamily="monospace" fontSize={Math.min(5.4, 35 / labels[index].length)}>{labels[index]}</text>
      </g>)}
    </g>
  }
  if (kind === 'potentiometer') {
    const leads = pins ?? [{ x: -24, y: 0 }, { x: 0, y: 0 }, { x: 24, y: 0 }]
    return <g>
      {selected && <rect x={-half - 9} y={-48} width={span + 18} height={61} rx={10} fill="#d5f278" fillOpacity={0.13} stroke="#a8c55e" strokeWidth={1.5} strokeDasharray="4 3" />}
      {leads.map((pin, index) => <g key={index} data-pin={index + 1}>
        <title>{index + 1}: {pinNames?.[index] ?? ['A', 'Wiper', 'B'][index]}</title>
        <path d={`M${pin.x} ${pin.y}V-14`} stroke="#585f52" strokeWidth={4} strokeLinecap="round" />
        <path d={`M${pin.x - 0.7} ${pin.y}V-14`} stroke="#c8c9bd" strokeWidth={1.5} strokeLinecap="round" />
        <circle cx={pin.x} cy={pin.y} r={3} fill="#353d35" />
      </g>)}
      <rect x={-29} y={-42} width={58} height={32} rx={5} fill="#466783" stroke="#294a68" strokeWidth={1.3} />
      <path d="M-24-37H24" stroke="#7392a9" strokeWidth={1.5} />
      <circle cx={0} cy={-26} r={12} fill="#d6cb9b" stroke="#b1a474" strokeWidth={1.2} />
      <circle cx={0} cy={-26} r={8.5} fill="#bcae80" />
      <g transform={`translate(0 -26) rotate(${-135 + position * 270})`}>
        <path d="M0-9V8" stroke="#74694d" strokeWidth={2.8} strokeLinecap="round" />
        <path d="M0-9V-4" stroke="#eff0d0" strokeWidth={2.2} strokeLinecap="round" />
      </g>
      {leads.map((pin, index) => <text key={index} x={pin.x} y={-3} textAnchor="middle" fill="#576752" fontFamily="monospace" fontSize={6}>{['A', 'W', 'B'][index]}</text>)}
    </g>
  }
  if (kind === 'npn' || kind === 'pnp' || kind === 'njfet' || kind === 'nmos' || kind === 'pmos') {
    const fet = kind === 'njfet' || kind === 'nmos' || kind === 'pmos'
    const letters = fet ? ['D', 'G', 'S'] : ['C', 'B', 'E']
    const leads = pins ?? [{ x: -24, y: 0 }, { x: 0, y: 0 }, { x: 24, y: 0 }]
    const accent = fet ? '#cbbd91' : kind === 'npn' ? '#adc9ad' : '#cbbbd2'
    return <g>
      {selected && <rect x={-half - 9} y={-47} width={span + 18} height={60} rx={10} fill="#d5f278" fillOpacity={0.13} stroke="#a8c55e" strokeWidth={1.5} strokeDasharray="4 3" />}
      {leads.map((pin, index) => <g key={index} data-pin={index + 1}>
        <title>{index + 1}: {pinNames?.[index] ?? PARTS[kind].pinNames[index]}</title>
        <path d={`M${pin.x} ${pin.y}V-6L${(index - 1) * 13}-16`} fill="none" stroke="#596057" strokeWidth={4} strokeLinecap="round" />
        <path d={`M${pin.x - 0.7} ${pin.y}V-6L${(index - 1) * 13 - 0.7}-16`} fill="none" stroke="#c8c9bd" strokeWidth={1.5} strokeLinecap="round" />
        <circle cx={pin.x} cy={pin.y} r={3} fill="#353d35" />
      </g>)}
      <path d="M-23-12V-26C-23-47 23-47 23-26V-12Z" fill="#2d3730" opacity={0.18} transform="translate(1 2)" />
      <path d="M-23-14V-27C-23-48 23-48 23-27V-14Z" fill={kind === 'npn' ? '#3d4540' : '#46434a'} stroke="#242d27" strokeWidth={1.3} />
      <path d="M-18-30C-15-41 15-41 18-30" fill="none" stroke="#737b70" strokeWidth={1.2} />
      <path d="M-20-16H20" stroke="#202924" strokeWidth={2} />
      <text x={0} y={-23} textAnchor="middle" fill={accent} fontFamily="monospace" fontSize={8} fontWeight={700} letterSpacing={1}>{kind === 'njfet' ? 'JFET' : kind.toUpperCase()}</text>
      {leads.map((pin, index) => <text key={index} x={pin.x} y={-5} textAnchor="middle" fill="#465743" stroke="#e8e7d7" strokeWidth={2.2} paintOrder="stroke" fontFamily="monospace" fontSize={7} fontWeight={700}>{letters[index]}</text>)}
    </g>
  }
  return (
    <g>
      {selected && <rect x={-half - 9} y={-24} width={span + 18} height={48} rx={10} fill="#d5f278" fillOpacity={0.13} stroke="#a8c55e" strokeWidth={1.5} strokeDasharray="4 3" />}
      <path d={`M ${-half} 0 H ${half}`} fill="none" stroke="#585a51" strokeWidth={3.5} strokeLinecap="round" />
      <path d={`M ${-half} -0.7 H ${half}`} fill="none" stroke="#c8c9bd" strokeWidth={1.6} strokeLinecap="round" />
      {kind === 'resistor' && <g>
        <rect x={-23} y={-9} width={46} height={20} rx={7} fill="#565a48" opacity={0.16} />
        <rect x={-23} y={-11} width={46} height={20} rx={7} fill="#c5ac7e" stroke="#9c875f" strokeWidth={1} />
        {bands.map((color, index) => <path key={index} d={`M${-16 + index * 10.5}-10V8`} stroke={color} strokeWidth={4} />)}
        <path d="M16-9V7" stroke="#d9bd54" strokeWidth={3} />
        <path d="M-18-7H18" stroke="#fff8d3" strokeOpacity={0.35} strokeWidth={2} />
      </g>}
      {kind === 'inductor' && <g>
        <rect x={-25} y={-10} width={50} height={24} rx={9} fill="#3e4a37" opacity={0.18} />
        <rect x={-25} y={-12} width={50} height={24} rx={9} fill="#6e805e" stroke="#485d40" strokeWidth={1.3} />
        <path d="M-20-8H20" stroke="#9eb087" strokeWidth={1.5} />
        {[-16, -8, 0, 8, 16].map(x => <g key={x}>
          <path d={`M${x - 2}-11C${x + 5}-10 ${x + 5}10 ${x - 2}11`} fill="none" stroke="#6f472b" strokeWidth={4.5} />
          <path d={`M${x - 2}-11C${x + 5}-10 ${x + 5}10 ${x - 2}11`} fill="none" stroke="#c89454" strokeWidth={2.8} />
          <path d={`M${x}-9Q${x + 2}-7 ${x + 2}-3`} fill="none" stroke="#edd0a2" strokeWidth={1.1} strokeLinecap="round" />
        </g>)}
      </g>}
      {kind === 'capacitor' && <g>
        <rect x={-13} y={-18} width={26} height={34} rx={6} fill="#536266" opacity={0.18} transform="translate(1 2)" />
        <rect x={-13} y={-19} width={26} height={34} rx={6} fill="#cd7047" stroke="#aa5634" strokeWidth={1.3} />
        <path d="M-8-14H8" stroke="#f1a580" strokeWidth={2} strokeLinecap="round" />
        <text x={0} y={-2} fill="#442f28" textAnchor="middle" fontFamily="monospace" fontSize={8} fontWeight={700}>C</text>
        <text x={0} y={8} fill="#653d2b" textAnchor="middle" fontFamily="monospace" fontSize={6.5}>FILM</text>
      </g>}
      {kind === 'electrolytic' && <g>
        <ellipse cx={0} cy={17} rx={14} ry={5} fill="#2b4139" opacity={0.16} />
        <rect x={-14} y={-18} width={28} height={33} rx={6} fill="#496d70" stroke="#294e52" strokeWidth={1.3} />
        <path d="M6-17Q14-17 14-11V9Q14 15 6 15Z" fill="#cfddd1" />
        <ellipse cx={0} cy={-17} rx={13.3} ry={5} fill="#b7c3b8" stroke="#6c8780" strokeWidth={1} />
        <path d="M-6-18L5-15M-4-14L4-19" stroke="#768d83" strokeWidth={0.8} />
        <path d="M7-4H12M7 5H12" stroke="#476762" strokeWidth={1.5} />
        <text x={-6} y={6} fill="#d7e5db" textAnchor="middle" fontFamily="monospace" fontSize={10} fontWeight={700}>+</text>
      </g>}
      {kind === 'diode' && <g>
        <rect x={-17} y={-8} width={34} height={16} rx={4} fill="#393e3b" stroke="#242a26" />
        <path d="M10-7V7" stroke="#c2c5bc" strokeWidth={5} />
        <path d="M-12-5H5" stroke="#7b837a" strokeWidth={1.5} />
      </g>}
      {kind === 'schottky' && <g>
        <rect x={-20} y={-9} width={40} height={18} rx={4} fill="#344342" stroke="#223331" strokeWidth={1.2} />
        <path d="M12-8V8" stroke="#c9d8cd" strokeWidth={5} />
        <path d="M-16-6H6" stroke="#78928b" strokeWidth={1.4} />
        <text x={-5} y={4} fill="#bed1c5" textAnchor="middle" fontFamily="monospace" fontSize={8} fontWeight={700}>S</text>
      </g>}
      {kind === 'zener' && <g>
        <rect x={-18} y={-8} width={36} height={18} rx={5} fill="#774b33" opacity={0.17} />
        <rect x={-18} y={-10} width={36} height={18} rx={5} fill="#ca9266" stroke="#98613e" strokeWidth={1.2} />
        <path d="M-17 0H-6M5 0H17" stroke="#e4cab2" strokeWidth={5} />
        <rect x={-6} y={-4} width={11} height={7} rx={1} fill="#8f5e3d" />
        <path d="M10-9V7" stroke="#483d36" strokeWidth={4} />
        <path d="M-13-6H5" stroke="#ffe2b7" strokeOpacity={0.7} strokeWidth={1.8} strokeLinecap="round" />
        <text x={-1} y={3} fill="#f6deba" textAnchor="middle" fontFamily="monospace" fontSize={6.5} fontWeight={700}>Z</text>
      </g>}
      {kind === 'led' && <g>
        {ledLevel !== undefined && ledLevel > 0.01 && <circle r={22} fill="#ff6244" opacity={ledLevel * 0.4} />}
        <circle r={14} cy={1.5} fill="#4b3931" opacity={0.16} />
        <circle r={13} fill={ledLevel === undefined ? '#ce594a' : '#743b35'} stroke="#974537" strokeWidth={1.4} />
        <circle r={8} fill={ledLevel === undefined ? '#ed8068' : '#994c3f'} />
        {ledLevel !== undefined && <circle r={11} fill="#ffae7d" opacity={ledLevel} />}
        <path d="M-6-5Q-2-9 3-6" stroke="#ffcab6" strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <path d="M9-8V8" stroke="#aa4038" strokeWidth={2} />
      </g>}
      {kind === 'switch' && <g>
        <rect x={-18} y={-14} width={36} height={28} rx={4} fill="#3f4543" stroke="#272d2a" />
        <rect x={-13} y={-8} width={26} height={16} rx={3} fill="#171d1a" />
        <rect x={value > 0 ? 0 : -12} y={-7} width={12} height={14} rx={2} fill="#a9b0a7" stroke="#d2d7ca" />
        <path d={`M${value > 0 ? 4 : -8} -4V4 M${value > 0 ? 8 : -4} -4V4`} stroke="#6d746a" />
      </g>}
      <circle cx={-half} r={3} fill="#353d35" />
      <circle cx={half} r={3} fill="#353d35" />
    </g>
  )
}
