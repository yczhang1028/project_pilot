# Startup Performance Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local, phase-specific startup timing for Extension activation and both Project Pilot Webviews without changing startup behavior.

**Architecture:** A pure Extension Host timing module owns duration calculation, formatting, and one-shot reporting with an injectable monotonic clock. A separate pure Webview helper schedules one `uiReady` message after the first populated React paint; the sidebar and fullscreen hosts correlate that message with their own creation time and write results to the existing Output channel.

**Tech Stack:** TypeScript, VS Code Extension API, React 18, Node `assert`, existing npm scripts

---

### Task 1: Extension Host performance model

**Files:**
- Create: `src/startupPerformance.ts`
- Create: `test/startupPerformance.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing timing-model test**

Create `test/startupPerformance.test.js` that requires `../out/startupPerformance` and verifies this API:

```js
const assert = require('node:assert/strict');
const {
  createPerformanceTimeline,
  createReadyReporter,
  formatPerformanceMessage
} = require('../out/startupPerformance');

assert.equal(formatPerformanceMessage('activation', 'Store initialized', 12.34),
  'Startup performance [activation] Store initialized: 12.3 ms');
assert.equal(formatPerformanceMessage('sidebar', 'UI ready', -4),
  'Startup performance [sidebar] UI ready: 0.0 ms');

const messages = [];
const times = [100, 112.34, 130];
const timeline = createPerformanceTimeline('activation', message => messages.push(message), () => times.shift());
assert.equal(timeline.mark('Store initialized'), 12.34);
assert.equal(timeline.mark('Setup complete'), 30);

let now = 40;
const readyMessages = [];
const ready = createReadyReporter('fullscreen', 10, message => readyMessages.push(message), () => now);
assert.equal(ready.report(), true);
now = 70;
assert.equal(ready.report(), false);
assert.deepEqual(readyMessages, ['Startup performance [fullscreen] UI ready: 30.0 ms']);
```

- [ ] **Step 2: Register and run the focused test to verify RED**

Add this script to `package.json`:

```json
"test:startupPerformance": "npm run build:ext && node test/startupPerformance.test.js"
```

Run: `npm run test:startupPerformance`

Expected: FAIL because `src/startupPerformance.ts` and its compiled module do not exist.

- [ ] **Step 3: Implement the pure timing module**

Create `src/startupPerformance.ts` with an injectable `Clock`, duration clamping, one-decimal formatting, `createPerformanceTimeline()`, and a one-shot `createReadyReporter()`:

```ts
import { performance } from 'node:perf_hooks';

export type PerformanceClock = () => number;
export type PerformanceWriter = (message: string) => void;

const defaultClock: PerformanceClock = () => performance.now();

function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}

export function formatPerformanceMessage(scope: string, milestone: string, durationMs: number): string {
  return `Startup performance [${scope}] ${milestone}: ${Math.max(0, durationMs).toFixed(1)} ms`;
}

export function createPerformanceTimeline(scope: string, write: PerformanceWriter, now: PerformanceClock = defaultClock) {
  const startedAt = now();
  return {
    mark(milestone: string): number {
      const durationMs = elapsed(startedAt, now());
      write(formatPerformanceMessage(scope, milestone, durationMs));
      return durationMs;
    }
  };
}

export function createReadyReporter(
  scope: string,
  startedAt: number,
  write: PerformanceWriter,
  now: PerformanceClock = defaultClock
) {
  let reported = false;
  return {
    report(): boolean {
      if (reported) return false;
      reported = true;
      write(formatPerformanceMessage(scope, 'UI ready', elapsed(startedAt, now())));
      return true;
    }
  };
}

export function monotonicNow(): number {
  return defaultClock();
}
```

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `npm run test:startupPerformance`

Expected: PASS and print `startupPerformance tests passed` after adding that final log line to the test.

- [ ] **Step 5: Commit the timing model**

```powershell
git add -- src/startupPerformance.ts test/startupPerformance.test.js package.json
git commit -m "test: define startup performance timing model"
```

### Task 2: Webview first-paint notifier

**Files:**
- Create: `webview-ui/src/ui/performanceReady.ts`
- Create: `test/performanceReady.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing one-shot notifier test**

Create a TypeScript-loading test following `test/managerLayout.test.js`. Use a fake frame queue and verify that repeated `notifyAfterRender()` calls schedule only one two-frame sequence and post exactly `{ type: 'uiReady' }`:

```js
const frames = [];
const posted = [];
const notifier = model.createUiReadyNotifier(
  message => posted.push(message),
  callback => { frames.push(callback); return frames.length; }
);
assert.equal(notifier.notifyAfterRender(), true);
assert.equal(notifier.notifyAfterRender(), false);
assert.equal(frames.length, 1);
frames.shift()();
assert.equal(frames.length, 1);
frames.shift()();
assert.deepEqual(posted, [{ type: 'uiReady' }]);
assert.equal(notifier.notifyAfterRender(), false);
```

- [ ] **Step 2: Register and run the focused test to verify RED**

Add:

```json
"test:performanceReady": "node test/performanceReady.test.js"
```

Run: `npm run test:performanceReady`

Expected: FAIL because `webview-ui/src/ui/performanceReady.ts` does not exist.

- [ ] **Step 3: Implement the notifier**

Create `webview-ui/src/ui/performanceReady.ts`:

```ts
type FrameScheduler = (callback: FrameRequestCallback) => number;

export function createUiReadyNotifier(
  postMessage: (message: { type: 'uiReady' }) => void,
  scheduleFrame: FrameScheduler = requestAnimationFrame
) {
  let scheduled = false;
  let reported = false;
  return {
    notifyAfterRender(): boolean {
      if (scheduled || reported) return false;
      scheduled = true;
      scheduleFrame(() => scheduleFrame(() => {
        reported = true;
        postMessage({ type: 'uiReady' });
      }));
      return true;
    }
  };
}
```

- [ ] **Step 4: Run focused test and Webview typecheck**

Run: `npm run test:performanceReady`

Expected: PASS.

Run: `npx tsc --noEmit -p webview-ui/tsconfig.json`

Expected: exit 0.

- [ ] **Step 5: Commit the notifier**

```powershell
git add -- webview-ui/src/ui/performanceReady.ts test/performanceReady.test.js package.json
git commit -m "test: define webview ready signal"
```

### Task 3: Wire activation and Webview milestones

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/managerViewProvider.ts`
- Modify: `src/outputChannel.ts`
- Modify: `webview-ui/src/ui/App.tsx`
- Modify: `test/outputChannel.test.js`

- [ ] **Step 1: Extend the Output test with performance logging**

Add a failing assertion that a performance writer adapter emits one INFO line through the existing Output channel. The adapter must be exported from `src/outputChannel.ts` as `writeStartupPerformance(message)` and preserve the supplied formatted message.

- [ ] **Step 2: Run the Output test to verify RED**

Run: `npm run test:outputChannel`

Expected: FAIL because `writeStartupPerformance` is undefined.

- [ ] **Step 3: Add the Output adapter and activation milestones**

Implement:

```ts
export function writeStartupPerformance(message: string): void {
  writeProjectPilotOutput('INFO', message);
}
```

In `activate()`, create an `activation` timeline immediately after Output initialization. Mark `Store initialized`, `Providers registered`, `Setup complete`, and mark `Auto fullscreen dispatched` inside the existing timeout before executing the command. Do not change the timeout, setting default, or command behavior.

- [ ] **Step 4: Add sidebar and fullscreen ready reporters**

At the start of each Webview creation path, capture `monotonicNow()` and create a reporter labeled `sidebar` or `fullscreen`. Intercept only `msg.type === 'uiReady'`, call `report()`, and return before existing message handling. Create a fresh reporter for each newly created Webview instance.

- [ ] **Step 5: Trigger `uiReady` after initial state render**

In the existing App message-listener effect, create one `createUiReadyNotifier()` instance. After processing the first `state` message and calling `setState()`, call `notifyAfterRender()`. Do not send readiness for error, probe, or mutation messages.

- [ ] **Step 6: Run focused integration verification**

Run:

```powershell
npm run test:startupPerformance
npm run test:performanceReady
npm run test:outputChannel
npx tsc --noEmit -p webview-ui/tsconfig.json
npm run build
```

Expected: every command exits 0.

- [ ] **Step 7: Commit the integration**

```powershell
git add -- src/extension.ts src/managerViewProvider.ts src/outputChannel.ts webview-ui/src/ui/App.tsx test/outputChannel.test.js
git commit -m "feat: log startup performance milestones"
```

### Task 4: Documentation and complete verification

**Files:**
- Modify: `docs/user-guide.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document local performance diagnostics**

Add a user-guide section explaining that the `Project Pilot` Output channel contains local startup phase timings, no telemetry is transmitted, and cold/warm comparisons should be made with automatic fullscreen both enabled and disabled.

- [ ] **Step 2: Update the changelog**

Add an Unreleased entry for activation, Store, sidebar, and fullscreen first-ready timing.

- [ ] **Step 3: Run the complete verification matrix**

Run all existing 12 test scripts plus `test:startupPerformance` and `test:performanceReady`, then run the Webview typecheck, `npm run build`, and `git diff --check`.

Expected: all 14 test scripts pass, the typecheck and build exit 0, and `git diff --check` prints no errors.

- [ ] **Step 4: Commit documentation**

```powershell
git add -- docs/user-guide.md CHANGELOG.md
git commit -m "docs: explain startup timing diagnostics"
```
