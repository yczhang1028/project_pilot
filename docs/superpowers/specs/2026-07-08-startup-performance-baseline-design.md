# Startup Performance Baseline Design

## Goal

Measure Project Pilot's real startup path before changing activation or loading
behavior. The baseline must separate Extension Host activation, configuration
initialization, Webview host creation, and React's first usable render.

## Scope

This phase adds local timing diagnostics only. It does not change
`onStartupFinished`, the `autoOpenFullscreen` default, Store initialization
order, Webview retention, or bundle structure. Evidence from this phase will
drive a separate optimization change.

## Approaches Considered

1. **Instrument first, then optimize (selected).** Add small timing boundaries
   around the existing path and compare cold and warm runs. This preserves
   behavior and identifies the actual bottleneck.
2. **Immediately disable startup fullscreen.** This is likely to reduce work,
   but it changes a visible default before quantifying the benefit.
3. **Immediately split the React bundle.** The current production bundle is
   about 228 KB raw and 66 KB gzip, so code splitting is unlikely to be the
   highest-value first step.

## Architecture

Create a focused Extension Host timing module that accepts an injectable clock,
records named milestones, formats stable duration messages, and writes only to
the existing `Project Pilot` Output channel. It must not send telemetry or
persist performance data.

Activation records these milestones:

- activation entered;
- configuration Store initialized;
- Manager and Outline providers registered;
- activation setup complete;
- automatic fullscreen command dispatched, when enabled.

Each Webview host records its own creation start and correlates one `uiReady`
message from the React application. The sidebar and fullscreen paths are labeled
separately. The React application sends `uiReady` once, after receiving initial
state and completing the next paint opportunity, so the duration represents a
usable populated view rather than JavaScript evaluation alone.

## Data Flow

1. The Extension Host creates a timer with a monotonic clock.
2. Existing activation and Webview boundaries call `mark()` with fixed labels.
3. React requests and receives the initial state as it does today.
4. After the populated render reaches a paint boundary, React posts
   `{ type: 'uiReady' }` once.
5. The owning Webview host converts that message into a labeled duration and
   writes it to `Project Pilot` Output.

Performance messages are diagnostic-only and never enter `projects.json`.

## Correctness and Failure Handling

- Timing must never delay activation, Store initialization, or rendering.
- Missing or duplicate `uiReady` messages must not break normal message routing;
  only the first valid message is recorded per Webview instance.
- Unknown Webview messages continue through the existing routing rules.
- The timing module rounds durations consistently and clamps negative injected
  clock differences to zero for stable tests.
- Logging remains optional: if the Output channel is unavailable, application
  behavior is unchanged.

## Verification

Automated tests cover milestone duration calculation, stable formatting,
negative-duration protection, and one-shot Webview-ready correlation. Existing
SSH, Store, Outline, modal, and layout tests must remain green. The required
build verification remains `npm run build`.

Manual Extension Host verification uses two cold and two warm launches for each
of these configurations:

- `autoOpenFullscreen: true`;
- `autoOpenFullscreen: false`.

The Output channel results will be compared by phase. No optimization will be
selected solely from a single launch or from total time without phase detail.

## Follow-up Decision Rules

- If automatic fullscreen dominates, change its default or scheduling in the
  next design.
- If Store initialization dominates, plan lazy or staged Store setup while
  preserving configuration migration and watcher correctness.
- If Webview-ready time dominates, profile React render work and state payloads
  before considering bundle splitting.
- If activation is already negligible, prioritize memory and duplicate-render
  work instead of startup restructuring.
