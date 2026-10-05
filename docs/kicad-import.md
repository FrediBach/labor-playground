# Import KiCad schematics

Use **Import** (Ctrl/Cmd+O) and select a `.kicad_sch` file. The importer supports self-contained, flat single-sheet schematics with embedded symbol definitions. Legacy `.sch` files must first be opened and saved in KiCad as `.kicad_sch`; keep their symbol libraries available during conversion.

The review dialog leaves the current project untouched until **Confirm and import**:

1. Review each suggested Labor component. Known library identifiers receive suggestions; other symbols start unmatched. Search by component name, type, or description to select a replacement from the Labor catalog. Existing suggestions can also be changed.
2. Verify the value in the displayed base unit. Passive engineering notation such as `4k7`, `100nF`, and `10 kΩ` is converted. Unrecognized passive values require an entry. Other components use the Labor model's default setting, shown for review. Expand **Model assumptions** to check the selected approximation.
3. Verify pin assignments. Pin names help match polarized devices and transistors; other pins initially match by physical number. Every KiCad pin must map to one Labor pin. Extra Labor pins may remain unconnected; the importer does not invent their connections.
4. Explicitly assign any named nets to ground, ±12 V, CV, signal, or envelope sources. Names such as `GND` and `VCC` preserve connectivity but do not automatically attach a workbench supply. CV initially supplies +5 V. Unnamed nets can be wired to instruments after import.
5. Confirm. The importer arranges components on a 60-column, three-row board and adds visible jumpers. Undo restores the previous project as one action. Cancel or Escape makes no document changes.

## Electrical and compatibility contract

The [import module](../src/lib/kicad-import.ts) converts KiCad geometry into nets before creating an ordinary `CircuitDocument`. The document is checked by `validateDocument`, then the existing compiler and solver own its electrical behavior. There is no new saved schema, external library fetch, arbitrary SPICE execution, or imported firmware.

Wires connect through endpoints, symbol pins, labels, and explicit junctions. Bare wire crossings do not join. Repeated labels join their nets. Embedded pin coordinates honor symbol rotation and mirroring. Multi-unit symbols combine by reference with physical pin numbers retained; repeated pin numbers across units denote the same physical terminal. Power symbols and hidden power-input pins supply net names, not voltage. `PWR_FLAG` does not create a source.

Every placed pin receives an isolated breadboard strip, including unconnected pins. Jumpers use spare holes on those strips. This conservative layout preserves topology and may run out of space before the project part limit. Parts retain their KiCad references; unsupported reference syntax is reported by project validation. Electrical compiler diagnostics, including missing ground or supply connections, remain visible after import.

Hierarchical sheets/labels, buses, unresolved inherited/library symbols, conflicting multi-unit definitions, and oversized files fail explicitly rather than producing a partial circuit. The importer accepts files up to 2 MB, with bounds on nesting, tokens, wire segments and connection points; resulting documents retain the normal part, wire and saved-project limits. Schematic artwork, coordinates, footprints, custom simulation models, and no-connect annotations are not saved. Pins without wires remain electrically isolated. Imported models are Labor approximations, not vendor SPICE models.

The parser follows the [KiCad schematic format](https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/) and [symbol format](https://dev-docs.kicad.org/en/file-formats/sexpr-intro/). Regression coverage includes [connectivity, matching, parsing and real ngspice results](../tests/kicad-import.test.ts) and [review, correction, cancellation and undo](../tests/e2e/kicad-import.spec.ts).
