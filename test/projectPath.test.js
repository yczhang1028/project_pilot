const assert = require('assert');
const Module = require('module');
const { parseRawSshPath } = require('../out/sshPath');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

let projectPath;
try {
  projectPath = require('../out/projectPath');
} finally {
  Module._load = originalLoad;
}

const structuredAuthority = Buffer.from(JSON.stringify({
  hostName: 'windows.example.com',
  user: 'administrator',
  port: 2222
}), 'utf8').toString('hex');
const selection = projectPath.normalizeSelectedProjectUri({
  scheme: 'vscode-remote',
  authority: `ssh-remote+${structuredAuthority}`,
  path: '/C:/work/pilot.code-workspace'
}, 'workspace');
assert.strictEqual(selection.type, 'ssh-workspace');
const parsedSelection = parseRawSshPath(selection.path);
assert.deepStrictEqual(
  (({ hostname, username, port, remotePath }) => ({ hostname, username, port, remotePath }))(parsedSelection),
  {
    hostname: 'windows.example.com',
    username: 'administrator',
    port: 2222,
    remotePath: 'C:/work/pilot.code-workspace'
  },
  'structured Remote-SSH authority keeps username and port when selected in VS Code'
);

const managed = {
  id: 'managed',
  name: ' Managed workspace ',
  path: 'stale-host:/not-a-workspace-folder',
  type: 'ssh-workspace',
  sshHostId: 'host-1',
  remotePath: '/srv/current.code-workspace'
};
assert.deepStrictEqual(projectPath.normalizeProjectItemForStorage(managed), {
  ...managed,
  name: 'Managed workspace'
}, 'managed project type is derived from managed fields, never its compatibility snapshot');

console.log('projectPath tests passed');
