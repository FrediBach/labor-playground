/** Original educational models, not manufacturer macromodels.
 * Pin/functional references: TI cd4013b.pdf, cd4070b.pdf, cd4081b.pdf;
 * Sharp PC817 family: LED A/K, emitter, collector in DIP-4 order.
 */
import type { ComponentKind } from './circuit.ts'

/** Zero-based [A, B, output] for each two-input gate. */
export const QUAD_GATE_SECTIONS = [[0, 1, 2], [4, 5, 3], [7, 8, 9], [11, 12, 10]] as const
/** Zero-based [Q, /Q, clock, reset, data, set]. */
export const FLIP_FLOP_SECTIONS = [[0, 1, 2, 3, 4, 5], [12, 11, 10, 9, 8, 7]] as const
export const LOGIC_PINOUTS: Partial<Record<ComponentKind, { inputs: number[]; outputs: number[] }>> = {
  cd4024: { inputs: [0, 1], outputs: [11, 10, 8, 5, 4, 3, 2] },
  cd4093: { inputs: QUAD_GATE_SECTIONS.flatMap(([a, b]) => [a, b]), outputs: QUAD_GATE_SECTIONS.map(([, , output]) => output) },
  cd4001: { inputs: QUAD_GATE_SECTIONS.flatMap(([a, b]) => [a, b]), outputs: QUAD_GATE_SECTIONS.map(([, , output]) => output) },
  cd4013: { inputs: FLIP_FLOP_SECTIONS.flatMap(([, , ...inputs]) => inputs), outputs: FLIP_FLOP_SECTIONS.flatMap(([q, nq]) => [q, nq]) },
  cd4070: { inputs: QUAD_GATE_SECTIONS.flatMap(([a, b]) => [a, b]), outputs: QUAD_GATE_SECTIONS.map(([, , output]) => output) },
  cd4081: { inputs: QUAD_GATE_SECTIONS.flatMap(([a, b]) => [a, b]), outputs: QUAD_GATE_SECTIONS.map(([, , output]) => output) },
}

export function synthLogicLines(kind: 'cd4013' | 'cd4070' | 'cd4081' | 'cd4001' | 'pc817', id: string, n: string[], ctr = 100): string[] {
  if (kind === 'pc817') {
    const [anode, cathode, emitter, collector] = n
    const light = `photo_${id}`, base = `photo_${id}_base`
    const target = `max(0,1000*i(VLED_${id}))`
    return [
      `.model DIR_${id} D(Is=1e-15 N=1.6 Rs=10 Cjo=20p)`,
      `DIR_${id} ${anode} ir_${id} DIR_${id}`,
      `VLED_${id} ir_${id} ${cathode} 0`,
      `BPHOTO_${id} ${light} ${cathode} I = (v(${light},${cathode})-${target})/(${target}>v(${light},${cathode}) ? 2k : 5k)`,
      `CPHOTO_${id} ${light} ${cathode} 1n`,
      `.model QOPT_${id} NPN(Is=1e-14 Bf=100 Br=1 Vaf=100 Cje=20p Cjc=5p Tf=0.5u Tr=5u)`,
      `BCON_${id} ${emitter} ${base} I = max(0,v(${light},${cathode}))*${ctr / 100}/100000`,
      `RBOPT_${id} ${base} ${emitter} 10Meg`,
      `QOPT_${id} oc_${id} ${base} ${emitter} QOPT_${id}`,
      `VCOL_${id} ${collector} oc_${id} 0`,
    ]
  }
  const low = n[6], high = n[13], supply = `v(${high},${low})`
  const valid = `(${supply}>=3 && ${supply}<=18)`
  const lines: string[] = []
  const voltage = (node: string) => `v(${node},${low})`
  const highInput = (index: number) => `(${voltage(n[index])}>0.5*${supply})`
  const drive = (output: number, target: string) => {
    const internal = `logic_${id}_out${output}`
    lines.push(
      `BDRV_${id}_${output} ${internal} ${low} V = ${valid} ? ${supply}*max(0,min(1,${target})) : 0`,
      `BOUT_${id}_${output} ${internal} ${n[output]} I = v(${internal},${n[output]})/max(150,2500/max(3,${supply}))`,
    )
  }
  for (const pin of LOGIC_PINOUTS[kind]!.inputs) lines.push(`RIN_${id}_${pin} ${n[pin]} ${low} 1e12`, `CIN_${id}_${pin} ${n[pin]} ${low} 5p`)
  if (kind === 'cd4013') {
    for (const [section, [q, nq, clock, reset, data, set]] of FLIP_FLOP_SECTIONS.entries()) {
      const master = `ff_${id}_${section}_m`, slave = `ff_${id}_${section}_s`
      const forcedReset = `(!${valid} || time<1u || ${highInput(reset)})`
      const async = (target: string) => `${forcedReset} ? 0 : (${highInput(set)} ? 1 : (${target}))`
      // Non-overlapping transparent phases prevent /Q-to-D feedback racing
      // through both latches. Data is captured on the positive clock transition.
      const masterTarget = async(`${voltage(n[clock])}<0.45*${supply} ? ${highInput(data)} : (${voltage(master)}>0.5)`)
      const slaveTarget = async(`${voltage(n[clock])}>0.55*${supply} ? (${voltage(master)}>0.5) : (${voltage(slave)}>0.5)`)
      lines.push(
        `BMASTER_${id}_${section} ${master} ${low} I = (${voltage(master)}-(${masterTarget}))/1k`,
        `CMASTER_${id}_${section} ${master} ${low} 100p`,
        `BSLAVE_${id}_${section} ${slave} ${low} I = (${voltage(slave)}-(${slaveTarget}))/1k`,
        `CSLAVE_${id}_${section} ${slave} ${low} 100p`,
      )
      // Both asynchronous inputs high produces both outputs high. On their
      // simultaneous release this approximation deterministically retains reset.
      const both = `(${highInput(set)} && ${highInput(reset)} && time>=1u)`
      drive(q, `(${both} ? 1 : ${voltage(slave)})`)
      drive(nq, `(${both} ? 1 : 1-${voltage(slave)})`)
    }
  } else {
    for (const [section, [a, b, output]] of QUAD_GATE_SECTIONS.entries()) {
      const logic = (pin: number) => `(0.5*(1+tanh((${voltage(n[pin])}-0.5*${supply})/max(0.01,0.01*${supply}))))`
      const x = logic(a), y = logic(b), state = `gate_${id}_${section}`
      const target = kind === 'cd4070' ? `(${x}+${y}-2*${x}*${y})` : kind === 'cd4001' ? `((1-${x})*(1-${y}))` : `(${x}*${y})`
      lines.push(`BGATE_${id}_${section} ${state} ${low} I = (${voltage(state)}-${target})/1k`, `CGATE_${id}_${section} ${state} ${low} 100p`)
      drive(output, voltage(state))
    }
  }
  return lines
}
