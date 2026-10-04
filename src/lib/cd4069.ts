/** Educational CD4069UB: continuous analog inversion, without Schmitt hysteresis.
 * Pin reference: https://www.ti.com/lit/ds/symlink/cd4069ub.pdf
 * The smooth transfer is illustrative, not a fit to a manufacturer's device.
 * All voltages are relative to the visible VSS pin. No startup forcing.
 */
export const INVERTER_SECTIONS = [[0, 1], [2, 3], [4, 5], [8, 7], [10, 9], [12, 11]] as const

export function cd4069Lines(id: string, n: string[]): string[] {
  const low = n[6], high = n[13], supply = `v(${high},${low})`
  const valid = `(${supply}>=3 && ${supply}<=18)`
  return INVERTER_SECTIONS.flatMap(([input, output], section) => {
    const drive = `inv_${id}_${section}`
    return [
      `BINV_${id}_${section} ${drive} ${low} V = ${valid} ? ${supply}/2*(1-tanh(40*(v(${n[input]},${low})/max(3,${supply})-0.5))) : 0`,
      `ROUT_${id}_${section} ${drive} ${n[output]} 500`,
      `COUT_${id}_${section} ${n[output]} ${low} 20p`,
      `CIN_${id}_${section} ${n[input]} ${low} 5p`,
      `RIN_${id}_${section} ${n[input]} ${low} 1e12`,
    ]
  })
}
