import type { ComponentKind } from '@/lib/circuit'

interface PartGlyphProps {
  kind: ComponentKind
  span?: number
  selected?: boolean
  value?: number
}

/** Original SVG component artwork, centered between two horizontal leads. */
export function PartGlyph({ kind, span = 72, selected = false, value = 0 }: PartGlyphProps) {
  const half = span / 2
  const resistance = value > 0 ? value : 10000
  let multiplier = Math.floor(Math.log10(resistance)) - 1
  let digits = Math.round(resistance / 10 ** multiplier)
  if (digits >= 100) { digits = 10; multiplier++ }
  const bandColors = ['#302d28', '#795037', '#b54934', '#d58236', '#d2b341', '#638553', '#456e99', '#86618e', '#929189', '#ebe5cf']
  const bands = [bandColors[Math.floor(digits / 10)], bandColors[digits % 10], multiplier < 0 ? '#c6aa53' : bandColors[multiplier]]
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
      {kind === 'capacitor' && <g>
        <rect x={-13} y={-18} width={26} height={34} rx={6} fill="#536266" opacity={0.18} transform="translate(1 2)" />
        <rect x={-13} y={-19} width={26} height={34} rx={6} fill="#cd7047" stroke="#aa5634" strokeWidth={1.3} />
        <path d="M-8-14H8" stroke="#f1a580" strokeWidth={2} strokeLinecap="round" />
        <text x={0} y={-2} fill="#442f28" textAnchor="middle" fontFamily="monospace" fontSize={8} fontWeight={700}>C</text>
        <text x={0} y={8} fill="#653d2b" textAnchor="middle" fontFamily="monospace" fontSize={6.5}>FILM</text>
      </g>}
      {kind === 'diode' && <g>
        <rect x={-17} y={-8} width={34} height={16} rx={4} fill="#393e3b" stroke="#242a26" />
        <path d="M10-7V7" stroke="#c2c5bc" strokeWidth={5} />
        <path d="M-12-5H5" stroke="#7b837a" strokeWidth={1.5} />
      </g>}
      {kind === 'led' && <g>
        <circle r={14} cy={1.5} fill="#4b3931" opacity={0.16} />
        <circle r={13} fill="#ce594a" stroke="#974537" strokeWidth={1.4} />
        <circle r={8} fill="#ed8068" />
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
