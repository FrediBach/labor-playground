/** Original educational approximations; pin references are linked in README. */
import { QUAD_GATE_SECTIONS } from './synth-logic.ts'

/** Q1 (divide by 2) through Q7 (divide by 128), zero-based DIP pin indices. */
export const COUNTER_OUTPUTS = [11, 10, 8, 5, 4, 3, 2] as const
export const COUNTER_NC = [7, 9, 12] as const

export function synthTimingLines(kind: 'cd4024' | 'cd4093' | 'lm4040', id: string, n: string[], reference = 2.5): string[] {
  if (kind === 'lm4040') {
    // TI TO-92: pin 1 must float or connect to anode; 2 cathode; 3 anode.
    const [, cathode, anode] = n, internal = `ref_${id}`, v = `v(${internal},${anode})`
    return [
      `VREF_${id} ${cathode} ${internal} 0`,
      `BREF_${id} ${internal} ${anode} I = ${v}>${reference} ? 60u+(${v}-${reference})/0.5 : 60u*pow(max(0,${v})/${reference},8)`,
      `.model DREF_${id} D(Is=1p N=1 Rs=1 Cjo=20p)`,
      `DREF_${id} ${anode} ${internal} DREF_${id}`,
      `CREF_${id} ${internal} ${anode} 1n`,
    ]
  }
  const low = n[6], high = n[13], supply = `v(${high},${low})`
  const valid = `(${supply}>=3 && ${supply}<=18)`
  const lines: string[] = []
  const voltage = (node: string) => `v(${node},${low})`
  const state = (node: string, target: string) => lines.push(
    `BSTATE_${node} ${node} ${low} I = (${voltage(node)}-(${target}))/1k`,
    `CSTATE_${node} ${node} ${low} 100p`,
  )
  const schmitt = (pin: number) => {
    const node = `sch_${id}_${pin}`
    state(node, `(!${valid} || time<1u) ? 0 : (${voltage(n[pin])}>0.6*${supply} ? 1 : (${voltage(n[pin])}<0.4*${supply} ? 0 : (${voltage(node)}>0.5)))`)
    lines.push(`RIN_${id}_${pin} ${n[pin]} ${low} 1e12`, `CIN_${id}_${pin} ${n[pin]} ${low} 5p`)
    return node
  }
  const drive = (pin: number, target: string) => {
    const node = `drv_${id}_${pin}`
    lines.push(`BDRV_${id}_${pin} ${node} ${low} V = ${valid} ? ${supply}*max(0,min(1,${target})) : 0`,
      `BOUT_${id}_${pin} ${node} ${n[pin]} I = v(${node},${n[pin]})/max(150,2500/max(3,${supply}))`)
  }
  if (kind === 'cd4093') {
    for (const [a, b, output] of QUAD_GATE_SECTIONS) {
      const x = schmitt(a), y = schmitt(b), out = `nand_${id}_${output}`
      state(out, `1-(${voltage(x)}>0.5)*(${voltage(y)}>0.5)`)
      drive(output, voltage(out))
    }
  } else {
    let clock = schmitt(0)
    lines.push(`RRESET_${id} ${n[1]} ${low} 1e12`, `CRESET_${id} ${n[1]} ${low} 5p`)
    const reset = `(!${valid} || time<1u || ${voltage(n[1])}>0.5*${supply})`
    for (const [stage, output] of COUNTER_OUTPUTS.entries()) {
      const master = `count_${id}_${stage}_m`, slave = `count_${id}_${stage}_s`
      // Negative-edge master/slave toggles. The next stage sees the internal
      // Q state, preserving ripple operation independently of output loading.
      state(master, `${reset} ? 0 : (${voltage(clock)}>0.55 ? (${voltage(slave)}<0.5) : (${voltage(master)}>0.5))`)
      state(slave, `${reset} ? 0 : (${voltage(clock)}<0.45 ? (${voltage(master)}>0.5) : (${voltage(slave)}>0.5))`)
      drive(output, voltage(slave))
      clock = slave
    }
  }
  return lines
}
