const assert = require('node:assert/strict');
const {
  createPerformanceTimeline,
  createReadyReporter,
  formatPerformanceMessage
} = require('../out/startupPerformance');

assert.equal(
  formatPerformanceMessage('activation', 'Store initialized', 12.34),
  'Startup performance [activation] Store initialized: 12.3 ms'
);
assert.equal(
  formatPerformanceMessage('sidebar', 'UI ready', -4),
  'Startup performance [sidebar] UI ready: 0.0 ms'
);

const messages = [];
const times = [100, 112.34, 130];
const timeline = createPerformanceTimeline(
  'activation',
  message => messages.push(message),
  () => times.shift()
);
assert.ok(Math.abs(timeline.mark('Store initialized') - 12.34) < 0.0001);
assert.equal(timeline.mark('Setup complete'), 30);
assert.deepEqual(messages, [
  'Startup performance [activation] Store initialized: 12.3 ms',
  'Startup performance [activation] Setup complete: 30.0 ms'
]);

let now = 40;
const readyMessages = [];
const ready = createReadyReporter(
  'fullscreen',
  10,
  message => readyMessages.push(message),
  () => now
);
assert.equal(ready.report(), true);
now = 70;
assert.equal(ready.report(), false);
assert.deepEqual(readyMessages, [
  'Startup performance [fullscreen] UI ready: 30.0 ms'
]);

console.log('startupPerformance tests passed');
