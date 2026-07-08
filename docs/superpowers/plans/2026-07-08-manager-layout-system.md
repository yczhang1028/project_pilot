# Manager Layout System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver three persisted, switchable React Manager layouts with the approved Liquid Gallery style while preserving all existing project and SSH functionality and fixing overlay, zoom, and scroll behavior.

**Architecture:** Keep `App.tsx` as the extension-message and feature-state coordinator, but move persisted layout semantics, layout rendering, and overlay infrastructure into focused React/TypeScript modules. All layouts consume the same prepared projects and callbacks. A shared portal host owns nested modal ordering, Escape handling, focus containment, focus restoration, and document scroll locking.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS 3, VS Code Webview API, Node assertion tests.

---

## File structure

- Create `webview-ui/src/ui/managerLayout.ts`: semantic layout names and storage compatibility.
- Create `webview-ui/src/ui/ModalHost.tsx`: React portal and nested modal infrastructure.
- Create `webview-ui/src/ui/modalStackModel.ts`: pure stack helpers for deterministic tests.
- Create `webview-ui/src/ui/ProjectLayouts.tsx`: shared project action contract and the three presentation variants.
- Create `test/managerLayout.test.js`: layout mapping/default tests.
- Create `test/modalStackModel.test.js`: overlay ordering tests.
- Modify `webview-ui/src/ui/App.tsx`: compact shell, shared prepared data, layout integration, modal integration.
- Modify `webview-ui/src/ui/SshHostManager.tsx`: render through the shared modal surface.
- Modify `webview-ui/src/ui/model.ts`: retain storage values and deprecate the density field.
- Modify `webview-ui/src/ui/sshHostManagerModel.ts`: normalize new state to Command without breaking saved values.
- Modify `webview-ui/src/main.tsx`: install `ModalHostProvider`.
- Modify `webview-ui/src/styles.css`: approved material tokens, responsive layouts, modal scrolling, high contrast.
- Modify `src/store.ts`: new-state default becomes stored `mini`; existing settings remain valid.
- Modify `package.json`: add layout and modal model test scripts and update default-view description/default.

### Task 1: Persisted layout compatibility

**Files:**
- Create: `webview-ui/src/ui/managerLayout.ts`
- Create: `test/managerLayout.test.js`
- Modify: `webview-ui/src/ui/model.ts`
- Modify: `webview-ui/src/ui/sshHostManagerModel.ts`
- Modify: `src/store.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing mapping test**

Test exact mappings and invalid/default behavior:

```js
assert.equal(model.fromStoredViewMode('mini'), 'command');
assert.equal(model.fromStoredViewMode('list'), 'explorer');
assert.equal(model.fromStoredViewMode('grid'), 'gallery');
assert.equal(model.toStoredViewMode('command'), 'mini');
assert.equal(model.normalizeManagerLayout('unknown'), 'command');
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node test/managerLayout.test.js`
Expected: FAIL because `managerLayout.ts` does not exist.

- [ ] **Step 3: Implement the semantic adapter**

```ts
export type StoredViewMode = 'grid' | 'list' | 'mini';
export type ManagerLayout = 'command' | 'explorer' | 'gallery';

export const layoutOptions = [
  { id: 'command', label: 'Command', stored: 'mini' },
  { id: 'explorer', label: 'Explorer', stored: 'list' },
  { id: 'gallery', label: 'Gallery', stored: 'grid' }
] as const;
```

Use `mini` as the default only when no valid saved value exists. Keep `compactMode?: boolean` readable for old files but mark it deprecated and stop using it in rendering.

- [ ] **Step 4: Run layout and store tests**

Run: `node test/managerLayout.test.js; npm run test:store`
Expected: both PASS; saved `grid/list/mini` values still validate.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/ui/managerLayout.ts webview-ui/src/ui/model.ts webview-ui/src/ui/sshHostManagerModel.ts src/store.ts test/managerLayout.test.js package.json
git commit -m "refactor: define manager layout modes"
```

### Task 2: Deterministic modal stack model

**Files:**
- Create: `webview-ui/src/ui/modalStackModel.ts`
- Create: `test/modalStackModel.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing stack tests**

```js
let state = model.emptyModalStack();
state = model.pushModal(state, { id: 'project-editor', dismissible: true });
state = model.pushModal(state, { id: 'ssh-hosts', dismissible: true });
assert.equal(model.getTopModal(state).id, 'ssh-hosts');
assert.equal(model.getModalLayer(state, 'project-editor'), 0);
assert.equal(model.getModalLayer(state, 'ssh-hosts'), 1);
state = model.removeModal(state, 'ssh-hosts');
assert.equal(model.getTopModal(state).id, 'project-editor');
```

Also test duplicate registration, removing a middle entry, and an empty top.

- [ ] **Step 2: Run and verify failure**

Run: `node test/modalStackModel.test.js`
Expected: FAIL because `modalStackModel.ts` does not exist.

- [ ] **Step 3: Implement immutable stack helpers**

```ts
export interface ModalEntry { id: string; dismissible: boolean }
export type ModalStack = readonly ModalEntry[];
export const emptyModalStack = (): ModalStack => [];
export const pushModal = (stack: ModalStack, entry: ModalEntry): ModalStack =>
  [...stack.filter(item => item.id !== entry.id), entry];
export const removeModal = (stack: ModalStack, id: string): ModalStack =>
  stack.filter(item => item.id !== id);
```

- [ ] **Step 4: Run the test**

Run: `node test/modalStackModel.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webview-ui/src/ui/modalStackModel.ts test/modalStackModel.test.js package.json
git commit -m "test: define modal stack behavior"
```

### Task 3: Shared React modal host

**Files:**
- Create: `webview-ui/src/ui/ModalHost.tsx`
- Modify: `webview-ui/src/main.tsx`
- Modify: `webview-ui/src/styles.css`

- [ ] **Step 1: Add provider and modal surface contracts**

Expose:

```ts
export function ModalHostProvider({ children }: { children: React.ReactNode }): JSX.Element;
export function ModalSurface(props: {
  id: string;
  labelId: string;
  onRequestClose: () => void;
  dismissible?: boolean;
  maxWidth?: string;
  children: React.ReactNode;
}): JSX.Element;
```

- [ ] **Step 2: Implement topmost-only interaction**

The provider stores the immutable stack. `ModalSurface` registers on mount and unregisters on unmount. Only the top entry handles Escape and backdrop clicks. Portals preserve React context.

- [ ] **Step 3: Implement focus and scroll lifecycle**

On the first modal, store the current focused element and set `document.documentElement.dataset.modalOpen`. Trap Tab/Shift+Tab inside the topmost surface. On final close, remove the dataset and restore focus. Use one document scroll lock even when two surfaces are stacked.

- [ ] **Step 4: Add modal CSS**

```css
.modal-viewport { position: fixed; inset: 0; overflow: hidden; }
.modal-frame { max-block-size: calc(100dvh - 2 * var(--modal-gutter)); }
.modal-body { overflow: auto; overscroll-behavior: contain; }
html[data-modal-open='true'] { overflow: hidden; }
```

Use layer-derived CSS variables instead of `z-[9999]` and `z-[10000]`.

- [ ] **Step 5: Build**

Run: `npm run build:webview`
Expected: Vite and TypeScript succeed.

- [ ] **Step 6: Commit**

```bash
git add webview-ui/src/ui/ModalHost.tsx webview-ui/src/main.tsx webview-ui/src/styles.css
git commit -m "feat: add shared modal host"
```

### Task 4: Compact Manager command shell

**Files:**
- Modify: `webview-ui/src/ui/App.tsx`
- Modify: `webview-ui/src/styles.css`

- [ ] **Step 1: Replace the hero with a compact sticky command bar**

Keep search, Add Project, SSH Hosts, Options, and the three-way switch visible. Remove hero copy, decorative orbs/grid, duplicate stats, and the density toggle.

- [ ] **Step 2: Keep Options and Add Project inline**

Preserve existing sort, tag, group, grouping mode, favorites-only, refresh, sync, and auto-open actions. The panels expand beneath the command bar and do not create portals.

- [ ] **Step 3: Persist semantic layout selection**

```ts
const [layout, setLayout] = useState<ManagerLayout>('command');
const selectLayout = (next: ManagerLayout) => {
  setLayout(next);
  updateUISettings({ viewMode: toStoredViewMode(next) });
};
```

- [ ] **Step 4: Add responsive and material shell CSS**

Use the F mockup style, one cyan-blue focus accent, group-level glass, opaque controls, `100dvh`, and high-contrast fallbacks.

- [ ] **Step 5: Build**

Run: `npm run build:webview`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add webview-ui/src/ui/App.tsx webview-ui/src/styles.css
git commit -m "feat: simplify manager command shell"
```

### Task 5: Three shared-data React layouts

**Files:**
- Create: `webview-ui/src/ui/ProjectLayouts.tsx`
- Modify: `webview-ui/src/ui/App.tsx`
- Modify: `webview-ui/src/styles.css`

- [ ] **Step 1: Define one action contract**

```ts
export interface ProjectLayoutActions {
  open(project: ProjectItem): void;
  edit(project: ProjectItem): void;
  remove(project: ProjectItem): void;
  toggleFavorite(project: ProjectItem): void;
}
```

All three renderers receive identical groups/projects/actions.

- [ ] **Step 2: Implement Command tiles**

Render responsive horizontal tiles with icon, name, short path/authority, favorite, and overflow actions. One column is valid at 320px.

- [ ] **Step 3: Implement Explorer rows**

Render one shared group surface with aligned rows and priority-based responsive columns. Actions remain reachable without hover.

- [ ] **Step 4: Implement Gallery cards**

Render Favorites/Recent when available and compact two/three-column cards. Avoid illustration-only empty areas.

- [ ] **Step 5: Wire the prepared collection once**

`App.tsx` continues to filter, sort, and group once, then passes the same result to `ProjectLayouts`. Add/edit/delete/open/favorite callbacks continue to send existing messages.

- [ ] **Step 6: Build and run layout tests**

Run: `npm run test:managerLayout; npm run build:webview`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webview-ui/src/ui/ProjectLayouts.tsx webview-ui/src/ui/App.tsx webview-ui/src/styles.css
git commit -m "feat: add switchable manager layouts"
```

### Task 6: Move Project Editor and SSH Hosts onto the modal host

**Files:**
- Modify: `webview-ui/src/ui/App.tsx`
- Modify: `webview-ui/src/ui/SshHostManager.tsx`
- Modify: `webview-ui/src/styles.css`

- [ ] **Step 1: Replace direct Project Editor portal**

Use `ModalSurface id="project-editor"`. Remove its independent document Escape listener, magic z-index, overlay scrolling, hard `minWidth`, and duplicate backdrop blur.

- [ ] **Step 2: Replace direct SSH Host portal**

Use `ModalSurface id="ssh-host-manager"`. Keep Host draft and migration Escape semantics by making `onRequestClose` call `cancelTransientOrClose`.

- [ ] **Step 3: Make Host deletion confirmation inline**

Replace `window.confirm` with an inline confirmation state inside the Host Manager so no native/unmanaged layer appears above the stack.

- [ ] **Step 4: Verify nested behavior**

Open Project Editor, launch SSH Hosts, press Escape once, and confirm only SSH Hosts closes. Press Escape again and confirm Project Editor closes. Repeat while a Host draft is open: first Escape cancels the draft.

- [ ] **Step 5: Verify zoom/scroll behavior**

At 200% zoom and a short window, verify one modal body scrollbar, no page scrollbar, visible header/footer, no horizontal overflow, and usable controls.

- [ ] **Step 6: Build and commit**

Run: `npm run test:modalStack; npm run build`
Expected: PASS.

```bash
git add webview-ui/src/ui/App.tsx webview-ui/src/ui/SshHostManager.tsx webview-ui/src/styles.css
git commit -m "fix: unify manager modal layering"
```

### Task 7: Full regression and documentation

**Files:**
- Modify: `docs/user-guide.md`
- Modify: `README.md` only if it documents the old names

- [ ] **Step 1: Run every existing automated suite**

```bash
npm run test:sshPath
npm run test:projectPath
npm run test:sshResolve
npm run test:sshHosts
npm run test:sshProjectRuntime
npm run test:store
npm run test:sshHostMessages
npm run test:outline
npm run test:sshHostManagerModel
npm run test:managerLayout
npm run test:modalStack
npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Run source checks**

Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 3: Update user-facing layout documentation**

Document Command, Explorer, Gallery, persistence, and the removal of the separate Compact control.

- [ ] **Step 4: Perform the Extension Host matrix**

Use F5 with the repository's Run Extension configuration. Verify three layouts, persistence, project actions, nested SSH Hosts, Escape, keyboard focus, 320/560/920px widths, 80/100/150/200% zoom, and dark/light/high-contrast themes.

- [ ] **Step 5: Commit documentation and any verified fixes**

```bash
git add docs/user-guide.md README.md
git commit -m "docs: explain manager layout modes"
```
