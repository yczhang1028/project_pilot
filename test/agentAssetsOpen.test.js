const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const opened = [];
const shown = [];
const posted = [];
const configPath = path.resolve('AGENTS.md');
const snapshot = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  machines: [{ id: 'local', kind: 'local', label: 'Local' }],
  assets: [{
    id: 'asset-settings',
    physicalId: 'physical-settings',
    machineId: 'local',
    kind: 'settings',
    name: 'AGENTS.md',
    path: configPath,
    status: 'ready',
    bindings: [{
      key: 'binding-settings',
      providerId: 'codex',
      providerLabel: 'Codex',
      scope: 'global',
      sourceKind: 'native'
    }]
  }],
  summaries: [{
    machineId: 'local',
    status: 'fresh',
    scannedAt: new Date().toISOString(),
    skillCount: 0,
    mcpCount: 0,
    settingsCount: 1,
    errors: []
  }]
};

const fileUri = value => ({
  scheme: 'file',
  fsPath: value,
  authority: '',
  path: value,
  toString: () => value
});
const vscode = {
  env: { remoteName: undefined },
  Uri: {
    joinPath: (base, ...parts) => fileUri(path.join(base.fsPath || base.path || '', ...parts)),
    file: fileUri,
    parse: value => ({ scheme: value.split(':')[0], fsPath: '', authority: '', path: value, toString: () => value })
  },
  workspace: {
    workspaceFile: undefined,
    workspaceFolders: undefined,
    fs: {
      createDirectory: async () => {},
      readFile: async () => Buffer.from(JSON.stringify(snapshot)),
      writeFile: async () => {},
      rename: async () => {},
      delete: async () => {}
    },
    openTextDocument: async uri => {
      opened.push(uri);
      return { uri };
    }
  },
  window: {
    showTextDocument: async (document, options) => shown.push({ document, options }),
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} })
  },
  ViewColumn: { One: 1 }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { AgentAssetsService } = require('../out/agentAssets/inventoryService');
const { handleAgentAssetsMessage } = require('../out/agentAssets/messages');

(async () => {
  const service = new AgentAssetsService(
    { globalStorageUri: fileUri(path.resolve('.tmp-agent-assets-test')) },
    { state: { projects: [], sshHosts: [] } }
  );
  const handled = await handleAgentAssetsMessage(
    { type: 'openAgentAsset', payload: { assetId: 'asset-settings' } },
    { postMessage: async message => { posted.push(message); return true; } },
    service
  );

  assert.equal(handled, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].fsPath, configPath);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].options.preview, false);
  assert.equal(shown[0].options.preserveFocus, false);
  assert.deepEqual(posted.at(-1), {
    type: 'agentAssetOperationResult',
    payload: { success: true, message: 'Opened AGENTS.md.' }
  });
  console.log('agentAssetsOpen tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
