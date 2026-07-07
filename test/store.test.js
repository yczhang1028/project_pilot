const assert = require('assert');
const path = require('path');
const Module = require('module');

const files = new Map();
const directories = new Set();
const infoMessages = [];
const warningMessages = [];
let failNextWrite = false;
let failBackupWrites = false;
let triggerWatcherOnWrite = false;
let autoBackupEnabled = true;
let writeAttempts = 0;
let currentConfigPath;
let activeWatcher;
const writeBehaviors = [];
const readBehaviors = [];
const watcherTasks = [];
const writeTargets = [];

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const result = {
    settled: false,
    promise: new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve(value) {
      result.settled = true;
      resolvePromise(value);
    },
    reject(error) {
      result.settled = true;
      rejectPromise(error);
    }
  };
  return result;
}

function planWrite({ hold = false, error, match = () => true } = {}) {
  const started = deferred();
  const release = deferred();
  if (!hold) release.resolve();
  const behavior = { started, release, error, match };
  writeBehaviors.push(behavior);
  return behavior;
}

function planRead({ hold = false, error, match = () => true } = {}) {
  const started = deferred();
  const release = deferred();
  if (!hold) release.resolve();
  const behavior = { started, release, error, match };
  readBehaviors.push(behavior);
  return behavior;
}

async function drainWatcherTasks() {
  let consumed = 0;
  while (consumed < watcherTasks.length) {
    const batch = watcherTasks.slice(consumed);
    consumed = watcherTasks.length;
    await Promise.all(batch);
  }
}

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

class FileSystemError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FileSystemError';
    this.code = code;
  }

  static FileNotFound(target) {
    return new FileSystemError(`File not found: ${target.fsPath}`, 'FileNotFound');
  }
}

function takeBehavior(behaviors, target) {
  const index = behaviors.findIndex(behavior => behavior.match(target));
  return index >= 0 ? behaviors.splice(index, 1)[0] : undefined;
}

function watcherMatches(target) {
  if (!activeWatcher) return false;
  const basePath = activeWatcher.pattern.base.fsPath;
  const relative = path.win32.relative(basePath, target.fsPath);
  return activeWatcher.pattern.pattern === 'projects.json'
    ? relative === 'projects.json'
    : activeWatcher.pattern.pattern === '*'
      && relative.length > 0
      && !relative.startsWith('..')
      && !relative.includes(path.win32.sep);
}

const vscodeMock = {
  Uri: {
    file: uri,
    joinPath(base, ...parts) {
      return uri(path.win32.join(base.fsPath, ...parts));
    }
  },
  RelativePattern,
  FileSystemError,
  FileType: { File: 1, Directory: 2 },
  workspace: {
    fs: {
      async createDirectory(target) {
        directories.add(target.fsPath);
      },
      async readFile(target) {
        const value = files.get(target.fsPath);
        const captured = value ? Buffer.from(value) : undefined;
        const behavior = takeBehavior(readBehaviors, target);
        if (behavior) {
          behavior.started.resolve();
          await behavior.release.promise;
          if (behavior.error) throw behavior.error;
        }
        if (!captured) throw FileSystemError.FileNotFound(target);
        return Uint8Array.from(captured);
      },
      async writeFile(target, data) {
        writeAttempts += 1;
        writeTargets.push(target.fsPath);
        const behavior = takeBehavior(writeBehaviors, target);
        if (behavior) {
          behavior.started.resolve();
          await behavior.release.promise;
          if (behavior.error) throw behavior.error;
        }
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error('simulated write failure');
        }
        if (failBackupWrites && target.fsPath.includes(`${path.win32.sep}backups${path.win32.sep}`)) {
          throw new Error('simulated backup write failure');
        }
        const existed = files.has(target.fsPath);
        files.set(target.fsPath, Buffer.from(data));
        if (triggerWatcherOnWrite && watcherMatches(target)) {
          const task = Promise.resolve().then(() => existed
            ? activeWatcher.fireChange(target)
            : activeWatcher.fireCreate(target));
          watcherTasks.push(task);
        }
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
    createFileSystemWatcher(pattern) {
      const changeHandlers = [];
      const createHandlers = [];
      activeWatcher = {
        pattern,
        onDidChange(handler) {
          changeHandlers.push(handler);
          return { dispose() {} };
        },
        onDidCreate(handler) {
          createHandlers.push(handler);
          return { dispose() {} };
        },
        async fireChange(target = uri(currentConfigPath)) {
          await Promise.all(changeHandlers.map(handler => handler(target)));
        },
        async fireCreate(target = uri(currentConfigPath)) {
          await Promise.all(createHandlers.map(handler => handler(target)));
        },
        dispose() {}
      };
      return activeWatcher;
    },
    getConfiguration() {
      return {
        get(key, fallback) {
          return key === 'autoBackup' ? autoBackupEnabled : fallback;
        }
      };
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
  failBackupWrites = false;
  triggerWatcherOnWrite = false;
  autoBackupEnabled = true;
  writeAttempts = 0;
  currentConfigPath = undefined;
  activeWatcher = undefined;
  writeBehaviors.length = 0;
  readBehaviors.length = 0;
  watcherTasks.length = 0;
  writeTargets.length = 0;
}

async function createStore(initial, root = 'C:\\store-tests', reset = true) {
  if (reset) resetFs();
  const configPath = path.win32.join(root, 'data', 'projects.json');
  currentConfigPath = configPath;
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
    const duplicateV2 = baseState([
      { id: 'duplicate', name: 'First', path: 'C:\\first', type: 'local' },
      { id: 'duplicate', name: 'Second', path: 'C:\\second', type: 'local' }
    ]);
    await expectReject(() => createStore(duplicateV2), /duplicate project id.*duplicate/i);
    await expectReject(
      () => createStore(baseState([{ name: 'Missing ID', path: 'C:\\missing', type: 'local' }])),
      /project id.*nonempty/i
    );
    await expectReject(
      () => createStore(baseState([{ id: '   ', name: 'Blank ID', path: 'C:\\blank', type: 'local' }])),
      /project id.*nonempty/i
    );
  }

  {
    const { store, configPath } = await createStore(baseState([
      { id: 'good', name: 'Good', path: 'C:\\good', type: 'local' }
    ]));
    const beforeState = JSON.parse(JSON.stringify(store.state));
    const beforeDisk = readJson(configPath);
    const duplicateState = baseState([
      { id: 'duplicate', name: 'First', path: 'C:\\first', type: 'local' },
      { id: 'duplicate', name: 'Second', path: 'C:\\second', type: 'local' }
    ]);

    const importUri = uri('C:\\imports\\duplicate-v2.json');
    putJson(importUri.fsPath, duplicateState);
    const backupWritesBefore = writeTargets.filter(
      target => target.includes(`${path.win32.sep}backups${path.win32.sep}`)
    ).length;
    await expectReject(() => store.importFromFile(importUri), /duplicate project id.*duplicate/i);
    assert.deepStrictEqual(store.state, beforeState, 'duplicate v2 import is atomic');
    assert.deepStrictEqual(readJson(configPath), beforeDisk, 'duplicate v2 import does not overwrite disk');
    assert.strictEqual(
      writeTargets.filter(target => target.includes(`${path.win32.sep}backups${path.win32.sep}`)).length,
      backupWritesBefore,
      'duplicate v2 import is rejected before backup preprocessing'
    );

    putJson(configPath, duplicateState);
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      await expectReject(() => store.reload(), /duplicate project id.*duplicate/i);
    } finally {
      console.error = originalConsoleError;
    }
    assert.deepStrictEqual(store.state, beforeState, 'duplicate v2 reload preserves the last good state');
  }

  {
    const existing = { id: 'taken', name: 'Existing', path: 'C:\\existing', type: 'local' };
    const { store } = await createStore(baseState([existing]));
    const duplicateInput = { id: 'taken', name: 'Duplicate', path: 'C:\\duplicate', type: 'local' };
    const before = JSON.parse(JSON.stringify(store.state));
    await expectReject(() => store.addProject(duplicateInput), /duplicate project id.*taken/i);
    assert.deepStrictEqual(store.state, before, 'duplicate addProject is atomic');
    assert.deepStrictEqual(
      duplicateInput,
      { id: 'taken', name: 'Duplicate', path: 'C:\\duplicate', type: 'local' },
      'duplicate addProject does not mutate its input'
    );
  }

  {
    const collisionRandom = 0.5;
    const generatedCollision = collisionRandom.toString(36).slice(2, 10);
    const { store } = await createStore(baseState([
      { id: generatedCollision, name: 'Existing', path: 'C:\\existing', type: 'local' }
    ]));
    const firstInput = { name: 'Generated One', path: 'C:\\generated-one', type: 'local' };
    const secondInput = { name: 'Generated Two', path: 'C:\\generated-two', type: 'local' };
    const originalRandom = Math.random;
    Math.random = () => collisionRandom;
    try {
      await store.addProject(firstInput);
      await store.addProject(secondInput);
    } finally {
      Math.random = originalRandom;
    }
    const ids = store.state.projects.map(project => project.id);
    assert.ok(ids.every(id => typeof id === 'string' && id.trim().length > 0));
    assert.strictEqual(new Set(ids).size, ids.length, 'generated project IDs remain unique after collisions');
    assert.deepStrictEqual(firstInput, { name: 'Generated One', path: 'C:\\generated-one', type: 'local' });
    assert.deepStrictEqual(secondInput, { name: 'Generated Two', path: 'C:\\generated-two', type: 'local' });
  }

  {
    const collisionRandom = 0.5;
    const reservedLegacyId = collisionRandom.toString(36).slice(2, 10);
    const originalRandom = Math.random;
    Math.random = () => collisionRandom;
    try {
      const { store } = await createStore({
        projects: [
          { name: 'Missing Before Reserved', path: 'C:\\missing-first', type: 'local' },
          { id: reservedLegacyId, name: 'Keep Reserved', path: 'C:\\reserved', type: 'local' },
          { id: reservedLegacyId, name: 'Repair Reserved Duplicate', path: 'C:\\reserved-duplicate', type: 'local' }
        ]
      });
      const ids = store.state.projects.map(project => project.id);
      assert.strictEqual(ids[1], reservedLegacyId, 'legacy repair reserves the first explicit valid ID');
      assert.strictEqual(new Set(ids).size, ids.length);
    } finally {
      Math.random = originalRandom;
    }
  }

  {
    const legacyProjects = [
      { id: 'legacy-id', name: 'Keep ID', path: 'C:\\keep', type: 'local' },
      { id: 'legacy-id', name: 'Repair Duplicate', path: 'C:\\duplicate', type: 'local' },
      { name: 'Repair Missing', path: 'C:\\missing', type: 'local' },
      { id: '   ', name: 'Repair Blank', path: 'C:\\blank', type: 'local' }
    ];
    const { store: startupStore } = await createStore({ projects: legacyProjects });
    const startupIds = startupStore.state.projects.map(project => project.id);
    assert.strictEqual(startupStore.state.projects.length, legacyProjects.length);
    assert.strictEqual(startupIds[0], 'legacy-id', 'legacy policy preserves the first valid ID');
    assert.ok(startupIds.every(id => typeof id === 'string' && id.trim().length > 0));
    assert.strictEqual(new Set(startupIds).size, startupIds.length, 'legacy startup repairs duplicate/missing IDs');

    const { store: importStore, configPath } = await createStore(baseState(), 'C:\\legacy-id-import');
    const importUri = uri('C:\\imports\\legacy-project-ids.json');
    putJson(importUri.fsPath, { projects: legacyProjects });
    await importStore.importFromFile(importUri);
    const importedIds = importStore.state.projects.map(project => project.id);
    assert.strictEqual(importStore.state.projects.length, legacyProjects.length, 'legacy repair preserves every project');
    assert.strictEqual(importedIds[0], 'legacy-id');
    assert.ok(importedIds.every(id => typeof id === 'string' && id.trim().length > 0));
    assert.strictEqual(new Set(importedIds).size, importedIds.length, 'legacy import repairs duplicate/missing IDs');
    assert.deepStrictEqual(readJson(configPath).projects.map(project => project.id), importedIds);
    await importStore.reload();
    assert.deepStrictEqual(
      importStore.state.projects.map(project => project.id),
      importedIds,
      'persisted repaired IDs remain deterministic on reload'
    );
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
    const beforeDuplicateSelection = JSON.parse(JSON.stringify(store.state));
    await expectReject(
      () => store.migrateSshHostProjects('source', 'target', ['b', 'b']),
      /duplicate selected project id.*b/i
    );
    assert.deepStrictEqual(store.state, beforeDuplicateSelection, 'duplicate migration selections are atomic');
    await expectReject(() => store.migrateSshHostProjects('source', 'target', ['target-project']), /does not belong.*source/i);
    await expectReject(() => store.migrateSshHostProjects('source', 'missing'), /target.*not found/i);
    await store.migrateSshHostProjects('source', 'target');
    assert.strictEqual(store.state.projects.find(project => project.id === 'b').sshHostId, 'target');
    assert.strictEqual(store.state.projects.find(project => project.id === 'b').remotePath, '/srv/b');
  }

  {
    const hosts = [
      { id: 'source', name: 'Source', hostname: 'source.example.com' },
      { id: 'target', name: 'Target', hostname: 'target.example.com' }
    ];
    const { store } = await createStore(baseState([
      { id: 'dup', name: 'Captured', path: 'old', type: 'ssh', sshHostId: 'source', remotePath: '/captured' },
      { id: 'existing', name: 'Existing', path: 'old', type: 'ssh', sshHostId: 'source', remotePath: '/existing' }
    ], hosts));
    const capturedIds = ['dup'];
    await expectReject(
      () => store.addProject({
        id: 'dup',
        name: 'Duplicate Attempt',
        path: 'old',
        type: 'ssh',
        sshHostId: 'source',
        remotePath: '/duplicate'
      }),
      /duplicate project id.*dup/i
    );
    await store.addProject({
      id: 'newly-linked',
      name: 'Newly Linked',
      path: 'old',
      type: 'ssh',
      sshHostId: 'source',
      remotePath: '/newly-linked'
    });
    await store.migrateSshHostProjects('source', 'target', capturedIds);
    assert.deepStrictEqual(
      store.state.projects.map(project => [project.id, project.sshHostId]),
      [['dup', 'target'], ['existing', 'source'], ['newly-linked', 'source']],
      'migration moves exactly the IDs captured before confirmation'
    );
  }

  {
    const hosts = [
      { id: 'source', name: 'Source', hostname: 'source.example.com' },
      { id: 'target', name: 'Target', hostname: 'target.example.com' }
    ];
    const { store } = await createStore(baseState([
      { id: 'ambiguous', name: 'One', path: 'old', type: 'ssh', sshHostId: 'source', remotePath: '/one' }
    ], hosts));
    store.state.projects.push({
      id: 'ambiguous',
      name: 'Corrupt Duplicate',
      path: 'old',
      type: 'ssh',
      sshHostId: 'source',
      remotePath: '/two'
    });
    await expectReject(
      () => store.migrateSshHostProjects('source', 'target', ['ambiguous']),
      /project ambiguous.*exactly one|not unique/i
    );
    assert.ok(store.state.projects.every(project => project.sshHostId === 'source'));
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

  {
    const { store, configPath } = await createStore(baseState());
    let notifications = 0;
    store.setOnChangeCallback(() => { notifications += 1; });
    const firstWrite = planWrite({
      hold: true,
      error: new Error('first mutation failed'),
      match: target => target.fsPath === configPath
    });
    const secondWrite = planWrite({ match: target => target.fsPath === configPath });
    const failedInput = { name: 'Failed A', path: 'C:\\failed-a', type: 'local' };
    const succeedingInput = { name: 'Succeeded B', path: 'C:\\succeeded-b', type: 'local' };

    const firstMutation = store.addProject(failedInput);
    await firstWrite.started.promise;
    const secondMutation = store.upsertProject(succeedingInput);
    await Promise.resolve();
    const secondWaited = !secondWrite.started.settled;
    firstWrite.release.resolve();
    const [firstResult, secondResult] = await Promise.allSettled([firstMutation, secondMutation]);

    assert.strictEqual(secondWaited, true, 'a later mutation waits for the pending write');
    assert.strictEqual(firstResult.status, 'rejected');
    assert.match(firstResult.reason.message, /first mutation failed/);
    assert.strictEqual(secondResult.status, 'fulfilled');
    assert.deepStrictEqual(store.state.projects.map(project => project.name), ['Succeeded B']);
    assert.deepStrictEqual(readJson(configPath).projects.map(project => project.name), ['Succeeded B']);
    assert.strictEqual(notifications, 1);
    assert.deepStrictEqual(failedInput, { name: 'Failed A', path: 'C:\\failed-a', type: 'local' });
    assert.deepStrictEqual(succeedingInput, { name: 'Succeeded B', path: 'C:\\succeeded-b', type: 'local' });
  }

  {
    const { store, configPath } = await createStore(baseState());
    let notifications = 0;
    store.setOnChangeCallback(() => { notifications += 1; });
    const firstWrite = planWrite({ hold: true, match: target => target.fsPath === configPath });
    const secondWrite = planWrite({ match: target => target.fsPath === configPath });
    const firstInput = { name: 'First', path: 'C:\\first', type: 'local' };
    const secondInput = { name: 'Second', path: 'C:\\second', type: 'local' };

    const firstMutation = store.addProject(firstInput);
    await firstWrite.started.promise;
    const secondMutation = store.upsertProject(secondInput);
    await Promise.resolve();
    const secondWaited = !secondWrite.started.settled;
    firstWrite.release.resolve();
    await Promise.all([firstMutation, secondMutation]);

    assert.strictEqual(secondWaited, true, 'successful writes retain request order');
    assert.deepStrictEqual(store.state.projects.map(project => project.name), ['First', 'Second']);
    assert.deepStrictEqual(readJson(configPath).projects.map(project => project.name), ['First', 'Second']);
    assert.strictEqual(notifications, 2);
    assert.deepStrictEqual(firstInput, { name: 'First', path: 'C:\\first', type: 'local' });
    assert.deepStrictEqual(secondInput, { name: 'Second', path: 'C:\\second', type: 'local' });
  }

  {
    const { store, configPath } = await createStore(baseState());
    const watchedDirectory = path.win32.dirname(configPath);
    const watcherTargetsFile = activeWatcher.pattern.base.fsPath === watchedDirectory
      && activeWatcher.pattern.pattern === 'projects.json';
    triggerWatcherOnWrite = true;
    infoMessages.length = 0;
    let notifications = 0;
    store.setOnChangeCallback(() => { notifications += 1; });

    await store.addProject({ id: 'self-write', name: 'Self Write', path: 'C:\\self', type: 'local' });
    await drainWatcherTasks();

    assert.strictEqual(watcherTargetsFile, true, 'the watcher targets projects.json from its directory');
    assert.strictEqual(notifications, 1, 'a self-write emits one logical store notification');
    assert.deepStrictEqual(infoMessages, [], 'a self-write does not show a reload toast');
  }

  {
    const { store, configPath } = await createStore(baseState());
    infoMessages.length = 0;
    let notifications = 0;
    store.setOnChangeCallback(() => { notifications += 1; });
    putJson(configPath, baseState([
      { id: 'older', name: 'Older', path: 'C:\\older', type: 'local' }
    ]));
    const olderRead = planRead({ hold: true, match: target => target.fsPath === configPath });
    const olderEvent = activeWatcher.fireChange();
    await olderRead.started.promise;

    putJson(configPath, baseState([
      { id: 'newer', name: 'Newer', path: 'C:\\newer', type: 'local' }
    ]));
    const newerEvent = activeWatcher.fireChange();
    olderRead.release.resolve();
    await Promise.all([olderEvent, newerEvent]);

    assert.deepStrictEqual(store.state.projects.map(project => project.name), ['Newer']);
    assert.strictEqual(notifications, 2, 'each distinct external state emits one callback');
    assert.strictEqual(
      infoMessages.filter(message => message === 'Project Pilot configuration reloaded').length,
      2,
      'each distinct external state emits one reload toast'
    );
  }

  {
    const invalidStartupStates = [
      [{ schemaVersion: 2, projects: [] }, /sshHosts.*array/i],
      [baseState([{}]), /project.*name/i]
    ];
    for (const [invalid, pattern] of invalidStartupStates) {
      await expectReject(() => createStore(invalid), pattern);
    }
  }

  {
    const { store, configPath } = await createStore(baseState());
    const beforeState = JSON.parse(JSON.stringify(store.state));
    const beforeWarnings = JSON.parse(JSON.stringify(store.migrationWarnings));
    const invalidProjects = [
      [{ name: 'Bad Type', path: 'C:\\repo', type: 'bogus' }, /type/i],
      [{ name: 42, path: 'C:\\repo', type: 'local' }, /name/i],
      [{ name: 'Bad Path', path: 42, type: 'local' }, /path/i],
      [{ name: 'Bad ID', path: 'C:\\repo', type: 'local', id: 42 }, /id/i],
      [{ name: 'Bad Description', path: 'C:\\repo', type: 'local', description: 42 }, /description/i],
      [{ name: 'Bad Icon', path: 'C:\\repo', type: 'local', icon: 42 }, /icon/i],
      [{ name: 'Bad Color', path: 'C:\\repo', type: 'local', color: 42 }, /color/i],
      [{ name: 'Bad Tags', path: 'C:\\repo', type: 'local', tags: ['ok', 42] }, /tags/i],
      [{ name: 'Bad Group', path: 'C:\\repo', type: 'local', group: 42 }, /group/i],
      [{ name: 'Bad Favorite', path: 'C:\\repo', type: 'local', isFavorite: 'yes' }, /isFavorite/i],
      [{ name: 'Bad Count', path: 'C:\\repo', type: 'local', clickCount: 'many' }, /clickCount/i],
      [{ name: 'Bad Access', path: 'C:\\repo', type: 'local', lastAccessed: 42 }, /lastAccessed/i]
    ];
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      for (const [project, pattern] of invalidProjects) {
        putJson(configPath, baseState([project]));
        await expectReject(() => store.reload(), pattern);
        assert.deepStrictEqual(store.state, beforeState);
        assert.deepStrictEqual(store.migrationWarnings, beforeWarnings);
      }
    } finally {
      console.error = originalConsoleError;
    }
  }

  {
    const { store, configPath } = await createStore(baseState([
      { id: 'good', name: 'Good', path: 'C:\\good', type: 'local' }
    ]));
    const beforeState = JSON.parse(JSON.stringify(store.state));
    const beforeDisk = readJson(configPath);
    const badSettings = [
      [{ compactMode: 'yes' }, /compactMode/i],
      [{ viewMode: 'bogus' }, /viewMode/i],
      [{ selectedGroup: 42 }, /selectedGroup/i],
      [{ outlineMode: 'bogus' }, /outlineMode/i]
    ];
    for (let index = 0; index < badSettings.length; index += 1) {
      const [uiSettings, pattern] = badSettings[index];
      const importUri = uri(`C:\\imports\\bad-settings-${index}.json`);
      putJson(importUri.fsPath, baseState([], [], uiSettings));
      const backupWritesBefore = writeTargets.filter(target => target.includes(`${path.win32.sep}backups${path.win32.sep}`)).length;
      await expectReject(() => store.importFromFile(importUri), pattern);
      const backupWritesAfter = writeTargets.filter(target => target.includes(`${path.win32.sep}backups${path.win32.sep}`)).length;
      assert.strictEqual(backupWritesAfter, backupWritesBefore, 'invalid imports do not create backups');
      assert.deepStrictEqual(store.state, beforeState);
      assert.deepStrictEqual(readJson(configPath), beforeDisk);
    }

    const missingHostsUri = uri('C:\\imports\\missing-hosts.json');
    putJson(missingHostsUri.fsPath, { schemaVersion: 2, projects: [] });
    const backupWritesBefore = writeTargets.filter(target => target.includes(`${path.win32.sep}backups${path.win32.sep}`)).length;
    await expectReject(() => store.importFromFile(missingHostsUri), /sshHosts.*array/i);
    const backupWritesAfter = writeTargets.filter(target => target.includes(`${path.win32.sep}backups${path.win32.sep}`)).length;
    assert.strictEqual(backupWritesAfter, backupWritesBefore);
    assert.deepStrictEqual(store.state, beforeState);

    const missingProjectsUri = uri('C:\\imports\\missing-projects.json');
    putJson(missingProjectsUri.fsPath, { schemaVersion: 2, sshHosts: [] });
    const missingProjectsBackupCount = writeTargets.filter(
      target => target.includes(`${path.win32.sep}backups${path.win32.sep}`)
    ).length;
    await expectReject(() => store.importFromFile(missingProjectsUri), /projects.*array/i);
    assert.strictEqual(
      writeTargets.filter(target => target.includes(`${path.win32.sep}backups${path.win32.sep}`)).length,
      missingProjectsBackupCount
    );
    assert.deepStrictEqual(store.state, beforeState);
  }

  {
    resetFs();
    const root = 'C:\\permission-error';
    const configPath = path.win32.join(root, 'data', 'projects.json');
    currentConfigPath = configPath;
    planRead({
      error: new FileSystemError('permission denied', 'NoPermissions'),
      match: target => target.fsPath === configPath
    });
    const store = new ConfigStore({ globalStorageUri: uri(root) });
    await expectReject(() => store.init(), /permission denied/i);
    assert.strictEqual(writeAttempts, 0, 'startup read errors never replace config with demo data');
  }

  {
    const { store, configPath } = await createStore(baseState([
      { id: 'before', name: 'Before', path: 'C:\\before', type: 'local' }
    ]));
    const beforeState = JSON.parse(JSON.stringify(store.state));
    const beforeDisk = readJson(configPath);
    const importUri = uri('C:\\imports\\valid-for-backup-failure.json');
    putJson(importUri.fsPath, baseState([
      { id: 'after', name: 'After', path: 'C:\\after', type: 'local' }
    ]));
    failBackupWrites = true;
    const originalConsoleWarn = console.warn;
    console.warn = () => {};
    try {
      await expectReject(() => store.importFromFile(importUri), /backup write failure/i);
    } finally {
      console.warn = originalConsoleWarn;
    }
    assert.deepStrictEqual(store.state, beforeState);
    assert.deepStrictEqual(readJson(configPath), beforeDisk);

    autoBackupEnabled = false;
    await store.importFromFile(importUri);
    assert.deepStrictEqual(store.state.projects.map(project => project.name), ['After']);
  }

  console.log('store tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
