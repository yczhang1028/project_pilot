# Manager Layout System Design

Date: 2026-07-08
Status: Approved visual direction; implementation requested

## Summary

Project Pilot will replace the current `Grid / List / Mini` presentation with three clearly named, switchable Manager layouts: **Command**, **Explorer**, and **Gallery**. All three layouts share the visual language approved from the `F · Liquid Gallery` mockup: a dark graphite/navy foundation, restrained cyan-blue material edges, and selective glass surfaces.

The change is presentation-focused. Search, sorting, filtering, grouping, favorites, project CRUD, project opening, migration warnings, SSH Host management, remote browsing, connection testing, configuration actions, and extension-to-webview message contracts remain functional in every layout.

## User-approved decisions

- Keep all three previously proposed layouts.
- Use the third refined mockup, `F · Liquid Gallery`, as the shared visual style.
- Make the three layouts directly switchable from the Manager command bar.
- Simplify the interface rather than retaining a separate density matrix.
- Preserve every existing Manager feature while changing presentation.
- Treat modal stacking, z-index, zoom, viewport sizing, and scroll ownership as core requirements rather than follow-up polish.

## Current implementation audit

The current UI has three stored view modes:

```ts
type ViewMode = 'grid' | 'list' | 'mini';
```

It also has an independent `compactMode` and an automatic compact breakpoint below 1080px. This produces up to six visual combinations, plus responsive variants. The same large `Card` component contains three separate render branches and repeats action, metadata, and edit-modal wiring.

The Manager shell currently:

- renders a large marketing-style hero before the project collection;
- places view switching inside the expanded Options panel;
- applies backdrop blur to the shell, panels, cards, buttons, inputs, and modals;
- uses independent magic modal layers (`z-[9999]` and `z-[10000]`);
- allows both modal backdrops and modal panels to own vertical scrolling;
- uses `100vh` calculations that can behave poorly during browser zoom or dynamic viewport changes;
- can intentionally stack SSH Host Manager above the project editor, but does not model that relationship as a shared modal stack;
- handles Escape separately in each modal and does not provide a shared focus trap, focus restoration, or body-scroll lock;
- keeps `App.tsx` responsible for state normalization, message routing, filtering, grouping, shell rendering, three card layouts, and the complete project editor.

These issues will be addressed only where they support the new Manager layouts and reliable overlays. Extension-host business logic and SSH resolution remain unchanged.

## Layout model and compatibility

The stored enum values remain unchanged to avoid a configuration migration:

| Stored value | New UI name | Purpose |
| --- | --- | --- |
| `mini` | Command | Fast default view with compact project tiles |
| `list` | Explorer | Highest-density aligned project rows |
| `grid` | Gallery | Richer visual cards and Favorites/Recent rail |

The UI introduces a semantic type while preserving the storage adapter:

```ts
type ManagerLayout = 'command' | 'explorer' | 'gallery';

function fromStoredViewMode(value: ViewMode): ManagerLayout;
function toStoredViewMode(value: ManagerLayout): ViewMode;
```

Existing users retain their saved mode. New installations default to **Command** (`mini`). `compactMode` remains accepted by the store for backward compatibility but is no longer shown or used to create a second layout dimension. Responsive CSS adapts each named layout without changing the selected mode.

## Shared Manager shell

All three layouts use the same compact shell:

1. A sticky command bar with Project Pilot, search, Add Project, SSH Hosts, Options, and the three-way layout switcher.
2. Inline Add Project and Options regions that expand below the command bar without becoming modal dialogs.
3. Existing migration warnings and empty/error states.
4. A project collection rendered by the selected layout.

The large hero copy, duplicate total/visible badges, current mode badge, density badge, floating orbs, and decorative grid are removed. Project counts remain available where they help scanning: group headers, Favorites/Recent, and an unobtrusive collection footer or toolbar label.

The command bar becomes sticky only inside the webview document. It must not create a second scroll container.

## The three layouts

### Command

Command is the recommended default and maps to the former `mini` value.

- Projects render as compact horizontal tiles in responsive columns.
- Each tile shows icon, name, short path or SSH authority, favorite state, and overflow actions.
- Clicking the main tile opens the project.
- Groups use compact headers and fixed, predictable spacing.
- At narrow widths the layout falls to one column while preserving the same information and actions.

Command optimizes for rapid recognition without the current icon-only ambiguity.

### Explorer

Explorer maps to the former `list` value.

- Projects render as aligned rows within a shared group surface rather than separate floating cards.
- Columns include icon/name, path or SSH authority, project type, favorite, and overflow actions.
- Columns collapse by priority as width decreases: type first, then path metadata, while name and actions remain accessible.
- Hover, focus, and selected states use one cyan-blue indicator rather than card glow.
- Row actions remain keyboard reachable and are not hover-only on touch or narrow layouts.

Explorer is the densest view and receives the lightest glass treatment.

### Gallery

Gallery maps to the former `grid` value.

- A compact Favorites/Recent rail appears above the grouped collection when entries exist.
- Most projects render as two- or three-column horizontal cards.
- At most one meaningful featured project per group may span additional width; no decorative illustration area is required.
- Cards show icon, name, path or SSH authority, optional description, favorite, and overflow actions.
- Responsive collapse preserves card content order and never forces horizontal page scrolling.

Gallery carries the strongest material depth while staying efficient for configurations with 30–50 projects.

## Functional invariants

Every layout must support the same actions and state:

- search by name, description, path, and tags;
- sort by name, type, recent access, and frequency;
- tag and group filtering;
- grouped or flat display;
- custom-group or target/Host grouping;
- favorites-only filtering and favorite toggling;
- opening and access recording;
- add, edit, and delete project flows;
- local folder, workspace, SSH folder, and SSH workspace projects;
- reusable SSH Host selection and Host Manager launch;
- remote path browsing, SSH resolution, and connection testing;
- migration warning review;
- refresh, sync/settings, and auto-open configuration;
- VS Code light, dark, and high-contrast theme compatibility.

Filtering and grouping are computed once before layout rendering. Layout components receive the same prepared project collection and action callbacks, preventing behavioral drift among the three modes.

## Component boundaries

The refactor keeps extension/webview message contracts unchanged and separates presentation from behavior:

- `App.tsx` owns extension messages, top-level state, filtering, grouping, and opening overlays.
- `managerLayout.ts` owns semantic layout names, stored-value mapping, labels, and responsive metadata.
- `ManagerCommandBar.tsx` owns search, primary actions, Options expansion, and layout switching.
- `ProjectCollection.tsx` owns grouped/flat collection scaffolding and empty states.
- `ProjectCard.tsx` owns shared project metadata/actions and delegates visual structure to Command, Explorer, or Gallery variants.
- `ModalHost.tsx` owns overlay layering, scroll lock, Escape routing, focus containment, and focus restoration.
- The existing project editor and `SshHostManager` remain separate feature components but render through `ModalHost`.

The split must not move SSH parsing or persistence logic into presentation components. Existing pure SSH Host Manager model helpers remain in place.

## Material and visual system

The approved `F · Liquid Gallery` direction becomes a small token system:

- foundation: opaque graphite/navy themed from VS Code colors;
- accent: one restrained cyan-blue derived from the VS Code focus color;
- group surfaces: translucent material with a subtle inner edge and 10–14px blur;
- command bar and modal surfaces: 14–18px blur with stronger opacity;
- project cards/rows: mostly opaque tinted surfaces with no blur or at most a subtle 4–6px effect;
- inputs and buttons: crisp, nearly opaque surfaces without backdrop blur;
- glow: limited to focus, active layout, selected row, and important featured state;
- texture: optional very low-opacity grain, with no floating orbs or animated decorative grid.

No UI area may stack more than two backdrop-filtered surfaces. Explorer intentionally uses less transparency than Command, and Gallery may use the strongest group-level material.

When `backdrop-filter` is unavailable, surfaces use an opaque theme-derived fallback. VS Code high-contrast themes disable translucency, decorative shadows, and glow.

## Overlay and modal architecture

All overlays render through one `ModalHost` attached to `document.body`. The host defines named layers rather than arbitrary z-index values:

```ts
const overlayLayers = {
  base: 0,
  sticky: 20,
  popover: 40,
  modalBackdrop: 100,
  modal: 110,
  nestedModalBackdrop: 120,
  nestedModal: 130,
  toast: 160
};
```

Project Editor is a base modal. Opening SSH Host Manager from the editor creates one nested modal above it. Escape affects only the topmost layer: first transient Host editing/migration state, then Host Manager, then Project Editor. Closing the nested modal restores focus to the control that opened it and leaves the editor intact.

While a modal is open:

- the background Manager is inert and cannot receive pointer or keyboard focus;
- document scrolling is locked and restored exactly once when the stack empties;
- focus is trapped in the topmost modal;
- initial focus and closing focus restoration are deterministic;
- backdrop clicks close only the topmost dismissible modal;
- pending SSH mutations cannot be dismissed accidentally;
- `aria-modal`, dialog labeling, and live status regions remain valid.

Native confirmation prompts are not allowed to create an unmanaged third layer over the Host Manager. Destructive confirmation is presented inline inside the current modal layer.

## Viewport, zoom, and scroll behavior

The webview document owns normal page scrolling. The command bar is sticky; the project collection does not create another page-height scroll container.

Each modal uses one scroll owner:

- the fixed overlay uses `overflow: hidden`;
- the dialog uses `max-block-size: calc(100dvh - 2 * var(--modal-gutter))`;
- the dialog body uses `overflow: auto` and `overscroll-behavior: contain`;
- the header and footer remain visible where practical, while only the body scrolls;
- width uses `min(100% - 2 * var(--modal-gutter), var(--dialog-max-width))` with no hard `min-width` that can overflow.

The layouts must remain usable at:

- webview widths from 320px through wide fullscreen panels;
- browser zoom from 80% through 200%;
- reduced window height where modal content exceeds the viewport;
- long project names, long Windows paths, long SSH authorities, and large tag sets;
- mouse, keyboard, and touch-like pointer input.

Use `100dvh` with a `100vh` fallback. Avoid nested vertical scrollbars, horizontal document scroll, and controls that can only be reached by hover.

## State and message flow

Changing layout updates local UI immediately and sends the existing message:

```ts
vscode.postMessage({
  type: 'updateUISettings',
  payload: { viewMode: toStoredViewMode(layout) }
});
```

The extension store remains the persistence authority and sends the full state back to both sidebar and fullscreen webviews. No new extension-host message type is needed for layout switching.

The sidebar and fullscreen views share the saved layout. Responsive adaptations are local CSS behavior and are not persisted as another mode.

## Error, empty, and pending states

- Empty projects, no filter matches, and migration warnings keep their existing actions.
- Modal validation and SSH operation feedback remain inline and associated with the relevant form.
- Pending Host operations disable conflicting actions without blocking modal-body scrolling.
- Long error text wraps inside its surface and cannot widen the dialog.
- A missing or malformed saved `viewMode` normalizes to Command for fresh state and to a safe supported value during state loading.

## Testing strategy

Add pure tests for:

- stored view-mode to semantic layout mapping and round trips;
- invalid view-mode normalization;
- the default Command layout for new state;
- prepared collection data being identical across all three layout renderers;
- modal stack push/pop ordering and topmost Escape behavior;
- scroll-lock reference counting for a nested modal;
- responsive visibility rules for Explorer columns.

Build verification remains:

```bash
npm run build
```

Existing SSH, store, OUTLINE, and Host Manager model tests must continue to pass.

Manual Extension Host verification covers:

1. Switching Command, Explorer, and Gallery in both sidebar and fullscreen views.
2. Reloading VS Code and confirming the selected layout persists.
3. Search, sort, filter, grouping, favorites, open, add, edit, delete, and migration warnings in every layout.
4. Local folder, workspace, SSH folder, and SSH workspace cards in every layout.
5. Opening Project Editor, launching nested SSH Host Manager, editing/testing a Host, closing it, and returning to the intact Project Editor.
6. Escape and backdrop behavior with one and two modal layers.
7. Keyboard Tab/Shift+Tab focus containment and focus restoration.
8. Zoom at 80%, 100%, 150%, and 200%, including short-height windows.
9. No document horizontal scrollbar and no nested vertical scrollbar at 320px, 560px, 920px, and wide fullscreen widths.
10. Dark, light, and high-contrast themes, plus fallback with backdrop filtering disabled.

## Scope boundaries

- Do not change project persistence, SSH resolution, Host CRUD semantics, or OUTLINE behavior.
- Do not add a new UI framework or component library.
- Do not rewrite the extension-host message architecture.
- Do not preserve the old independent Compact toggle in the visible interface.
- Do not introduce additional layout modes beyond Command, Explorer, and Gallery.
- Do not commit the user's existing `.vscode/launch.json`, `.superpowers/`, or `AGENTS.md` changes.
