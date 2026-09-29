# Simulation engine and audio implementation notes

This prototype uses **eecircuit-engine 1.8.0**, pinned exactly in `package.json` and `package-lock.json`. Its installed WASM identifies itself as **ngspice 45.2**, built **2026-09-05 01:00:10 UTC**, with the KLU direct solver compiled in. The startup log reports SPARSE as the active solver. No custom circuit solver or prerecorded waveform fallback is used.

## Runtime boundary

The documented API is `new Simulation()`, `await start()`, `setNetList(netlist)`, and `await runSim()`. Inspection of the installed distribution confirmed that this API creates no Web Worker: the asynchronous Emscripten simulation runs in the caller's context. Therefore `src/lib/simulation.worker.ts` imports and initializes the entire engine inside a dedicated Vite module worker. The UI thread handles document compilation and rendering; the worker handles WASM initialization, the electrical solve, and extraction of the two probe channels. See the [upstream API](https://github.com/eelab-dev/EEcircuit-engine).

The npm package embeds the WASM binary and its model library in its ESM distribution, about 19 MB before bundling/compression. There is no runtime CDN, external model fetch, simulation service, or server API. Vite emits the worker as a static application asset. The package declares no runtime npm dependencies of its own. The application otherwise uses its existing React/Vite frontend stack; `@playwright/test` is a development dependency only.

The engine executes `source`, `destroy all`, `run`, and `write out.raw`. We use an ordinary `.tran` directive plus `.save all`, and extract the real `time` and `v(node)` vectors. Reference ground is exactly zero; unused or disconnected probe nodes produce an empty channel, never an invented waveform. Only the channels and adaptive timestamps cross the worker boundary. `.op` is not requested as an additional exported analysis because the wrapper returns only the current plot. The transient begins from ngspice's operating point, so steady DC examples still give DC voltages, but a separate operating-point panel and branch-current measurements remain future work.

## Capture behavior and limits

- Captures cover 100 ms. The compiler chooses at most 10 µs between steps, reduced to 1/80 of an oscillator period when necessary.
- Every request carries a revision. An edited document immediately makes older results stale, including while Auto update is off. Late results never replace the current document's capture.
- Edits are coalesced for 160 ms. There is one running request and at most one replaceable pending request.
- Initialization gets 30 seconds; solving gets 8 seconds. On failure or timeout, the worker is terminated and the next Capture creates a new one. The circuit document is preserved.
- Results above 50,000 samples or with invalid timestamps/voltages are rejected. The compiler additionally enforces the documented part/net envelope.
- Each capture restarts from its defined operating point. Capacitor charge is not carried between captures or edits. There is no continuous physical timeline.
- Device, stimulus, and numerical simplifications are described by `PARTS`, the generated netlist, and `hardware-spec.md`. The current library does not yet include a dual op-amp, potentiometer, polarized capacitor, or an envelope instrument.

The displayed scope data remains unprocessed electrical voltage. Whenever a capture is not current, the scope hides its previous traces and measurements. Listen is unavailable until a current capture succeeds, so new probe labels never describe older electrical results.

## Audio monitor

`playCapture()` creates/resumes an `AudioContext` only after the explicit Listen action. It plays one capture once; it never loops an arbitrary recording. `stopAllAudio()` stops active playback and invalidates playback awaiting a suspended audio context. The simulation hook calls it after document edits, Reset, and failed simulations.

Adaptive timestamps are linearly interpolated onto a grid at four times the device's sample rate. A normalized 97-tap Hann-windowed sinc filter limits listening bandwidth to 10 kHz before decimation. DC removal, a conservative gain cap, an output limiter, and 5 ms endpoint fades affect only the audio monitor. These measures are a deliberately bounded preview path, not a calibrated audio interface. Preview duration is currently 100 ms, so a useful sustained monitor/steady-state loop is deferred.

## Verification

`tests/simulation.test.ts` runs the actual installed WASM engine in Node and checks:

- 5 V / equal 10 kΩ voltage divider: 2.5 V.
- 10 kΩ / 100 nF RC step: about 3.1606 V after one time constant.
- RC sinusoidal attenuation against the analytical transfer function.
- Nonlinear limiting with opposing generic signal diodes.
- Bounded LED forward voltage and the documented open/closed switch resistance.
- All three editable example documents, including the effect of changing C1.
- Probe extraction, adaptive resampling, DC removal, fade endpoints, and above-band attenuation.
- Latest-request coalescing and termination/recreation of a stuck worker using a controlled worker fixture.

`tests/e2e/simulation.spec.ts` additionally checks the React hook with a controlled browser worker: equivalent-document replacements during a manual capture, rejection of late results after edits, error visibility across Auto update toggles, and reset after a cancelled capture. These fixtures live outside `src` and are excluded from the production bundle.

The initial local Node smoke run initialized in about 272 ms and completed the 10,008-point divider capture in about 51 ms after initialization. These are observations from this development environment, not cross-browser performance guarantees. Native ngspice is not installed in this workspace, so comparison with a separate native executable has not been performed. Browser integration is checked separately by the Playwright suite.

## Attribution and publication follow-up

The wrapper's installed license is MIT, copyright 2024 EElab.dev; a copy is included in `public/third-party/eecircuit-engine-LICENSE.txt`. The [ngspice maintainers](https://ngspice.sourceforge.io/devel.html) describe ngspice as predominantly modified BSD with exceptions. The npm bundle also contains model libraries beyond the models this app uses, including GlobalFoundries/SkyWater text with their own notices. Those embedded libraries are not selected by the generated circuits, but they are still present in the shipped upstream bundle.

The npm package does not include a complete, build-specific notice inventory or its referenced build metadata. Before public distribution, obtain the exact WASM build's component/license inventory and corresponding notices, including enabled solver dependencies and the bundled PDKs, or rebuild a minimal engine with those artifacts preserved. Do not infer that every embedded component is MIT merely from the wrapper's `package.json`. This implementation has not been published. The [upstream build scripts](https://github.com/eelab-dev/EEcircuit-engine/tree/main/Docker) are the starting point for that work.
