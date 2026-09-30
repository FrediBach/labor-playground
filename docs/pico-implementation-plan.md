# Raspberry Pi Pico implementation plan

Status: first-release implementation delivered and verified in the production browser bundle. Updated 2026-09-30.

Implementation evidence, measured limits, pinned assets, and compatibility overlays are recorded in [pico-runtime.md](pico-runtime.md). The bridge remains one way; the later analog-feedback milestone below is not enabled.

Add one original RP2040 Raspberry Pi Pico to LABOR Playground using `rp2040js`, with MicroPython programming in **Monaco and full semantic IntelliSense**. Keep execution, language analysis, circuit simulation, and project storage in the browser. The first release connects Pico GPIO and PWM outputs to the existing ngspice circuit captures and oscilloscope.

This extends the [original implementation plan](../plan.md). The current circuit workbench remains the foundation. The choices below are implementation decisions and validation targets; the dependency combination is now pinned and tested in this repository; the runtime report records the resolved versions.

## Scope

| Area | First release |
| --- | --- |
| Board | One original RP2040 Pico instance per circuit |
| Programming | One editable `main.py`, bundled and tested MicroPython firmware |
| Editor | Monaco with semantic completions, signatures, documentation, diagnostics, navigation, references, rename, and relevant code actions |
| Execution | Dedicated emulator worker, explicit Run, Stop, and Reset, bounded serial output |
| Circuit integration | GPIO and hardware PWM outputs driving real ngspice captures through an explicit electrical model |
| Instruments | Existing scope, DC measurements, and capture-based audio where already supported |
| Persistence | Circuit, Pico configuration, source, and runtime profile saved together; legacy circuit imports remain supported |
| Deployment | Static application assets, no compiler server, language server service, account, or runtime CDN |

Later work covers circuit-fed digital inputs and interrupts, ADC feedback, continuous mixed analog/digital simulation, user modules across multiple files, external I2C/SPI/UART devices, PIO workflows, and optional precompiled UF2 import. Multiple board families, wireless variants, Pico 2, and multicore execution are outside this plan.

Full IntelliSense is part of the first release. Syntax coloring, snippets, or a fixed list of Pico API names do not meet that requirement. Its coverage describes the selected MicroPython firmware; emulator and circuit support are documented separately.

## Existing integration points

| Current code | Planned extension |
| --- | --- |
| [`src/lib/circuit.ts`](../src/lib/circuit.ts) | Separate reusable connectivity resolution from netlist generation; add Pico terminals and a versioned project schema |
| [`src/lib/simulation.ts`](../src/lib/simulation.ts) | Coordinate an immutable source/circuit snapshot, firmware trace, and subsequent electrical capture |
| [`src/lib/simulation-client.ts`](../src/lib/simulation-client.ts) and [`simulation.worker.ts`](../src/lib/simulation.worker.ts) | Preserve worker cancellation, failure recovery, and stale-result protection across the expanded pipeline |
| [`src/lib/simulation-analysis.ts`](../src/lib/simulation-analysis.ts) | Keep separate operating-point and transient analyses, compiled from the same initial GPIO state |
| [`src/lib/use-document.ts`](../src/lib/use-document.ts) | Save source and board state while keeping Monaco undo separate from circuit undo |
| [`src/App.tsx`](../src/App.tsx) and [`src/components/workbench/`](../src/components/workbench/) | Add the board, editor, console, runtime controls, and keyboard focus boundaries |

LABOR currently calculates complete 100 ms transient captures after a separate DC solve. Each capture restarts analog state. The installed engine API exposes netlist submission and completed results, without a public stepping or pin-feedback interface. The first release therefore uses a firmware-to-circuit pipeline; true feedback requires additional engine work. See [engine notes](./engine-notes.md).

## User workflow

Add a **Pico** control that enables one board dock beside the breadboard and opens a resizable code panel. The dock uses recognizable Pico artwork, physical pin numbers, and GPIO labels. Jumper wires connect its supported pins to ordinary breadboard terminals. Docking avoids consuming most of the existing 30-column breadboard; physical insertion and board dragging can be separate future work.

The code panel contains Monaco, Run, Stop, Reset, and a console/problems area. Preserve space for the circuit and scope, and allow the editor to collapse without losing its model, cursor, or undo history. Monaco owns editing shortcuts while focused; typing W or R, Delete, and Cmd/Ctrl+Z must not operate on the circuit.

Run executes a fresh bounded experiment from the current source and circuit. The UI explains that it captures the first 100 ms of program execution. Status progresses through preparing the Pico, running the program, calculating the circuit, and capture ready. The MCU stops advancing after the capture interval. An infinite loop is normal firmware and runs only until this interval or a resource limit is reached.

Stop cancels whichever phase is active, discards partial results, and mutes audio. Reset additionally clears emulator and console state while preserving source and wiring. Neither action erases code. Python exceptions link to the corresponding source line, with wrapper offsets removed.

For Pico projects, firmware runs only after explicit Run/Capture. Source and circuit edits immediately mark results stale and stop audio; typing must not reboot the interpreter. The existing analog-only Auto update behavior continues for documents without a Pico. Loading or importing source never executes it automatically.

## Monaco and full IntelliSense

### Language service architecture

Use locally bundled Monaco ESM assets and a Python language server running in its own worker, independent of both the MCU worker and the ngspice worker. The preferred candidate is `browser-basedpyright`, the browser build maintained in the basedpyright repository. Its own playground demonstrates Monaco connected to the worker with a virtual filesystem. This is a packaging candidate to verify, rather than an assumption that the normal Node.js Pyright package runs unchanged in a browser. [Browser package](https://github.com/DetachHead/basedpyright/tree/main/packages/browser-pyright), [playground client](https://github.com/DetachHead/basedpyright-playground/blob/main/client/LspClient.ts).

Start the integration spike with Monaco's public LSP client/transport APIs. Native LSP support is documented in Monaco 0.55, with typed public APIs in 0.56. Pin a compatible released version after testing the worker transport. If that transport cannot support the acceptance cases, use a compatible `monaco-languageclient` adapter; keep the same semantic feature requirements. Its standard Python example uses an external server and must not be mistaken for a browser-only Python implementation. [Monaco changelog](https://github.com/microsoft/monaco-editor/blob/main/CHANGELOG.md), [Monaco language client](https://github.com/TypeFox/monaco-languageclient).

Maintain a small virtual workspace containing `main.py`, language configuration, and read-only `.pyi` type stubs. Synchronize document open/change/close events and versioned diagnostics. Implement worker startup, any language-server background workers, cancellation, shutdown, and recovery under Vite's production asset paths. Language-service failures must remain visible and retryable without losing source.

### MicroPython API coverage

Bundle stubs for the exact RP2 Pico firmware profile, including `machine`, `rp2`, MicroPython builtins, and its standard library. Ensure MicroPython definitions take precedence over incompatible CPython typeshed definitions, particularly APIs such as `time.sleep_ms`. Do not download packages or resolve imports from the public internet while editing. [MicroPython stubs](https://github.com/Josverl/micropython-stubs), [configuration guidance](https://micropython-stubs.readthedocs.io/en/main/22_vscode.html).

Treat emulator version, boot ROM, MicroPython firmware, and stub package as one tested runtime profile. The upstream MicroPython demo's 1.20.0 firmware is a useful starting compatibility fixture, not an automatic choice for the shipped version. Verify a matching Pico-specific stub release, module inventory, docstrings, and actual runtime signatures before locking the profile. Fill verified documentation gaps in a small maintained stub overlay with source attribution.

IntelliSense should expose the firmware's APIs even where the first electrical bridge cannot yet connect a peripheral. A separate capability diagnostic explains limitations such as ADC circuit feedback or multicore execution. Type checking and emulation support must not be conflated.

### Required editor acceptance cases

| Feature | Concrete acceptance case |
| --- | --- |
| Semantic completion | After `from machine import Pin, PWM` and `led = Pin(25, Pin.OUT)`, `led.` offers the correct instance methods; local variables and functions also complete |
| Module and import completion | `from machine import` offers matching firmware symbols; MicroPython `time.sleep_ms` resolves without a false missing-member error |
| Signature help | `Pin(`, `PWM(`, and `pwm.duty_u16(` show parameter names, types, and documented overloads |
| Hover documentation | Hovering a local symbol shows its inferred type; Pico APIs show useful documentation and signatures |
| Diagnostics | Syntax errors, undefined names, unresolved imports, and statically provable invalid arguments appear at the correct ranges and clear after edits |
| Navigation | Go to definition works for user functions and opens firmware stubs read-only; find references and symbol outlines work in `main.py` |
| Rename and edits | Renaming a local symbol updates its references as one undoable editor operation; language-server code actions and auto-import edits work for supported cases |
| Lifecycle | Obsolete diagnostics and completion results cannot replace results for newer source; restarting analysis does not clear code or reset circuit state |

Use a friendly type-checking configuration for unannotated MicroPython examples while retaining useful type errors. Dynamic Python behavior cannot always be inferred; do not promise exhaustive runtime error detection. Formatting and hardware debugging are separate features and are not prerequisites for semantic IntelliSense.

## Pico runtime and capture timing

Wrap `rp2040js` behind a small Pico-specific adapter. It owns the CPU, boot assets, emulated serial transport, run identity, and pin-event collection. Avoid importing emulator internals into React components. The upstream demo establishes the boot ROM, UF2 loading, and emulated USB serial route; scripts can be submitted using MicroPython raw REPL without a C/C++ compilation service. [Demo](https://github.com/wokwi/rp2040js/blob/main/demo/micropython-run.ts), [raw REPL protocol](https://docs.micropython.org/en/latest/reference/repl.html#raw-mode-and-raw-paste-mode).

Implement each run in this order:

1. Freeze source, circuit, runtime profile, and capture settings under a new run/revision ID.
2. Create a fresh emulator, load bundled assets, and boot until the expected REPL handshake. Bound boot instructions, simulated time, and wall-clock duration separately; do not use a fixed host delay as readiness detection.
3. Submit `main.py` through the protocol and define capture zero at a documented, tested user-code execution boundary. Verify traceback filenames and line numbers for this submission mechanism.
4. Record initial GPIO state and then timestamped output events for 100 ms using the emulator clock. Track direction, output enable, peripheral function, and pulls as well as HIGH/LOW levels.
5. Compile the electrical models from the trace and run the existing operating-point/transient analyses. Publish traces, measurements, diagnostics, and serial output under the same revision.

Boot time is excluded from the electrical capture. Firmware preparation does not imply that capacitors have already charged: the analog circuit still starts from the operating point associated with the recorded initial pin state. Keep that state identical between the `.op` and `.tran` netlists.

Chunk emulation work so Stop remains responsive. Use virtual timestamps independent of worker batch size and browser frame timing; define deterministic ordering for simultaneous pin events. Record all relevant initial states even when a pin never changes. Define terminal behavior if the script returns early, fails, or has a transition exactly at the capture boundary.

Set explicit limits for boot, execution work, event count, trace bytes, and console bytes. Overflow must fail the electrical capture clearly rather than silently drop edges. Console overflow may use a visibly marked bounded log. Retain independent deadlines for the existing ngspice work. Pin limits and supported PWM rates after measurements in the initial spike; real-time execution speed is not a release assumption.

All worker messages, including console output and errors, carry a run ID. Source edits, wiring edits, reset, imports, and board removal cancel or supersede old work. Never execute Python as JavaScript or expose the host filesystem to it.

## Electrical integration

### Pin mapping and power

Keep the Pico separate from the generic numeric-value `Part` model. Define its physical header, internal ground connections, supported electrical terminals, and mapping to emulator GPIO explicitly. Original Pico hardware has 40 header pins and 26 exposed GPIOs; GP25 drives the onboard LED and is not an extra header pin. Use the official pinout as the mapping source. [Raspberry Pi board documentation](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html#pin-functions).

For the first model, the Pico is virtually USB-powered. Expose supported GPIO, ground, and a documented 3.3 V output. Join the board's ground pins internally, but require an explicit jumper to the workbench ground for a coupled circuit capture. Do not silently connect breadboard rails. Display other power/control pins with their support status and reject unsupported connections rather than assigning invented electrical behavior.

Validate terminal IDs through the same topology resolver used for breadboard wires. Include supported Pico nodes in scope probing and electrical checks. Do not require ngspice voltage/current descriptors for every decorative or unsupported header pin.

### GPIO driver model

Convert GPIO events into piecewise-linear control waveforms and generated ngspice driver models. Model 0/3.3 V push-pull output through a documented finite output resistance, finite edge duration, disabled output as high impedance with finite leakage, and finite pull-up/down conductances. Select and record the educational model constants in `hardware-spec.md`; do not present them as calibrated silicon characteristics.

At capture zero, user code may not have enabled any output yet. Give each connected GPIO a documented off-state leakage path to Pico ground, initially proposed as 1 GΩ, and include that model in connectivity validation and the operating-point solve. This supplies a defined initial DC state for a GPIO feeding an RC network before PWM starts. It is a deliberate Pico model element, not a general repair for floating circuit nodes. Validate its loading effect and a high-impedance-to-PWM startup fixture; unrelated floating nodes retain the existing diagnostics.

Changing a pin to input must disable its output driver. A LOW-valued voltage source alone cannot represent high impedance. Prove transitions between disabled, driven, and pulled states with ngspice fixtures before enabling them in the UI. Unsupported pin functions or states must identify the affected GPIO and fail the capture clearly.

Preserve PWM plateaus when generating PWL: add points around transitions so the solver does not interpolate a ramp across the entire HIGH or LOW interval. Keep deterministic event ordering, consistent initial DC values, and a defined policy for coincident transitions. Loading and contention are solved electrically through the model; do not overwrite the resulting node voltage with the ideal GPIO value.

Include Pico pin overvoltage and contention diagnostics relevant to LABOR's bipolar sources. Define the tolerated voltage/current envelope for this educational model and show unsupported conditions explicitly. Avoid claiming damage, protection-diode, regulator, or supply-current fidelity.

### Scope and numerical limits

Use actual solved node voltages for the existing scope and audio path. Adapt maximum timestep constraints to the GPIO edge and PWM envelope as well as the LABOR oscillator. Keep the current 50,000-sample capture limit until measurements justify changing it. Unsupported event density or PWM frequency should produce an actionable error, not a plausible aliased trace.

The initial bridge is one way. Circuit voltages do not feed Pico digital reads, interrupts, or ADC conversions. Require runtime guards that reject unsupported circuit-fed observations, including aliased or indirect Python calls, before accepting an electrical capture. Static source warnings alone do not satisfy this contract. If an observation cannot be distinguished safely from an unsupported circuit read, report that limitation instead of returning a default or stale voltage. Reads of supported emulator-internal state need a separate documented contract. Prove these guards during the runtime spike. The ADC callback exists in `rp2040js`, but it does not supply synchronization with LABOR's solver. [GPIO interface](https://github.com/wokwi/rp2040js/blob/main/src/gpio-pin.ts), [ADC interface](https://github.com/wokwi/rp2040js/blob/main/src/peripherals/adc.ts).

## Project storage and undo

Introduce a project schema version with an optional Pico configuration containing the board kind, runtime profile ID, `main.py` text, and capture settings. Use stable board terminal identifiers; keep dock layout preferences separate from electrical identity. Migrate schema-1 circuit documents without changing their electrical behavior.

Persist source and settings, but exclude firmware binaries, live RAM/flash, GPIO traces, serial history, worker state, and language caches. Store reproducible runtime assets with the application and resolve them through a versioned manifest. Loading an unknown profile reports incompatibility rather than silently selecting another firmware.

Keep Monaco's text undo history local to its model. Circuit undo should continue to operate on structural edits, rather than copy the whole source on every keystroke. Save editor drafts through a separate debounced project-save path, and flush the current model before export or Run. Example loading, import, board removal, and Clear board need explicit source-preservation behavior and regression coverage.

Centralize project-size limits: the current 100 kB limit is duplicated in validation, file import, and browser recovery. Define a bounded source allowance and total project limit together, then enforce them consistently. Storage failures must preserve the in-memory project and leave export available. Import/recovery must never auto-run a saved script.

## Implementation sequence

### Milestone 1 Prove runtime and editor compatibility

- [x] Bundle `rp2040js`, boot assets, and one compatible MicroPython firmware; execute a short GPIO/PWM script and read serial output in a browser worker.
- [x] Demonstrate a deterministic user-code start boundary, a bounded 100 ms trace, and cancellation during boot and execution.
- [x] Prove runtime rejection of unsupported circuit-fed GPIO/ADC observations, including indirect calls, while allowing the firmware's required internal operations.
- [x] Bundle Monaco, `browser-basedpyright`, and matching Pico stubs; exercise every IntelliSense acceptance row against the production Vite build.
- [x] Record exact package/asset versions, checksums, licenses/notices, any compatibility overlays, cold startup, memory use, and worker recovery behavior.
- [x] Verify all features with external network requests blocked after loading local application assets.

Both spikes are prerequisites for the feature. If browser language analysis cannot meet the semantic acceptance cases, resolve that integration before calling the editor complete. Adding a hosted language service would change the browser-only architecture and requires a separate product decision.

### Milestone 2 Add the board and project model

- [x] Add schema migration, source storage, the Pico terminal definition, and reusable topology resolution.
- [x] Render the board dock with supported pin connections, labels, ground behavior, and one-instance enforcement.
- [x] Integrate the Monaco panel, versioned language workspace, console, problems navigation, and focus-scoped shortcuts.
- [x] Verify legacy projects, import/export, browser recovery, source undo, circuit undo, and error handling for unsupported profiles or pins.

### Milestone 3 Implement deterministic execution

- [x] Add the Pico worker protocol and source/circuit snapshot coordinator.
- [x] Implement fresh-run boot, raw REPL submission, bounded serial capture, pin-state snapshots, and timestamped GPIO/PWM/mode events.
- [x] Implement Stop, Reset, cancellation on edits, and stale-message rejection throughout the pipeline.
- [x] Verify identical runs and different worker batch sizes produce equivalent traces; verify failures and resource limits recover without reloading the page.

### Milestone 4 Connect firmware output to ngspice

- [x] Compile driver/pull models and PWL controls from the trace; generate matching operating-point and transient initial conditions.
- [x] Add pin diagnostics, event-density checks, timestep constraints, and atomic publication of measurements.
- [x] Verify loaded HIGH/LOW output, high impedance and leakage, pull changes, PWM frequency/duty, and PWM through an RC filter from the initial disabled-driver state using the real installed engine.
- [x] Verify unsupported feedback, missing ground, conflicting drives, limits, and edits during each phase cannot produce a successful stale or misleading capture.

### Milestone 5 Deliver examples and complete acceptance

- [x] Add editable examples for onboard LED/console output, an external LED with a resistor, a pulse train, and PWM through an RC low-pass filter.
- [x] Use example timing that is visible within the 100 ms window. Show how to change frequency or duty cycle in Monaco and rerun the experiment.
- [x] Document the runtime profile, pin model, first-release limits, and source/circuit persistence behavior.
- [x] Run the repository's appropriate numerical, editor, worker, and production-browser checks; complete the release criteria below.

## Validation and release criteria

Use focused tests for integration contracts and actual runtime behavior. Expected electrical values should come from analytical circuits or independent fixtures rather than mirror the compiler implementation.

| Area | Required evidence |
| --- | --- |
| Runtime | Real MicroPython executes the saved source; serial messages and exceptions map correctly; bounded loops, boot errors, Stop, and Reset recover |
| Determinism | Repeated clean runs and different scheduling chunks preserve GPIO timing; boundary and simultaneous events have defined results |
| Electrical behavior | Actual ngspice fixtures verify output loading, driver disable, pull states, PWM plateaus, RC response, and consistent DC initialization |
| IntelliSense | Browser tests cover all acceptance rows, including inferred instance methods, MicroPython-specific APIs, rename edits, and stale diagnostic rejection |
| End to end | Edit PWM duty in Monaco, Run, and observe the expected filtered-voltage change on the existing scope; wiring changes invalidate it immediately |
| Persistence | Source and circuit round-trip together; schema-1 examples remain equivalent; import/recovery never execute code automatically |
| Resilience | Stop works during boot, trace generation, and ngspice; worker failure leaves the editor and circuit usable; old console/error messages cannot contaminate a new run |
| Packaging | Production build serves workers, firmware, and stubs locally; required notices ship; browser tests make no external runtime requests |
| Usability | Editor resizing, keyboard navigation, focus isolation, error navigation, and accessible controls work at the existing desktop target sizes |

Use `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and relevant `npm run test:e2e` suites as implementation changes warrant. Production browser verification should use the existing `LABOR_PRODUCTION=1` workflow. Measure language-service readiness, completion responsiveness, emulation throughput, cancellation latency, and memory on named test environments; set explicit supported limits from those measurements before release.

The first release is complete only when the Pico examples, semantic editor, and firmware-to-analog pipeline work together in the production bundle. A working editor alone or a blinking virtual LED alone does not complete this plan.

## Later analog feedback milestone

After the first release, investigate a solver API that can pause/advance while retaining electrical state. Coordinate MCU events and analog integration on one simulated timeline, with defined GPIO input thresholds and ADC sample timing. Validate capacitor state continuity and a feedback example before enabling circuit-fed inputs. This milestone may require extending or replacing the current ngspice wrapper; adding ADC callbacks to the existing batch pipeline is insufficient.
