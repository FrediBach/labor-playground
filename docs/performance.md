# Simulation and recording performance

The original scope validated every sample before each interpolated voltage lookup. Hovering also repainted the entire waveform, while moving measurement cursors could recompute the full-capture differential mean. These costs grew with recording length even though a cursor needs only two neighboring samples.

## Scope changes

- Validate immutable capture arrays once and use binary searches for subsequent voltage lookups. Invalid series and duplicate-time discontinuities retain their existing behavior.
- Render hover cursors, A/B cursors and the recording playhead as a separate overlay. Playback inside the displayed interval does not repaint the waveform.
- Page the view when playback or seeking leaves it. Trigger changes deliberately reframe the capture; timebase changes keep the selected recording moment visible. Available timebases extend to 1 second per division.
- Cache minimum/maximum values in a tree of 64-sample blocks. Dense views query these extrema instead of scanning the whole recording, preserving single-sample pulses. Short visible windows use a direct scan to avoid tree overhead. Boundary lookup uses binary search.
- Reuse measured channel means for the differential meter and reuse the integrated scope's endpoint reading rather than validating it twice.

## Measurements

Measured locally on 2026-10-01 with Node's `performance.now()`, normal JavaScript number arrays, and the median of seven repeated runs. Each capture spans 10 seconds and contains a 220 Hz sine wave. The lookup benchmark queries 120 evenly spaced moments in one channel. Setup and one-time validation are excluded from lookup timings and reported separately. These are local microbenchmarks, not end-to-end browser or solver timings.

| Samples per channel | Previous 120 lookups | Prepared 120 lookups | One-time scope index construction |
| --- | ---: | ---: | ---: |
| 100,000 | 77.0 ms | 0.031 ms | 3.1 ms |
| 1,000,000 | 762.9 ms | 0.032 ms | 12.0 ms |

At one million samples, computing a 600-column dense waveform envelope took approximately 0.78 ms with the previous sequential scan and 0.76 ms with the index. The main benefit is eliminating repeated validation and redraws during interaction, rather than claiming a large speedup in the already efficient drawing loop. The index adds approximately 0.5 MiB per million-sample channel; captures retain their original samples for inspection.

Unit tests compare indexed envelopes with direct scans, cover isolated spikes and adaptive/duplicate timestamps, and assert bounded sample access on million-sample captures. Browser coverage instruments the scope canvas's `clearRect`: hovering, moving A/B cursors and playing inside a fixed interval must cause zero waveform redraws. Changing the visible interval must redraw and retain the selected playhead in view.

## Engine and recording

The interface offers 100 ms, 500 ms, 1 s, 5 s, and 10 s recordings. Increasing duration no longer extends an unconditional 10 µs grid. The compiler omits disconnected OSC/EG sources and saves exposed node voltages plus capacitor, diode, inductor, and transistor current vectors. Pico driver conductances are also saved for the electrical envelope checks, then omitted from the visible recording. Hidden IC nodes and unused source currents no longer inflate every row.

The maximum timestep is the smallest applicable bound: duration/1,000 (duration/10,000 for connected step stimuli), oscillator period/80, envelope decay constant/200, or a 555 timing bound. The 555 bound uses the smallest resistor and capacitor touching its timing pins, divided by 50, with a 10 µs fallback for unrecognized timing networks. Source breakpoints and ngspice error control can add samples. Ordinary analog circuits use `trtol=0.01` to preserve RC/RL interpolation accuracy; the behavioral 555 latch retains its established `trtol=7` with the explicit RC bound. Testing showed that tightening LTE alone could distort that model's pulse widths. Existing analytical gain, charging, RL, envelope, timer frequency, and timer duty tolerances are retained.

Completed recordings retain all adaptive timestamps and saved values without downsampling. `sampleRecording` finds adjacent rows with one binary search, interpolates voltages and measured currents, then derives resistor/potentiometer currents and signed instantaneous power. Capacitor current is recorded from ngspice rather than substituted with its zero DC current. Channels reuse the same arrays as recording nodes, including after structured cloning across the worker boundary. Playback inspection costs O(log(samples) + saved vectors + component branches), independent of the full recording length after the search.

Measured locally on 2026-10-01 with the installed ngspice WASM engine after initialization, one 10-second transient run per variant. The baseline snapshots preserve the previous compiler's netlists; only their stop times are extended. The previous application would reject these long captures at its old 50,000-row limit. The new variants include transient device-current vectors. Timings exclude the separate DC analysis, UI work, and startup, and vary with machine load. Numeric sizes count eight bytes per value; they are not total process memory.

| Circuit, 10-second recording | Previous solve | New solve | Previous rows → new rows | Previous numeric data → new data |
| --- | ---: | ---: | ---: | ---: |
| DC voltage divider | 3,825 ms | 4 ms | 1,000,008 → 1,008 | 106.812 → 0.038 MiB |
| 220 Hz RC filter | 4,028 ms | 733 ms | 1,000,012 → 206,833 | 106.813 → 11.046 MiB |
| 555 astable | 16,900 ms | 7,259 ms | 1,007,506 → 501,797 | 176.793 → 42.112 MiB |

Recordings are bounded to 1,000,000 rows and 12,000,000 numeric values. The compiler rejects configurations that already exceed the budget at the minimum possible row count, and result validation checks actual adaptive totals. A dense or fast circuit may therefore require a shorter recording even though 10 seconds is available. The limit never causes silent truncation or downsampling. Raw parsing, solver state, and worker transport need additional working memory beyond this numeric payload; these limits do not promise a hard process-memory ceiling. Startup has a 30-second watchdog; a 100 ms capture keeps its 8-second watchdog, while longer captures get 60 seconds. Every accepted result must reach the exact requested endpoint.

## Pico runtime

The Pico emulator supports the same 100 ms, 500 ms, 1 s, 5 s and 10 s durations. GPIO states are compared as packed values, and the emulator yields by elapsed wall time instead of scheduling a timer after every instruction batch. A local 100 ms PWM capture fell from 486 ms to 302 ms with identical instruction and event counts. A full 10-second 1 kHz PWM recording was verified through ngspice: firmware took 19.77 s, electrical simulation with the final accuracy settings took 16.41 s, and the recording contained 339,972 samples. These are local observations, not cross-browser performance guarantees.

The emulator has independent 60-second execution, 25,000-event and 4 MB trace limits. Dense output patterns can hit these before reaching 10 seconds; the user receives an error instead of a partial successful recording. The circuit and firmware remain editable. See [Pico runtime notes](pico-runtime.md).

Playback shares one external store at up to 30 visual updates per second. Only the transport, measured component, LED glyphs and scope subscribe; waveform drawing remains cached while its frame is unchanged. The application, breadboard geometry, editor and instrument controls do not rerender with the playback clock. Node voltages and supported device currents are interpolated between adjacent adaptive samples; GPIO states use discrete recorded events. Edits, new captures and hidden tabs stop playback. Audio remains a separate bounded preview, clearly labeled when shorter than the full electrical recording.

## Reproduce verification

```sh
node --experimental-strip-types --test tests/measurements.test.ts tests/scopeTrace.test.ts
node --experimental-strip-types --test tests/recording.test.ts tests/simulation.test.ts tests/components.test.ts tests/ic-components.test.ts
node --experimental-strip-types scripts/benchmark-simulation.ts 10
npm run test:e2e -- tests/e2e/scope-performance.spec.ts tests/e2e/measurements.spec.ts tests/e2e/trigger.spec.ts
```
