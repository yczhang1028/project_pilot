const assert = require('assert');
const path = require('path');
const Module = require('module');

const files = new Map();
const directories = new Set();
const infoMessages = [];
const warningMessages = [];
let failNextWrite = false;
let activeWatcher;

function normalizePath(value) {
  return path.win32.normalize(value);
}

function uri(fsPath) {
  return {
    fsPath: normalizePath(fsPath),
    toString() { return this.fsPath; }
  };
}

function encode(value) {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

function putJson(fsPath, value) {
  files.set(normalizePath(fsPath), encode(value));
}

function readJson(fsPath) {
  return JSON.parse(Buffer.from(files.get(normalizePath(fsPath))).toString('utf8'));
}

class RelativePattern {
  constructor(base, pattern) {
    this.base = base;
    this.pattern = pattern;
  }
}

const vscodeMock = {
  Uri: {
    file: uri,
    joinPath(base, ...parts) {
      return uri(path.win32.join(base.fsPath, ...parts));
    }
  },
  RelativePattern,
  FileType: { File: 1, Directory: 2 },
  workspace: {
    fs: {
      async createDirectory(target) {
        directories.add(target.fsPath);
      },
      async readFile(target) {
        const value = files.get(target.fsPath);
        if (!value) throw new Error(`File not found: ${target.fsPath}`);
        return Uint8Array.from(value);
      },
      async writeFile(target, data) {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error('simulated write failure');
        }
        files.set(target.fsPath, Buffer.from(data));
      },
      async readDirectory(target) {
        const prefix = `${target.fsPath}${path.win32.sep}`;
        return [...files.keys()]
          .filter(candidate => candidate.startsWith(prefix))
          .map(candidate => [candidate.slice(prefix.length), 1]);
      },
      async delete(target) {
        files.delete(target.fsPath);
      },
      async copy(source, target) {
        const value = files.get(source.fsPath);
        if (!value) throw new Error(`File not found: ${source.fsPath}`);
        files.set(target.fsPath, Buffer.from(value));
      }
    },
    createFileSystemWatcher() {
      let changeHandler;
      activeWatcher = {
        onDidChange(handler) {
          changeHandler = handler;
          return { dispose() {} };
        },
        async fireChange() {
          if (changeHandler) await changeHandler();
        },
        dispose() {}
      };
      return activeWatcher;
    }
  },
  window: {
    showInformationMessage(message) { infoMessages.push(message); },
    showWarningMessage(message) { warningMessages.push(message); }
  }
};

const originalLoad = Module._load;
Module._load = function mockVscode(request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { ConfigStore } = require('../out/store');
Module._load = originalLoad;

function resetFs() {
  files.clear();
  directories.clear();
  infoMessages.length = 0;
  warningMessages.length = 0;
  failNextWrite = false;
  activeWatcher = undefined;
}

async function createStore(initial, root = 'C:\\store-tests', reset = true) {
  if (reset) resetFs();
  const configPath = path.win32.join(root, 'data', 'projects.json');
  if (initial !== undefined) putJson(configPath, initial);
  const store = new ConfigStore({ globalStorageUri: uri(root) });
  await store.init();
  return { store, configPath };
}

function baseState(projects = [], sshHosts = [], uiSettings) {
  return {
    schemaVersion: 2,
    sshHosts,
    projects,
    ...(uiSettings ? { uiSettings } : {})
  };
}

async function expectReject(action, pattern) {
  await assert.rejects(action, pattern);
}

(async () => {
  {
    const { store, configPath } = await createStore({
      projects: [
        { id: 'one', name: 'One', path: 'dev@example.com:/srv/one', type: 'ssh' },
        { id: 'two', name: 'Two', path: 'dev@example.com:/srv/two.code-workspace', type: 'ssh-workspace' }
      ],
      uiSettings: { outlineMode: 'target' }
    });
    assert.strictEqual(store.state.schemaVersion, 2);
    assert.strictEqual(store.state.uiSettings.outlineMode, 'host');
    assert.strictEqual(store.state.sshHosts.length, 1);
    assert.deepStrictEqual(store.state.projects.map(project => project.remotePath), [
      '/srv/one',
      '/srv/two.code-workspace'
    ]);
    assert.ok(store.state.projects.every(project => project.sshHostId === store.state.sshHosts[0].id));
    assert.deepStrictEqual(store.state.projects.map(project => project.path), [
      'dev@example.com:/srv/one',
      'dev@example.com:/srv/two.code-workspace'
    ]);
    assert.strictEqual(readJson(configPath).schemaVersion, 2, 'startup migration persists schema v2');
  }

  {
    const malformed = { id: 'bad', name: 'Malformed', path: 'not-an-ssh-path', type: 'ssh' };
    const { store, configPath } = await createStore({ projects: [malformed] });
    assert.deepStrictEqual(store.state.projects[0], malformed, 'malformed legacy SSH projects are retained');
    assert.strictEqual(store.migrationWarnings.length, 1);
    assert.strictEqual(store.migrationWarnings[0].projectName, 'Malformed');
    assert.ok(!Object.hasOwn(readJson(configPath), 'migrationWarnings'));
  }

  {
    const { store } = await createStore(baseState());
    await store.updateUISettings({ outlineMode: 'target' });
    assert.strictEqual(store.state.uiSettings.outlineMode, 'host');
  }

  {
    const { store } = await createStore(baseState());
    await store.addSshHost({ id: 'host-a', name: 'Host A', hostname: 'old.example.com', username: 'dev' });
    await store.upsertProject({
      id: 'project-a', name: 'Project A', path: 'stale', type: 'ssh', sshHostId: 'host-a', remotePath: '/srv/a'
    });
    await store.upsertProject({
      id: 'project-b', name: 'Project B', path: 'stale', type: 'ssh-workspace', sshHostId: 'host-a', remotePath: '/srv/b.code-workspace'
    });
    assert.deepStrictEqual(store.state.projects.map(project => project.path), [
      'dev@old.example.com:/srv/a',
      'dev@old.example.com:/srv/b.code-workspace'
    ]);
    await store.updateSshHost({ id: 'host-a', name: 'Renamed', hostname: 'new.example.com', username: 'dev' });
    assert.strictEqual(store.state.sshHosts[0].name, 'Renamed');
    assert.deepStrictEqual(store.state.projects.map(project => project.path), [
      'dev@new.example.com:/srv/a',
      'dev@new.example.com:/srv/b.code-workspace'
    ]);
  }

  {
    const { store } = await createStore(baseState([], [
      { id: 'one', name: 'One', hostname: 'one.example.com', username: 'dev' }
    ]));
    await expectReject(
      () => store.addSshHost({ id: 'one', name: 'Two', hostname: 'two.example.com' }),
      /id.*already exists/i
    );
    await expectReject(
      () => store.addSshHost({ id: 'two', name: ' one ', hostname: 'two.example.com' }),
      /name.*already exists/i
    );
    await expectReject(
      () => store.addSshHost({ id: 'two', name: 'Two', hostname: 'ONE.example.com', username: 'DEV' }),
      /same connection/i
    );
    await expectReject(
      () => store.addSshHost({ id: 'two', name: 'Two', hostname: 'two.example.com', port: 0 }),
      /integer between 1 and 65535/i
    );
  }

  {
    const linked = { id: 'linked', name: 'Linked Project', path: 'dev@one:/repo', type: 'ssh', sshHostId: 'one', remotePath: '/repo' };
    const { store } = await createStore(baseState([linked], [
      { id: 'one', name: 'One', hostname: 'one' },
      { id: 'empty', name: 'Empty', hostname: 'empty' }
    ]));
    await expectReject(() => store.deleteSshHost('one'), /Linked Project/);
    await expectReject(() => store.deleteSshHost('missing'), /not found/i);
    await store.deleteSshHost('empty');
    assert.deepStrictEqual(store.state.sshHosts.map(host => host.id), ['one']);
  }

  {
    const hosts = [
      { id: 'source', name: 'Source', hostname: 'source.example.com', username: 'dev' },
      { id: 'target', name: 'Target', hostname: 'target.example.com', username: 'ops' }
    ];
    const projects = [
      { id: 'a', name: 'A', path: 'old', type: 'ssh', sshHostId: 'source', remotePath: '/srv/a' },
      { id: 'b', name: 'B', path: 'old', type: 'ssh', sshHostId: 'source', remotePath: '/srv/b' },
      { id: 'target-project', name: 'T', path: 'old', type: 'ssh', sshHostId: 'target', remotePath: '/srv/t' }
    ];
    const { store } = await createStore(baseState(projects, hosts));
    await store.migrateSshHostProjects('source', 'target', ['a']);
    assert.deepStrictEqual(
      store.state.projects.map(project => [project.id, project.sshHostId, project.remotePath]),
      [['a', 'target', '/srv/a'], ['b', 'source', '/srv/b'], ['target-project', 'target', '/srv/t']]
    );
    assert.strictEqual(store.state.projects[0].path, 'ops@target.example.com:/srv/a');
    await expectReject(() => store.migrateSshHostProjects('source', 'target', ['target-project']), /does not belong.*source/i);
    await expectReject(() => store.migrateSshHostProjects('source', 'missing'), /target.*not found/i);
    await store.migrateSshHostProjects('source', 'target');
    assert.strictEqual(store.state.projects.find(project => project.id === 'b').sshHostId, 'target');
    assert.strictEqual(store.state.projects.find(project => project.id === 'b').remotePath, '/srv/b');
  }

  {
    const { store } = await createStore(baseState());
    await expectReject(
      () => store.upsertProject({ id: 'unknown', name: 'Unknown', path: 'stale', type: 'ssh', sshHostId: 'missing', remotePath: '/repo' }),
      /Host missing was not found/i
    );
    await store.addSshHost({ id: 'host', name: 'Host', hostname: 'host.example.com' });
    await expectReject(
      () => store.upsertProject({ id: 'empty', name: 'Empty', path: 'stale', type: 'ssh', sshHostId: 'host', remotePath: '   ' }),
      /remote path cannot be empty/i
    );
  }

  {
    const { store } = await createStore(baseState([], [
      { id: 'known', name: 'Known', hostname: 'known.example.com', username: 'dev' }
    ]));
    const before = JSON.parse(JSON.stringify(store.state));

    await expectReject(
      () => store.upsertProject({
        id: 'partial-host',
        name: 'Missing Remote Path',
        path: 'dev@legacy.example.com:/repo',
        type: 'ssh',
        sshHostId: 'missing'
      }),
      /Missing Remote Path.*remotePath/i
    );
    assert.deepStrictEqual(store.state, before, 'an sshHostId-only upsert is atomic');

    await expectReject(
      () => store.upsertProject({
        id: 'partial-path',
        name: 'Missing Host Reference',
        path: 'dev@legacy.example.com:/repo',
        type: 'ssh',
        remotePath: '/repo'
      }),
      /Missing Host Reference.*sshHostId/i
    );
    assert.deepStrictEqual(store.state, before, 'a remotePath-only upsert is atomic');

    await expectReject(
      () => store.upsertProject({
        id: 'local-managed-field',
        name: 'Local With Host',
        path: 'C:\\repo',
        type: 'local',
        sshHostId: 'known'
      }),
      /Local With Host.*non-SSH/i
    );
    assert.deepStrictEqual(store.state, before, 'managed SSH fields on local projects are rejected atomically');

    await store.upsertProject({
      id: 'legacy-upsert',
      name: 'Legacy Upsert',
      path: 'dev@legacy.example.com:/repo',
      type: 'ssh'
    });
    const legacy = store.state.projects.find(project => project.id === 'legacy-upsert');
    assert.strictEqual(legacy.remotePath, '/repo');
    assert.ok(legacy.sshHostId);
    assert.strictEqual(legacy.path, 'dev@legacy.example.com:/repo');
  }

  {
    const { store, configPath } = await createStore({
      projects: [{ id: 'bad', name: 'Bad', path: 'broken', type: 'ssh' }]
    });
    const beforeState = JSON.parse(JSON.stringify(store.state));
    const beforeWarnings = JSON.parse(JSON.stringify(store.migrationWarnings));
    const beforeDisk = readJson(configPath);
    let notifications = 0;
    store.setOnChangeCallback(() => { notifications += 1; });
    failNextWrite = true;
    await expectReject(
      () => store.addSshHost({ id: 'new', name: 'New', hostname: 'new.example.com' }),
      /simulated write failure/
    );
    assert.deepStrictEqual(store.state, beforeState);
    assert.deepStrictEqual(store.migrationWarnings, beforeWarnings);
    assert.deepStrictEqual(readJson(configPath), beforeDisk);
    assert.strictEqual(notifications, 0);
  }

  {
    const malformed = { id: 'warning', name: 'Warning', path: 'broken', type: 'ssh' };
    const { store, configPath } = await createStore({ projects: [malformed] });
    const beforeState = JSON.parse(JSON.stringify(store.state));
    const beforeWarnings = JSON.parse(JSON.stringify(store.migrationWarnings));

    const importUri = uri('C:\\imports\\partial-v2.json');
    putJson(importUri.fsPath, baseState([
      {
        id: 'import-partial',
        name: 'Import Missing Host',
        path: 'dev@import.example.com:/repo',
        type: 'ssh',
        remotePath: '/repo'
      }
    ]));
    await expectReject(() => store.importFromFile(importUri), /Import Missing Host.*sshHostId/i);
    assert.deepStrictEqual(store.state, beforeState, 'invalid v2 import leaves state unchanged');
    assert.deepStrictEqual(store.migrationWarnings, beforeWarnings, 'invalid v2 import leaves warnings unchanged');

    putJson(configPath, baseState([
      {
        id: 'reload-partial',
        name: 'Reload Missing Path',
        path: 'dev@reload.example.com:/repo',
        type: 'ssh-workspace',
        sshHostId: 'missing'
      }
    ]));
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      await expectReject(() => store.reload(), /Reload Missing Path.*remotePath/i);
    } finally {
      console.error = originalConsoleError;
    }
    assert.deepStrictEqual(store.state, beforeState, 'invalid v2 reload leaves state unchanged');
    assert.deepStrictEqual(store.migrationWarnings, beforeWarnings, 'invalid v2 reload leaves warnings unchanged');
  }

  {
    const sourceRoot = 'C:\\roundtrip-source';
    const { store: source } = await createStore(baseState([], [], { viewMode: 'list', outlineMode: 'host' }), sourceRoot);
    await source.addSshHost({ id: 'host', name: 'Host', hostname: 'host.example.com', username: 'dev' });
    await source.upsertProject({
      id: 'remote', name: 'Remote', path: 'stale', type: 'ssh', sshHostId: 'host', remotePath: '/repo'
    });
    const exportUri = uri('C:\\exports\\config.json');
    await source.exportToFile(exportUri);
    const exported = readJson(exportUri.fsPath);
    assert.strictEqual(exported.schemaVersion, 2);
    assert.deepStrictEqual(exported.sshHosts, source.state.sshHosts);
    assert.deepStrictEqual(exported.projects, source.state.projects);
    assert.deepStrictEqual(exported.uiSettings, source.state.uiSettings);
    assert.ok(!Object.hasOwn(exported, 'migrationWarnings'));

    const { store: imported } = await createStore(baseState(), 'C:\\roundtrip-target', false);
    await imported.importFromFile(exportUri);
    assert.deepStrictEqual(imported.state, source.state);

    const workspaceUri = uri('C:\\imports\\legacy-workspace.json');
    putJson(workspaceUri.fsPath, { folders: [{ name: 'Legacy Folder', path: 'C:\\work\\legacy' }] });
    await imported.importFromFile(workspaceUri);
    assert.strictEqual(imported.state.schemaVersion, 2);
    assert.deepStrictEqual(imported.state.sshHosts, []);
    assert.deepStrictEqual(
      imported.state.projects.map(project => [project.name, project.path, project.type]),
      [['Legacy Folder', 'C:\\work\\legacy', 'workspace']]
    );
  }

  {
    const good = baseState(
      [{ id: 'local', name: 'Local', path: 'C:\\repo', type: 'local' }],
      [],
      { outlineMode: 'flat' }
    );
    const { store, configPath } = await createStore(good);
    const before = JSON.parse(JSON.stringify(store.state));
    let notifications = 0;
    store.setOnChangeCallback(() => { notifications += 1; });
    putJson(configPath, baseState([
      { id: 'broken', name: 'Broken', path: 'stale', type: 'ssh', sshHostId: 'missing', remotePath: '/repo' }
    ]));
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      await expectReject(() => store.reload(), /Host missing was not found/i);
      assert.deepStrictEqual(store.state, before, 'manual reload preserves last good state');
      assert.strictEqual(notifications, 0);

      await activeWatcher.fireChange();
      assert.deepStrictEqual(store.state, before, 'watcher reload preserves last good state');
      assert.strictEqual(notifications, 0);
      assert.ok(warningMessages.length > 0);
    } finally {
      console.error = originalConsoleError;
    }
  }

  console.log('store tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
