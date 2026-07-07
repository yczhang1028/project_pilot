# SSH Host Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class SSH Host records that can be edited once and reused by multiple projects, with Host management in the Manager webview and native OUTLINE TreeView.

**Architecture:** Add a pure SSH Host domain module for validation, migration, path resolution, and grouping; keep `ConfigStore` as the only mutation and persistence boundary. All open, display, copy, test, import/export, Manager, and OUTLINE flows consume the same resolved Host-plus-remote-path model while retaining a legacy `path` compatibility snapshot.

**Tech Stack:** VS Code Extension API 1.90, TypeScript 5.5/CommonJS, React 18, Vite, TailwindCSS, Node `assert` tests, OpenSSH CLI.

---

## Working-tree safety

The workspace already contains user-owned changes in `.vscode/launch.json`, `package.json`, `src/projectPath.ts`, `src/sshPath.ts`, `src/sshResolve.ts`, `webview-ui/src/ui/App.tsx`, `AGENTS.md`, and `test/`. Preserve those changes.

Before every commit:

```powershell
git diff --cached --check
git diff --cached --name-only
```

Never stage `.vscode/launch.json`, `AGENTS.md`, or an unrelated hunk. Use `git add -p` for a tracked file that was dirty before this feature. If a coherent feature hunk cannot be separated from a user-owned hunk, leave that file unstaged and record the verified working-tree result instead of committing the user's work.

## File structure

- Create `src/sshHosts.ts`: pure Host types, validation, legacy migration, managed-project resolution, compatibility-path materialization, and Host buckets for OUTLINE.
- Create `src/sshHostMessages.ts`: transport-neutral handling for Host CRUD, migration, and test messages.
- Modify `src/sshPath.ts`: lossless structured Remote-SSH authority parsing/encoding, including username and port, while preserving existing APIs.
- Modify `src/sshResolve.ts`: resolve Host records and perform bounded non-interactive OpenSSH probes with classified failures.
- Modify `src/store.ts`: schema version 2 normalization, transactional Host mutations, rollback, import/export, and migration warnings.
- Modify `src/projectPath.ts`: retain existing normalization and delegate managed SSH resolution to the Host domain module.
- Modify `src/managerViewProvider.ts`: route Host messages and publish Host state/results.
- Modify `src/outlineTreeProvider.ts`: replace `target` mode with `host`, render Host nodes, and expose Host context values.
- Modify `src/extension.ts`: register Host/OUTLINE commands, use managed paths for opening/copying/testing, and route fullscreen messages.
- Modify `package.json`: add Host commands, OUTLINE menus, and test scripts.
- Create `webview-ui/src/ui/model.ts`: shared webview types for projects, Hosts, warnings, UI state, and Host message results.
- Create `webview-ui/src/ui/SshHostManager.tsx`: focused Host list/editor modal.
- Modify `webview-ui/src/ui/App.tsx`: integrate Host state, Host manager, and Host-plus-remote-path project editing without discarding existing SSH UI fixes.
- Create `test/sshHosts.test.js`: domain validation, migration, resolution, materialization, and grouping tests.
- Create `test/store.test.js`: in-memory VS Code filesystem tests for persistence transactions and rollback.
- Create `test/sshHostMessages.test.js`: message routing tests with a fake store and fake probe.
- Modify `test/sshPath.test.js`: structured authority username/port regression tests.
- Modify `test/sshResolve.test.js`: OpenSSH argument and error classification tests.
- Modify `docs/user-guide.md`, `docs/commands.md`, and `docs/development.md`: user behavior, commands, and manual verification.

### Task 1: Preserve and extend Remote-SSH authority handling

**Files:**
- Modify: `src/sshPath.ts`
- Modify: `test/sshPath.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add failing structured-authority tests**

Extend `test/sshPath.test.js` with assertions for a hex authority containing all supported fields:

```js
const {
  buildRemoteSshUriFromTarget,
  parseRemoteSshAuthority
} = require('../out/sshPath');

const structured = Buffer.from(JSON.stringify({
  hostName: '10.7.8.9',
  user: 'yichi',
  port: 2222
}), 'utf8').toString('hex');

assert.deepStrictEqual(parseRemoteSshAuthority(structured), {
  hostname: '10.7.8.9',
  username: 'yichi',
  port: 2222,
  structured: true
});

assert.strictEqual(
  buildRemoteSshUriFromTarget({ hostname: '10.7.8.9', username: 'yichi', port: 2222 }, 'C:/repo'),
  `vscode-remote://ssh-remote+${structured}/C:/repo`
);
```

Also assert that a plain lowercase hostname without user or port stays readable and that the existing local-username authority tests remain unchanged.

- [ ] **Step 2: Run the test and verify the new API is missing**

Run:

```powershell
npm run test:sshPath
```

Expected: FAIL because `parseRemoteSshAuthority` and `buildRemoteSshUriFromTarget` are not exported.

- [ ] **Step 3: Implement lossless authority parsing and encoding**

Add these public contracts to `src/sshPath.ts` and adapt existing normalization functions to consume them:

```ts
export interface SshAuthority {
  hostname: string;
  username?: string;
  port?: number;
  structured: boolean;
}

export interface SshTarget {
  hostname: string;
  username?: string;
  port?: number;
}

export function parseRemoteSshAuthority(value: string): SshAuthority {
  const decoded = safeDecode(value).trim();
  const payload = parseAuthorityObject(decoded);
  const hostname = payload && getStringProperty(payload, ['hostName', 'hostname', 'host']);
  const username = payload && getStringProperty(payload, ['user', 'username']);
  const rawPort = payload?.port;
  const port = typeof rawPort === 'number'
    ? rawPort
    : typeof rawPort === 'string' && /^\d+$/.test(rawPort)
      ? Number(rawPort)
      : undefined;

  if (hostname) {
    return { hostname, username, port, structured: true };
  }

  const at = decoded.lastIndexOf('@');
  return {
    hostname: at > 0 ? decoded.slice(at + 1) : decoded,
    username: at > 0 ? decoded.slice(0, at) : undefined,
    structured: false
  };
}

export function encodeRemoteSshAuthority(target: SshTarget): string {
  const mustStructure = Boolean(
    target.username || target.port || target.hostname !== target.hostname.toLowerCase() || /[\/\\+]/.test(target.hostname)
  );
  if (!mustStructure) return target.hostname;
  const payload = {
    hostName: target.hostname,
    ...(target.username ? { user: target.username } : {}),
    ...(target.port ? { port: target.port } : {})
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
}

export function buildRemoteSshUriFromTarget(target: SshTarget, remotePath: string): string {
  const authority = encodeRemoteSshAuthority(target);
  const path = normalizeRemoteSshPath(remotePath);
  return `vscode-remote://ssh-remote+${authority}${path.startsWith('/') ? path : `/${path}`}`;
}
```

Keep `parseRawSshPath`, `getRawSshPathFromRemoteUri`, `buildRemoteSshUri`, `normalizeRemoteSshUserHost`, and `extractHostnameFromSshPath` backward compatible. Structured URIs must retain `port`; readable raw paths may omit port only when no explicit custom port exists.

- [ ] **Step 4: Run authority tests**

Run:

```powershell
npm run test:sshPath
```

Expected: PASS with `sshPath tests passed`.

- [ ] **Step 5: Check and commit only separable feature hunks**

Run:

```powershell
git diff -- src/sshPath.ts test/sshPath.test.js package.json
git add -p -- src/sshPath.ts test/sshPath.test.js package.json
git diff --cached --check
git commit -m "fix: preserve Remote-SSH authority ports"
```

Expected: the staged diff contains only the new lossless authority behavior; pre-existing authority normalization remains unstaged if it cannot be separated safely.

### Task 2: Add the pure SSH Host domain model and migration

**Files:**
- Create: `src/sshHosts.ts`
- Create: `test/sshHosts.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing Host validation and migration tests**

Create `test/sshHosts.test.js` with concrete cases:

```js
const assert = require('assert');
const {
  buildHostBuckets,
  migrateSshState,
  resolveManagedSshProject,
  validateSshHost
} = require('../out/sshHosts');

const legacyState = {
  projects: [
    { id: 'a', name: 'A', type: 'ssh', path: 'yichi@10.7.8.9:/repo/a' },
    { id: 'b', name: 'B', type: 'ssh-workspace', path: 'yichi@10.7.8.9:/repo/b.code-workspace' },
    { id: 'bad', name: 'Bad', type: 'ssh', path: 'not-an-ssh-path' }
  ],
  uiSettings: { outlineMode: 'target' }
};

const migrated = migrateSshState(legacyState);
assert.strictEqual(migrated.state.schemaVersion, 2);
assert.strictEqual(migrated.state.sshHosts.length, 1);
assert.strictEqual(migrated.state.projects[0].sshHostId, migrated.state.sshHosts[0].id);
assert.strictEqual(migrated.state.projects[1].sshHostId, migrated.state.sshHosts[0].id);
assert.strictEqual(migrated.state.projects[2].sshHostId, undefined);
assert.strictEqual(migrated.warnings.length, 1);
assert.strictEqual(migrated.state.uiSettings.outlineMode, 'host');
assert.deepStrictEqual(migrateSshState(migrated.state).state, migrated.state);

assert.throws(
  () => validateSshHost({ id: 'x', name: 'GPU', hostname: 'host', port: 70000 }, []),
  /between 1 and 65535/
);
```

Add resolution assertions for Linux folders, Windows drive paths, custom ports, missing Host references, regenerated compatibility paths, and Host buckets that include an unused Host and a `Local` pseudo-host.

- [ ] **Step 2: Run the Host test and verify it fails**

Run:

```powershell
npm run build:ext
node test/sshHosts.test.js
```

Expected: FAIL with `Cannot find module '../out/sshHosts'`.

- [ ] **Step 3: Implement Host types and validation**

Create `src/sshHosts.ts` with these public types and deterministic helpers:

```ts
import type { ProjectItem, UISettings } from './store';
import { buildRemoteSshUriFromTarget, getRawSshPathFromRemoteUri, parseRawSshPath } from './sshPath';

export interface SshHost {
  id: string;
  name: string;
  hostname: string;
  username?: string;
  port?: number;
}

export interface SshMigrationWarning {
  projectId?: string;
  projectName: string;
  message: string;
}

export interface SshStateLike {
  schemaVersion?: number;
  sshHosts?: SshHost[];
  projects: ProjectItem[];
  uiSettings?: UISettings;
}

export interface ResolvedManagedSshProject {
  host: SshHost;
  remotePath: string;
  displayPath: string;
  compatibilityPath: string;
  remoteUri: string;
}

export function hostConnectionKey(host: Pick<SshHost, 'hostname' | 'username' | 'port'>): string {
  return JSON.stringify([
    host.username?.trim().toLowerCase() || null,
    host.hostname.trim().toLowerCase(),
    host.port ?? null
  ]);
}
```

`validateSshHost` trims fields, enforces case-insensitive unique names, validates ports, and rejects duplicate connection keys excluding the Host currently being edited.

- [ ] **Step 4: Implement idempotent migration and project resolution**

Implement these functions in `src/sshHosts.ts`:

```ts
export function migrateSshState(input: SshStateLike): {
  state: SshStateLike & { schemaVersion: 2; sshHosts: SshHost[] };
  warnings: SshMigrationWarning[];
  changed: boolean;
};

export function resolveManagedSshProject(
  project: ProjectItem,
  hosts: readonly SshHost[]
): ResolvedManagedSshProject;

export function materializeManagedProject(
  project: ProjectItem,
  hosts: readonly SshHost[]
): ProjectItem;

export function buildHostBuckets(
  projects: readonly ProjectItem[],
  hosts: readonly SshHost[]
): Array<{ hostId?: string; name: string; host?: SshHost; projects: ProjectItem[]; local: boolean }>;
```

Use stable generated IDs derived from the normalized legacy connection key plus collision-safe suffixing so a repeated migration produces byte-equivalent state. Preserve an unparseable legacy project and emit one warning. A managed project with a missing Host throws `SSH Host <id> was not found` from the resolver.

- [ ] **Step 5: Add and run the Host test script**

Add to `package.json`:

```json
"test:sshHosts": "npm run build:ext && node test/sshHosts.test.js"
```

Run:

```powershell
npm run test:sshHosts
```

Expected: PASS with `sshHosts tests passed`.

- [ ] **Step 6: Commit the new pure domain module**

Run:

```powershell
git add -- src/sshHosts.ts test/sshHosts.test.js
git add -p -- package.json
git diff --cached --check
git commit -m "feat: add reusable SSH host model"
```

Expected: commit contains the Host domain and its tests, not unrelated package changes.

### Task 3: Upgrade ConfigStore to schema version 2 with transactional mutations

**Files:**
- Modify: `src/store.ts`
- Create: `test/store.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write a failing in-memory store test**

Create `test/store.test.js`. Stub the VS Code filesystem before requiring the compiled store, then test startup migration, Host CRUD, delete protection, migration, and rollback:

```js
const assert = require('assert');
const Module = require('module');
const originalLoad = Module._load;
const files = new Map();
let failWrites = false;

const uri = value => ({ fsPath: value, path: value });
const watcher = { onDidChange() {}, dispose() {} };
const vscodeMock = {
  Uri: { joinPath: (base, ...parts) => uri([base.fsPath, ...parts].join('/')) },
  RelativePattern: class RelativePattern {},
  FileType: { File: 1 },
  workspace: {
    fs: {
      createDirectory: async () => {},
      readFile: async target => {
        if (!files.has(target.fsPath)) throw new Error('missing');
        return files.get(target.fsPath);
      },
      writeFile: async (target, data) => {
        if (failWrites) throw new Error('disk full');
        files.set(target.fsPath, data);
      }
    },
    createFileSystemWatcher: () => watcher
  },
  window: { showInformationMessage() {}, showWarningMessage() {} }
};

Module._load = (request, parent, isMain) => request === 'vscode'
  ? vscodeMock
  : originalLoad(request, parent, isMain);

const { ConfigStore } = require('../out/store');
```

Seed a legacy JSON state, call `init`, assert one deduplicated Host, update the Host, assert both compatibility paths change, reject deletion while referenced, migrate projects, and set `failWrites = true` to assert state rollback.

- [ ] **Step 2: Run the store test and verify missing methods**

Run:

```powershell
npm run build:ext
node test/store.test.js
```

Expected: FAIL because `addSshHost`, `updateSshHost`, `deleteSshHost`, and `migrateSshHostProjects` do not exist.

- [ ] **Step 3: Export schema-aware types and normalize every load path**

Update `src/store.ts`:

```ts
import {
  migrateSshState,
  materializeManagedProject,
  resolveManagedSshProject,
  validateSshHost,
  type SshHost,
  type SshMigrationWarning
} from './sshHosts';

export interface ProjectItem {
  id?: string;
  name: string;
  path: string;
  description?: string;
  icon?: string;
  color?: string;
  tags?: string[];
  group?: string;
  type: ProjectType;
  isFavorite?: boolean;
  clickCount?: number;
  lastAccessed?: string;
  sshHostId?: string;
  remotePath?: string;
}

export interface UISettings {
  compactMode?: boolean;
  viewMode?: 'grid' | 'list' | 'mini';
  selectedGroup?: string;
  outlineMode?: 'group' | 'host' | 'type' | 'flat';
}

export interface State {
  schemaVersion: 2;
  sshHosts: SshHost[];
  projects: ProjectItem[];
  uiSettings?: UISettings;
}
```

Add a private `applyIncomingState(raw)` method that calls `migrateSshState`, validates all references, materializes compatibility paths, sets `migrationWarnings`, and only then replaces `_state`. Call it from `init`, watcher reload, `reload`, import, and backup restore.

- [ ] **Step 4: Implement one rollback-safe mutation boundary**

Add this pattern and route existing project mutations through it:

```ts
private async commitState(mutator: (draft: State) => void): Promise<void> {
  const previous = this._state;
  const draft = structuredClone(previous);
  mutator(draft);
  draft.projects = draft.projects.map(project => materializeManagedProject(project, draft.sshHosts));
  this._state = draft;
  try {
    await this.save();
  } catch (error) {
    this._state = previous;
    throw error;
  }
  this.onChangeCallback?.();
}
```

Expose `migrationWarnings` as a read-only getter. Do not notify views until `save` succeeds.

- [ ] **Step 5: Implement Host operations and reference validation**

Add methods with exact behavior:

```ts
async addSshHost(host: SshHost): Promise<void>;
async updateSshHost(host: SshHost): Promise<void>;
async deleteSshHost(id: string): Promise<void>;
async migrateSshHostProjects(sourceId: string, targetId: string, projectIds?: string[]): Promise<void>;
resolveSshProject(project: ProjectItem): ReturnType<typeof resolveManagedSshProject>;
```

`deleteSshHost` throws a message naming linked projects. `migrateSshHostProjects` verifies both Hosts exist, keeps each `remotePath`, and reassigns all source projects when `projectIds` is omitted. `upsertProject` rejects a managed SSH project with an unknown Host ID.

- [ ] **Step 6: Update import and export validation**

Import schema version 2 with `sshHosts`; run legacy formats through the same normalizer. Export:

```ts
const exportState: State = {
  ...this._state,
  projects: this._state.projects.map(project => materializeManagedProject(project, this._state.sshHosts))
};
```

Reject duplicate Host names, duplicate Host connection keys, invalid ports, and missing project references before replacing current state.

- [ ] **Step 7: Run store and Host tests**

Add:

```json
"test:store": "npm run build:ext && node test/store.test.js"
```

Run:

```powershell
npm run test:sshHosts
npm run test:store
```

Expected: both scripts PASS; the rollback assertion confirms the pre-write state is restored after `disk full`.

- [ ] **Step 8: Commit the transactional store**

Run:

```powershell
git add -p -- src/store.ts package.json
git add -- test/store.test.js
git diff --cached --check
git commit -m "feat: persist and migrate SSH hosts"
```

Expected: only schema, Host mutation, and store-test hunks are staged.

### Task 4: Replace format-only checks with a bounded OpenSSH probe

**Files:**
- Modify: `src/sshResolve.ts`
- Modify: `test/sshResolve.test.js`

- [ ] **Step 1: Add failing probe tests**

Extend `test/sshResolve.test.js` to capture `execFile` arguments and simulate outcomes:

```js
const host = { id: 'h', name: 'GPU', hostname: '10.7.8.9', username: 'yichi', port: 2222 };
const success = await moduleUnderTest.testSshHostConnection(host);
assert.strictEqual(success.success, true);
assert.deepStrictEqual(calls.at(-1).args, [
  '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
  '-p', '2222', 'yichi@10.7.8.9', 'exit'
]);
```

Add mocked errors for `ENOENT`, DNS text, timeout text, host-key text, `Permission denied`, and a generic nonzero exit. Assert stable codes: `ssh-not-found`, `dns`, `timeout`, `host-key`, `auth`, and `remote-command`.

- [ ] **Step 2: Run and verify the probe API is absent**

Run:

```powershell
npm run test:sshResolve
```

Expected: FAIL because `testSshHostConnection` is missing.

- [ ] **Step 3: Implement the probe result and error classifier**

Add to `src/sshResolve.ts`:

```ts
export type SshProbeCode =
  | 'ok' | 'ssh-not-found' | 'dns' | 'timeout' | 'host-key' | 'auth' | 'remote-command';

export interface SshProbeResult {
  success: boolean;
  code: SshProbeCode;
  message: string;
  resolution?: SshResolutionResult;
}

export async function testSshHostConnection(host: SshHost): Promise<SshProbeResult> {
  const target = host.username ? `${host.username}@${host.hostname}` : host.hostname;
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
  if (host.port) args.push('-p', String(host.port));
  args.push(target, 'exit');
  const resolution = await resolveSshTarget(buildRemoteSshUriFromTarget(host, '/'));
  let lastError: unknown;
  for (const command of getSshCommandCandidates()) {
    try {
      await execFileAsync(command, args, { timeout: 10_000, windowsHide: true });
      return { success: true, code: 'ok', message: `Connected to ${host.name}.`, resolution };
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') break;
    }
  }
  return { ...classifySshProbeError(lastError), resolution };
}

function classifySshProbeError(error: unknown): Omit<SshProbeResult, 'resolution'> {
  const value = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
  const text = `${value?.message || ''}\n${value?.stderr || ''}`.toLowerCase();
  if (value?.code === 'ENOENT') return { success: false, code: 'ssh-not-found', message: 'OpenSSH was not found.' };
  if (value?.killed || /timed out|timeout/.test(text)) return { success: false, code: 'timeout', message: 'SSH connection timed out.' };
  if (/could not resolve hostname|name or service not known|no such host/.test(text)) return { success: false, code: 'dns', message: 'SSH hostname could not be resolved.' };
  if (/host key verification failed|remote host identification has changed/.test(text)) return { success: false, code: 'host-key', message: 'SSH host-key verification failed.' };
  if (/permission denied|authentication failed/.test(text)) return { success: false, code: 'auth', message: 'Non-interactive authentication failed; password-only Hosts cannot pass this probe.' };
  return { success: false, code: 'remote-command', message: value?.message || 'SSH remote command failed.' };
}
```

Use a child-process timeout of 10 seconds as a hard cap. The authentication message must explain that password-only Hosts cannot pass `BatchMode=yes`.

- [ ] **Step 4: Run SSH resolution tests**

Run:

```powershell
npm run test:sshResolve
```

Expected: PASS with `sshResolve tests passed`.

- [ ] **Step 5: Commit only the probe hunks**

Run:

```powershell
git add -p -- src/sshResolve.ts test/sshResolve.test.js
git diff --cached --check
git commit -m "fix: perform real SSH connection probes"
```

Expected: existing username-resolution changes remain preserved; only separable probe hunks are committed.

### Task 5: Add transport-neutral Host message routing

**Files:**
- Create: `src/sshHostMessages.ts`
- Create: `test/sshHostMessages.test.js`
- Modify: `src/managerViewProvider.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing router tests**

Create `test/sshHostMessages.test.js` with a fake store that records calls:

```js
const assert = require('assert');
const { handleSshHostMessage } = require('../out/sshHostMessages');

const calls = [];
const store = {
  addSshHost: async host => calls.push(['add', host]),
  updateSshHost: async host => calls.push(['update', host]),
  deleteSshHost: async id => calls.push(['delete', id]),
  migrateSshHostProjects: async (source, target, ids) => calls.push(['migrate', source, target, ids])
};
const probe = async host => ({ success: true, code: 'ok', message: host.name });

const result = await handleSshHostMessage(
  { type: 'addSshHost', payload: { id: 'h', name: 'GPU', hostname: 'host' } },
  store,
  probe
);
assert.deepStrictEqual(calls[0][0], 'add');
assert.deepStrictEqual(result, { type: 'sshHostOperationResult', payload: { success: true, operation: 'add' } });
```

Cover add, update, delete, migrate, test, unknown message returning `undefined`, and thrown store errors returning `success: false`.

- [ ] **Step 2: Run and verify the router module is missing**

Run:

```powershell
npm run build:ext
node test/sshHostMessages.test.js
```

Expected: FAIL with `Cannot find module '../out/sshHostMessages'`.

- [ ] **Step 3: Implement the router**

Create `src/sshHostMessages.ts`:

```ts
import type { ConfigStore } from './store';
import type { SshHost } from './sshHosts';
import { testSshHostConnection } from './sshResolve';

type HostStore = Pick<ConfigStore,
  'addSshHost' | 'updateSshHost' | 'deleteSshHost' | 'migrateSshHostProjects'>;

export async function handleSshHostMessage(
  msg: { type?: string; payload?: any },
  store: HostStore,
  probe: typeof testSshHostConnection = testSshHostConnection
): Promise<{ type: string; payload: unknown } | undefined>;
```

Return exactly one `sshHostOperationResult` for mutations and one `sshHostTestResult` for tests. Convert thrown values with `error instanceof Error ? error.message : String(error)`.

- [ ] **Step 4: Wire both webview transports to the same router**

In `src/managerViewProvider.ts` and the fullscreen message handler in `src/extension.ts`, call the router before existing message branches:

```ts
const hostResult = await handleSshHostMessage(msg, store);
if (hostResult) {
  webview.postMessage(hostResult);
  this.postState?.();
  return;
}
```

Manager state payloads include `sshHosts: store.state.sshHosts` and `migrationWarnings: store.migrationWarnings`. Store callbacks remain responsible for refreshing all views after successful mutations.

- [ ] **Step 5: Run router tests and extension build**

Add:

```json
"test:sshHostMessages": "npm run build:ext && node test/sshHostMessages.test.js"
```

Run:

```powershell
npm run test:sshHostMessages
npm run build:ext
```

Expected: router tests PASS and TypeScript emits no errors.

- [ ] **Step 6: Commit the shared routing layer**

Run:

```powershell
git add -- src/sshHostMessages.ts test/sshHostMessages.test.js
git add -p -- src/managerViewProvider.ts src/extension.ts package.json
git diff --cached --check
git commit -m "feat: route SSH host operations"
```

Expected: commit contains the common router and transport wiring only.

### Task 6: Upgrade the native OUTLINE from By Target to By Host

**Files:**
- Modify: `src/outlineTreeProvider.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Modify: `test/sshHosts.test.js`

- [ ] **Step 1: Strengthen failing Host-bucket expectations**

In `test/sshHosts.test.js`, assert deterministic OUTLINE data:

```js
const buckets = buildHostBuckets(projects, [usedHost, unusedHost]);
assert.deepStrictEqual(buckets.map(bucket => [bucket.name, bucket.projects.length, bucket.local]), [
  ['GPU', 2, false],
  ['Unused', 0, false],
  ['Local', 1, true]
]);
```

Run `npm run test:sshHosts` and expect failure until bucket ordering and empty Hosts meet the contract.

- [ ] **Step 2: Finish pure bucket ordering**

Sort stored Hosts by `name.localeCompare` and append `Local` only when local projects exist. Legacy unparseable SSH projects go in a final `Unmanaged SSH` display bucket so they remain visible and repairable.

Run `npm run test:sshHosts`; expect PASS.

- [ ] **Step 3: Replace the Outline mode and node model**

In `src/outlineTreeProvider.ts`:

```ts
export type OutlineMode = 'group' | 'host' | 'type' | 'flat';

export interface OutlineNode {
  id: string;
  type: 'section' | 'group' | 'host' | 'project';
  label: string;
  project?: ProjectItem;
  groupName?: string;
  hostId?: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  iconColor?: string;
  children?: OutlineNode[];
  sectionKind?: 'favorites' | 'recent' | 'mode-root';
}

const OUTLINE_MODE_ORDER: OutlineMode[] = ['group', 'host', 'type', 'flat'];
```

Use `buildHostBuckets` for `host` mode. Host `TreeItem` context values include `outline-host`, `host-used` or `host-unused`, and `host:<id>`. Tooltips show Host address, explicit port or `SSH config/default`, and project names. `Local` is display-only and has no Host context actions.

- [ ] **Step 4: Register Host context commands**

Add commands to `package.json` and register handlers in `src/extension.ts`:

```json
{
  "command": "projectPilot.editSshHostFromOutline",
  "title": "Edit SSH Host",
  "category": "Project Pilot",
  "icon": "$(edit)"
},
{
  "command": "projectPilot.testSshHostFromOutline",
  "title": "Test SSH Host",
  "category": "Project Pilot",
  "icon": "$(debug-disconnect)"
},
{
  "command": "projectPilot.migrateSshHostProjects",
  "title": "Migrate Projects to Another Host",
  "category": "Project Pilot",
  "icon": "$(replace-all)"
},
{
  "command": "projectPilot.deleteSshHostFromOutline",
  "title": "Delete SSH Host",
  "category": "Project Pilot",
  "icon": "$(trash)"
}
```

The edit command uses sequential `showInputBox` calls prefilled from the Host and saves only after all fields validate. Migration uses `showQuickPick` for a different target Host and a modal confirmation. Delete is contributed only for `host-unused` and still relies on store-side reference protection.

- [ ] **Step 5: Build and manually inspect contribution rules**

Run:

```powershell
npm run build:ext
```

Expected: PASS. Inspect `package.json` to confirm Host commands are hidden from the Command Palette unless useful and appear only for `view == projectPilot.outline && viewItem =~ /outline-host/`.

- [ ] **Step 6: Commit OUTLINE Host mode**

Run:

```powershell
git add -p -- src/outlineTreeProvider.ts src/extension.ts package.json test/sshHosts.test.js
git diff --cached --check
git commit -m "feat: manage SSH hosts from outline"
```

Expected: staged diff contains `By Host` mode, Host commands, and bucket tests.

### Task 7: Add the Manager Host panel and Host-aware project editor

**Files:**
- Create: `webview-ui/src/ui/model.ts`
- Create: `webview-ui/src/ui/SshHostManager.tsx`
- Modify: `webview-ui/src/ui/App.tsx`

- [ ] **Step 1: Add shared webview model types**

Create `webview-ui/src/ui/model.ts`:

```ts
export type ProjectType = 'local' | 'workspace' | 'ssh' | 'ssh-workspace';

export type SshHost = {
  id: string;
  name: string;
  hostname: string;
  username?: string;
  port?: number;
};

export type ProjectItem = {
  id?: string;
  name: string;
  path: string;
  remotePath?: string;
  sshHostId?: string;
  description?: string;
  icon?: string;
  color?: string;
  tags?: string[];
  group?: string;
  type: ProjectType;
  isFavorite?: boolean;
  clickCount?: number;
  lastAccessed?: string;
};

export type UISettings = {
  compactMode?: boolean;
  viewMode?: 'grid' | 'list' | 'mini';
  selectedGroup?: string;
  outlineMode?: 'group' | 'host' | 'type' | 'flat';
};

export type ConfigSettings = {
  autoOpenFullscreen?: boolean;
};

export type SshHostOperationResult = {
  success: boolean;
  operation: 'add' | 'update' | 'delete' | 'migrate';
  message?: string;
};

export type SshHostTestResult = {
  success: boolean;
  code: string;
  message: string;
};

export type State = {
  projects: ProjectItem[];
  sshHosts: SshHost[];
  migrationWarnings?: Array<{ projectId?: string; projectName: string; message: string }>;
  uiSettings?: UISettings;
  config?: ConfigSettings;
};
```

Move the matching type declarations from `App.tsx` to imports without changing runtime behavior.

- [ ] **Step 2: Create an intentional compile failure at the integration seam**

Import `SshHostManager` in `App.tsx`, add `showSshHosts` state, and render:

```tsx
{showSshHosts && (
  <SshHostManager
    hosts={state.sshHosts}
    projects={state.projects}
    onClose={() => setShowSshHosts(false)}
    postMessage={message => vscode.postMessage(message)}
  />
)}
```

Run `npm run build:webview`.

Expected: FAIL because `SshHostManager.tsx` does not exist.

- [ ] **Step 3: Implement the Host management modal**

Create `webview-ui/src/ui/SshHostManager.tsx` with this public contract:

```tsx
import { useState } from 'react';
import type {
  ProjectItem,
  SshHost,
  SshHostOperationResult,
  SshHostTestResult
} from './model';

type Props = {
  hosts: SshHost[];
  projects: ProjectItem[];
  operationResult?: SshHostOperationResult;
  testResult?: SshHostTestResult;
  onClose: () => void;
  postMessage: (message: unknown) => void;
};

export function SshHostManager({ hosts, projects, operationResult, testResult, onClose, postMessage }: Props) {
  const emptyDraft: SshHost = { id: '', name: '', hostname: '' };
  const [draft, setDraft] = useState<SshHost | null>(null);
  const [migration, setMigration] = useState<{ sourceId: string; targetId: string } | null>(null);
  const referenceCount = (hostId: string) => projects.filter(project => project.sshHostId === hostId).length;
  const save = () => {
    if (!draft) return;
    const host = { ...draft, id: draft.id || crypto.randomUUID() };
    postMessage({ type: draft.id ? 'updateSshHost' : 'addSshHost', payload: host });
    setDraft(null);
  };
  const remove = (host: SshHost) => {
    if (referenceCount(host.id) === 0) postMessage({ type: 'deleteSshHost', payload: { id: host.id } });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="SSH Hosts">
      <header><h2>SSH Hosts</h2><button onClick={onClose}>Close</button></header>
      {operationResult && <p role={operationResult.success ? 'status' : 'alert'}>{operationResult.message ?? `${operationResult.operation} completed`}</p>}
      {testResult && <p role={testResult.success ? 'status' : 'alert'}>{testResult.message}</p>}
      <button onClick={() => setDraft(emptyDraft)}>Add Host</button>
      {hosts.map(host => (
        <section key={host.id}>
          <strong>{host.name}</strong>
          <span>{host.username ? `${host.username}@` : ''}{host.hostname}:{host.port ?? 'default'}</span>
          <span>{referenceCount(host.id)} projects</span>
          <button onClick={() => setDraft(host)}>Edit</button>
          <button onClick={() => postMessage({ type: 'testSshHost', payload: host })}>Test</button>
          <button
            disabled={referenceCount(host.id) === 0 || hosts.length < 2}
            onClick={() => setMigration({ sourceId: host.id, targetId: hosts.find(candidate => candidate.id !== host.id)?.id ?? '' })}
          >Migrate</button>
          <button disabled={referenceCount(host.id) > 0} onClick={() => remove(host)}>Delete</button>
        </section>
      ))}
      {migration && (
        <section aria-label="Migrate SSH projects">
          <select value={migration.targetId} onChange={event => setMigration({ ...migration, targetId: event.target.value })}>
            {hosts.filter(host => host.id !== migration.sourceId).map(host => (
              <option key={host.id} value={host.id}>{host.name}</option>
            ))}
          </select>
          <button onClick={() => {
            postMessage({ type: 'migrateSshHostProjects', payload: migration });
            setMigration(null);
          }}>Migrate Projects</button>
          <button onClick={() => setMigration(null)}>Cancel</button>
        </section>
      )}
      {draft && (
        <section aria-label="SSH Host editor">
          <input aria-label="Name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
          <input aria-label="Hostname or IP" value={draft.hostname} onChange={event => setDraft({ ...draft, hostname: event.target.value })} />
          <input aria-label="Username" value={draft.username ?? ''} onChange={event => setDraft({ ...draft, username: event.target.value || undefined })} />
          <input aria-label="Port" type="number" min={1} max={65535} value={draft.port ?? ''} onChange={event => setDraft({ ...draft, port: event.target.value ? Number(event.target.value) : undefined })} />
          <button onClick={save}>Save Host</button>
          <button onClick={() => setDraft(null)}>Cancel</button>
        </section>
      )}
    </div>
  );
}
```

Use labels and buttons with visible text, focus the first form field when editing, close on Escape only when no unsaved draft exists, and disable Delete when the reference count is nonzero. Display operation errors and password-only probe limitations inside the modal.

- [ ] **Step 4: Add the toolbar entry and operation-result handling**

In `App.tsx`, add an `SSH Hosts` toolbar button near Add Project. Extend the existing `message` listener:

```ts
if (e.data?.type === 'sshHostOperationResult') {
  setSshHostOperationResult(e.data.payload);
} else if (e.data?.type === 'sshHostTestResult') {
  setSshHostTestResult(e.data.payload);
}
```

Pass `sshHostOperationResult` and `sshHostTestResult` into the modal as `operationResult` and `testResult`. Reset both result states when the modal closes. Render migration warnings as a dismissible warning strip that opens the affected project editor.

- [ ] **Step 5: Change SSH project editing to Host plus remote path**

For `ssh` and `ssh-workspace` projects that have `sshHostId`, replace the full-path input with:

```tsx
<select
  value={editedProject.sshHostId ?? ''}
  onChange={event => setEditedProject({ ...editedProject, sshHostId: event.target.value })}
>
  <option value="">Select SSH Host</option>
  {sshHosts.map(host => <option key={host.id} value={host.id}>{host.name}</option>)}
</select>
<input
  value={editedProject.remotePath ?? ''}
  onChange={event => setEditedProject({ ...editedProject, remotePath: event.target.value })}
/>
```

Add `New Host` beside the selector. Preserve the existing full-path editor and current authority-resolution UI only for legacy unparseable projects. New SSH projects require a Host and remote path before Save.

- [ ] **Step 6: Build the webview and full extension**

Run:

```powershell
npm run build:webview
npm run build
```

Expected: both PASS; Vite emits updated `webview-ui/dist` assets and TypeScript reports no missing fields.

- [ ] **Step 7: Commit only separable Manager changes**

Run:

```powershell
git add -- webview-ui/src/ui/model.ts webview-ui/src/ui/SshHostManager.tsx
git add -p -- webview-ui/src/ui/App.tsx
git diff --cached --check
git commit -m "feat: add SSH host manager UI"
```

Expected: new components are committed; pre-existing `App.tsx` authority fixes remain unstaged if Git cannot separate them safely.

### Task 8: Route every SSH project operation through the managed resolver

**Files:**
- Modify: `src/projectPath.ts`
- Modify: `src/extension.ts`
- Modify: `src/managerViewProvider.ts`
- Modify: `src/outlineTreeProvider.ts`
- Modify: `webview-ui/src/ui/App.tsx`
- Modify: `test/sshHosts.test.js`

- [ ] **Step 1: Add failing end-to-end resolver assertions**

Extend `test/sshHosts.test.js`:

```js
const project = {
  id: 'p', name: 'Workspace', type: 'ssh-workspace', path: 'stale:/old',
  sshHostId: 'h', remotePath: 'C:/work/main.code-workspace'
};
const host = { id: 'h', name: 'Windows Lab', hostname: '10.0.0.42', username: 'yichi', port: 2222 };
const resolved = resolveManagedSshProject(project, [host]);
assert.match(resolved.remoteUri, /^vscode-remote:\/\/ssh-remote\+/);
assert.match(resolved.displayPath, /10\.0\.0\.42/);
assert.notStrictEqual(resolved.compatibilityPath, project.path);
```

Change the Host IP and assert the resolved URI, display path, and materialized compatibility path all change while `remotePath` remains identical.

- [ ] **Step 2: Run and verify any missing resolver behavior**

Run:

```powershell
npm run test:sshHosts
```

Expected: FAIL if any custom-port or Windows-path behavior is not yet handled.

- [ ] **Step 3: Centralize extension-host project resolution**

Replace direct `item.path` use for SSH projects with:

```ts
const resolved = store.resolveSshProject(item);
const uri = vscode.Uri.parse(resolved.remoteUri);
await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
```

Apply the same resolver to:

- `openSshProject`
- `openSshWorkspace`
- `testSshConnection`
- copy-path commands
- browse default URIs
- OUTLINE labels/tooltips
- Manager state projection

Legacy projects without managed fields retain the existing parser fallback.

- [ ] **Step 4: Remove format-only success messages**

Replace `testSshConnectionFormat` and the Manager provider's private format checker with the Host probe for managed projects. Legacy projects first parse into a temporary Host target, then use the same probe. A syntactically valid path is reported as `configuration-valid` only when the network probe is unavailable; it is never reported as a successful connection.

- [ ] **Step 5: Run all extension tests and the required complete build**

Run:

```powershell
npm run test:sshPath
npm run test:sshResolve
npm run test:sshHosts
npm run test:store
npm run test:sshHostMessages
npm run build
```

Expected: every test prints its PASS marker and `npm run build` completes both webview and extension builds.

- [ ] **Step 6: Commit separable resolver-integration hunks**

Run:

```powershell
git add -p -- src/projectPath.ts src/extension.ts src/managerViewProvider.ts src/outlineTreeProvider.ts webview-ui/src/ui/App.tsx test/sshHosts.test.js
git diff --cached --check
git commit -m "refactor: resolve SSH projects through hosts"
```

Expected: no unrelated launch, package, or UI hunks are staged. Skip this commit if the working dependency cannot be separated from user-owned hunks.

### Task 9: Document and manually verify the complete feature

**Files:**
- Modify: `docs/user-guide.md`
- Modify: `docs/commands.md`
- Modify: `docs/development.md`

- [ ] **Step 1: Update user-facing behavior**

Document in `docs/user-guide.md`:

- Open `SSH Hosts` from the Manager toolbar.
- Add or edit hostname/IP, optional username, and optional port.
- Create SSH projects by selecting a Host and entering only the remote path.
- Use native OUTLINE `By Host` mode and Host context actions.
- Explain automatic legacy migration, unparseable-project fallback, delete protection, and password-only probe limitations.

- [ ] **Step 2: Update commands and development verification**

Add the four Host OUTLINE commands to `docs/commands.md`. Replace “Validate SSH project paths” with “Resolve and probe SSH Hosts.” Add the exact Extension Host checklist to `docs/development.md`:

```text
1. Launch Run Extension after npm run build.
2. Import a legacy config with two projects on one Host and one malformed SSH path.
3. Confirm one Host is created, two projects link to it, and the malformed project remains editable.
4. Switch OUTLINE to By Host; confirm used, unused, Local, and Unmanaged SSH buckets.
5. Change the Host IP; open both linked projects and verify the new authority.
6. Test success, auth failure, timeout, and missing-SSH messages.
7. Migrate projects, verify delete protection, then delete the empty source Host.
8. Export and re-import; confirm Host IDs, remote paths, and compatibility paths survive.
```

- [ ] **Step 3: Run final automated verification**

Run:

```powershell
npm run test:sshPath
npm run test:sshResolve
npm run test:sshHosts
npm run test:store
npm run test:sshHostMessages
npm run build
git diff --check
```

Expected: all five test scripts PASS, complete build PASS, and `git diff --check` produces no output.

- [ ] **Step 4: Run the Extension Host checklist**

Use the `Run Extension` launch configuration. Record each checklist item as pass/fail, the VS Code and Remote-SSH versions, and any environment limitation. Do not claim the UI workflow is complete if the Extension Host was not launched successfully.

- [ ] **Step 5: Review the final diff for user-owned changes**

Run:

```powershell
git status --short
git diff --stat
git diff -- .vscode/launch.json AGENTS.md
```

Expected: `.vscode/launch.json` and `AGENTS.md` remain exactly as the user left them; the feature diff is limited to the files listed in this plan plus generated `webview-ui/dist` files if the repository tracks them.

- [ ] **Step 6: Commit documentation only**

Run:

```powershell
git add -- docs/user-guide.md docs/commands.md docs/development.md
git diff --cached --check
git commit -m "docs: explain SSH host management"
```

Expected: documentation commit succeeds without staging implementation or user-owned files.

## Completion criteria

- Editing one Host changes every linked project's resolved address without editing each project.
- All stored Hosts, including empty Hosts, appear in native OUTLINE `By Host` mode; Favorites and Recent remain flat.
- Referenced Hosts cannot be deleted, and project migration preserves remote paths.
- Legacy migration is safe, deduplicating, idempotent, and non-destructive for malformed paths.
- Explicit username and port survive structured Remote-SSH authority parsing and opening.
- Connection testing performs a bounded real OpenSSH probe and reports classified failures.
- Import/export round trips preserve Hosts and project references.
- Existing user-owned SSH parsing work remains preserved.
- All automated commands and the complete `npm run build` pass.
- Manual Extension Host results are reported accurately.
