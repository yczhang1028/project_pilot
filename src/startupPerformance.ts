import { performance } from 'node:perf_hooks';

export type PerformanceClock = () => number;
export type PerformanceWriter = (message: string) => void;

const defaultClock: PerformanceClock = () => performance.now();

function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}

export function formatPerformanceMessage(
  scope: string,
  milestone: string,
  durationMs: number
): string {
  return `Startup performance [${scope}] ${milestone}: ${Math.max(0, durationMs).toFixed(1)} ms`;
}

export function createPerformanceTimeline(
  scope: string,
  write: PerformanceWriter,
  now: PerformanceClock = defaultClock
) {
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
      if (reported) {
        return false;
      }
      reported = true;
      write(formatPerformanceMessage(scope, 'UI ready', elapsed(startedAt, now())));
      return true;
    }
  };
}

export function monotonicNow(): number {
  return defaultClock();
}
