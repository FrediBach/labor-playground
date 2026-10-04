# Working on Pico Labor

Pico Labor is a local, browser-based circuit workbench built with React, TypeScript, Vite, and ngspice/WASM. Prioritize correct electrical results, compatible saved projects, and responsive, accessible editing.

## Find the right place first

- Read [docs/architecture.md](docs/architecture.md) for the module map, runtime flow, and decisions to preserve. Follow its links to the relevant implementation and tests before changing behavior.
- Use [README.md](README.md) for setup and user workflows. Domain references live in [docs/engine-notes.md](docs/engine-notes.md), [docs/hardware-spec.md](docs/hardware-spec.md), [docs/pico-runtime.md](docs/pico-runtime.md), and [docs/automations.md](docs/automations.md).
- `plan.md` and `docs/*-plan.md` record design history and deferred work. Check their claims against current code and tests; they are not blanket instructions to implement a roadmap.
- Search for the domain symbol and its tests with `rg` before adding a helper or abstraction. Extend the existing owner of a behavior.

## Preserve the boundaries

- **Document → compiler → simulation:** `circuit.ts` owns the document schema, physical terminals, validation, and connectivity compilation. UI components edit documents; the compiler resolves nets; the solver supplies electrical results. Reuse those paths instead of deriving connectivity or voltages in UI code.
- **Durable state:** use `useDocument` for undoable document changes and its source-session API for Pico editing. Keep viewport, selection, playback, and worker state outside the saved document. Preserve supported schema versions, validation, import/export, recovery, and manual folder-sync behavior.
- **Execution:** keep ngspice and Pico emulation in their workers. Preserve cancellation, revision/run ownership, semantic fingerprints, and resource limits. Outdated or partial electrical captures must not appear current; cosmetic edits must not trigger a solve.
- **Measurement integrity:** retain adaptive solver samples and unavailable/error states. Do not replace missing measurements with zero, loosen numerical tolerances to hide regressions, or add hidden wiring to make a circuit solve. Audio processing must not alter electrical measurements.
- **Playback and performance:** subscribe to the recording store only where values animate. Keep expensive work out of pointer/playback updates and retain the cached waveform/overlay split. See [docs/performance.md](docs/performance.md).
- **Automation and Pico:** use the shared flow evaluator for browser captures and circuit tests. Preserve continuous solver trajectories and simulation-time ordering. Pico simulation is output-only; physical USB upload is a separate, explicit user action.

## Make maintainable changes

- Keep changes scoped to the requested behavior. Put reusable domain logic in the existing `src/lib/` modules and UI behavior in the relevant component; avoid growing `App.tsx` with new model or solver logic.
- Follow nearby TypeScript and CSS conventions. `@/` resolves to `src/` in the app. Modules used by Node tests or CLI scripts need Node-resolvable relative imports with `.ts` extensions; do not introduce browser-only dependencies into those paths.
- Preserve keyboard operation, focus, accessible labels, and text-editor shortcut isolation when changing interactions. A drag gesture should remain one undoable edit where the existing control uses that convention.
- For behavior changes, add or adjust focused regressions that exercise the observable contract. Use real ngspice fixtures for electrical changes and browser tests for interaction/lifecycle changes. Prefer analytical expectations and justified tolerances over snapshots of incidental implementation details.
- Treat lint, type, and React Doctor findings as evidence to investigate. Fix issues introduced by the change; do not silence rules broadly or mix unrelated cleanup into the task. Existing Doctor findings are tracked incrementally.

## Verify the affected behavior

Use Node 24 (`nvm use`) and the checked-in npm lockfile (`npm ci` for setup). Commands come from [package.json](package.json).

| Check | Command |
| --- | --- |
| Lint and application types | `npm run lint` and `npm run typecheck` |
| Focused unit/numerical tests | `node --experimental-strip-types --test tests/circuit.test.ts` (substitute affected files) |
| Full unit/numerical suite | `npm test` |
| React diagnostics | `npm run doctor` (`-- --verbose` for details) |
| Production bundle | `npm run build` |
| Focused browser workflow | `npm run test:e2e -- tests/e2e/workbench.spec.ts` (substitute affected specs) |
| Saved circuit-test regression | `npm run test:circuit -- docs/examples/automation-regression.json` |

For code changes, run lint, typecheck, and the affected tests. Use the full unit suite for shared compiler/runtime changes, browser checks for UI behavior, Doctor for React changes, and a build for bundling/worker/asset changes. Typecheck currently covers `src/` and Vite config, so it does not replace running tests or scripts.

Playwright needs Chromium (`npx playwright install chromium`) and starts its own server on port 5177. For production browser checks, build first and set `LABOR_PRODUCTION=1`. Specs using `/tests/*-harness.html` require `npm run build -- --mode test`; an ordinary build excludes those entry points. See [playwright.config.ts](playwright.config.ts) and [vite.config.ts](vite.config.ts).

For documentation-only changes, verify claims, commands, and links against the repository and run `git diff --check`; application suites are unnecessary unless runtime files also change. Report checks actually run and any unresolved failures.

## Keep decisions discoverable

When changing a boundary, schema, numerical assumption, or execution contract, update [docs/architecture.md](docs/architecture.md) and the relevant domain guide in the same change. Record the reason, compatibility implications, and regression coverage. Mark replaced decisions as superseded instead of leaving contradictory guidance. Keep this file concise; detailed rationale belongs in the architecture guide.
