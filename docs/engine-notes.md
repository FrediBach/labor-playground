# Simulation engine and audio implementation notes

This prototype uses **eecircuit-engine 1.8.0**, pinned exactly in `package.json` and `package-lock.json`. Its installed WASM identifies itself as **ngspice 45.2**, built **2026-09-05 01:00:10 UTC**, with the KLU direct solver compiled in. The startup log reports SPARSE as the active solver. No custom circuit solver or prerecorded waveform fallback is used.

## Runtime boundary

The documented API is `new Simulation()`, `await start()`, `setNetList(netlist)`, and `await runSim()`. Inspection of the installed distribution confirmed that this API creates no Web Worker: the asynchronous Emscripten simulation runs in the caller's context. Therefore `src/lib/simulation.worker.ts` imports and initializes the entire engine inside a dedicated Vite module worker. The UI thread handles document compilation and rendering; the worker handles WASM initialization, the electrical solve, and extraction of the two probe channels. See the [upstream API](https://github.com/eelab-dev/EEcircuit-engine).

The npm package embeds the WASM binary and its model library in its ESM distribution, about 19 MB before bundling/compression. There is no runtime CDN, external model fetch, simulation service, or server API. Vite emits the worker as a static application asset. The package declares no runtime npm dependencies of its own. The application otherwise uses its existing React/Vite frontend stack; `@playwright/test` is a development dependency only.

The engine executes `source`, `destroy all`, `run`, and `write out.raw`. The wrapper exports only the current plot, so each production capture now runs **a separate `.op` analysis followed by `.tran`** in the same worker. Both netlists come from the same circuit snapshot and use identical node/device names. Their results are published together under one revision only after both analyses succeed. Reference ground is exactly zero; unused or disconnected probe nodes remain unavailable. Only channel traces, adaptive timestamps, compact part diagnostics, and the operating-point measurements cross the worker boundary.

The operating-point plot is validated as a single real row with finite node voltages and every component pin present. Its completion log must contain the matching new data-row count and raw-file write, and its plot name must be Operating Point. The transient separately needs its own Transient Analysis plot, matching completion log, and full requested time interval. A prior raw file cannot be accepted merely because the wrapper returned it after an unsuccessful run.

## DC operating point

The operating-point panel reads actual `.op` node voltages, independently of scope capture means and cursor values. For a square-wave RC input, `.op` uses the source's initial DC value even when the later waveform has a near-zero time-weighted mean. Every readout is hidden when its circuit revision becomes stale or invalid.

Resistor and switch currents are calculated from these solved DC voltage differences and their exact compiled resistance. Potentiometers report both CCW-to-wiper and wiper-to-CW currents using the same 1 Ω endpoint floor as the electrical model. Signal, Schottky, zener and LED currents come directly from explicit `.save @D_device[id]` vectors in the `.op` netlist; their nonlinear current is never inferred from an assumed forward voltage. Inductor current comes from `.save @L_device[i]`, including the voltage drop and dissipation of its 1 Ω winding resistance. Bipolar transistors save `@Q_device[ic]` and `@Q_device[ib]`; their power is `Vce × Ic + Vbe × Ib`. Negative PNP terminal currents retain their sign. Power is the sum of branch voltage times branch current, in watts. Positive current follows the displayed pin direction.

Ideal capacitors have zero steady DC current and zero DC dissipated power; this is labelled as an ideal-model result and does not describe charging current. Generic op-amp current and dissipation are unavailable because its behavioral voltage model has no supply-consumption model. Missing requested pin voltages or saved diode currents fail the measurement instead of producing a zero. Unused holes have no invented DC voltage.

## Capture behavior and limits

- Captures cover 100 ms. The compiler chooses at most 10 µs between steps, reduced to 1/80 of an oscillator period when necessary.
- Every request carries a revision. An edited document immediately makes older results stale, including while Auto update is off. Late results never replace the current document's capture.
- Edits are coalesced for 160 ms. There is one running request and at most one replaceable pending request.
- Initialization gets 30 seconds; the combined operating-point and transient job gets 8 seconds. On failure or timeout, the worker is terminated and the next Capture creates a new one. The circuit document is preserved.
- Results above 50,000 samples, invalid timestamps/voltages, and captures that do not complete the requested 0–100 ms interval are rejected. The compiler additionally enforces the documented part/net envelope.
- Each capture restarts from its defined operating point. Capacitor charge is not carried between captures or edits. There is no continuous physical timeline.
- Device, stimulus, and numerical simplifications are described by `PARTS`, the generated netlist, and `hardware-spec.md`. The library includes thirteen component kinds. The generic dual op-amp uses explicit supplies, finite gain, output resistance, and output limiting; the potentiometer uses a 1 Ω endpoint floor.

The displayed scope data remains unprocessed electrical voltage. Whenever a capture is not current, the scope hides its previous traces and measurements. Listen is unavailable until a current capture succeeds, so new probe labels never describe older electrical results.

The worker distinguishes failed runs from a documented ngspice recovery sequence. Exact dynamic/true gmin-stepping failure warnings are accepted only when a later source-stepping-completed message exists and the current analysis has a validated, freshly completed result: one `.op` row or the full 0–100 ms transient. Other failures, singular matrices, aborted runs, and incomplete recovery remain errors. A narrow 50 ms monitor also detects irreversible abort/write failures when the upstream wrapper otherwise leaves its result promise pending. This monitor does not reject intermediate gmin warnings; the independent main-thread watchdog remains responsible for terminating a blocked worker.

Polarized capacitors are checked against the simultaneous voltages on both physical leads throughout the capture. A negative differential beyond −50 mV produces a part-specific reverse-bias warning with the maximum measured magnitude. Missing or malformed vectors for an explicitly requested capacitor check fail the capture rather than silently skipping the diagnostic. These checks do not alter the ideal capacitance or model damage, and they are displayed only for the current revision.

## Expanded discrete models

Inductance is editable from 1 µH to 10 H, initially 10 mH. A native SPICE inductor is in series with a fixed 1 Ω resistor, avoiding ideal-source/inductor DC loops and making winding dissipation explicit. It provides a DC return; capacitors do not. Each capture resets to the operating-point current. There is no magnetic saturation, core loss, mutual coupling, or thermal model.

The generic Schottky diode uses `Is=200 nA`, `N=1.05`, `Rs=0.2 Ω`, `Cjo=10 pF`, and `Eg=0.69 eV`. The generic zener uses `Is=1 pA`, `N=1`, `Rs=2 Ω`, `Cjo=50 pF`, and `IBV=1 mA`. Its editable `Part.value` is the nominal `BV` in volts (2.4–24 V, initially 5.1 V); each instance gets its own model. Actual terminal voltage varies with current and series resistance. Both diode variants preserve anode/cathode order and the visible cathode stripe.

NPN and PNP use complementary Gummel–Poon models with `Is=10 fA`, `Bf=100`, `Br=1`, `Vaf=100 V`, `Cje=10 pF`, `Cjc=4 pF`, `Tf=0.5 ns`, and `Tr=10 ns`. Their rigid adjacent three-pin package always orders collector, base, emitter, including when rotated. This is an educational footprint, not a manufacturer pinout. Bias changes reproduce cutoff, active gain, and saturation; breakdown, thermal effects, and damage are not modeled. The [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf) documents diode breakdown parameters, transistor terminal order, and saved device-current parameters used by these models.

## Scope measurements

The expanded Measurements panel reports min/max, peak-to-peak, and the trapezoidal time integral divided by duration; adaptive rows are never treated as equally spaced. Cursor readings linearly interpolate actual timestamps and do not extrapolate. A/B positions remain in milliseconds across captures, with Δt and per-channel ΔV. The differential meter subtracts CH2 from CH1 at either cursor or uses the time-weighted capture mean. These are measurements of the transient data, not a separate `.op` run.

Frequency requires at least three complete periods with stable rising crossings and a repeating cycle shape, checking the settled end of the capture. DC, step stimuli, insufficient cycles, and irregular traces report unavailable. Input-step examples open at 10 ms/div to show the 1 ms rising edge and 51 ms falling edge together. Current channel data disappears when a capture becomes stale or invalid.

The optional scope trigger frames the current capture without rerunning simulation or changing the circuit history. CH1 or CH2 can trigger on the first confirmed rising or falling crossing of an adjustable voltage level, interpolated between actual timestamps. Confirmation requires traversing a hysteresis band of ±1% of the signal span, with a 1 mV minimum on each side. The view aims for 10% pre-trigger time and clamps to the available capture interval without extrapolation; when no crossing qualifies, it explicitly reports “No crossing found” and shows the capture start. Axis labels, hover readings, and A/B cursors always use absolute capture time, so framing does not change existing cursor measurements.

## Audio monitor

`playCapture()` creates/resumes an `AudioContext` only after the explicit Listen action. Its third argument accepts the original numeric volume or `{ mode: 'once' | 'loop', volume, onEnded }`; one-shot remains the default. `stopAllAudio()` invalidates playback awaiting a suspended context and fades active playback out over 5 ms. Natural completion, explicit stop, cancellation, and failures each deliver `onEnded` once. The simulation hook mutes after document edits, Reset, and failed simulations; new captures never automatically restart listening.

`analyzeAudioLoop()` derives eligibility from the selected channel's actual capture, independently of the oscillator or envelope settings. It requires 3–8 complete cycles at matching rising crossings near the settled end, with periods within 1%, repeating phase shapes, and consistent cycle extrema. Shape checks include every recorded sample in phase-bin extrema, so narrow changing defects cannot hide between phase samples. The remaining partial cycle must agree too. DC, isolated steps, decaying or changing envelopes, irregular waveforms, insufficient cycles, and poorly sampled signals remain one-shot only. This is a conservative finite-capture stability check; it cannot prove that a circuit will remain periodic indefinitely.

Adaptive timestamps are interpolated onto a grid at four times the device's sample rate. A normalized 97-tap Hann-windowed sinc filter limits listening bandwidth to at most 10 kHz before decimation. Loop resampling uses only the verified crossing-to-crossing region, with circular filter taps and a whole PCM frame count; the source playback rate restores the exact measured duration. There is no arbitrary 100 ms wrap, crossfade, or per-cycle fade. DC removal and conservative peak scaling affect only monitor audio. PCM has a fixed 0.35 ceiling; `setMonitorVolume()` applies a live 0–0.35 level through a GainNode with 5 ms ramps, without restarting playback. One-shot PCM retains endpoint fades, and sustained playback fades only at start/stop.

The monitor is a bounded preview, not a calibrated audio interface. It accepts ordered finite captures up to 1 s / 100,000 samples, device sample rates of 8–192 kHz, and voltages within ±10¹² V to prevent numerical overflow. Loop fundamentals above the device's preview bandwidth are rejected. Production captures remain 100 ms; a validated subset can sustain until explicitly muted. `tests/audio-loop.test.ts` covers adaptive timing, analytical RC startup, square/clipped signals, narrow irregular defects, seam continuity, exact pitch, alias attenuation, level limits, live volume, suspended-context cancellation, replacement, and end-state cleanup.

## Verification

`tests/simulation.test.ts` runs the actual installed WASM engine in Node and checks:

- 5 V / equal 10 kΩ voltage divider: 2.5 V.
- 10 kΩ / 100 nF RC step: about 3.1606 V after one time constant.
- RC sinusoidal attenuation against the analytical transfer function.
- Nonlinear limiting with opposing generic signal diodes.
- Bounded LED forward voltage and the documented open/closed switch resistance.
- All thirteen editable example documents, including attenuation, AC coupling, edge shaping, envelope following, mixing, attenuversion, and two-pole filtering with meaningful parameter changes.
- Probe extraction, adaptive resampling, DC removal, fade endpoints, and above-band attenuation.
- Latest-request coalescing and termination/recreation of a stuck worker using a controlled worker fixture.

`tests/components.test.ts` adds real potentiometer endpoints, capacitor charge/decay, dual op-amp follower/gain/clipping, rotated package equivalence, and supply-dependent clipping. `tests/measurements.test.ts` and `tests/polarity.test.ts` check adaptive statistics, stable frequency, cursor interpolation, differential voltage, measured reverse bias, and strict solver-recovery classification.

`tests/expanded-components.test.ts` checks all five added kinds against the installed ngspice engine: RL step response and winding loss, lower Schottky forward voltage and reverse leakage, editable zener breakdown and forward conduction, and complementary BJT cutoff, active gain, saturation, signed terminal currents, and power. Schema ranges, rigid transistor footprints, DC connectivity, independent zener models, and SPICE-safe IDs are also covered.

`tests/operating-point.test.ts` exercises the combined analysis pipeline against the installed engine: divider voltage/current/power, a square-driven RC operating point distinct from its transient mean, potentiometer endpoint currents, saved diode/LED currents, and supply-limited op-amp outputs. Invalid-row, missing-vector, stale-raw-file, explicit recovery, and pending-after-abort fixtures verify that a failed DC analysis cannot produce a successful combined capture.

`tests/e2e/simulation.spec.ts` additionally checks the React hook with a controlled browser worker: equivalent-document replacements during a manual capture, rejection of late results after edits, error visibility across Auto update toggles, and reset after a cancelled capture. These fixtures live outside `src` and are excluded from the production bundle.

The initial local Node smoke run initialized in about 272 ms and completed the 10,008-point divider capture in about 51 ms after initialization. These are observations from this development environment, not cross-browser performance guarantees. Native ngspice is not installed in this workspace, so comparison with a separate native executable has not been performed. Browser integration is checked separately by the Playwright suite.

The combined DC/transient divider pipeline was also timed locally after initialization: the first DC run took 15.8 ms and the full pair 68.2 ms; four warmed runs spent 0.7–1.0 ms on DC and 37.6–43.6 ms on the pair. This measures the installed WASM engine in Node, not browser startup or rendering, and is not a performance guarantee for more complex circuits.

## Attribution and publication follow-up

The wrapper's installed license is MIT, copyright 2024 EElab.dev; a copy is included in `public/third-party/eecircuit-engine-LICENSE.txt`. The [ngspice maintainers](https://ngspice.sourceforge.io/devel.html) describe ngspice as predominantly modified BSD with exceptions. The npm bundle also contains model libraries beyond the models this app uses, including GlobalFoundries/SkyWater text with their own notices. Those embedded libraries are not selected by the generated circuits, but they are still present in the shipped upstream bundle.

The npm package does not include a complete, build-specific notice inventory or its referenced build metadata. Before public distribution, obtain the exact WASM build's component/license inventory and corresponding notices, including enabled solver dependencies and the bundled PDKs, or rebuild a minimal engine with those artifacts preserved. Do not infer that every embedded component is MIT merely from the wrapper's `package.json`. This implementation has not been published. The [upstream build scripts](https://github.com/eelab-dev/EEcircuit-engine/tree/main/Docker) are the starting point for that work.
