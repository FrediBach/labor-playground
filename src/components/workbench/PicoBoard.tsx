import { useId } from 'react'
import { PICO_DOCK_CENTER_X, PICO_PINS } from '@/lib/pico/profile'
import { RecordedPicoLed } from './Recording'

// Decorative board artwork. Terminal hit areas and wires stay in Breadboard so
// their positions, keyboard navigation and stacking remain independent of it.
export function PicoBoard() {
  const id = useId()
  const pcb = `${id}-pcb`, gold = `${id}-gold`, metal = `${id}-metal`, chip = `${id}-chip`
  return <g aria-label="Original Raspberry Pi Pico dock" pointerEvents="none" transform={`translate(${PICO_DOCK_CENTER_X} 0)`}>
    <defs>
      <linearGradient id={pcb} x2="1" y2="1"><stop stopColor="#25855b" /><stop offset=".5" stopColor="#19764f" /><stop offset="1" stopColor="#126343" /></linearGradient>
      <linearGradient id={gold} x2=".8" y2="1"><stop stopColor="#f6e6aa" /><stop offset=".4" stopColor="#d7bf74" /><stop offset=".75" stopColor="#b5984e" /><stop offset="1" stopColor="#e5cd87" /></linearGradient>
      <linearGradient id={metal} x2=".3" y2="1"><stop stopColor="#f0f0e5" /><stop offset=".2" stopColor="#b1bcb7" /><stop offset=".52" stopColor="#d9ded5" /><stop offset="1" stopColor="#7c8c86" /></linearGradient>
      <linearGradient id={chip} x2="1" y2="1"><stop stopColor="#343b37" /><stop offset="1" stopColor="#171e1b" /></linearGradient>
    </defs>

    <rect x={-83} y={56} width={166} height={462} rx={5} fill="#080e0a" opacity={.55} />
    <rect x={-83} y={52} width={166} height={462} rx={4} fill={`url(#${pcb})`} stroke="#83ab79" strokeWidth={1.5} />
    <rect x={-80.5} y={54.5} width={161} height={457} rx={2} fill="none" stroke="#b7c789" strokeOpacity={.25} strokeWidth={.7} />

    {/* Traces sit below the silkscreen and components, as on the real PCB. */}
    <g fill="none" stroke="#76b789" strokeWidth={.65} opacity={.32}>
      {[-1, 1].map(side => <g key={side} transform={`scale(${side} 1)`}>
        {[0, 1, 2, 3, 4, 5].map(index => <path key={index} d={`M${4 + index * 3} 246V${233 - index * 5}L${31 + index * 3} ${206 - index * 5}V${97 + index * 22}H62`} />)}
        {[0, 1, 2, 3, 4, 5].map(index => <path key={index} d={`M${4 + index * 3} 290V${302 + index * 5}L${30 + index * 3} ${328 + index * 5}V${383 + index * 22}H62`} />)}
        <path d="M24 258H34L45 247H62M24 265H40L48 273H62M24 278H35L52 295H62M6 86V114L22 130V181L4 199V229" />
      </g>)}
    </g>
    <g fill="#a7c88a" stroke="#0f593d" strokeWidth={1} opacity={.55}>
      {[[-28, 110], [27, 168], [-25, 183], [26, 225], [-32, 308], [27, 345], [-23, 437], [25, 459]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} />)}
    </g>

    {/* Plated mounting holes fit in the end margins, clear of pin labels. */}
    {[-46, 46].flatMap(x => [63, 505].map(y => <g key={`${x}-${y}`}>
      <circle cx={x} cy={y} r={8} fill={`url(#${gold})`} stroke="#d9dbaa" strokeWidth={.7} />
      <circle cx={x} cy={y} r={5.8} fill="#17251f" stroke="#9bb7a0" strokeWidth={1.1} />
      <path d={`M${x - 5} ${y + 3}A6 6 0 0 0 ${x + 5} ${y + 3}`} fill="none" stroke="#080f0b" strokeWidth={1.3} />
    </g>))}

    {/* Micro-USB: solder feet, rolled shell, latch holes and inset connector. */}
    <g>
      {[-22, 18].flatMap(x => [57, 75].map(y => <rect key={`${x}-${y}`} x={x} y={y} width={5} height={8} rx={1} fill={`url(#${metal})`} />))}
      {[0, 1, 2, 3, 4].map(index => <rect key={index} x={-8 + index * 3.6} y={81} width={2} height={6} fill={`url(#${metal})`} />)}
      <rect x={-20} y={44} width={40} height={40} rx={2.5} fill="#10281d" opacity={.5} transform="translate(1 2)" />
      <path d="M-20 45Q-20 42-17 42H17Q20 42 20 45V79L16 84H-16L-20 79Z" fill={`url(#${metal})`} stroke="#768f80" strokeWidth={.9} />
      <path d="M-17 44H17L18 50H-18Z" fill="#26332e" stroke="#f0eee0" strokeWidth={.8} />
      <path d="M-13 47H13" stroke="#a9b0a4" strokeWidth={1.5} />
      <path d="M-18 53V77L-14 81H14L18 77V53M-18 72H-12M12 72H18" fill="none" stroke="#eef0e4" strokeWidth={.9} opacity={.8} />
      {[-12, 8].map(x => <rect key={x} x={x} y={59} width={4} height={6} rx={1} fill="#46554c" stroke="#8b9890" strokeWidth={.6} />)}
      <path d="M-10 78H-5M5 78H10" stroke="#36483d" strokeWidth={2.4} strokeLinecap="round" />
      <text x={0} y={91} textAnchor="middle" fill="#deead8" fontSize={4.5} letterSpacing={.7}>USB</text>
    </g>

    <RecordedPicoLed x={-21} y={104} />
    <g fill={`url(#${metal})`}>
      <rect x={-14} y={131} width={22} height={5} rx={1} />
      <rect x={-14} y={157} width={22} height={5} rx={1} />
    </g>
    <rect x={-13} y={135} width={20} height={23} rx={2} fill="#a2ada2" stroke="#123d2a" />
    <rect x={-10} y={135} width={14} height={22} rx={6} fill="#eeeede" stroke="#c4cdbb" strokeWidth={.8} />
    <text transform="translate(-17 161) rotate(-90)" fill="#e5eedc" fontSize={5} letterSpacing={.5}>BOOTSEL</text>

    {/* Power supply, flash and passives. */}
    <g>
      {[{ x: 12, y: 114, w: 9, h: 14 }, { x: 13, y: 167, w: 10, h: 13 }, { x: -14, y: 198, w: 15, h: 20 }].map(({ x, y, w, h }) => <g key={y}>
        {[2, 6, 10].map(offset => <path key={offset} d={`M${x - 3} ${y + offset}H${x + w + 3}`} stroke="#b0bcb0" strokeWidth={1.8} />)}
        <rect x={x} y={y} width={w} height={h} rx={.8} fill={`url(#${chip})`} stroke="#112e20" strokeWidth={.8} />
        <circle cx={x + 2.5} cy={y + 3} r={.8} fill="#819381" />
      </g>)}
      {[{ x: 11, y: 149, vertical: false }, { x: 11, y: 191, vertical: false }, { x: -12, y: 178, vertical: false }, { x: 13, y: 213, vertical: true }, { x: -17, y: 229, vertical: false }, { x: 11, y: 308, vertical: false }, { x: -16, y: 343, vertical: true }, { x: 15, y: 344, vertical: false }].map(({ x, y, vertical }) => <g key={y} transform={`translate(${x} ${y}) rotate(${vertical ? 90 : 0})`}>
        <rect x={-1} y={-1} width={13} height={7} rx={.8} fill="#124c34" />
        <rect width={11} height={5} rx={.6} fill={`url(#${metal})`} />
        <rect x={2.5} width={6} height={5} rx={.4} fill="#b7aa7e" />
        <path d="M3 1H8" stroke="#e1d3a8" strokeWidth={.7} />
      </g>)}
    </g>

    {/* The RP2040 is a square QFN package, aligned with the board. */}
    <g transform="translate(0 268)">
      {[0, 90, 180, 270].map(angle => <g key={angle} transform={`rotate(${angle})`}>
        {Array.from({ length: 14 }, (_, index) => <path key={index} d={`M${-19.5 + index * 3} -26V-22`} stroke="#b1b8a5" strokeWidth={1.4} />)}
      </g>)}
      <rect x={-24} y={-22} width={49} height={48} rx={1.4} fill="#0c3825" opacity={.7} />
      <rect x={-23} y={-23} width={46} height={46} rx={1.3} fill={`url(#${chip})`} stroke="#515b4d" strokeWidth={.7} />
      <path d="M-21 20V-21H20" fill="none" stroke="#78816b" strokeWidth={.5} opacity={.6} />
      <circle cx={-18} cy={-17} r={1.1} fill="#9ba38a" />
      <text x={0} y={-10} textAnchor="middle" fill="#c3c5ae" fontSize={4.2}>Raspberry Pi</text>
      <RaspberryMark x={0} y={-1} scale={.37} color="#b7bca3" />
      <text x={0} y={16} textAnchor="middle" fill="#c3c5ae" fontSize={5.8} letterSpacing={.6}>RP2040</text>
    </g>

    <g transform="translate(0 329)">
      <rect x={-10} y={-8} width={20} height={16} rx={1} fill="#b8aa73" stroke="#e1d6a1" strokeWidth={.6} />
      <rect x={-8} y={-6} width={16} height={12} rx={2} fill={`url(#${metal})`} stroke="#698575" strokeWidth={.7} />
      <text x={0} y={1.5} textAnchor="middle" fill="#6b796e" fontSize={4}>12.000</text>
    </g>

    <g fill="#e2ebd9">
      <text transform="translate(-14 459) rotate(-90)" fontSize={7.2} letterSpacing={.6}>Raspberry Pi Pico</text>
      <RaspberryMark x={10} y={390} scale={.95} color="#e2ebd9" />
      <text transform="translate(18 465) rotate(-90)" fontSize={4.5} letterSpacing={.5}>© 2020</text>
      <text x={0} y={479} textAnchor="middle" fontSize={4.5} letterSpacing={1}>DEBUG</text>
    </g>
    {[-15, 0, 15].map((x, index) => <g key={x}>
      <rect x={x - 3.5} y={489} width={7} height={24} rx={3} fill={`url(#${gold})`} stroke="#ecdda4" strokeWidth={.6} />
      <circle cx={x} cy={494} r={2} fill="#1a3d2b" />
      <path d={`M${x - 1.5} 513V504Q${x} 501 ${x + 1.5} 504V513`} fill="#183e2b" />
      <text x={x} y={486} textAnchor="middle" fill="#e0e8d3" fontSize={3.5}>{['SWCLK', 'GND', 'SWDIO'][index]}</text>
    </g>)}

    {PICO_PINS.map(pin => {
      const left = pin.number <= 20, x = pin.x - PICO_DOCK_CENTER_X
      return <g key={pin.id}>
        <path d={left ? `M-83 ${pin.y - 6}H-70A6 6 0 0 1-70 ${pin.y + 6}H-83Z` : `M83 ${pin.y - 6}H70A6 6 0 0 0 70 ${pin.y + 6}H83Z`} fill={`url(#${gold})`} stroke="#e6d393" strokeWidth={.6} />
        <circle cx={left ? -83 : 83} cy={pin.y} r={3.2} fill="#1b2a20" stroke="#a78e51" strokeWidth={1} />
        <circle cx={x} cy={pin.y} r={3.1} fill="#162f23" stroke="#fae9ad" strokeWidth={.7} />
        {pin.number === 1 && <rect x={x - 4.4} y={pin.y - 4.4} width={8.8} height={8.8} rx={.5} fill="none" stroke="#fff0b4" strokeWidth={.7} />}
        <g opacity={pin.supported ? 1 : .52}>
          <text x={left ? -60 : 60} y={pin.y + 2.5} textAnchor={left ? 'start' : 'end'} fontSize={6.5} fill="#c4d4b1">{pin.number}</text>
          <text x={left ? -49 : 48} y={pin.y + 2.5} textAnchor={left ? 'start' : 'end'} fontSize={7.3} fill="#f1f4e6">{pin.label}</text>
        </g>
        <title>{pin.number}: {pin.label}{pin.supported ? '' : ' · unsupported connection'}</title>
      </g>
    })}
    <text x={0} y={535} fill="#b9cbbf" textAnchor="middle" fontSize={8} letterSpacing={.25}>USB POWER · 3.3 V · GPIO / I²C</text>
  </g>
}

function RaspberryMark({ x, y, scale, color }: { x: number; y: number; scale: number; color: string }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} fill="none" stroke={color} strokeWidth={1.8}>
    <path d="M0-13C-3-23-13-23-14-23C-14-16-7-12 0-13ZM0-13C3-23 13-23 14-23C14-16 7-12 0-13Z" />
    <ellipse cx={-6} cy={-7} rx={5.4} ry={4.4} transform="rotate(-28 -6 -7)" />
    <ellipse cx={6} cy={-7} rx={5.4} ry={4.4} transform="rotate(28 6 -7)" />
    <ellipse cx={-11} cy={2} rx={4} ry={5.7} transform="rotate(12 -11 2)" />
    <ellipse cx={11} cy={2} rx={4} ry={5.7} transform="rotate(-12 11 2)" />
    <ellipse cy={2} rx={5.5} ry={6} />
    <ellipse cx={-6} cy={12} rx={4.5} ry={5.7} transform="rotate(-24 -6 12)" />
    <ellipse cx={6} cy={12} rx={4.5} ry={5.7} transform="rotate(24 6 12)" />
    <ellipse cy={19} rx={4.4} ry={3.2} />
  </g>
}
