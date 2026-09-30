/**
 * Educational LM13700-style dual OTA, not a manufacturer macromodel.
 * Pin order follows the 16-pin package, including both independent buffers.
 *
 * Each differential pair supplies IABC*tanh(Vdiff/52mV); its small-signal gm is
 * 19.23*IABC and its peak current is IABC, limited here to 2 mA. IABC enters a
 * real two-junction diode equivalent referenced to V−, rather than a voltage
 * control input. Paired diodes from diode bias to the signal inputs implement
 * input linearization with an external current feed and input resistances.
 * Differential input resistance is approximately 13/IABC ohms (26k at 500uA).
 * No signal input receives an invented return to ground or a supply rail.
 *
 * OTA output current rolls off in the last 0.8–1 V before either supply, with
 * 100 Mohm output resistance to each rail. Positive current is sourced from
 * V+ and negative current sinks into V−. Supply quiescent current is a simple
 * 0.6 mA + 2*(IABC_A+IABC_B) approximation. OTA current is disabled outside
 * the supported 9.5–32 V total supply range; passive junctions remain present.
 *
 * Separate Darlington pairs model the buffers. They source current and need
 * an external pull-down resistor/current sink to V−; their output sits about
 * two diode drops below the input. They are not unity-gain op-amps. The model
 * does not enforce the real buffer's 20 mA rating or simulate device damage.
 * Unused bias, diode, current-output, and buffer pins may remain unconnected.
 *
 * No bandwidth, slew, temperature variation, offset, mismatch, or noise model.
 * All package currents and voltages use actual pins, never global ground.
 * Per package: 23 devices, 4 internal nodes, and 3 local model declarations.
 * Behavior/pin reference: https://www.ti.com/lit/ds/symlink/lm13700.pdf
 */
export function lm13700Lines(safeId: string, nodes: string[]): string[] {
  const negative = nodes[5]
  const positive = nodes[10]
  const prefix = `ota_${safeId}`
  const valid = `(v(${positive},${negative}) >= 9.5 && v(${positive},${negative}) <= 32)`
  const biasCurrent = (section: string) => `min(0.002,max(0,i(V${prefix}_${section}_bias)))`
  const lines = [
    `.model ${prefix}_bias D(Is=1e-15 N=2)`,
    `.model ${prefix}_linear D(Is=1e-15 N=1)`,
    `.model ${prefix}_buffer NPN(Is=1e-14 Bf=200 Vaf=100)`,
  ]
  const sections = [
    { name: 'a', bias: 0, diode: 1, inputPositive: 2, inputNegative: 3, output: 4, bufferInput: 6, bufferOutput: 7 },
    { name: 'b', bias: 15, diode: 14, inputPositive: 13, inputNegative: 12, output: 11, bufferInput: 9, bufferOutput: 8 },
  ]
  for (const section of sections) {
    const name = `${prefix}_${section.name}`
    const bias = `${name}_bias_junction`
    const buffer = `${name}_buffer_emitter`
    const inputPositive = nodes[section.inputPositive]
    const inputNegative = nodes[section.inputNegative]
    const output = nodes[section.output]
    const differential = `v(${inputPositive},${inputNegative})`
    const command = `(${biasCurrent(section.name)}*tanh(${differential}/0.052))`
    lines.push(
      `V${name}_bias ${nodes[section.bias]} ${bias} 0`,
      `D${name}_bias ${bias} ${negative} ${prefix}_bias`,
      `D${name}_linear_p ${nodes[section.diode]} ${inputPositive} ${prefix}_linear`,
      `D${name}_linear_n ${nodes[section.diode]} ${inputNegative} ${prefix}_linear`,
      `B${name}_input ${inputPositive} ${inputNegative} I=${differential}*(1e-9+${biasCurrent(section.name)}/13)`,
      `B${name}_source ${positive} ${output} I=${valid} ? max(0,${command})*min(1,max(0,(v(${positive},${output})-0.8)/0.2)) : 0`,
      `B${name}_sink ${output} ${negative} I=${valid} ? max(0,-${command})*min(1,max(0,(v(${output},${negative})-0.8)/0.2)) : 0`,
      `R${name}_out_p ${output} ${positive} 100meg`,
      `R${name}_out_n ${output} ${negative} 100meg`,
      `Q${name}_buffer_1 ${positive} ${nodes[section.bufferInput]} ${buffer} ${prefix}_buffer`,
      `Q${name}_buffer_2 ${positive} ${buffer} ${nodes[section.bufferOutput]} ${prefix}_buffer`,
    )
  }
  lines.push(`B${prefix}_supply ${positive} ${negative} I=${valid} ? 0.0006+2*(${biasCurrent('a')}+${biasCurrent('b')}) : 0`)
  return lines
}
