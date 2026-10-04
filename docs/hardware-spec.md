# Virtual workbench specification — `virtual-1`

This first implementation is a LABOR-inspired virtual breadboard. It is not a physical LABOR replica, and its coordinates, connector positions, source limits, and model impedances must not be used as a hardware wiring reference.

## Reference verification

Checked on 2026-09-29: the [Erica Synths product page](https://www.ericasynths.lv/edu-diy-labor/) lists the English user manual (June 12, 2024), project material, and interface board templates. The [official manual](https://www.ericasynths.lv/service/file/download/product_id/804/file_id/534/) was downloaded, text-extracted, and visually inspected on pages 10–14. The manual is not bundled with the application.

The following are verified physical LABOR facts, distinct from the virtual implementation below:

| Physical hardware | Manual reference |
| --- | --- |
| 830 tie-point breadboard; supply connections require jumpers | p. 10 |
| Power header, top to bottom: +12 V, +12 V, GND, +5 V, +5 V, GND, −12 V, −12 V | p. 10 panel diagram |
| Square/triangle/sine oscillator; low-frequency/audio range switch; frequency knob; square-wave pulse-width knob | p. 11 |
| Signal available from the SIGNAL OUT jack and header | p. 11 |
| Manual gate/trigger/envelope generator, with a decay knob for envelope mode; EG OUT jack and header | pp. 11–12 |
| Buffered variable CV source covering −8 to +8 V | p. 12 |
| AUDIO IN header feeds the output amplifier; AUDIO is line level, PHONES drives headphones | p. 12 |
| Interface adapters plug into 2×4 sockets; 16-pin breakout numbering alternates top/bottom left to right | p. 13 |
| Top-slot potentiometer: CCW → breakout 3/5, wiper → 7/9, CW → 11/13 | p. 13 |
| In the shown bottom-slot jack arrangement: signal → 8/10, switched contact → 4/6; sleeve is internally grounded | pp. 13–14 diagram |

The manual's general adapter description gives jack signal contacts 7/9 and switched contacts 3/5; the page-14 bottom-slot example routes these to the even-numbered breakout row. Slot orientation is therefore essential, and no interface adapter pinout is implemented in this first build.

Numeric oscillator frequency bounds, amplitude, output impedance, rail breaks, precise breadboard dimensions, and detailed supply current limits are not specified in the inspected feature pages. Repeated printed connector labels alone are not sufficient evidence of internal commoning. Before claiming physical fidelity, verify these details against schematics and the actual board revision, then introduce a matching board definition. Interface boards, the output amplifier, physical audio sockets, and +5 V fixed supply are deferred. A virtual gate/trigger/decay-envelope source follows the documented mode choices; its numeric behavior is a deliberate virtual model. A TL072-style dual op-amp is available as a virtual component; it is not a hardware instrument model.

## Board coordinates and electrical groups

Use the **Columns** and **Rows** selectors above the breadboard to choose 30, 45, or 60 columns and one, two, or three stacked breadboard rows. Each row contains its own A–E and F–J strips, center trench, and four rails. The default remains 30 columns and one row.

The default SVG scene uses a 920 × 550 coordinate system. Column `c` is positioned at `x = 100 + 24 × (c − 1)`. Each additional column adds 24 units of width and each additional breadboard row adds 480 units of height. The following coordinates describe the first row; later rows add 480 or 960 to Y. The Pico dock moves to the right of the selected width, retaining its pin IDs. Adding rows increases the breadboard area’s page height in proportion to the workbench height, preserving the existing hole scale and zoom setting. Scroll the page to reach lower rows. Fit breadboard / Fit all use the complete selected geometry within that expanded area, and zoom supports up to 600% for editing larger layouts.

| Terminals | Y coordinates | Internally connected |
| --- | --- | --- |
| a–e | 170, 194, 218, 242, 266 | Five holes in the same column, above the trench |
| f–j | 326, 350, 374, 398, 422 | Five holes in the same column, below the trench |
| tp1–tp30 | 100 | 1–15 together; 16–30 together |
| tn1–tn30 | 124 | 1–15 together; 16–30 together |
| bp1–bp30 | 468 | 1–15 together; 16–30 together |
| bn1–bn30 | 492 | 1–15 together; 16–30 together |

The default board has 420 holes; each row has `14 × columns` holes, up to 2,520 holes at 60 columns × 3 rows. The trench separates e from f. Rails are isolated in fixed 15-column segments: 1–15, 16–30, 31–45, and 46–60 where present. Different rails and different breadboard rows are never internally connected. Printed polarity/color carries no electrical meaning: every rail starts isolated and requires explicit jumpers to power or ground. Wires connect endpoints only; drawn crossings are not junctions. Components connect electrical nodes through their model without merging those nodes. A physical hole accepts one lead or wire endpoint. Probes do not occupy holes.

Saved projects optionally include `board: { columns: 60, rows: 3 }` (shown at maximum size). Omission preserves legacy geometry and is not rewritten during validation. The first row keeps IDs such as `a1` and `tp30`; subsequent rows use `r2:a1`, `r2:tp30`, `r3:a1`, etc. Resizing preserves existing attachments and is undoable. Shrinking is rejected if it would remove a component lead, wire endpoint, probe, or physical voltage-signal reference. Clear board removes the circuit while retaining its size. Electrical resource limits remain 30 parts, 120 wires, and 60 active external nodes. Geometry changes invalidate existing captures because generated node names may change. Unit tests cover geometry, isolation, placement and compatibility; a real ngspice divider spanning multiple rows verifies the numerical result.

## Instrument terminals and virtual source models

Instrument terminals have y=52. The original OSC, CV, GND, +12 V and −12 V terminals retain x=135, 295, 455, 615 and 775 respectively. EG OUT is added at x=855 without changing any earlier terminal or hole coordinate. Outputs are electrically separate unless the user connects them.

| ID | Label / virtual range | Internal model |
| --- | --- | --- |
| osc | OSC; 20–2,000 Hz; 0–5 V peak | Sine, triangle, square, or capture-step voltage source relative to GND; 100 Ω series output resistance |
| cv | CV; −5 to +5 V | Ideal DC source relative to GND; no current limit |
| gnd | GND | Explicit reference node 0 |
| vplus | +12 V | Ideal fixed source relative to GND; no current limit |
| vminus | −12 V | Ideal fixed source relative to GND; no current limit |
| eg | EG OUT; gate/trigger/envelope; 5 V peak | Behavioral voltage source relative to GND; 100 Ω series output resistance; exponential decay time constant 1–40 ms |

The oscillator ranges and impedances are deliberate virtual choices. Virtual CV is restricted to ±5 V, compared with the manual's physical ±8 V range. Ideal CV and supply sources are educational simplifications. Direct shorts between these ideal source terminals block capture. OSC and EG shorts are bounded by their separate modeled 100 Ω resistances. Source output impedance is part of the circuit calculation and therefore slightly affects a loaded oscillator’s measured amplitude.

EG OUT reproduces the manual’s three mode choices without an ADSR interface. These numeric settings describe the virtual source, not measured physical LABOR behavior:

- **Gate:** a saved high/low state holds the ideal source at 5 V or 0 V throughout the capture and at the DC operating point.
- **Trigger:** one positive pulse begins at 1 ms, with 1 µs rise/fall transitions. The falling edge begins at 2 ms, so the rising-to-falling interval is 1 ms. A finite piecewise-linear source defines one pulse per capture and supplies breakpoints at the edges; it has no repeating clock.
- **Envelope:** a rapid exponential attack begins at 1 ms with a 0.1 µs rise time constant, reaching 99.995% of 5 V within 1 µs. The decay begins at 1.001 ms, with its time constant adjustable from 1 to 40 ms and defaulting to 20 ms. The native ngspice `EXP(0 5 1m 0.1u 1.001m decay)` source evaluates both transitions in the circuit simulation; after the negligible rise tail it follows `5 × exp(−(time − 1.001 ms) / decay)`. This avoids interactions between multiple pulse timing sources. The 10 µs maximum capture timestep can undersample the very short attack. Loaded terminal voltage includes the 100 Ω output resistance. Long decays can extend beyond the captured 100 ms window.

The source is referenced internally to instrument GND, while breadboard rails still require jumpers. It is independent of oscillator amplitude, waveform, and Periodic/Step selection. Trigger/envelope mode starts at 0 V for the DC operating point. Each Capture or Fire action restarts the complete circuit from its initial operating point; there is no preserved envelope phase or capacitor charge. Gate hold is a document setting that participates in undo and JSON saving. The source is always available at EG OUT and affects a circuit only through explicit wiring.

## Models and capture policy

The component library contains resistors, non-polarized and polarized capacitors, inductors, generic silicon/Schottky/Zener diodes, a generic red LED, NPN and PNP transistors, a static switch, a linear potentiometer, a TL072-style dual op-amp, a TL074-style quad op-amp, a 555 timer, and an LM13700-style dual OTA. Named ICs use matching pinouts with educational approximations, not calibrated manufacturer models. Each component definition exposes its assumptions in `model` and its ordered `pinNames`.

- **Diodes/LED:** pin order is anode then cathode. Signal and red LED models remain unchanged. The generic Schottky model has lower forward voltage; Zener breakdown voltage is editable from 2.4–24 V, specified at 1 mA. Both added diodes retain forward conduction and a marked cathode.
- **Inductor:** 1 µH–10 H with a fixed 1 Ω winding resistance and no core saturation, coupling, or thermal model. Every capture starts from its DC operating-point current.
- **NPN/PNP:** generic complementary bipolar transistors with nominal forward beta 100. The rigid footprint has three adjacent pins ordered collector, base, emitter (C–B–E); this virtual pinout does not identify a manufacturer package. Rotations preserve the pin order and cannot span the trench. Exact parameters and limitations for these five models are recorded in [engine notes](./engine-notes.md#expanded-discrete-models).
- **Switch:** 1 Ω closed and 1 GΩ open.
- **Potentiometer:** ordered pins CCW, wiper, CW; 100 Ω–1 MΩ total resistance. `position` is 0 at CCW, 1 at CW, defaulting to 0.5 when omitted. The two resistances are `max(1 Ω, position × total)` and `max(1 Ω, (1 − position) × total)`. The endpoint floor therefore adds 1 Ω to the nominal end-to-end resistance at an extreme. Three consecutive holes form the footprint. Horizontal and vertical rotation are supported, but the rigid footprint cannot span the trench. Vertical same-strip placement is electrically bypassed and warns.
- **Electrolytic capacitor:** ordered pins positive then negative, rendered with polarity marks. The ideal capacitor has no ESR, leakage, breakdown, or damage behavior. Detected reverse bias produces a warning without changing the simulated capacitance; it does not stop capture.
- **TL072-style dual op-amp:** a deliberately static behavioral model, with open-loop gain 100,000, 100 MΩ differential input resistance and 50 Ω output resistance per half. Its internal output targets the supply midpoint plus the amplified differential input, clipped 1 V inside the two visible supply voltages. Each controlled source returns to its visible negative supply pin. Supply separation must exceed 2 V for amplification. As separation falls toward 2 V, the available output swing collapses continuously to the supply midpoint; reversed dynamic supplies collapse the internal source to V−. This continuous limiting avoids a discontinuity during DC source stepping. Missing, directly reversed, and insufficient known supplies block capture. Circuit-dependent supply voltages warn because their separation cannot be known before simulation. Both inputs on each half require an external DC path; differential input resistance is not used to conceal a disconnected input. Connect an unused half as a grounded follower. No hidden supply or ground connection is inserted. The model omits bandwidth, slew rate, common-mode input limits, offset, supply-current accounting, noise, current limiting and damage. Output resistance models loading but is not a supply-current or short-circuit protection model.

The added **TL074-style quad** uses the same static model structure with lower open-loop gain 10,000 for stable cascaded clipping, and follows DIP-14 supply/output/input assignments. V+ is pin 4, V− pin 11; sections A/B/C/D use OUT/IN−/IN+ pins 1/2/3, 7/6/5, 8/9/10, and 14/13/12. Its package spans seven columns. The **555 timer** uses GND/TRIG/OUT/RESET/CTRL/THRESH/DISCH/VCC pins 1–8, with a modeled divider, latch, finite output drive, and discharge switch. It requires 4.5–16 V and begins each capture with a 1 µs reset. See [engine notes](./engine-notes.md#timer-and-quad-op-amp-ics) for model limits and TI pinout references. These ICs need separately sourced parts for physical builds.

The **LM13700-style dual OTA** uses the [TI DIP-16 pinout](https://www.ti.com/lit/ds/symlink/lm13700.pdf), with V− on pin 6 and V+ on pin 11; it spans eight columns. Pins 1/16 accept bias current through external resistors; 2/15 are optional diode-bias inputs; 3/14 and 4/13 are positive and negative signal inputs; 5/12 are current outputs. Separate sourcing-only Darlington buffers use inputs 7/10 and outputs 8/9, requiring external pull-down loads when used. Both OTA signal inputs need DC returns even for unused sections; unused bias may be open or tied to V−. The educational model supports 9.5–32 V total, gain set by bias current, nonlinear input saturation, output compliance, and linearizing diodes. It does not predict exact bandwidth, offsets, temperature behavior, buffer current limits, or damage. The VCA example uses a small input signal and a load resistor to demonstrate CV-controlled gain. See [engine details](./engine-notes.md#tl072-naming-and-lm13700-dual-ota).

The DIP-8 pin order was verified against [TI's TL07xx datasheet, Figure 4-5 and Table 4-3](https://www.ti.com/lit/ds/symlink/tl072.pdf) on 2026-09-29: 1 OUT A, 2 IN− A, 3 IN+ A, 4 V−, 5 IN+ B, 6 IN− B, 7 OUT B, 8 V+. The displayed TL072-style name describes this pin-compatible educational model; it does not reproduce the manufacturer’s full electrical characteristics. Its saved `opamp` kind and electrical behavior are unchanged. At 0°, pin 1 anchors at eN and pins 1–4 advance along e while pins 5–8 return along f. At 180°, pin 1 anchors at fN and the column direction reverses. Other orientations and off-trench placement are rejected, including on import. Existing two-lead documents retain their arbitrary lead spacing. All virtual DIP packages retain this established E/F numbering convention; follow the visible pin labels and the physical device datasheet when rebuilding, rather than treating the virtual artwork as a physical top-view wiring template.

The compiler follows [ngspice analysis and model documentation](https://ngspice.sourceforge.io/docs.html), including exponential and piecewise-linear sources in sections 4.1.3–4.1.4 and B-source voltage expressions in section 5.1.1 of the [ngspice user manual](https://ngspice.sourceforge.io/docs/ngspice-39-manual.pdf). The op-amp uses bounded expressions in that documented behavioral source, verified against the shipped WASM engine. Each capture performs a transient analysis for 100 ms, beginning with the DC operating point. Timestep is at most 10 µs and is further limited to one eightieth of the oscillator period. No `.uic` flag, hidden grounding resistor, or previous capacitor charge is supplied. Open or floating circuit nodes without a modeled DC return are reported before simulation. Operating-point compilation replaces the transient directive with `.op`, retaining identical device and node names. It saves diode/LED, inductor, and transistor terminal-current vectors explicitly along with all node voltages. DC operating-point values are distinct from means of a transient capture; trigger/envelope sources are still 0 V at that initial point. Periodic captures retain the selected sine/triangle/square waveform. Step captures temporarily drive OSC from 0 V to the amplitude at 1 ms, hold it until 51 ms, and return to 0 V, with 1 µs transitions and a 1 s repeat period. Only one pulse occurs in the 100 ms capture; the stored oscillator waveform is preserved.

Import boundaries: schemas 1 and 2, board `virtual-1`, at most 30 components, 120 wires, 60 active external electrical nodes, 200,000 UTF-8 bytes of serialized project data (including at most 32 KiB of Pico source), finite bounded parameters, valid terminal references, unique IDs, and no overlapping occupancy. The compiler returns deterministic nodes and a physical-terminal map so probes retain their attachment across edits. Arbitrary SPICE, model URLs, and imported extra properties are never compiled. Pico Python source runs only in the isolated emulator after an explicit Run. The former fixed 23-device / four-node per-component estimate is superseded by later CMOS models. The compiler checks actual expansion against 1 MB, 1,000 devices and 300 internal nodes, including instrument and model contributions. The CD4069UB adds 30 devices and six internal nodes per package. Schema 1 remains backward compatible: omitted `stimulus` means periodic, omitted potentiometer `position` means midpoint, and these optional fields are not injected into legacy imports. An omitted `instruments.envelope` uses mode `envelope`, `gateHigh: false`, and `decayMs: 20` without adding that object during import. When supplied, all three settings are required; mode, boolean gate state, finite 1–40 ms decay, and allowed property names are validated. Rigid potentiometer, transistor, and IC footprints are validated during import; pin count and occupancy apply to every lead.

## Example circuits

- **RC low-pass:** 10 kΩ plus 100 nF; 220 Hz sine at 2.5 V peak; explicit output return to GND. Nominal RC corner 159 Hz, with oscillator source impedance included in simulation.
- **Voltage divider:** ideal 5 V CV and two 10 kΩ resistors; midpoint 2.5 V.
- **Diode clipper:** oscillator through 1 kΩ into opposing generic silicon diodes with an explicit GND return.
- **Capacitor charge/decay:** 10 kΩ and 1 µF polarized capacitor, plus the oscillator’s 100 Ω source impedance; a 5 V capture step rises at 1 ms and falls at 51 ms. Effective time constant 10.1 ms, verified on both the rise and decay.
- **Op-amp gain stage:** non-inverting gain 2 from equal 10 kΩ feedback resistors, with visible ±12 V supplies. The second amplifier is a grounded follower. Changing the feedback resistor to 20 kΩ gives gain 3; sufficiently large gains clip near ±11 V subject to output loading.

- **Envelope shaping:** EG OUT drives 10 kΩ and 100 nF; CH1 follows the input envelope and CH2 shows the rounded attack. The 20 ms default decay is independent of the RC filter’s 1.01 ms time constant including source resistance. Increasing the capacitor to 470 nF lowers and delays the output peak.

### Modular synth examples

The seven additional experiments form a progression using supported components. These are circuit topologies that can be rebuilt on EDU LABOR, with source levels checked on the hardware; the virtual board is not a physical wiring template.

| Level | Experiment | Synth application |
| --- | --- | --- |
| Basic | CV attenuator | Scale a modulation depth with a linear potentiometer. |
| Basic | AC coupling / high-pass | Remove DC and attenuate low frequencies with a series capacitor and ground-return resistor. |
| Intermediate | Gate-to-trigger | Turn a positive gate’s edges into decaying pulses; the falling edge is negative, so this is an edge-shaping lesson rather than a protected logic output. |
| Intermediate | Diode envelope follower | Rectify audio and smooth the peaks into a control voltage, with diode loss, ripple, and loading visible. |
| Intermediate | CV/audio mixer | Add an oscillator and DC offset with two inverting stages, restoring the signal polarity. |
| Intermediate | Buffered attenuverter | Sweep modulation continuously from inverted through zero to positive, using both amplifier halves. |
| Advanced | Sallen–Key low-pass | Explore a two-pole active filter and the effect of feedback on its damping. Equal 10 kΩ/100 nF filter components give a nominal 159 Hz natural frequency; 4.7 kΩ/10 kΩ gain resistors give gain 1.47 and Q ≈ 0.654. Changing the feedback resistor to 10 kΩ gives gain 2 and Q ≈ 1. |

The sixteen analog examples are ordinary editable documents. Scope channels attach to physical terminals. The JSON document stores no traces or audio data. Difficulty and build guidance are catalog metadata, leaving the saved document schema unchanged.

### Building the examples on EDU LABOR

Checked against the [official LABOR manual, pp. 2–5](https://www.ericasynths.lv/service/file/download/product_id/804/file_id/534/) on 2026-09-30: the full kit adds experimental components including two TL072s, ten 1N4148s, ten each of 10 kΩ and 100 kΩ resistors, five 100 nF capacitors, one 470 nF capacitor, and two 10 nF capacitors. The main kit includes linear B10K and B100K potentiometers. The new experiments use listed values and fit the full-kit inventory individually; the components can be reused between experiments. A partial kit requires separately sourced experimental parts. Some suggested variations in older lessons (such as 220 nF, 2.2 µF, or 20 kΩ) need additional parts.

- Reproduce electrical connections, not the virtual coordinates. Confirm the real breadboard rail continuity and bridge rails as needed. Connect circuit ground to LABOR GND. Potentiometer CCW, wiper, and CW connections must follow the actual adapter orientation described on manual pp. 13–14.
- Use a DIP-8 TL072 for the TL072-style dual op-amp, with pin 8 at +12 V and pin 4 at −12 V. The three new active examples include a 100 nF capacitor from each supply pin to GND; place these close to the IC. Add the same bypassing when building the older gain-stage example. Keep unused halves connected as grounded followers. This follows [TI’s TL072 pinout and supply-bypassing guidance, §8.4.1](https://www.ti.com/lit/ds/symlink/tl072.pdf). The virtual model does not predict the device’s exact bandwidth, output swing, or saturation recovery.
- Use non-polarized signal and bypass capacitors rated at least 25 V; only use a polarized capacitor where explicitly specified, with its marked polarity respected. These are build recommendations, not a claim about the supplied capacitors’ ratings. The 1N4148 stripe marks its cathode; the simulator uses a generic silicon model.
- Set frequency, shape, CV, and EG mode using LABOR’s controls and measure the actual outputs. Its manual does not specify a calibrated oscillator amplitude adjustment or the simulator’s 100 Ω source impedance. Use a passive attenuator to reduce physical input levels as needed. For the simulated positive gate step, press and release EG OUT in gate mode; the precise simulated pulse duration is not a physical preset. Connect circuit audio to AUDIO IN for monitoring through LABOR’s amplifier.
- The Sallen–Key lesson uses [TI’s equal-component relation Q = 1 / (3 − K)](https://www.ti.com/lit/an/sloa024b/sloa024b.pdf), where K is the non-inverting amplifier gain. The suggested resistor change stays below K = 3. Free-running oscillators, VCAs, and transistor-based VCFs are outside these examples because the current component set and static op-amp model do not support a faithful implementation.

## Editing and view geometry

Resistors, capacitors, electrolytics, inductors, all diode variants, LEDs, and switches can move one lead independently. The other lead, pin order, component value, and polarity are preserved. A new edited spacing must be between 24 and 192 SVG units (1–8 hole pitches), use distinct breadboard holes, and respect occupied holes. Imported legacy two-lead spacing remains valid; these bounds apply to new individual-lead edits. Each completed move is one undo action. Wires and probes remain attached to their physical holes. Potentiometer, transistor, and DIP geometry stays rigid.

Pan, zoom, fit actions, and scope height are presentation state only. They do not change saved documents, connectivity, captures, or undo history. At 100% the responsive viewport fits the 920 × 550 workbench extent, including source terminals. Fit breadboard frames the board body at (46, 79), with extent 828 × 450; source terminals may be outside this closer view. Zoom buttons preserve the visible center subject to the scroll bounds.

## Original Pico output model — `rp2-pico-1.20.0-v1`

One docked Pico is virtually USB-powered. Supported terminals are the 26 exposed GPIOs, all GND/AGND headers, and 3V3 OUT. GP25 is internal to the board. Other power/control pins are decorative and reject connections. Internal grounds are joined, but an explicit jumper to workbench GND is mandatory. The model does not power breadboard rails automatically.

| Element | Educational constant |
| --- | --- |
| HIGH / LOW target | 3.3 V / 0 V, relative to Pico GND |
| Push-pull output resistance | 50 Ω |
| Disabled output | Driver conductance zero; 1 GΩ leakage to Pico GND |
| Enabled pull-up / pull-down | 50 kΩ to 3.3 V / GND |
| Edge duration | 1 µs, linear conductance transition |
| 3V3 OUT | 3.3 V through 1 Ω; no regulator or supply-current model |
| Supported GPIO voltage envelope | −0.3 V to +3.6 V |
| Supported GPIO net driver current | Up to 20 mA magnitude |
| Maximum repetition per connected GPIO | 5 kHz, within the shared 2,000-event budget |
| Maximum analog step with Pico | 5 µs, with PWL edge breakpoints |

These are teaching constants, not calibrated RP2040 silicon characteristics. Overvoltage or excessive driver current fails a capture, including on unprobed connected GPIOs. No damage, thermal, protection-diode, regulator, drive-strength or supply-current fidelity is claimed. The 3V3 source must not be used as a model of a physical regulator.

The initial state comes from the freshly booted emulator immediately before user-code dispatch. Firmware-reset pull-downs can therefore be present before `Pin` configuration. Both `.op` and `.tran` use that same initial state; startup is not assumed to be a running PWM steady state. Each connected GPIO has its own leakage path. Unrelated floating components retain the existing DC-return diagnostics.

PWL controls preserve plateaus by adding points at each transition and at its finite edge end. Output disable removes the driver instead of substituting a LOW source. Pull and direction changes are recorded even if the logic level stays unchanged. Output drivers and pull resistors have independent PWL controls, so nearby register changes during pin initialization can overlap without being mistaken for short pulses. Changes to the same control within an unfinished 1 µs edge are rejected. Solved loading/contention changes the scope voltage; ideal pin levels never replace ngspice results.

See [Pico runtime](pico-runtime.md) for timing, guard behavior, resource limits, assets and persistence.

Pico driver expansion adds at most 210 devices and 157 internal nodes, independently of the generic component model limit.


The **CD4069UB-style unbuffered inverter** is a DIP-14 part with inputs/outputs on 1/2, 3/4, 5/6, 9/8, 11/10 and 13/12, VSS on 7 and VDD on 14. It requires a 3–18 V supply span and explicit unused-input connections. Its continuous analog transfer supports feedback around midrail; a CD40106 Schmitt inverter is not an equivalent replacement. See [model limits and classic synth examples](engine-notes.md#classic-synth-designs-and-cd4069ub). The new examples use expanded boards, ordinary wires and editable documentation; the existing TL074 signal splitter remains the buffered-mult example.
