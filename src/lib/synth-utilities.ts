/** Original educational models. Pin references:
 * https://www.ti.com/lit/ds/symlink/cd40106b.pdf
 * https://www.ti.com/lit/ds/symlink/cd4053b.pdf
 * The LED/LDR is generic, with a virtual four-pin carrier.
 */
export const SCHMITT_SECTIONS = [[0, 1], [2, 3], [4, 5], [8, 7], [10, 9], [12, 11]] as const
/** [common, X (select low), Y (select high), select], zero-based. */
export const MULTIPLEXER_SECTIONS = [[13, 11, 12, 10], [14, 1, 0, 9], [3, 4, 2, 8]] as const

export function synthUtilityLines(kind: 'cd40106' | 'cd4053' | 'vactrol', id: string, n: string[]): string[] {
  if (kind === 'vactrol') {
    const [anode, cathode, ldr2, ldr1] = n
    const state = `light_${id}`, led = `led_${id}`
    const target = `max(0,1000*i(VLED_${id}))`
    return [
      `.model DOPT_${id} D(Is=1e-18 N=2 Rs=10 Cjo=15p)`,
      `DOPT_${id} ${anode} ${led} DOPT_${id}`,
      `VLED_${id} ${led} ${cathode} 0`,
      // Milliamps of LED current become an optical state; the two sides have
      // no electrical connection. DC starts at the equilibrium illumination.
      `BPHOTO_${id} ${state} ${cathode} I = (v(${state},${cathode})-${target})/(${target}>v(${state},${cathode}) ? 2k : 20k)`,
      `CPHOTO_${id} ${state} ${cathode} 1u`,
      `BLDR_${id} ${ldr1} ${ldr2} I = v(${ldr1},${ldr2})/(500+9999500/pow(1+max(0,v(${state},${cathode}))/0.05,2))`,
    ]
  }
  const lines: string[] = []
  if (kind === 'cd40106') {
    const low = n[6], high = n[13], supply = `v(${high},${low})`
    const valid = `(${supply}>=3 && ${supply}<=18)`
    for (const [section, [input, output]] of SCHMITT_SECTIONS.entries()) {
      const state = `sch_${id}_${section}`, drive = `${state}_drive`
      // A 1 us initialization also makes RC-feedback oscillators solvable in
      // .op. Afterwards, the capacitor retains the state in the hysteresis band.
      const target = `(!${valid} || time<1u) ? 1 : (v(${n[input]},${low})>0.58*${supply} ? 0 : (v(${n[input]},${low})<0.38*${supply} ? 1 : (v(${state},${low})>0.5 ? 1 : 0)))`
      lines.push(
        `BSCH_${id}_${section} ${state} ${low} I = (v(${state},${low})-(${target}))/1k`,
        `CSCH_${id}_${section} ${state} ${low} 100p`,
        `BDRV_${id}_${section} ${drive} ${low} V = ${valid} ? max(0,${supply})*max(0,min(1,v(${state},${low}))) : 0`,
        `BOUT_${id}_${section} ${drive} ${n[output]} I = v(${drive},${n[output]})/max(150,2500/max(3,${supply}))`,
        `CIN_${id}_${section} ${n[input]} ${low} 5p`,
        `RIN_${id}_${section} ${n[input]} ${low} 1e12`,
      )
    }
  } else {
    const low = n[7], negative = n[6], high = n[15]
    const logic = `v(${high},${low})`, analog = `v(${high},${negative})`
    const valid = `(${logic}>=3 && ${logic}<=18 && ${analog}>=${logic} && ${analog}<=20)`
    for (const [section, [common, x, y, select]] of MULTIPLEXER_SECTIONS.entries()) {
      const control = `mux_${id}_${section}`, inhibit = `mux_${id}_inhibit`
      lines.push(`RSEL_${id}_${section} ${n[select]} ${control} 10k`, `CSEL_${id}_${section} ${control} ${low} 10p`)
      for (const [leg, terminal] of [x, y].entries()) {
        // A 10% dead band provides break-before-make on slow or filtered edges.
        const selected = leg === 0 ? `v(${control},${low})<0.45*${logic}` : `v(${control},${low})>0.55*${logic}`
        const on = `(${valid} && v(${inhibit},${low})<0.5*${logic} && ${selected})`
        const level = `((v(${n[common]},${negative})+v(${n[terminal]},${negative}))/max(3,${analog})-1)`
        const resistance = `(125*pow(15/max(3,${analog}),1.206)*(1+0.15*max(0,1-${level}*${level})))`
        lines.push(`BMUX_${id}_${section}_${leg} ${n[common]} ${n[terminal]} I = v(${n[common]},${n[terminal]})*(1e-9+(${on})/${resistance})`, `CMUX_${id}_${section}_${leg} ${n[terminal]} ${negative} 5p`)
      }
      lines.push(`CCOM_${id}_${section} ${n[common]} ${negative} 9p`)
    }
    lines.push(`RINH_${id} ${n[5]} mux_${id}_inhibit 10k`, `CINH_${id} mux_${id}_inhibit ${low} 10p`)
  }
  return lines
}
