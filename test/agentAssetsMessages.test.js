const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { handleAgentAssetsMessage } = require('../out/agentAssets/messages');

const posted = [];
const calls = [];
const webview = {
  postMessage: async message => {
    posted.push(message);
    return true;
  }
};
const service = {
  init: async () => calls.push(['init']),
  getSnapshot: () => ({ schemaVersion: 2, generatedAt: '', machines: [], assets: [], summaries: [] }),
  scan: async machineId => calls.push(['scan', machineId]),
  cancel: machineId => calls.push(['cancel', machineId]),
  openAsset: async assetId => {
    calls.push(['open', assetId]);
    return 'Opened asset.';
  },
  launch: async (assetId, bindingKey) => {
    calls.push(['launch', assetId, bindingKey]);
    return 'Launched agent.';
  }
};

(async () => {
  assert.equal(await handleAgentAssetsMessage(
    { type: 'openAgentAsset', payload: { assetId: 'asset-1' } },
    webview,
    service
  ), true);
  assert.deepEqual(calls.at(-1), ['open', 'asset-1']);
  assert.deepEqual(posted.at(-1), {
    type: 'agentAssetOperationResult',
    payload: { success: true, message: 'Opened asset.' }
  });

  assert.equal(await handleAgentAssetsMessage(
    { type: 'launchAgentAsset', payload: { assetId: 'asset-1', bindingKey: 'binding-1' } },
    webview,
    service
  ), true);
  assert.deepEqual(calls.at(-1), ['launch', 'asset-1', 'binding-1']);

  assert.equal(await handleAgentAssetsMessage({ type: 'unrelated' }, webview, service), false);
  console.log('agentAssetsMessages tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
