/**
 * Educational pin-compatible bipolar 555 approximation, not a vendor macromodel.
 * Pin order: GND, TRIG, OUT, RESET, CTRL, THRESH, DISCH, VCC.
 *
 * The real three-resistor divider loads CTRL and makes the trigger reference
 * half of CTRL. The capacitor stores the latch across independent TRIG/THRESH
 * events; RESET wins over TRIG, which wins over THRESH. A 100 ns latch time
 * constant avoids an instantaneous algebraic feedback loop.
 *
 * A deterministic 1 us power-on reset provides a solvable DC initialization for
 * astable circuits. Consequently .op describes this initial reset state, while
 * a transient capture releases the latch. No UIC or hidden input returns are
 * needed. Every voltage is relative to the package's external GND connection.
 *
 * Contract: 4.5–16 V supply, 0.7 V RESET threshold, high target VCC−1.2 V,
 * low target 0.1 V, 50 ohm output resistance, 10 ohm discharge / 1 Gohm off.
 * Outside the supply range, the output target is 0 V and discharge is off.
 * VCC supplies 3 mA plus divider current and the output's sourced load current.
 * This does not model temperature, tolerances, damage, or transistor-level
 * supply spikes, and is intended for ordinary audio/LFO timing networks.
 *
 * Behavior/pin reference: https://www.ti.com/lit/ds/symlink/ne555.pdf
 * Analog B-source syntax: https://ngspice.sourceforge.io/docs/ngspice-manual.pdf
 */
export function timer555Lines(safeId: string, nodes: string[]): string[] {
  const [ground, trigger, output, reset, control, threshold, discharge, supply] = nodes
  const prefix = `timer_${safeId}`
  const lowReference = `${prefix}_third`
  const state = `${prefix}_state`
  const drive = `${prefix}_drive`
  const voltage = (positive: string) => `v(${positive},${ground})`
  const valid = `(${voltage(supply)} >= 4.5 && ${voltage(supply)} <= 16)`
  const forcedLow = `(!${valid} || ${voltage(reset)} < 0.7 || time < 1u)`
  const target = `${forcedLow} ? 0 : (${voltage(trigger)} < ${voltage(lowReference)} ? 1 : (${voltage(threshold)} > ${voltage(control)} ? 0 : (${voltage(state)} > 0.5 ? 1 : 0)))`
  const high = `(${voltage(state)} > 0.5)`
  return [
    `R${prefix}_divider1 ${supply} ${control} 5k`,
    `R${prefix}_divider2 ${control} ${lowReference} 5k`,
    `R${prefix}_divider3 ${lowReference} ${ground} 5k`,
    `B${prefix}_latch ${state} ${ground} I=(${voltage(state)}-(${target}))/1k`,
    `C${prefix}_latch ${state} ${ground} 100p`,
    `B${prefix}_out ${drive} ${ground} V=${valid} ? (${high} ? ${voltage(supply)}-1.2 : 0.1) : 0`,
    `R${prefix}_out ${drive} ${output} 50`,
    `B${prefix}_supply ${supply} ${ground} I=${valid} ? 0.003+max(0,-i(B${prefix}_out)) : 0`,
    `B${prefix}_discharge ${discharge} ${ground} I=${voltage(discharge)}/(${valid} && !${high} ? 10 : 1e9)`,
  ]
}
