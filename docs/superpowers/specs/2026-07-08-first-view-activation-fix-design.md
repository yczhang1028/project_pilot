# First View Activation Fix Design

## Problem

The first expansion of the Project Pilot Manager can show an empty View until
the user switches away and returns. Current VS Code Extension Host logs show
Project Pilot activating only for `onStartupFinished`; they do not show the
first Manager expansion activating through `onView:projectPilot.manager`.

## Selected Fix

Keep `onStartupFinished` so the existing automatic fullscreen behavior remains
available. Add explicit activation events for:

- `onView:projectPilot.manager`;
- `onView:projectPilot.outline`;
- `onCommand:projectPilot.showManager`;
- `onCommand:projectPilot.openFullscreen`.

This makes the first visible View or primary command trigger activation without
waiting for the startup-finished event. Duplicate activation events are safe
because VS Code activates an extension at most once per Extension Host.

## Scope

The fix changes only `package.json`, a focused manifest regression test, and
the user-facing changelog. It does not reorder Store initialization, register
providers before configuration is ready, change React rendering, remove
`onStartupFinished`, or change `autoOpenFullscreen`.

## Verification

An automated test reads `package.json` and requires all five supported
activation paths: startup, Manager View, Outline View, Show Manager command,
and Open Fullscreen command. The complete test matrix, Webview typecheck, and
`npm run build` must remain green.

Manual verification launches an Extension Host, immediately expands Project
Pilot before waiting for startup completion, and confirms the Manager renders
on the first expansion. The Extension Host log should identify the first-entry
activation event as the Manager View or primary command when that entry occurs
before `onStartupFinished`.
