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
