import type { ComponentKind } from './circuit.ts'

export const SYNTH_IC_LAYOUTS: Partial<Record<ComponentKind, { negative: number; positive: number; min: number; max: number }>> = {
  cd40106: { negative: 6, positive: 13, min: 3, max: 18 },
  cd4053: { negative: 7, positive: 15, min: 3, max: 18 },
  lm393: { negative: 3, positive: 7, min: 2, max: 36 },
  cd4066: { negative: 6, positive: 13, min: 3, max: 18 },
}

/** Original bounded approximations, not manufacturer macromodels.
 * Pinout/behavior references:
 * https://www.ti.com/lit/ds/symlink/lm393.pdf
 * https://www.ti.com/lit/ds/symlink/cd4066b.pdf
 */
export function synthIcLines(kind: 'lm393' | 'cd4066', id: string, n: string[]): string[] {
  const lines: string[] = []
  if (kind === 'lm393') {
    const low = n[3], high = n[7]
    for (const [section, [output, minus, plus]] of [[0, 1, 2], [6, 5, 4]].entries()) {
      const state = `cmp_${id}_${section}`, target = `${state}_target`
      const enabled = `(v(${high},${low})>=2 && v(${high},${low})<=36)`
      lines.push(
        `BCT_${id}_${section} ${target} ${low} V = ${enabled}*0.5*(1+tanh(v(${n[minus]},${n[plus]})/0.001))`,
        `RCT_${id}_${section} ${target} ${state} 1k`,
        `CCT_${id}_${section} ${state} ${low} 600p`,
        // Sink only; the external pull-up supplies the high level. Saturation
        // resistance and current limiting keep a heavily loaded output honest.
        `BCO_${id}_${section} ${n[output]} ${low} I = max(0,min(0.016,v(${n[output]},${low})/40))*max(0,min(1,v(${state},${low})))+v(${n[output]},${low})/1e9`,
        `CCO_${id}_${section} ${n[output]} ${low} 5p`,
        `RCP_${id}_${section} ${n[plus]} ${low} 1e12`,
        `RCM_${id}_${section} ${n[minus]} ${low} 1e12`,
        `ICP_${id}_${section} ${low} ${n[plus]} 25n`,
        `ICM_${id}_${section} ${low} ${n[minus]} 25n`,
      )
    }
  } else {
    const low = n[6], high = n[13], supply = `v(${high},${low})`
    const enabled = `(${supply}>=3 && ${supply}<=18)`
    // Fits nominal 5/15 V resistance points; adds a modest mid-rail hump.
    const baseResistance = `(125*pow(15/max(3,${supply}),1.206))`
    for (const [section, [a, b, control]] of [[0, 1, 12], [2, 3, 4], [7, 8, 5], [9, 10, 11]].entries()) {
      const state = `sw_${id}_${section}`, target = `${state}_target`
      const level = `((v(${n[a]},${low})+v(${n[b]},${low}))/max(3,${supply})-1)`
      const ron = `${baseResistance}*(1+0.15*max(0,1-${level}*${level}))`
      lines.push(
        `BST_${id}_${section} ${target} ${low} V = ${enabled}*0.5*(1+tanh((v(${n[control]},${low})-0.5*${supply})/0.05))`,
        `RST_${id}_${section} ${target} ${state} 1k`,
        `CST_${id}_${section} ${state} ${low} 100p`,
        `BSW_${id}_${section} ${n[a]} ${n[b]} I = v(${n[a]},${n[b]})*(1e-9+max(0,min(1,v(${state},${low})))/(${ron}))`,
        `CSA_${id}_${section} ${n[a]} ${low} 8p`,
        `CSB_${id}_${section} ${n[b]} ${low} 8p`,
        `RSE_${id}_${section} ${n[control]} ${low} 1e12`,
      )
    }
  }
  return lines
}
