const assert = require('node:assert/strict');
const Module = require('node:module');

let demoMode = true;
const notices = [];
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, fallback) => key === 'demoMode' ? demoMode : fallback
        })
      },
      window: {
        showInformationMessage: message => notices.push(message)
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  DEMO_MODE_READ_ONLY_MESSAGE,
  getProjectPilotWebviewState,
  handleDemoModeMessage
} = require('../out/demoMode');

const store = {
  state: {
    schemaVersion: 2,
    sshHosts: [{ id: 'real-host', name: 'Private Host', hostname: 'private.example' }],
    projects: [{ id: 'real-project', name: 'Private Project', path: 'C:\\Private', type: 'local' }],
    uiSettings: { viewMode: 'mini' }
  },
  migrationWarnings: [{ projectName: 'Private Project', message: 'private warning' }]
};

const posted = [];
const webview = {
  postMessage: async message => {
    posted.push(message);
    return true;
  }
};

(async () => {
  const state = getProjectPilotWebviewState(store);
  assert.equal(state.config.demoMode, true);
  assert.ok(state.projects.every(project => project.id.startsWith('demo-')));
  assert.ok(!JSON.stringify(state).includes('Private Project'));
  assert.deepEqual(state.migrationWarnings, []);

  assert.equal(await handleDemoModeMessage({ type: 'requestState' }, webview), false);
  assert.equal(await handleDemoModeMessage({ type: 'requestAgentInventory' }, webview), true);
  assert.equal(posted.at(-1).type, 'agentInventorySnapshot');

  assert.equal(await handleDemoModeMessage({ type: 'openAgentAsset', payload: { assetId: 'demo' } }, webview), true);
  assert.deepEqual(posted.at(-1), {
    type: 'agentAssetOperationResult',
    payload: { success: false, message: DEMO_MODE_READ_ONLY_MESSAGE }
  });

  assert.equal(await handleDemoModeMessage({ type: 'addOrUpdate', payload: {} }, webview), true);
  assert.equal(notices.at(-1), DEMO_MODE_READ_ONLY_MESSAGE);

  demoMode = false;
  assert.equal(await handleDemoModeMessage({ type: 'addOrUpdate', payload: {} }, webview), false);
  const realState = getProjectPilotWebviewState(store);
  assert.equal(realState.config.demoMode, false);
  assert.equal(realState.projects[0].name, 'Private Project');

  console.log('demo mode tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
