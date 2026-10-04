import { BOARD_ROW_PITCH, type BoardConfiguration } from '@/lib/circuit'

/** Decorative surfaces use the same spacing as the physical terminal geometry. */
export function BreadboardSurface({ board }: { board: Readonly<BoardConfiguration> }) {
  const extraWidth = (board.columns - 30) * 24
  const extraHeight = (board.rows - 1) * BOARD_ROW_PITCH
  return <>
      <rect x={3} y={2} width={914 + extraWidth} height={548 + extraHeight} rx={5} fill="url(#breadboard-pcb)" stroke="#4b504c" />
      <path d={`M10 74H${910 + extraWidth}M10 ${532 + extraHeight}H${910 + extraWidth}`} stroke="#535b54" strokeOpacity={0.4} />
      <path d="M34 104V205L15 224V458M886 114V246L906 266V443M37 452V486L15 508M882 315V385L907 410" fill="none" stroke="#626958" strokeWidth={1} opacity={0.18} />
      <text transform="translate(28 386) rotate(-90)" fill="none" stroke="#c5d0c7" strokeWidth={0.7} fontSize={25} fontWeight={500} letterSpacing={4}>LABOR</text>
      <text transform="translate(28 227) rotate(-90)" fill="#acb6ad" fontSize={5.5} fontFamily="monospace" letterSpacing={1}>ERICA SYNTHS · EDU</text>
      {[{ x: 24, y: 33 }, { x: 896 + extraWidth, y: 33 }, { x: 23, y: 91 }, { x: 897 + extraWidth, y: 91 }, { x: 23, y: 516 + extraHeight }, { x: 897 + extraWidth, y: 516 + extraHeight }].map(({ x, y }) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
        <circle cy={2} r={11} fill="#090e0d" opacity={0.75} />
        <path d="M-5-9H5L10 0 5 9H-5L-10 0Z" fill="url(#hardware-steel)" stroke="#7b8781" strokeWidth={0.7} />
        <circle r={6.3} fill="#aeb9ae" stroke="#dde2d5" strokeWidth={0.9} />
        <circle r={4.7} fill="#65716a" />
        <path d="M-3.8 0H3.8M0-3.8V3.8" stroke="#151d19" strokeWidth={2.1} transform="rotate(28)" />
        <path d="M-6-5A8 8 0 0 1 5-6" fill="none" stroke="#f9f6df" strokeWidth={1.2} opacity={0.75} />
      </g>)}
    {Array.from({ length: board.rows }, (_, bank) => <g key={bank} transform={`translate(0 ${bank * BOARD_ROW_PITCH})`}>
      <rect x={47} y={84} width={828 + extraWidth} height={445} rx={5} fill="#080c0a" opacity={0.65} />
      <rect x={46} y={79} width={828 + extraWidth} height={446} rx={5} fill="url(#breadboard-edge)" stroke="#b0b5a6" strokeWidth={1} />
      <rect x={52} y={83} width={816 + extraWidth} height={433} rx={2} fill="url(#breadboard-plastic)" />
      <rect x={55} y={85} width={810 + extraWidth} height={60} rx={1} fill="url(#breadboard-plastic)" stroke="#c7cebf" strokeWidth={0.7} />
      <rect x={55} y={150} width={810 + extraWidth} height={132} rx={1} fill="url(#breadboard-plastic)" />
      <rect x={55} y={310} width={810 + extraWidth} height={140} rx={1} fill="url(#breadboard-plastic)" />
      <rect x={55} y={454} width={810 + extraWidth} height={55} rx={1} fill="url(#breadboard-plastic)" stroke="#c0c8b8" strokeWidth={0.7} />
      <path d={`M55 146H${865 + extraWidth}M55 452H${865 + extraWidth}`} stroke="#909c8d" strokeWidth={1} opacity={0.65} />
      <path d={`M55 148H${865 + extraWidth}M55 453H${865 + extraWidth}M56 86H${864 + extraWidth}M53 513H${867 + extraWidth}`} stroke="#fffdef" strokeWidth={1.4} opacity={0.8} />
      <rect x={54} y={283} width={812 + extraWidth} height={27} fill="url(#breadboard-trench)" />
      <path d={`M56 283H${864 + extraWidth}`} stroke="#8b9487" />
      <path d={`M56 310H${864 + extraWidth}`} stroke="#fffdee" strokeWidth={1.5} />
      <text x={75} y={300} fill="#778475" fontSize={6.8} fontFamily="monospace" letterSpacing={1}>SOLDERLESS BREADBOARD{board.rows > 1 ? ` · ROW ${bank + 1}` : ''}</text>
      <text x={844 + extraWidth} y={300} textAnchor="end" fill="#778475" fontSize={6.8} fontFamily="monospace" letterSpacing={0.6}>{board.columns} × 10 · SPLIT RAILS</text>
      {Array.from({ length: board.columns / 15 }, (_, index) => index).map(segment => <g key={segment}>
        {[{ y: 89, color: '#b95548' }, { y: 138, color: '#647e88' }, { y: 457, color: '#b95548' }, { y: 505, color: '#647e88' }].map(line => <path key={line.y} d={`M${90 + segment * 360} ${line.y}H${443 + segment * 360}`} stroke={line.color} strokeWidth={1.6} />)}
      </g>)}
      {[{ y: 104, text: '+', color: '#b95548' }, { y: 128, text: '−', color: '#647e88' }, { y: 472, text: '+', color: '#b95548' }, { y: 496, text: '−', color: '#647e88' }].map(label => <g key={label.y} fill={label.color} fontSize={13} fontWeight={500} textAnchor="middle"><text x={71} y={label.y}>{label.text}</text><text x={846 + extraWidth} y={label.y}>{label.text}</text></g>)}
      {Array.from({ length: board.columns }, (_, index) => index + 1).map(column => <g key={column} fill="#536258" fontSize={8} textAnchor="middle" fontFamily="monospace"><text x={100 + (column - 1) * 24} y={157}>{column}</text><text x={100 + (column - 1) * 24} y={442}>{column}</text></g>)}
      {'abcdefghij'.split('').map((row, index) => <g key={row} fill="#536258" fontSize={8.5} fontFamily="monospace" textAnchor="middle"><text x={71} y={173 + index * 24 + (index > 4 ? 36 : 0)}>{row.toUpperCase()}</text><text x={846 + extraWidth} y={173 + index * 24 + (index > 4 ? 36 : 0)}>{row.toUpperCase()}</text></g>)}
    </g>)}
  </>
}
