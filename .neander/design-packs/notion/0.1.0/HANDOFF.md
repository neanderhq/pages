# Notion framework handoff

Use the versioned `NotionFramework` shell and one `pack.css` entry. Follow [the React contract](components/react/README.md) and [pack usage instructions](SKILL.md). All 97 delivered files are canonical reusable code/styles/provenance. Catalog reference state, screenshot crops and fixture localStorage are excluded from application delivery.

The pack uses sixteen adapted official shadcn New York source components at commit `9253b43f29e6f54e20e7d2e10647f0755753f6b0`; the MIT license and original checksums are in ui/. Shared React/Radix behavior, themes and layer context underlie all compositions. Product block editing and hierarchy/board sorting are custom because shadcn does not supply those domain behaviors; sorting uses pinned dnd-kit.

Reusable coverage now extends beyond the original seven compositions: Home, Settings, Inbox, Templates, Discussions, History, covers/structured blocks, typed database properties, nine database layouts, linked views and forms. Reuse these modules inside content/header/inspector/children slots rather than constructing a second shell. The navigation model supplies selected IDs and sidebar content. Every write is semantic and host-confirmed; missing callbacks disable or hide capabilities. Keep dirty-editor navigation inside `useNotionNavigationGuard`. Custom composed editors should register `useNotionSaveGuard(id, save, draftRevision)`, using a stable revision value that changes with their draft or pending operation. The shell drains newly registered revisions before executing navigation, including edits made while another editor saves.

The host owns storage, authorization, records, schema/query/computed values, revisions, notifications, invitations, account/OAuth, file conversion/storage, publication, AI, recording and concurrent conflict handling. Local fixture acceptance is not external delivery or a production service. See [surface coverage](SURFACE_INVENTORY.md) and [current QA](design-qa.md) for concrete limitations. Do not describe this reference pilot as complete Notion parity or production-ready.

The catalog host duplicates a record page and its property rows in the parent database views together. Trashing records archives their rows and incident timeline dependencies, leaving live view definitions editable. Undo restores a dependency once both endpoints are present; pending edges remain with the still-trashed endpoint, and consumed archives cannot resurrect connections removed after undo. These helpers remain excluded from application delivery.

The reference host supports ordinary page and whole-database reparenting. It rejects moves that would transfer individual records across database boundaries, including moving ordinary pages into a database, preserving the page parent, rows, property values and incident dependencies. Production hosts may support those semantic move intents through an atomic row/schema/dependency transfer; the catalog does not approximate that transaction by changing only `parentId`.

The catalog formula evaluator decodes number and checkbox properties before evaluating operators, preserving text properties and empty numeric inputs. Computed dependencies, including related-record rollups, resolve on demand before their consumers; cycles reject the write without publishing partial values. Board moves preserve unrelated memberships and identify the source group for cross-group replacement. Native cross-block clipboard/deletion operations retain the complete selected block span, including enclosed media and nested payloads; text formatting uses its separate rich-text ranges. Partially selected containers retain unselected descendants.

Conditional and logical formulas parse every branch but evaluate only the active branch. Relation choices and labels use the current host-supplied relation sources in database views and record properties; embedded choice metadata remains available to hosts that supply it without live sources. Removing a target from the choices does not silently erase existing relationship values.

The in-app and public form hosts resolve those same current relation records before validating submissions. Database copies retain form definitions but clear publication and URL metadata; explicitly publishing a copied form creates a link targeting the copy, leaving the original form unchanged.

Computed formula and rollup dependencies keep numeric, boolean and text results in the existing resolver; only persisted/display values are serialized. Formula previews use the same resolver as accepted writes.

Numeric rollups omit unanswered values while retaining actual zeroes; record counts still include all related records. Document history preserves current parentage and database definitions/records; it does not roll back schema, membership, dependencies or Trash. Restoring a record's page history updates its row title in every database view in the same write, so computed names and live relation labels follow the restored title.

The completion pass adds 21 Settings destinations, a shared presentation-preferences context, nested block authoring, safe rich paste/merge, computed-property configuration, nested queries, column geometry/calculations, chart configuration, timeline ranges and typed import parsers. Use the updated README signatures. The preview's formula host stays excluded from delivery. A host must authorize and compute formulas/relations/rollups and accept timeline range writes atomically; rendering a configured field is not a substitute for that service.


Conditional forms now include schema-backed question creation/duplication/removal, names/descriptions, answer presentation, limits, branching and visible-only validation. Supply the atomic form-definition and view-specific submission callbacks described in the React README. Capability, current-schema validation, access/publication and durable writes remain host-owned. The November 5 QA section distinguishes actual Mobbin form-builder evidence from the unmatched conditional configuration panel.


The November 5 conditional/dark pass adds source-shaped question options, canonical linked-property editing, inline choice authoring with deletion confirmation, saved-rule reopening and explicit rule removal. Referenced answers/questions are protected from silent dependency loss. Form-only hosts use the metadata callback described in the React README; absent atomic schema capability keeps schema actions disabled. The dark document now has a distinct callout token. Mobile sidebar openers and editor selection dismissal share the shell's navigation rules. Actual dark-document and question-options sources are retained under `nov5/conditional-dark/`; exact branch-rule/dark-toolbar visual identity remains unverified.


The branch/toolbar follow-up makes branch sessions transactional across targets and stages removals with Undo. The shared source-aligned color grid is collision-aware and keyboard reachable. Toolbar/child palette portals stay owned by a center peek; source selection survives control focus and nested Escape. See the React README for the direct branch-editor batch callback and optional Popover portal container. Exact branch-dialog and dark selected-text source identity is still unverified; local functional checks are separate evidence.

Multi-value form callbacks retain the `Record<string,string>` boundary. Values with commas, leading `[` or surrounding whitespace are encoded as JSON string arrays; ordinary selections retain the existing comma-separated representation. Hosts should decode with `notionFormSelections` and encode with `encodeNotionSelections` from `NotionFormModel`. The canonical form validation, property editor, alternate views, charts and reference rollups share this decoding.

Chart grouping keeps unanswered properties separate from literal text such as `Empty`. Group keys, including `hiddenGroups`, are opaque identities produced by the chart controls; hosts should round-trip them unchanged rather than deriving them from display labels. Ordinary values keep their supplied option/color identities. The literal label `Empty (value)` distinguishes it from the unanswered `Empty` group.

The pack declares compatibility with the existing `shadcn@1.0.0` project foundation. Normal catalog/adoption eligibility remains backend-owned; installation requires the matching initialized foundation and preserves customer edits on later turns. Refs accept both React 18 and React 19 types; the existing foundation catalog build type-checks the delivered framework against React 19. Scoped Notion source adaptations remain documented above.

Schema renames update literal formula property references in the same host transaction, without changing quoted text. Subtree copies remap internal relation databases, metadata and selected records while retaining external links. Chat Close/New chat use the existing save/navigation guard, including draft rejection and pending-send completion.

Read-only toggle expansion is local presentation state in each flat-list owner. Locked pages and version previews reveal descendants without changing document drafts, creating history or requesting persistence; editable expansion retains its existing saved behavior.

Locked database pages render the existing read-only title; unlocking restores the host-backed rename control. The lock transition still flushes pending title edits through the existing guard.

Gallery, list, feed and calendar property cards apply saved visibility and order independently of record data. Hiding a calendar date property removes its label while preserving date-based placement.

Boards retain display groups for existing values removed from select/status metadata instead of hiding their records. Database search keeps raw-ID matches and includes person names/current relation titles from the same label resolver used for display.

Structured paste replaces active keyboard or native-text selections in one draft write. It retains unselected endpoint runs and descendants, regenerates clipboard identities and adopts destination indentation; pasting without a selection retains branch-aware insertion.

The reference host rejects restoring a child while its parent remains in Trash. Restore the parent first; rejection changes no pages, trash items or row archives, and parent restoration reconciles the complete branch and saved record properties/dependencies.

Boards without a group property or legacy group definition show the existing cards and creation control in one All records group. This representation does not infer or rewrite a grouping property; adding a Board from a table and changing a table layout remain usable, including empty databases.

Structured block paste is scoped to an owned rich-text editor or its block-selection root. The rich-text target must identify an actual block in the owned document; simple-table cells keep their own rich-text and tabular-paste handlers. Titles, code text, language fields, media URL/caption inputs and other auxiliary text controls retain native plain-text paste even when the clipboard also contains copied blocks.

The catalog host parses formula definitions even for empty database schemas before accepting a transaction. Syntax, builtin signatures and literal property references are checked without evaluating row-dependent arithmetic; normal per-record computation and lazy guarded branches remain in place. Rejected property saves retain the existing editor draft and leave persisted pages unchanged.

Creating a record from a board encodes person, relation and multi-select group assignments with the shared selection serializer; commas in a single ID/option remain one membership. Select/status assignments remain scalar and the unassigned group stores an empty value.

The reference host rejects schema changes that would invalidate a saved form's explicit questions or conditions before persisting the columns. Remove or retarget the affected question/conditions in the form builder first, then delete the property; rejected writes preserve both schema and form configuration.

Computed-row publication preserves absent base-property keys instead of materializing empty strings, so hidden conditional-form answers remain omitted. Computed results and explicitly supplied empty values still persist normally.

Computed schema validation walks literal formula dependencies and value-reading rollup dependencies across databases before row computation, including empty databases; self/mutual cycles reject the write without evaluating arithmetic. Count rollups depend on membership rather than computed source values. Both table schema edits and form-designer schema edits share all-saved-form validation, so one form cannot invalidate another form's conditions.

Plain text pasted at a block-selection root reuses the atomic block-replacement transaction, including selected descendants and multiline text; an empty clipboard does not delete the selection. Plain paste within rich editors, table cells and auxiliary fields remains delegated to their existing handlers.

Value-reading rollups require their selected source property to remain in the source schema; remove or retarget dependent rollups before deleting it. Rollup evaluation never falls back to retained values outside that schema. Count rollups still read only relation membership and permit deletion of an unused selected-value property.

Rollup schema validation and evaluation share one dependency resolver. Both sum/value and count rollups require an available relation column of relation type and an available source database; deleting/retyping that relation or trashing its source database rejects the write until dependent rollups are removed or retargeted.
