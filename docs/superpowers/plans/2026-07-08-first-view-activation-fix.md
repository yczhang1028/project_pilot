# First View Activation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first Manager/Outline expansion and primary Manager commands activate Project Pilot immediately.

**Architecture:** Preserve `onStartupFinished` for automatic fullscreen behavior and add explicit View/command activation events in the extension manifest. A focused Node regression test reads `package.json` and locks the complete activation-event set.

**Tech Stack:** VS Code extension manifest, Node `assert`, npm scripts

---

### Task 1: Lock and fix first-entry activation

**Files:**
- Create: `test/activationEvents.test.js`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the failing manifest test**

Create `test/activationEvents.test.js`:

```js
const assert = require('node:assert/strict');
const manifest = require('../package.json');

const requiredEvents = [
  'onStartupFinished',
  'onView:projectPilot.manager',
  'onView:projectPilot.outline',
  'onCommand:projectPilot.showManager',
  'onCommand:projectPilot.openFullscreen'
];

for (const event of requiredEvents) {
  assert.ok(
    manifest.activationEvents.includes(event),
    `activationEvents must include ${event}`
  );
}

console.log('activationEvents tests passed');
```

- [ ] **Step 2: Register and run the test to verify RED**

Add to `package.json`:

```json
"test:activationEvents": "node test/activationEvents.test.js"
```

Run: `npm run test:activationEvents`

Expected: FAIL for the missing Manager View activation event.

- [ ] **Step 3: Add the explicit activation events**

Replace the current activation-event array with:

```json
"activationEvents": [
  "onStartupFinished",
  "onView:projectPilot.manager",
  "onView:projectPilot.outline",
  "onCommand:projectPilot.showManager",
  "onCommand:projectPilot.openFullscreen"
]
```

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `npm run test:activationEvents`

Expected: PASS.

- [ ] **Step 5: Document the fix**

Add an Unreleased changelog entry stating that Manager and Outline now activate
on their first expansion instead of waiting for `onStartupFinished`.

- [ ] **Step 6: Run complete verification**

Run all 15 test scripts, the Webview TypeScript check, `npm run build`, and
`git diff --check`.

Expected: every command exits 0 and only the user's existing unrelated files
remain outside the change.

- [ ] **Step 7: Commit**

```powershell
git add -- package.json test/activationEvents.test.js CHANGELOG.md
git commit -m "fix: activate Project Pilot on first view"
```

### Task 2: Prepare and package the 3.0.0 VSIX

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Create: `builds/project-pilot-3.0.0.vsix`

- [ ] **Step 1: Set the new major version without creating a Git tag**

Run:

```powershell
npm version 3.0.0 --no-git-tag-version
```

Expected: `package.json` and the root `package-lock.json` both report `3.0.0`.

- [ ] **Step 2: Finalize the changelog release heading**

Replace `## [Unreleased]` with:

```markdown
## [3.0.0] - 2026-07-08
```

- [ ] **Step 3: Re-run complete verification at the release version**

Run all 15 test scripts, the Webview TypeScript check, `npm run build`, and
`git diff --check`.

Expected: every command exits 0.

- [ ] **Step 4: Package the release artifact**

Run:

```powershell
npx @vscode/vsce package --out builds/project-pilot-3.0.0.vsix
```

Expected: `builds/project-pilot-3.0.0.vsix` exists, has non-zero length, and
the package command identifies version `3.0.0`.

- [ ] **Step 5: Commit release metadata**

The `builds/` directory is intentionally ignored, so commit only release
metadata and keep the VSIX as the local delivery artifact:

```powershell
git add -- package.json package-lock.json CHANGELOG.md
git commit -m "release: prepare Project Pilot 3.0.0"
```
