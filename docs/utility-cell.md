# Cascadable 1U utility cells

The Advanced example implements **Cascadable 1U Utility Cell Design.pdf**, v0.1, 04 October 2026, as two cells and their shared reference board. It is a functional simulation of the proposal, whose PCB, mechanical fit and bench validation remain outstanding.

Load **Cascadable 1U utility cells** from Examples, or import [the saved project](examples/cascadable-utility-cell.json). The 60-column, three-row board contains 112 individually editable components and 249 visible jumpers. **Overview** explains the experiment; each component and flow also has an editable documentation note.

## Controls and measurements

Prefixes `A_` and `B_` identify the cells. `R1`–`R23`, `C1`–`C5`, `P1`, `P2`, `U1`–`U4` and `Q1` follow the PDF ledger. `C6`–`C13` are the eight supply bypasses; `C14`/`C15` are the bulk capacitors.

| Part | Meaning |
| --- | --- |
| `A_P1`, `B_P1` | LEVEL: position 0 gives −1, 0.5 gives zero, 1 gives +1. |
| `A_P2`, `B_P2` | OFFSET: position 0 gives −5 V, 0.5 gives zero, 1 gives +5 V. |
| `A_IN`, `B_IN` | SPDT input jack: 0 selects the SOURCE normal; 1 selects the patched input. A is patched to OSC; B to the CV instrument. The first SOURCE normal is grounded. |
| `A_CV`, `B_CV` | SPDT CV jack: 0 selects the buffered +5 V reference; 1 selects the CV instrument. |
| `A_SW1`, `B_SW1` | DPDT mode: 0 PROCESS, 1 DIRECT. |
| `A_SUM`, `B_SUM` | SPST SUM normal: closed (1) forwards the sum; open (0) represents inserting a plug and breaking forwarding. The SUM tip remains available to probe. |
| `A_TAP`, `B_TAP` | Closing connects a 10 kΩ test load to local OUT. No SOURCE or MIX contact changes. |
| CH1 / CH2 | A local OUT / B SUM tip. Tests use separate terminal-bound signals. |

Select a part on the board or through Overview to edit it in Inspector. In Automations, use **Flow** to edit the capture sequence. Each capture starts from the saved settings; the test suite has its own frozen initial controls.

For each cell, `x` is the input-buffer output, `a = 2×P1−1`, `w = −a×x`, `g ≈ max(0, CV/5)`, `v = −g×w`, `b ≈ 10×P2−5`, and `p = v+b`. PROCESS sends `p` to OUT and local contribution `q`. DIRECT sends `x` to OUT and grounds `q`. The positive sum is `S = m+q`, where `m` is buffered incoming MIX. SOURCE forwards `x`, independent of both output drivers.

## Default capture and tests

The 100 ms capture starts with both LEVEL controls at +0.5 and both offsets at zero. A receives a 1 V peak, 100 Hz sine; B inherits A's raw SOURCE.

| Simulation time | Action |
| --- | --- |
| 10–20 ms | Ramp A LEVEL to +1. |
| 30–35 ms | Ramp A OFFSET to +1 V. |
| 45 ms | Select A DIRECT: local OUT becomes raw input; A leaves the mix. |
| 60 ms | Restore A PROCESS. |
| 70 ms | Open A SUM normal: B's incoming MIX returns to zero through B_R18. |
| 85 ms | Patch B IN to the +2 V CV instrument, overriding SOURCE. |

Run **Automations → Tests → Run all tests** for eight independent checks: signed LEVEL and offset after cutoff; linear CV at negative, zero, half and unity settings; DIRECT bypass/exclusion; positive sum, OUT tap and SUM break/rejoin; SOURCE override; offset extremes; reference voltages; and −5…+5 V to 0…5 V conversion. A 10 mV absolute allowance covers finite gain, reference error, pot endpoint resistance and link loading. It is not a hardware tolerance specification.

```sh
nvm use
npm run test:circuit -- docs/examples/cascadable-utility-cell.json
```

[Numerical regressions](../tests/utility-cell.test.ts) additionally check the audio trajectory, output loading, finite summed headroom, a +10 V VCA-control fixture, malformed controls, missing supplies, exports and failure after changing a gain resistor. [Browser coverage](../tests/e2e/utility-cell.spec.ts) exercises the suite, controls, adapters, export and recovery.

## Implementation choices and limits

- OPA197/OPA4197 retain SOIC pin numbering on virtual DIP adapters; SSI2162 retains SSOP-10 numbering on a virtual DIP-10 adapter. These are not PCB footprints. Q1 uses the existing generic PNP model, not a calibrated BC557.
- IN/CV jack insertion uses explicit SPDT contacts; SUM uses an SPST normal. Grounded sleeves are the shared circuit ground. Local OUT has no normal. There is no hidden jack wiring.
- The reference board contains the 5 V LM4040 shunt, buffered +5 V, inverted −5 V, buffered 4.64 kΩ / 5.49 kΩ clamp divider and grounded spare amplifier, with resistor-fed reference and bypasses.
- Both 110 Ω / 2.2 nF input shunts are series networks. The 100 pF feedback capacitors and the OUT 10 kΩ / 1 nF dual-feedback network remain explicit.
- Local OUT feedback senses the tip after R16. SUM feedback senses raw S before R23, retaining series loss. `B_RLINK` represents a following cell's 1 MΩ MIX input; `RLOAD`/`TAP` are test loads. A_R18 is omitted because both ends would be grounded; B_R18 is retained and establishes zero after a broken normal.
- Models omit calibrated distortion, noise, offsets, thermal behavior, short-circuit protection and cable stability. IC supply-current/power readings remain unavailable. The proposed ±8 V accumulated-sum target is a hardware design target. A later attenuator cannot repair earlier clipping.

See [engine details](engine-notes.md#cascadable-utility-cells) for numerical assumptions and primary references. Existing schemas and SPST actions retain their meanings; the new parts and 5 V reference are additive.
