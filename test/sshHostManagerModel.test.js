const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(
  __dirname,
  '..',
  'webview-ui',
  'src',
  'ui',
  'sshHostManagerModel.ts'
);

function loadTypeScriptModule(filePath) {
  if (!fs.existsSync(filePath)) {
    assert.fail(`Expected UI model module to exist: ${filePath}`);
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: filePath,
    reportDiagnostics: true
  });
  const diagnostics = output.diagnostics ?? [];
  assert.equal(
    diagnostics.length,
    0,
    diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n')
  );

  const module = { exports: {} };
  new Function('module', 'exports', 'require', output.outputText)(module, module.exports, require);
  return module.exports;
}

const model = loadTypeScriptModule(sourcePath);

const hosts = [
  { id: 'alpha', name: 'Build Box', hostname: '10.1.2.3', username: 'dev', port: 2222 },
  { id: 'beta', name: 'QA Box', hostname: 'qa.internal' }
];
const projects = [
  { id: 'one', name: 'One', type: 'ssh', path: 'old', sshHostId: 'alpha', remotePath: '/repo/one' },
  { id: 'two', name: 'Two', type: 'ssh-workspace', path: 'old', sshHostId: 'alpha', remotePath: '/repo/two.code-workspace' },
  { id: 'three', name: 'Three', type: 'ssh', path: 'legacy:/repo', remotePath: '/repo' },
  { id: 'four', name: 'Four', type: 'local', path: 'C:/repo', sshHostId: 'alpha' }
];

assert.equal(model.countHostReferences(projects, 'alpha'), 3, 'counts every stored Host reference so delete safety matches the Store');
assert.equal(model.countHostReferences(projects, 'missing'), 0);

assert.equal(model.formatSshHostAddress(hosts[0]), 'dev@10.1.2.3:2222');
assert.equal(
  model.formatSshHostAddress({ id: 'v6', name: 'IPv6', hostname: '2001:db8::1', port: 22 }),
  '[2001:db8::1]:22',
  'brackets an IPv6 hostname before appending a port'
);

assert.equal(model.validateSshHostDraft({ name: '', hostname: 'example.com', username: '', port: '' }, hosts), 'Host name is required.');
assert.equal(model.validateSshHostDraft({ name: 'New', hostname: '', username: '', port: '' }, hosts), 'Hostname is required.');
assert.equal(model.validateSshHostDraft({ name: 'New', hostname: 'example.com', username: '', port: '70000' }, hosts), 'Port must be an integer between 1 and 65535.');
assert.equal(model.validateSshHostDraft({ name: 'build box', hostname: 'new.example', username: '', port: '' }, hosts), 'A Host with this name already exists.');
assert.equal(model.validateSshHostDraft({ name: 'Duplicate', hostname: '10.1.2.3', username: 'dev', port: '2222' }, hosts), 'A Host with this connection already exists.');
assert.equal(model.validateSshHostDraft({ name: 'Build Box', hostname: '10.1.2.4', username: 'dev', port: '2222' }, hosts, 'alpha'), null, 'editing a Host may keep its name');
assert.deepEqual(
  model.sshHostFromDraft('new-id', { name: ' New Host ', hostname: ' example.com ', username: ' dev ', port: '2200' }),
  { id: 'new-id', name: 'New Host', hostname: 'example.com', username: 'dev', port: 2200 }
);

assert.deepEqual(model.getMigrationTargets(hosts, 'alpha'), [hosts[1]]);

assert.equal(
  model.validateManagedProjectFields('ssh', '', '/repo', hosts),
  'Select an SSH Host.'
);
assert.equal(
  model.validateManagedProjectFields('ssh', 'missing', '/repo', hosts),
  'The selected SSH Host no longer exists.'
);
assert.equal(
  model.validateManagedProjectFields('ssh', 'alpha', '', hosts),
  'Remote path is required.'
);
assert.equal(
  model.validateManagedProjectFields('ssh-workspace', 'alpha', '/repo', hosts),
  'SSH workspace path should end with .code-workspace.'
);
assert.equal(
  model.validateManagedProjectFields('ssh-workspace', 'alpha', '/repo/project.code-workspace', hosts),
  null
);

const managedPath = model.buildManagedProjectPath(hosts[0], '/repo/project');
assert.match(managedPath, /^vscode-remote:\/\/ssh-remote\+[0-9a-f]+\/repo\/project$/);
const authorityHex = managedPath.replace(/^vscode-remote:\/\/ssh-remote\+/, '').split('/')[0];
assert.deepEqual(JSON.parse(Buffer.from(authorityHex, 'hex').toString('utf8')), {
  hostName: '10.1.2.3',
  user: 'dev',
  port: 2222
});

assert.deepEqual(
  model.normalizeUiState({ projects: [{ id: 'legacy', name: 'Legacy', path: 'C:/repo', type: 'local' }] }),
  {
    projects: [{ id: 'legacy', name: 'Legacy', path: 'C:/repo', type: 'local' }],
    sshHosts: [],
    migrationWarnings: []
  },
  'defaults Host collections from legacy state messages'
);
assert.deepEqual(model.normalizeUiState(undefined), { projects: [], sshHosts: [], migrationWarnings: [] });

assert.equal(model.extractRemotePathForManagedProject('dev@example.com:/srv/repo'), '/srv/repo');
assert.equal(
  model.extractRemotePathForManagedProject('vscode-remote://ssh-remote+example.com/C:/repo'),
  'C:/repo'
);
assert.equal(model.extractRemotePathForManagedProject('not-an-ssh-path'), null);

console.log('sshHostManagerModel tests passed');
