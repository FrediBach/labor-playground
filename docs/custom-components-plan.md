# Custom components implementation plan

Status: implemented on 2026-10-02. The architecture findings below record the pre-implementation audit against revision `6947c79`. Both custom characteristic families now use permanent engine fixtures, schema 3 definitions, the editor/library workflow, and portable project storage. Verification evidence is recorded at the end of this document.

Let users create named, reusable components with their own electrical characteristics, beginning with resistance versus current and capacitance versus voltage. Definitions belong to the circuit project, appear in the parts library, and travel with exported circuits.

**Architecture verdict: feasible with targeted extensions.** The existing ngspice engine can express these behaviors, and the worker, topology, placement, history, and persistence infrastructure can be reused. The implementation extends the schema, compiler, library, and measurement logic to accept custom definitions. An engine replacement or general plugin runtime is not indicated by this audit.

## Pre-implementation architecture findings

| Area | Verified current behavior | Consequence for implementation |
| --- | --- | --- |
| Component data | [`circuit.ts`](../src/lib/circuit.ts) defines a closed `ComponentKind` union, static `PARTS` metadata, and `Part.value` as one number. `validateDocument` rebuilds known fields and discards extra properties. | Adding curve fields to imported JSON today does not create a custom model. Introduce explicit, validated definitions and references. |
| Electrical compilation | `compileCircuit` emits fixed resistor and capacitor statements. It already generates behavioral sources for automated controls, op-amps, and the [`LM13700`](../src/lib/lm13700.ts). | Reuse generated ngspice models, with a separate adapter for each supported characteristic. |
| Simulation boundary | [`simulation.worker.ts`](../src/lib/simulation.worker.ts) runs the pinned `eecircuit-engine` 1.8.0 package in a worker. [`simulation-analysis.ts`](../src/lib/simulation-analysis.ts) performs separate operating-point and transient analyses and recompiles automation passes. | Evaluate characteristics inside the solver on every solve step. Carry identical model semantics through both analyses and every automation pass. |
| Connectivity and geometry | `resolveTopology`, `getPlacement`, `isValidFootprint`, and [`part-editing.ts`](../src/lib/part-editing.ts) already support two-lead passive parts. DC-path checking distinguishes resistors from capacitors. | Retain base kinds and existing footprints. A custom resistor conducts at DC; a lossless custom capacitor remains open at DC. |
| Measurements | [`simulation-descriptors.ts`](../src/lib/simulation-descriptors.ts) describes fixed resistor currents as voltage divided by `Part.value`. [`recording.ts`](../src/lib/recording.ts) and [`simulation-results.ts`](../src/lib/simulation-results.ts) consume those descriptors. [`RecordedMeasurements.tsx`](../src/components/workbench/RecordedMeasurements.tsx) uses `0.5 * C * V²` for capacitor energy. | Custom parts need actual solved branch currents and model-aware energy. Reusing scalar formulas would display incorrect results. |
| User interface | [`PartsLibrary.tsx`](../src/components/workbench/PartsLibrary.tsx), [`Breadboard.tsx`](../src/components/workbench/Breadboard.tsx), and [`App.tsx`](../src/App.tsx) carry a component kind as the placement selection and drag payload. [`Inspector.tsx`](../src/components/workbench/Inspector.tsx) assumes scalar values and presets. | Add model identity to placement and inspection while retaining existing artwork and lead editing. |
| Persistence and history | [`use-document.ts`](../src/lib/use-document.ts) stores document snapshots and browser recovery; [`use-directory-sync.ts`](../src/lib/use-directory-sync.ts) validates folder imports. [`simulation.ts`](../src/lib/simulation.ts) uses the serialized document to invalidate results. | Embedded definitions fit these mechanisms. Keep incomplete editor drafts outside the document and commit each saved edit atomically. |

### Engine evidence and remaining uncertainty

Temporary probes used the installed engine without changing application code. Its ngspice version is documented in [engine-notes.md](engine-notes.md) as 45.2.

| Probe | Observed result |
| --- | --- |
| Current-dependent resistor with a series zero-volt sense source and behavioral voltage source, `V = I * (1000 + 100000 * abs(I))` in SI units | Separate operating-point solves at +5 V, −5 V, and 0 V returned approximately +3.660254 mA, −3.660254 mA, and 0 A. A 1 kHz, 5 V peak transient completed 2 ms with 2,008 points and a maximum law residual of approximately 96 µV at default solver tolerances. |
| Charge-defined capacitor, `Q = 1e-6 * V + 0.5e-6 * V * V`, exercised from 0 to 2 V | Operating-point current was zero at 0 V. A 2 ms voltage ramp completed with 2,011 points; measured current followed `(1e-6 + 1e-6 * V) * dV/dt`, with maximum error approximately 2.94 µA at default tolerances. |
| Current extraction | Explicit sense-source currents were available as `i(vsense)`. Requesting the charge-defined capacitor's presumed `@Ccustom[i]` vector during an operating-point probe failed and left the wrapper pending until the probe watchdog ended it. Do not assume behavioral capacitors expose the ordinary capacitor's internal vector names. |
| Existing capture pipeline | Both model arrangements also completed through `runCircuitCapture` and `sampleRecording` using existing `saved-current` descriptors, with current and power extraction. This did not require a new worker protocol or current/power result type. |

These probes establish engine feasibility for simple laws. They do not establish arbitrary point-table convergence, browser integration, or performance at project limits. Milestone 1 below must turn this evidence into permanent fixtures through the application capture path.

The official [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf), sections 3.3.4, 3.3.9, and 5.1, documents behavioral resistors, charge-defined capacitors, and nonlinear sources. The consulted manual is development version 47+, newer than the bundled engine; the installed-engine probes establish the narrower compatibility claim here.

## First release scope

Deliver both of these component families through one shared definition and editor system:

| Base kind | User characteristic | Interpretation |
| --- | --- | --- |
| Resistor | Resistance in Ω versus current magnitude in A | `V = I * R(abs(I))`, with positive current from pin 1 to pin 2. The same resistance curve applies in either direction. |
| Non-polarized capacitor | Differential capacitance in F versus signed terminal voltage in V | `C(V) = dQ/dV`, with `V = V(pin 1) - V(pin 2)` and current entering pin 1. |

Support naming, an optional description, an editable point table, a graph preview, placement, assignment to a compatible existing part, duplication, shared-definition editing, and project persistence. A constant curve provides a useful starting template and must reproduce the corresponding built-in ideal component.

Later adapters may add resistance versus voltage, signed-current resistor curves, polarized capacitors, inductance versus current, and device-specific diode characteristics. Thermal dynamics, hysteresis, arbitrary multi-pin packages, user code, raw SPICE/subcircuit import, and a global component marketplace are later projects. A current-dependent resistance curve describes an instantaneous electrical law; modeling heating and cooling requires a separate stateful thermal model.

## Definition and document design

Add a project schema version 3 with optional `customComponents` definitions and an optional `Part.customModelId`. Keep `Part.kind` as `resistor` or `capacitor` for the initial models. Avoid adding a new enum member for every user-created component.

Each definition contains a stable ID, name, optional description, `modelVersion: 1`, a base kind, and a discriminated characteristic. The characteristic records its type, axis interpretation, points in SI units, linear interpolation, and constant endpoint extrapolation. Use a typed union so a resistor cannot reference a capacitance law. Model version identifies the interpretation of saved data; editing a curve changes its contents, not the meaning of that version.

For example, the resistance curve below becomes a reusable definition named **Current-sensitive resistor**:

| Current magnitude | Resistance |
| --- | --- |
| 0 mA | 1 kΩ |
| 1 mA | 1.2 kΩ |
| 5 mA | 2 kΩ |
| 10 mA | 4 kΩ |

The stored points are `(0, 1000)`, `(0.001, 1200)`, `(0.005, 2000)`, and `(0.01, 4000)`. A placed instance keeps its own ID and pins and references the definition. All placed instances referring to that definition share its behavior.

Keep `Part.value` temporarily for compatibility with existing artwork and formatting. For a custom instance it is a derived nominal value, `R(0)` or `C(0)`, maintained by validated document transactions and displayed as nominal. It is neither an independent electrical override nor a hidden curve multiplier. Audit every `part.value` consumer before enabling custom parts, including the 555 timestep estimate in `compileCircuit`; use conservative model bounds where a timing heuristic currently assumes fixed R or C.

Centralize resolution in helpers such as `resolvePartModel(document, part)`, `partDisplayName`, and `partValueSummary`. Add focused modules for definition types/validation, curve evaluation, and model compilation, for example `custom-components.ts`, `characteristic-curves.ts`, and `component-models.ts`. Use a small built-in adapter registry, not a general executable plugin system. Existing built-in compilation can remain behind the current path while these seams are introduced.

### Validation and compatibility

- Continue accepting schema 1 and 2 with their existing electrical behavior. Upgrade to schema 3 when custom definitions are added; support Pico configurations in schema 3 and remove UI actions that would accidentally downgrade it to schema 2.
- Reject custom-model fields under older schema versions, missing references, duplicate definition IDs, incompatible base kinds, unsupported characteristic types or model versions, and malformed definitions. Never silently replace a custom model with a linear part.
- Require finite numbers, strictly increasing independent coordinates, distinct points, and positive R or C. Current-magnitude curves begin at zero; signed-voltage capacitor curves include zero and cover negative and positive voltage. The editor may offer explicit sorting, but validation must not silently change an imported curve's order or meaning.
- Require positive differential resistance throughout every resistor segment: `dV/dI = R(x) + x * dR/dx > 0` for `x = abs(I)`. Check the segment endpoints analytically, including one-sided limits. Positive R alone is insufficient. Decreasing resistance can still be valid when this condition holds; negative differential resistance is outside the first release.
- Propose initial bounds of 32 definitions, 2–64 points per definition, 80-character names, and 500-character descriptions, subject to the first milestone's measurements. Start with the existing base-kind R/C ranges, and establish finite axis and slope bounds in the engine fixtures before exposing them in the editor.
- Preserve the existing 200,000-byte project budget and 30 placed-component limit. Move generic project limits from [`pico/profile.ts`](../src/lib/pico/profile.ts) to a shared module if extending them. Budget exported, formatted JSON as well as compact recovery JSON; account for 80 history snapshots and definition expansion into netlist expressions.
- Generate numeric netlist expressions from validated data. Use application-owned device names derived from `spiceDeviceId`; names and descriptions remain display text. Do not interpolate user strings as expressions, directives, or device identifiers.

## Curve behavior and solver integration

Use piecewise-linear interpolation with constant endpoint extension for both R and C. State this in the editor and preview the extension. When a completed capture goes outside a supplied axis range, report the affected component and range so users know endpoint values were used. Apply exactly the same interpolation semantics in the preview, compiler, and derived measurements.

### Resistance versus current

Compile the law into a series zero-volt current sensor and a behavioral voltage source. Conceptually, for terminals `a` and `b`:

```spice
VSENSE_R1 a internal_R1 0
BCUSTOM_R1 internal_R1 b V = i(VSENSE_R1) * <generated R(abs(i(VSENSE_R1)))>
```

The angle-bracket expression above is a compiler placeholder, not literal SPICE. The engine solves the self-dependent current within its nonlinear iteration. Do not approximate it by changing a linear resistance after a capture or by using the previous recorded sample. Piecewise-linear R produces piecewise-quadratic V(I); interpolating only transformed I/V knot endpoints would change the requested curve. Retain exact zero-current behavior without dividing by I. Prove the chosen piecewise expression syntax, breakpoint handling, and endpoint extension against the installed engine.

The proven smooth-law fixture can be reproduced by replacing the placeholder with `(1000+100000*abs(i(VSENSE_R1)))`, supplying `VDRIVE a 0 5`, and grounding `b`. This analytical fixture has no endpoint clamp; it proves the source arrangement, while bounded point curves need separate tests.

### Capacitance versus voltage

Interpret the user curve as differential capacitance. Construct `Q(V) = integral from 0 to V of C(u) du`, then emit the supported charge-defined capacitor with a series zero-volt current sensor. Integrating piecewise-linear C yields continuous piecewise-quadratic Q. Extend Q linearly beyond the supplied voltage range because C is held constant there; do not clamp charge itself.

Use `I = dQ/dt`. Substituting `Q = C(V) * V` would produce a different differential capacitance, so it is not an acceptable implementation of this editor contract. Keep the current initial-state behavior: each capture starts at its DC operating point, with no retained charge from a previous capture.

Compute stored energy from the same characteristic: `E(V) = integral from 0 to V of u * C(u) du`. The ordinary `0.5 * C * V²` formula remains valid for constant curves only. Implement charge and energy integrals once and test both voltage polarities; do not leave the existing scalar energy display enabled for custom capacitors.

### Compilation and measurements must agree

Have each custom adapter return its netlist fragment, internal identifiers, required saved vectors, measurement descriptors, and relevant model bounds together. Extend `CompiledCircuit` or introduce a shared compilation result so `.save` generation and result decoding use the same source of truth. Avoid another independent chain of kind checks for custom devices.

Use saved sense-source current for both resistor and capacitor models. Compute signed terminal power as `V * I`; a capacitor may return energy. Make the frozen characteristic available to recording measurements for capacitance, nominal/model labels, and stored energy. Do not reinterpret an old recording with newly edited model data.

Update the ordinary capture path and the automation recompilation path in `simulation-analysis.ts`. Any additional worker data must be structured-clone-compatible data, not functions. Preserve current revision checks, Stop/reset behavior, execution deadlines, completion checks, and finite-result checks. Include added vectors in the existing sample and memory budgets, and add bounds for expanded netlist bytes, devices, and internal nodes. Convergence failures should identify affected custom components where the engine exposes a usable device name and retain an actionable circuit-level error otherwise.

## User workflow

1. Choose **Create custom component** in the parts library, then **Resistor** or **Capacitor**. Start from a constant template or duplicate a compatible existing component.
2. Enter a name and edit the characteristic in a numeric table. Show axis names and units, engineering-unit selectors, add/remove controls, a graph, interpolation/extrapolation behavior, and validation beside the affected rows. The table must be fully usable with a keyboard; graph dragging is optional later work.
3. Save the definition to the project and select it for placement. A **Custom components** section supports search by name, description, and base kind. Two custom resistors must remain distinct selections.
4. Place with the existing click or drag workflow. Introduce one shared placement type carrying `{ kind, customModelId? }` and use it in App, PartsLibrary, and Breadboard, including preview and validated drag/drop data. Reset stale selections when undo, import, or deletion removes a definition.
5. Inspect the part to see its model name, curve, nominal value, solved readings, and **Edit model**. Show how many placed instances share the model before saving a shared edit. **Make independent copy** duplicates the definition and reassigns only this instance. Offer compatible model assignment and an explicit return to a linear built-in model at its nominal value.
6. Keep editor drafts local, following the existing automation-dialog pattern. Save is one validated, undoable transaction; Cancel does not change the circuit or trigger simulation. Revalidate the draft against the current project before committing it. A saved change marks prior results stale and follows existing Auto update behavior.

Reuse resistor/capacitor artwork and physical pin order. Add a compact custom indicator and accessible model name; nominal resistor bands must not imply a live resistance reading. Update [`OverviewPanel.tsx`](../src/components/workbench/OverviewPanel.tsx), board labels, inspector descriptions, search, and accessible announcements through the shared model-resolution helpers. Hide scalar presets when they would imply changing an independent custom value.

## Persistence and definition lifecycle

Embed definitions in the document so export/import, browser recovery, folder sync, undo/redo, and simulation snapshots remain self-contained. A receiving browser must not need an external library. Preserve unused definitions when clearing the board; loading another example or importing a replacement project replaces the project's definitions through the existing undoable document action.

Allow deletion of unused definitions. For an in-use definition, show its instances and require reassignment or removal before deletion. Never silently detach instances. Shared edits update the definition and all derived nominal values in one transaction; undo restores both. Storage failure must leave the in-memory project and export available.

Cross-project reuse initially works through exporting/importing a circuit containing its definitions. Standalone component files and a personal library can follow with a separate versioned format and explicit ID-collision handling; they are not dependencies for the first release.

## Implementation sequence and acceptance gates

### Milestone 1 Prove bounded characteristic models

- [x] Add permanent real-engine fixtures for both source arrangements through `runCircuitCapture`, including `.op`, transient recording, and saved current extraction.
- [x] Verify constant curves against built-in R/C behavior; verify increasing and valid decreasing R(I), both current signs, zero crossings, exact knots, and endpoint extension. Include multiple custom parts sharing a definition and parts whose terminals are bypassed onto one net.
- [x] Verify C(V) charge and energy integrals, both voltage signs, nonzero initial DC bias, charge/discharge, and breakpoint crossings. Compare integrated measured current to change in Q and integrated power to change in E with documented numerical tolerances.
- [x] Exercise minimum/maximum R/C, narrow segments, axis bounds, 64-point curves, and a 30-part mixed circuit. Select tested slope/axis/compiled-size limits and check shorter timesteps produce consistent results. Measure 100 ms and long captures against existing resource limits.

Gate: each first-release law has a working bounded model with reliable measurements. If one cannot meet this gate, document the actual limitation before proceeding with its editor; do not silently substitute a constant model or change the curve meaning.

### Milestone 2 Add definitions and model resolution

- [x] Implement schema 3, typed definitions, validation, model lookup, curve evaluation/integrals, and centralized limits.
- [x] Add tests for legacy schema 1/2 behavior, schema 3 with and without Pico, unsupported versions, bad references, malformed/oversized data, and prevention of schema downgrade.
- [x] Add atomic operations for definition creation/edit/duplication/deletion, instance assignment, and derived nominal values. Verify serialization and history round trips.

Gate: definitions survive every document boundary and invalid data cannot fall back to built-in behavior.

### Milestone 3 Integrate compilation and recordings

- [x] Implement custom adapters and compile saved vectors with measurement descriptors; update direct and automation capture paths.
- [x] Replace scalar assumptions for custom current, energy, model descriptions, and timing estimates. Verify DC topology, internal-name isolation, both pin orientations, and missing/nonfinite-vector failures.
- [x] Test revision invalidation, worker cancellation/recovery, resource limits, and a mixed circuit with built-in parts, Pico outputs, and automations. Automations continue to drive existing controls; editing a definition during a capture is not a new automation target.

Gate: the workbench reports the same electrical behavior as the numerical fixtures in both operating-point and recorded views.

### Milestone 4 Build the editor and library workflow

- [x] Add the accessible table/graph editor, validation, shared placement state, custom library entries, and compatible instance assignment.
- [x] Update inspector, board labels, Overview, and measurement presentation. Implement shared edit versus independent copy and the definition deletion/clear-board rules.
- [x] Add browser tests for keyboard creation, invalid drafts, Cancel/Save/Undo, two same-kind models, click/drag placement, lead movement, long names, definition edits with stale results, and correct nonlinear readings.

Gate: a user can create the example R(I) curve, place and wire it, simulate it, edit it, and undo the edit without losing its identity or showing linear-model measurements.

### Milestone 5 Verify portability and document the feature

- [x] Verify export/import in a fresh browser, recovery, and folder synchronization preserve definitions and behavior, including conflicts, clear-board, and undo after project replacement.
- [x] Add educational examples for current-dependent resistance and voltage-dependent capacitance, with expected observations and visible model limits.
- [x] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`; run targeted Playwright coverage against the production bundle. Extend the existing parts-library, components, lead-editing, overview, project-tools, measurements, and inspector-signals suites where appropriate.
- [x] Update README, engine notes, and the user guide with the supported laws, units, endpoint behavior, sharing semantics, numerical bounds, and measured limitations.

Release is complete when both characteristic families pass these gates, legacy circuits retain their behavior, and exported projects reproduce the custom models without external dependencies.


## Implementation evidence

- Definition validation and atomic lifecycle operations: `src/lib/custom-components.ts`; shared project budget: `src/lib/project-limits.ts`.
- Shared interpolation, charge and energy integrals: `src/lib/characteristic-curves.ts`; solver fragments, current vectors and frozen measurement descriptors: `src/lib/component-models.ts`.
- Permanent real-engine and boundary fixtures: `tests/custom-components.test.ts`, including 30 mixed shared instances, 64-point curves, minimum/maximum R/C, bounded slopes/axes, signed integration, timestep refinement, and Pico output with automation recompilation. Existing worker scheduling, timeout and recording tests cover the unchanged transport.
- Production browser coverage: `tests/e2e/custom-components.spec.ts` and the custom folder-conflict case in `tests/e2e/project-tools.spec.ts`; regression coverage includes components, parts library, lead editing, overview, measurements and inspector signals.
- Educational examples: **Current-sensitive resistor** and **Voltage-sensitive capacitor**. Supported laws, limits, sharing and recovery are documented in README, the in-app guide and `docs/engine-notes.md`.
- The 30-part, two-definition fixture generates 335,352 netlist bytes. A measured 100 ms capture used 1,044 samples (~421 ms); a 10 s capture used 18,454 samples (~7.2 s). These are local measurements, not worst-case guarantees. Existing deadlines and recording budgets remain enforced; netlist expansion is capped at 1 MB, 1,000 devices and 300 internal nodes.

Final verification: `npm test` passed 209 tests; `npm run lint`, `npm run typecheck`, and `npm run build` passed. All 37 targeted production Playwright checks passed (36 in the regression run, with the remaining nonlinear-DC test passing after correcting its selection action). Desktop and mobile editor screenshots were inspected. The build retains the existing large-chunk advisory for the editor bundle.
