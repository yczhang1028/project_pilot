const assert = require('assert');
const {
  buildRemoteSshUri,
  buildRemoteSshUriFromTarget,
  getRawSshPathFromRemoteUri,
  parseRawSshPath
} = require('../out/sshPath');
const {
  buildHostBuckets,
  hostConnectionKey,
  materializeManagedProject,
  migrateSshState,
  resolveManagedSshProject,
  validateSshHost
} = require('../out/sshHosts');

const normalizedHost = validateSshHost(
  {
    id: ' host-1 ',
    name: ' Build Host ',
    hostname: ' Build.EXAMPLE.com ',
    username: ' Alice ',
    port: 2222
  },
  []
);
assert.deepStrictEqual(normalizedHost, {
  id: 'host-1',
  name: 'Build Host',
  hostname: 'Build.EXAMPLE.com',
  username: 'Alice',
  port: 2222
});
assert.strictEqual(
  hostConnectionKey(normalizedHost),
  hostConnectionKey({ ...normalizedHost, hostname: 'build.example.COM', username: 'alice' })
);
assert.notStrictEqual(
  hostConnectionKey({ ...normalizedHost, port: undefined }),
  hostConnectionKey({ ...normalizedHost, port: 22 }),
  'an omitted port remains distinct from an explicit port 22'
);
assert.throws(
  () => validateSshHost({ id: 'h2', name: ' build host ', hostname: 'other' }, [normalizedHost]),
  /name.*already exists/i
);
assert.throws(
  () => validateSshHost({ id: 'h2', name: 'Other', hostname: 'BUILD.example.com', username: 'ALICE', port: 2222 }, [normalizedHost]),
  /same connection/i
);
assert.throws(
  () => validateSshHost({ id: 'h2', name: 'Other', hostname: 'other', port: 65536 }, []),
  /integer between 1 and 65535/i
);
assert.doesNotThrow(
  () => validateSshHost({ ...normalizedHost, name: 'Renamed' }, [normalizedHost], normalizedHost.id),
  'the Host being edited is excluded from duplicate checks'
);

const secondLegacyUri = buildRemoteSshUriFromTarget(
  { hostname: 'build.example.COM', username: 'ALICE' },
  '\\srv\\other.code-workspace'
);
const localProject = {
  id: 'local-1',
  name: 'Local',
  path: 'C:\\work\\local',
  type: 'local'
};
const legacyState = {
  projects: [
    {
      id: 'ssh-1',
      name: 'App',
      path: 'alice@Build.EXAMPLE.com:/srv/app',
      type: 'ssh'
    },
    {
      id: 'ssh-2',
      name: 'Workspace',
      path: secondLegacyUri,
      type: 'ssh-workspace'
    },
    {
      id: 'ssh-bad',
      name: 'Broken SSH',
      path: 'not-an-ssh-path',
      type: 'ssh'
    },
    localProject
  ],
  uiSettings: { outlineMode: 'target', viewMode: 'list' }
};

const migrated = migrateSshState(legacyState);
assert.strictEqual(migrated.changed, true);
assert.strictEqual(migrated.state.schemaVersion, 2);
assert.strictEqual(migrated.state.uiSettings.outlineMode, 'host');
assert.strictEqual(migrated.state.sshHosts.length, 1, 'equivalent legacy connections share one Host');
assert.strictEqual(migrated.state.projects[0].sshHostId, migrated.state.sshHosts[0].id);
assert.strictEqual(migrated.state.projects[1].sshHostId, migrated.state.sshHosts[0].id);
assert.strictEqual(migrated.state.projects[0].remotePath, '/srv/app');
assert.strictEqual(migrated.state.projects[1].remotePath, '/srv/other.code-workspace');
assert.strictEqual(migrated.state.projects[2].sshHostId, undefined);
assert.deepStrictEqual(migrated.state.projects[3], localProject, 'local projects remain unchanged');
assert.strictEqual(migrated.warnings.length, 1, 'one malformed project produces exactly one warning');
assert.deepStrictEqual(
  { projectId: migrated.warnings[0].projectId, projectName: migrated.warnings[0].projectName },
  { projectId: 'ssh-bad', projectName: 'Broken SSH' }
);

const migratedAgain = migrateSshState(migrated.state);
assert.strictEqual(migratedAgain.changed, false, 'migration is idempotent');
assert.deepStrictEqual(migratedAgain.state, migrated.state, 'an idempotent migration is byte-equivalent data');
assert.strictEqual(migratedAgain.warnings.length, 1, 'the malformed fallback still emits one warning per migration');

for (const username of ['DOMAIN\\user', 'name:part']) {
  const structuredUri = buildRemoteSshUriFromTarget(
    { hostname: 'host.example.com', username },
    '/srv/repo'
  );
  const unsafeUsernameMigration = migrateSshState({
    projects: [{
      id: `unsafe-${username}`,
      name: `Unsafe ${username}`,
      path: structuredUri,
      type: 'ssh'
    }]
  });

  assert.strictEqual(unsafeUsernameMigration.state.sshHosts.length, 1);
  assert.deepStrictEqual(
    (({ hostname, username: migratedUsername }) => ({ hostname, username: migratedUsername }))(
      unsafeUsernameMigration.state.sshHosts[0]
    ),
    { hostname: 'host.example.com', username }
  );
  assert.strictEqual(unsafeUsernameMigration.state.projects[0].remotePath, '/srv/repo');
  assert.strictEqual(
    unsafeUsernameMigration.state.projects[0].sshHostId,
    unsafeUsernameMigration.state.sshHosts[0].id
  );
  assert.match(
    unsafeUsernameMigration.state.projects[0].path,
    /^vscode-remote:\/\/ssh-remote\+/
  );
  assert.deepStrictEqual(unsafeUsernameMigration.warnings, []);

  const unsafeUsernameAgain = migrateSshState(unsafeUsernameMigration.state);
  assert.strictEqual(unsafeUsernameAgain.changed, false);
  assert.deepStrictEqual(unsafeUsernameAgain.state, unsafeUsernameMigration.state);
}

const linuxHost = {
  id: 'linux',
  name: 'Linux',
  hostname: 'linux.example.com',
  username: 'dev'
};
const linuxProject = {
  id: 'linux-project',
  name: 'Linux Project',
  path: 'stale',
  type: 'ssh',
  sshHostId: 'linux',
  remotePath: '\\home\\dev\\repo'
};
const linuxResolved = resolveManagedSshProject(linuxProject, [linuxHost]);
assert.strictEqual(linuxResolved.remotePath, '/home/dev/repo');
assert.strictEqual(linuxResolved.displayPath, 'dev@linux.example.com:/home/dev/repo');
assert.strictEqual(linuxResolved.compatibilityPath, 'dev@linux.example.com:/home/dev/repo');
assert.strictEqual(
  linuxResolved.remoteUri,
  buildRemoteSshUriFromTarget(linuxHost, '/home/dev/repo')
);

const windowsHost = {
  id: 'windows',
  name: 'Windows',
  hostname: 'windows.example.com',
  username: 'administrator',
  port: 2222
};
const windowsProject = {
  id: 'windows-project',
  name: 'Windows Workspace',
  path: 'stale',
  type: 'ssh-workspace',
  sshHostId: 'windows',
  remotePath: '/C:\\work\\main.code-workspace'
};
const windowsResolved = resolveManagedSshProject(windowsProject, [windowsHost]);
assert.strictEqual(windowsResolved.remotePath, 'C:/work/main.code-workspace');
assert.match(windowsResolved.displayPath, /administrator@windows\.example\.com:2222/);
assert.strictEqual(windowsResolved.compatibilityPath, windowsResolved.remoteUri);
assert.match(windowsResolved.compatibilityPath, /^vscode-remote:\/\/ssh-remote\+/);
assert.doesNotMatch(windowsResolved.compatibilityPath, /windows\.example\.com:2222:C:\//);

const ipv6Host = {
  id: 'ipv6',
  name: 'IPv6',
  hostname: '2001:db8::1',
  username: 'u'
};
const ipv6Resolved = resolveManagedSshProject({
  id: 'ipv6-project',
  name: 'IPv6 Project',
  path: 'stale',
  type: 'ssh',
  sshHostId: 'ipv6',
  remotePath: '/repo'
}, [ipv6Host]);
assert.match(ipv6Resolved.compatibilityPath, /^vscode-remote:\/\/ssh-remote\+/);
assert.notStrictEqual(ipv6Resolved.compatibilityPath, 'u@2001:db8::1:/repo');
assert.strictEqual(buildRemoteSshUri(ipv6Resolved.compatibilityPath), ipv6Resolved.remoteUri);
const ipv6RawPath = getRawSshPathFromRemoteUri(ipv6Resolved.compatibilityPath);
assert.ok(ipv6RawPath);
assert.deepStrictEqual(
  (({ hostname, username, remotePath }) => ({ hostname, username, remotePath }))(
    parseRawSshPath(ipv6RawPath)
  ),
  { hostname: '2001:db8::1', username: 'u', remotePath: '/repo' }
);

assert.throws(
  () => resolveManagedSshProject({ ...linuxProject, sshHostId: 'missing' }, [linuxHost]),
  /SSH Host missing was not found/
);

assert.deepStrictEqual(
  materializeManagedProject(linuxProject, [linuxHost]),
  { ...linuxProject, path: 'dev@linux.example.com:/home/dev/repo' },
  'materialization updates only the compatibility path'
);
assert.strictEqual(
  materializeManagedProject(windowsProject, [windowsHost]).path,
  windowsResolved.remoteUri,
  'custom-port materialization uses a structured URI'
);
const unmanagedProject = { id: 'legacy', name: 'Legacy', path: 'broken', type: 'ssh' };
assert.strictEqual(materializeManagedProject(unmanagedProject, [linuxHost]), unmanagedProject);
assert.strictEqual(materializeManagedProject(localProject, [linuxHost]), localProject);

const unusedHost = { id: 'unused', name: 'Alpha Unused', hostname: 'unused.example.com' };
const buckets = buildHostBuckets(
  [windowsProject, localProject, unmanagedProject, linuxProject],
  [linuxHost, windowsHost, unusedHost]
);
assert.deepStrictEqual(
  buckets.map(bucket => bucket.name),
  ['Alpha Unused', 'Linux', 'Windows', 'Local', 'Unmanaged SSH']
);
assert.deepStrictEqual(buckets[0].projects, [], 'unused Hosts still appear');
assert.deepStrictEqual(buckets[1].projects, [linuxProject]);
assert.deepStrictEqual(buckets[2].projects, [windowsProject]);
assert.deepStrictEqual(buckets[3].projects, [localProject]);
assert.strictEqual(buckets[3].local, true);
assert.deepStrictEqual(buckets[4].projects, [unmanagedProject]);
assert.strictEqual(buckets[4].unmanaged, true);

console.log('sshHosts tests passed');
