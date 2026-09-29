# LABOR Playground: first implementation plan

I would build this as **a local-only virtual workbench: a LABOR-inspired interface, a genuinely editable breadboard, circuit simulation, an oscilloscope, and audio previews**.

The first release should answer one question:

> Can someone open the page, understand the workbench, change a circuit, and see—and eventually hear—what changed without fighting the interface?

I would revise one part of my earlier recommendation: **do not start by writing a general circuit solver**. Use an existing engine, keep it behind a small adapter, and spend most of the effort on breadboard interaction, understandable measurements, and visual polish.

For this implementation, my starting stack would be **React + TypeScript, SVG for the workbench, Canvas for the scope, and ngspice/WASM through `eecircuit-engine`**. Its documented interface is built around loading a netlist and running a simulation, so the initial UX should use fast, bounded simulation captures—not assume uninterrupted, audio-rate simulation while everything is being edited. :chatgpt-content-reference{index="1"}

---

## 1. Define the first-release experience

### The main user journey

The application opens directly into a working example: **an oscillator feeding a passive low-pass filter**. The breadboard is already wired, two scope probes are attached, and a small instruction says:

> Change the capacitor value and watch the output waveform.

The user can inspect the circuit immediately. Audio starts only after an explicit **Listen** action.

From there, they can remove a wire, move a component, change a value, attach a probe elsewhere, load another example, or clear the board. There is no account creation, project dashboard, or mandatory tutorial.

The same editor should power both examples and an empty workbench. **Examples must be real editable circuits, not special-case animations.**

### Scope boundaries

| Include in the first release | Deliberately defer |
|---|---|
| One LABOR workbench layout | Multiple workbench types |
| Breadboard component placement and wiring | General schematic editing and PCB design |
| A small, tested component library | Arbitrary manufacturer model libraries |
| DC measurements and transient captures | A complete SPICE analysis interface |
| Two-channel virtual scope | Spectrum analyzer and extensive measurement tools |
| Audio previews of simulated output | Performance-grade, uninterrupted live audio |
| A handful of editable examples | A full course or lesson-authoring system |
| Undo, redo, JSON import/export, browser recovery | Accounts, databases, cloud storage, collaboration |

Use approximately **30 user-placed components and 60 external electrical nets** as an initial test envelope, not as a claim about engine capability. Internal model complexity also needs its own limit.

Desktop and laptop use should be the primary target. Support a trackpad properly before investing in phone interaction.

---

## 2. Decide what “virtual LABOR” means

The physical LABOR includes a dual supply, a 16-position interfacing section, a pulse/triangle/sine oscillator, a multimode envelope generator, a buffered variable CV source, an output amplifier, and audio outputs. Those are the functional blocks worth preserving around the virtual breadboard. :chatgpt-content-reference{index="2"}

The implementation should distinguish three kinds of fidelity.

### Physical fidelity: prioritize this

Preserve the arrangement of the breadboard, instrument controls, exposed connectors, power connections, and configurable interface area.

A user should be able to look at a virtual connection and understand where the corresponding connection belongs on their physical LABOR.

Before implementing the board, create a small `hardware-spec` document covering:

- Breadboard dimensions, coordinates, connected strips, and rail breaks.
- Connector labels, numbering, and electrically common pins.
- Instrument control ranges and available modes.
- Which connections exist internally and which require jumpers.

These are the few details that must not be guessed from a photograph. In particular, a rail’s printed color is not sufficient evidence that it is already connected to ground or a supply.

**Reference note:** the old direct manual URL I supplied earlier now returns 404. The current [LABOR product page](https://www.ericasynths.lv/edu-diy-labor/) lists the user manual, project material, and interface-board templates. I could verify those listings, but not retrieve the manual PDF in this session; exact pin mappings and control ranges therefore remain an explicit first implementation task. :chatgpt-content-reference{index="3"}

### Functional fidelity: model the instruments, not their internal construction

For the first version, implement the built-in oscillator, CV source, and envelope as documented behavioral sources. Do not simulate every component inside the LABOR itself.

Represent their electrical interfaces deliberately: voltage range, polarity, grounding, and a documented output impedance where relevant. Avoid an invisible, infinitely powerful source accidentally making a bad student circuit appear correct.

Match the actual panel’s controls. For example, do not replace the envelope section with an unrelated generic ADSR interface.

### Component-level fidelity: be explicit about simplifications

User-built circuits should actually be solved electrically, but the first release does not need to reproduce temperature drift, component tolerances, thermal damage, or every detail of a particular transistor.

Each component should expose a short **Model details** section:

> Generic dual op-amp model. Includes supply connections and output limiting. Not a calibrated reproduction of a specific device.

Do not put a manufacturer part number on an idealized model unless the implementation and validation justify it.

Treat the virtual scope as a software instrument alongside the workbench—not as an exact reproduction of the optional physical scope.

---

## 3. Choose a small implementation stack

| Area | Initial choice | Responsibility |
|---|---|---|
| Application | React + TypeScript + Vite | Panels, controls, application lifecycle |
| Workbench | SVG with a shared coordinate system | Breadboard, components, wires, probes |
| Scope | Canvas 2D | Waveform drawing and cursors |
| Document state | Reducer and command-based undo history | Circuit edits and serialization |
| Simulation | `eecircuit-engine`, behind an adapter | Netlist execution and results |
| Execution boundary | Web Worker | Keep simulation work away from interaction |
| Audio | Web Audio `AudioBuffer` playback | Audition completed simulations |
| Persistence | JSON files and a small `localStorage` snapshot | User-controlled saving and recovery |

Use ordinary HTML controls for the inspector, menus, and accessible inputs. The board does not need to become a canvas-only application.

Vite documents worker bundling, and Web Workers provide a separate execution context with message passing. An `async` simulation function alone is not evidence that expensive computation is off the main thread; verify the engine’s actual execution model during the initial prototype. Reuse its worker support where available rather than creating unnecessary nested workers. :chatgpt-content-reference{index="4"}

### Engine selection

**Start with `eecircuit-engine`.** Its documented API exposes initialization, netlist loading, and simulation execution. Build around those verified capabilities first. :chatgpt-content-reference{index="5"}

**Keep `@spice-ts/core` as an alternative to evaluate, not a second production backend.** Its documentation describes browser execution, DC/transient/AC analysis, and streamed results. That makes it a plausible candidate, but it still needs testing against the particular circuits, models, and interaction latency required here. :chatgpt-content-reference{index="6"}

**Use CircuitJS as an interaction and educational reference.** It has a documented same-origin iframe JavaScript interface, but that is different from a standalone, headless TypeScript library. Its GPL licensing also needs to be considered before incorporating its code. Do not make a hidden third-party iframe the foundation of this custom workbench. :chatgpt-content-reference{index="7"}

Only one engine should ship in v0.1. The adapter is a boundary for maintainability, not an invitation to build a simulator plugin system.

---

## 4. Establish the visual direction before adding complexity

### Aim for a workbench, not an engineering dashboard

Use a top-down, mostly flat presentation:

**A charcoal instrument panel, an off-white breadboard, restrained wood framing, clear printed labels, and colored jumper wires.**

Components should look recognizable without requiring photorealistic rendering. Resistors can have bands, capacitors can have polarity markings, and ICs should have a visible notch. Always make the numeric value available without requiring users to decode the artwork.

Avoid perspective, rotating cameras, heavy textures, dramatic lighting, and decorative animation. They would make accurate placement harder without improving the circuit model.

### Layout

Use a compact top toolbar, a collapsible parts tray on the left, the workbench in the center, an inspector on the right, and a resizable scope drawer below.

At a typical laptop size, aim for a roughly 200–220-pixel parts tray and a 260–300-pixel inspector. Both should collapse. The board receives the remaining space.

Default to a useful **breadboard-focused zoom**, not a full-device view in which every hole is tiny. Provide **Fit breadboard** and **Fit LABOR** actions. When zoomed in, selected instrument controls should remain accessible in the inspector or a compact dock.

The scope should never unexpectedly cover the part being edited.

### Visual states

Define these states before drawing many components:

**Normal, hovered, selected, placement preview, invalid placement, electrically highlighted, and measurement target.**

They should have distinct treatments. Selection is not the same as a connected net; a warning is not the same as a negative voltage.

Use labels and line treatments as well as color. Scope channels should have persistent names such as `CH1` and `CH2`, not just cyan and amber traces.

### Knobs

Knobs need a straight-line drag interaction, fine adjustment with a modifier key, keyboard adjustment, and an editable numeric value.

Do not require circular mouse movement.

Implement keyboard and accessible value semantics using the [W3C slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/). The visual knob and the accessible input should control the same parameter. :chatgpt-content-reference{index="8"}

Early visual deliverable: one polished workbench scene containing a resistor, capacitor, IC, jumper, selected net, and scope trace. Approve that visual language before expanding the library.

---

## 5. Make breadboard interaction the strongest part

### Component placement

Support both dragging from the tray and click-to-place. The latter matters for trackpads and precise work.

During placement, show a ghost component and highlight the exact holes its pins will occupy. Rotation should update that preview immediately. A placement commits only when all required pins have valid locations.

For two-lead components, allow a sensible range of lead spacing. For ICs, enforce the selected package’s pin geometry and orientation.

Prevent overlapping physical occupancy rather than silently stacking multiple leads into one hole. Scope probes can be treated as non-occupying measurement attachments.

### Wiring

Use a click-to-start, click-to-finish interaction.

After the first click, highlight the source hole and its existing electrical net. While the pointer moves, highlight the prospective destination and show a preview wire. Intermediate clicks may add visual bends, but those bends are not electrical junctions.

**Crossing wires must not connect automatically.**

A wire’s electrical identity comes from its endpoints, not from its drawn path.

Allow color changes, endpoint movement, and deletion. Keep wire routing simple initially; do not build an autorouter.

### Moving existing parts

Connections should remain attached to breadboard holes.

Moving a resistor to another location should not make unrelated jumper wires chase its legs. Preview the new occupied holes and commit the move as one transaction.

For v0.1, moving individual parts and wires well is more important than sophisticated group transformations.

### Connectivity inspection

Hovering a hole should reveal its coordinate and the connected strip. Selecting a net should highlight all connected holes and jumper endpoints.

Add a **Show breadboard connections** mode that reveals the hidden strips beneath the board.

This is a central teaching feature: users should be able to answer “Why are these two points connected?” without leaving the playground.

### Editing behavior

Use one undo entry per intentional action: placing a part, completing a wire, moving a part, or finishing a knob drag.

Do not create hundreds of history entries during a drag.

`Escape` cancels the current operation, deletion removes the selection, and ordinary undo/redo shortcuts work. Provide visible alternatives to shortcuts.

Keep simulation attached to the last committed circuit while a placement or wire is being previewed. Never simulate a half-completed drag.

---

## 6. Separate the circuit document from the electrical graph

The most important architectural rule is:

> **The UI owns physical placement. The compiler owns connectivity. The simulator owns electrical results.**

A useful separation is:

```text
Circuit document
      │
      ├── Workbench rendering and interaction
      │
      ▼
Connectivity compiler
      │
      ├── Diagnostics and source mapping
      │
      ▼
Electrical netlist
      │
      ▼
Simulation worker
      │
      ▼
Measurements, scope capture, audio preview
```

### Document model

Keep the saved document small and explicit.

| Entity | Essential data |
|---|---|
| Board definition | Hole IDs, coordinates, connected groups, connectors |
| Component definition | Pin names, footprint, parameter schema, model reference |
| Placed component | Stable ID, definition ID, parameters, pin-to-hole placement |
| Wire | Stable ID, endpoint references, bends, color |
| Instrument settings | Oscillator, CV, envelope, and output settings |
| Probe | Channel and physical terminal reference |
| Document metadata | Schema version, board version, title |

Separate temporary interaction state—hover, drag preview, open menus—from the saved circuit.

### Compilation

Build connectivity from the board definition and completed wires. A union-find structure is a reasonable implementation for merging directly connected terminals.

**Do not merge nodes across resistors, capacitors, or other components.** Those become devices between nodes in the netlist.

Give the reference ground a deliberate identity. Do not invent a ground connection merely because a circuit would otherwise be easier to solve.

Generate deterministic device names and retain a source map back to visible parts and holes.

For example, a simulator problem involving `R17` should become:

> R17 has both leads on the same breadboard strip.

—not an unexplained netlist error.

### Probe stability

Store probes against physical terminals, not simulator node numbers. Node numbering can change after an edit; a probe attached to a particular breadboard hole should not jump somewhere else.

After every compilation, resolve that physical attachment to the new electrical node.

---

## 7. Design the simulation behavior honestly

### Start with two analyses

Use **DC operating point** for static voltages and currents, and **transient captures** for waveform behavior.

Keep the netlist and solver controls out of the default interface. A read-only debug panel can expose them for development.

The ngspice documentation should be the reference for analysis commands, source definitions, model behavior, and convergence options. :chatgpt-content-reference{index="9"}

### Make capture semantics visible

The initial controls should be something like:

**Auto update · Capture · Reset · Listen**

With Auto update enabled, a committed circuit or parameter change schedules a new capture. The scope replaces its previous capture when the new result arrives.

This is **interactive recalculation**, not necessarily a continuously running physical timeline.

That distinction matters particularly for capacitors and envelopes. In v0.1, changing a value can restart the capture from its defined initial conditions. State that in the interface instead of pretending charge was preserved through the edit.

Each example should define a startup policy: an operating-point start, an input step, a power-on ramp, or another explicitly specified stimulus. Oscillator startup may require a documented initial perturbation; it must not be replaced with a canned waveform.

### Worker scheduling

Give every simulation request a revision ID. When a result arrives, display it only if it still matches the current circuit revision.

Coalesce rapid edits. During a knob drag, keep the knob responsive and schedule a bounded number of preview calculations; always calculate the final committed value.

Do not queue every intermediate value.

Set limits on execution time, sample count, and model complexity. If a solver gets stuck, terminate and recreate its worker while preserving the user’s circuit. Workers support termination, which makes this a practical recovery boundary. :chatgpt-content-reference{index="10"}

### Explicit result states

The UI needs to distinguish:

**Ready, calculating, stale result, invalid circuit, and simulation failed.**

A previous trace may remain visible while recalculating, but it must be marked as belonging to the previous circuit revision.

On an invalid circuit, do not quietly continue playing old audio.

### Numerical safeguards

Put timestep, tolerances, initial conditions, and device models in a centralized simulation configuration.

Switches and potentiometers need deliberate endpoint behavior. Avoid accidental zero-resistance singularities while documenting any numerical minimum introduced by the models.

On failure, surface the affected area and a useful explanation. Do not automatically “fix” the circuit by adding undisclosed connections or silently changing component values.

---

## 8. Implement a deliberately small component library

Start with resistors, non-polarized capacitors, polarized capacitors, a signal diode, an LED, a potentiometer, a switch, and one generic dual op-amp model.

A transistor can follow once the core interactions and nonlinear-device tests pass. There is no need to fill the tray with dozens of parts immediately.

Each definition should include visual geometry, pin labels, editable parameter constraints, an electrical model, and a short explanation.

For the op-amp, require visible supply-pin connections and a supply-aware model. An unpowered IC should not function because the simulator secretly supplied its rails.

For any named physical package, verify its pin mapping against the manufacturer’s documentation. The [TI TL072 documentation](https://www.ti.com/product/TL072) is one possible reference for a dual-op-amp footprint; using that footprint does not by itself make a generic model a faithful TL072 simulation. :chatgpt-content-reference{index="11"}

### Diagnostics belong in the component experience

Differentiate definite structural errors from model-dependent warnings.

A direct connection between opposing fixed supply rails should block the run. A high estimated resistor dissipation can be a warning with the calculated value. A suspected reversed polarized capacitor should point to its orientation and measured voltage.

Do not simulate dramatic component destruction. Explain the problem and let the user repair it.

---

## 9. Build the instruments around understanding

### Oscilloscope

Start with two channels, independent vertical scales, a shared time scale, autoscale, basic trigger selection for framing captures, and time/voltage cursors.

Display the node being measured beside each channel name. Clicking that name should highlight the corresponding breadboard connection.

For each channel, show a small selection of measurements: minimum, maximum, peak-to-peak, mean, and frequency where a sufficiently regular waveform is present. Otherwise display “frequency unavailable.”

Keep full-resolution results separate from display data. Use an extrema-preserving reduction for drawing so narrow pulses are not simply skipped.

When a time cursor moves, the inspector can show the selected node’s voltage at that exact simulated time. This is more informative than a vaguely changing voltage overlay.

### Meter

Offer voltage relative to LABOR ground and a simple two-point differential measurement.

Show component currents where supported. Leave per-wire current animation out of the first version.

### Audio

Implement **audio preview**, not continuous streaming, first.

Render a short transient, convert its time-stamped output to uniformly spaced audio samples, and play it through an `AudioBufferSourceNode`, which is designed for in-memory audio playback. :chatgpt-content-reference{index="12"}

Do not treat an adaptive solver’s output rows as evenly spaced PCM. Build an explicit resampling stage with an appropriate timestep and anti-aliasing policy.

For periodic output, allow looping only after selecting a suitable steady-state region. Do not loop an arbitrary capture and introduce a click every time it wraps. One-shot envelope examples should play once.

Keep monitor processing separate from circuit measurements: DC removal, listening gain, and an output limiter must not alter the voltage shown on the scope.

Start muted, use a conservative listening level, and provide an always-visible Mute control. Browser autoplay restrictions are another reason to initialize or resume audio from a deliberate user action. :chatgpt-content-reference{index="13"}

Defer AudioWorklet-based streaming until there is a proven requirement and a tested simulation pipeline that can meet it; AudioWorklet is the browser mechanism for custom low-latency audio processing, not a guarantee that a circuit solver can keep up. :chatgpt-content-reference{index="14"}

---

## 10. Use five small examples to shape the product

| Example | Main lesson | What it exercises |
|---|---|---|
| Voltage divider | Resistance ratios and node voltage | Placement, values, meter |
| RC low-pass filter | Frequency-dependent behavior | Oscillator, scope, audio preview |
| Diode clipper | Polarity and nonlinear behavior | Diode model, waveform inspection |
| Simple charging/decay circuit | Capacitor state over time | Triggered capture and cursors |
| Op-amp buffer or gain stage | Feedback and supply connections | IC placement and powered models |

Make an oscillator circuit a stretch example after startup and nonlinear convergence are validated.

Each example should contain the circuit, instrument settings, probe locations, a few original explanatory sentences, and one suggested experiment.

Avoid a lesson framework. A short panel with **What to change**, **What to observe**, and **Why it happens** is enough.

Add a restore-example action, but never reset the user’s edits merely because they reopen the instruction panel.

A particularly useful usability test is a deliberately misplaced wire: can a new user identify and repair it with the connectivity tools?

---

## 11. Keep saving simple and entirely local

Use three persistence mechanisms:

**In-memory document state** while editing, **a small browser recovery snapshot**, and **explicit JSON import/export**.

Store only circuit documents and settings in `localStorage`, not waveform arrays or rendered audio. `localStorage` persists across normal browser sessions, but access can be blocked and private-session data has different lifetime behavior, so the application must work without it. :chatgpt-content-reference{index="15"}

Label this honestly:

> Browser recovery copy saved. Export a file to keep a separate copy.

Give the JSON document a schema version. Validate imports before replacing the current circuit: allowed component types, finite values, valid terminal references, unique IDs, document size, and component-count limits.

Do not permit arbitrary scripts, external model URLs, or unrestricted SPICE directives in the project format.

Ship examples, models, and artwork as static application assets. There should be no simulation service, database, authentication system, or server-side project API.

Use original vector artwork and link to reference manuals rather than bundling their contents by default. Review licenses for the exact engine build, bundled models, and reused assets before publishing.

---

## 12. Build in milestones with clear exit tests

A reasonable planning allowance is **about five to seven weeks for one experienced frontend developer with access to circuit-modeling help**. This is an estimate, not a promise; engine integration and model validation are the largest uncertainties.

| Milestone | Work | Exit test |
|---|---|---|
| **1. Technical proof** | Verify hardware references; run divider, RC, diode, and op-amp netlists in the browser; test worker behavior and result extraction | A real waveform appears, interaction remains responsive, and a failed run is recoverable |
| **2. Visual workbench** | Establish tokens, board geometry, parts, wires, knobs, selection states, and layout | One example looks and feels coherent at laptop size |
| **3. Breadboard editor** | Placement, wiring, snapping, occupancy, pan/zoom, inspection, undo/redo | A user can build the divider from an empty board |
| **4. Compiler and simulation UX** | Connectivity, source maps, diagnostics, revision handling, captures, parameter editing | Editing the RC circuit reliably changes the measured result |
| **5. Instruments and examples** | Scope, meter, audio preview, five examples, JSON saving | The complete first-user journey works without developer tools |
| **6. Hardening and polish** | Cross-browser checks, accessibility, performance, error recovery, usability sessions | The release criteria below pass |

### Test electrical behavior separately from appearance

Include analytical fixtures. For example:

A 5 V source and two equal 10 kΩ resistors should produce 2.5 V at the midpoint.

For an RC step response with \(R=10\,\text{k}\Omega\) and \(C=100\,\text{nF}\):

\[
\tau=RC=1\,\text{ms},
\qquad
V_C(\tau)=5(1-e^{-1})\approx3.16\,\text{V}.
\]

Compare browser results with those expectations and with native ngspice using the same models. Native ngspice here is a development/test tool, not a runtime backend.

Also test the compiler independently: rail breaks, the breadboard trench, non-connecting wire crossings, duplicate endpoints, both resistor leads on one strip, rotated ICs, and probe attachment after recompilation.

### Performance acceptance targets

Treat these as targets to measure on a recorded reference laptop and browser:

**Smooth dragging near 60 fps; updated scope results within roughly 150–250 ms for small, warmed-up examples; audio preview preparation within about one second for supported examples; and recovery from a stuck simulation without losing the circuit.**

When a calculation exceeds those targets, show useful progress. Do not conceal a slow solver behind fake live animation.

### Usability acceptance targets

Test with a few people who did not build the application.

A first-time user should be able to change the loaded example and see a result within 30 seconds, construct a divider within a few minutes, identify what a scope channel is measuring, repair one misplaced wire, and export then restore a circuit.

The application should also survive unavailable browser storage, malformed imports, invalid wiring, repeated undo/redo, an audio context that is suspended, and an intentionally failed simulation.

---

## Reference material

These are the sources I would keep beside the implementation:

| Reference | Use |
|---|---|
| [Erica Synths LABOR product and downloads](https://www.ericasynths.lv/edu-diy-labor/) | Hardware features, manual, project material, and interface-board templates |
| [Moritz Klein Instruments](https://moritzkleininstruments.com/) | Hardware presentation and educational design reference |
| [CircuitJS live simulator](https://www.falstad.com/circuit/) | Interaction patterns and qualitative circuit exploration |
| [CircuitJS JavaScript interface example](https://github.com/pfalstad/circuitjs1/blob/master/war/jsinterface.html) | Understand its actual embedding capabilities |
| [EEcircuit engine](https://github.com/eelab-dev/EEcircuit-engine) | Initial browser simulation integration |
| [spice-ts](https://github.com/mfiumara/spice-ts) | Alternative TypeScript engine to benchmark if needed |
| [ngspice documentation](https://ngspice.sourceforge.io/docs.html) | Netlists, models, analysis settings, and convergence |
| [MDN: Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) | Execution isolation, messaging, and termination |
| [MDN: AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode) | First-version audio playback |
| [W3C: Slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) | Accessible knob and parameter controls |

**The first implementation is successful when placing a component, connecting it, measuring it, and understanding the result feel like one coherent activity.** A small circuit playground that does those things exceptionally well is a better foundation than a broad simulator whose breadboard is awkward or whose measurements are hard to trust.