type FrameScheduler = (callback: FrameRequestCallback) => number;

export function createUiReadyNotifier(
  postMessage: (message: { type: 'uiReady' }) => void,
  scheduleFrame: FrameScheduler = requestAnimationFrame
) {
  let scheduled = false;
  let reported = false;

  return {
    notifyAfterRender(): boolean {
      if (scheduled || reported) {
        return false;
      }
      scheduled = true;
      scheduleFrame(() => scheduleFrame(() => {
        reported = true;
        postMessage({ type: 'uiReady' });
      }));
      return true;
    }
  };
}
