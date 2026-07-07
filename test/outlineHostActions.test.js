const assert = require('assert');
const actions = require('../out/outlineHostActions');

assert.strictEqual(
  actions.sanitizeDisplayText('Build\r\nHost\u0000'),
  'Build Host'
);

assert.strictEqual(typeof actions.formatSshHostProgressTitle, 'function');
assert.strictEqual(
  actions.formatSshHostProgressTitle('Build\r\nHost\u0000'),
  'Testing SSH Host "Build Host"'
);

assert.strictEqual(typeof actions.formatSshHostProbeFailure, 'function');
for (const message of [
  'OpenSSH executable was not found.',
  'Could not resolve the SSH hostname.',
  'SSH authentication failed.'
]) {
  assert.strictEqual(
    actions.formatSshHostProbeFailure(message),
    message,
    'safe classified probe text remains visible'
  );
}
assert.strictEqual(
  actions.formatSshHostProbeFailure('SSH authentication failed.\r\nInjected'),
  'SSH authentication failed. Injected'
);

assert.strictEqual(typeof actions.formatUnexpectedSshHostProbeFailure, 'function');
assert.strictEqual(
  actions.formatUnexpectedSshHostProbeFailure('Build\r\nHost'),
  'Failed to connect to SSH Host "Build Host". Check the connection settings and try again.'
);

async function testMigrationCapture() {
  assert.strictEqual(typeof actions.captureSshHostMigrationProjectIds, 'function');
  const captured = actions.captureSshHostMigrationProjectIds([
    { id: 'p1', name: 'One', sshHostId: 'source' },
    { id: 'ignored', name: 'Other Host', sshHostId: 'other' },
    { id: 'p2', name: 'Two', sshHostId: 'source' }
  ], 'source');
  assert.deepStrictEqual(captured, {
    success: true,
    projectIds: ['p1', 'p2']
  });

  assert.deepStrictEqual(
    actions.captureSshHostMigrationProjectIds([
      { id: 'p1', name: 'One', sshHostId: 'source' },
      { name: 'Missing ID\r\nInjected', sshHostId: 'source' }
    ], 'source'),
    {
      success: false,
      missingProjectCount: 1
    },
    'a missing linked project ID aborts the selection instead of returning a partial list'
  );

  assert.strictEqual(typeof actions.migrateCapturedSshHostProjects, 'function');
  const calls = [];
  await actions.migrateCapturedSshHostProjects({
    async migrateSshHostProjects(...args) {
      calls.push(args);
    }
  }, 'source', 'target', captured.projectIds);
  assert.deepStrictEqual(calls, [['source', 'target', ['p1', 'p2']]]);
  assert.strictEqual(calls[0].length, 3, 'migration never omits the captured project ID argument');
}

testMigrationCapture()
  .then(() => console.log('outlineHostActions tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
