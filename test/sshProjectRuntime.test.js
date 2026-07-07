const assert = require('assert');
const { buildRemoteSshUriFromTarget } = require('../out/sshPath');
const {
  materializeRuntimeProject,
  resolveSshProjectRuntime,
  resolveSshTargetPayload,
  testSshProjectConnection
} = require('../out/sshProjectRuntime');

const managedProject = {
  id: 'managed',
  name: 'Managed',
  path: 'old@192.0.2.1:/stale',
  type: 'ssh',
  sshHostId: 'shared',
  remotePath: '/srv/current'
};
const currentHost = {
  id: 'shared',
  name: 'Shared host',
  hostname: '203.0.113.44',
  username: 'dev'
};
const managedRuntime = resolveSshProjectRuntime(managedProject, [currentHost]);
assert.strictEqual(managedRuntime.managed, true);
assert.strictEqual(managedRuntime.displayPath, 'dev@203.0.113.44:/srv/current');
assert.strictEqual(managedRuntime.compatibilityPath, 'dev@203.0.113.44:/srv/current');
assert.strictEqual(
  managedRuntime.remoteUri,
  buildRemoteSshUriFromTarget(currentHost, '/srv/current')
);
assert.doesNotMatch(managedRuntime.remoteUri, /192\.0\.2\.1|stale/);
assert.strictEqual(
  materializeRuntimeProject(managedProject, [currentHost]).path,
  'dev@203.0.113.44:/srv/current'
);

const customPortHost = { ...currentHost, hostname: '198.51.100.9', port: 2202 };
const portRuntime = resolveSshProjectRuntime(managedProject, [customPortHost]);
assert.strictEqual(portRuntime.compatibilityPath, portRuntime.remoteUri);
assert.match(portRuntime.displayPath, /198\.51\.100\.9:2202/);

const ipv6Runtime = resolveSshProjectRuntime(managedProject, [{
  ...currentHost,
  hostname: '2001:db8::42',
  port: 2202
}]);
assert.match(ipv6Runtime.displayPath, /dev@\[2001:db8::42\]:2202:\/srv\/current/);

const workspaceProject = {
  ...managedProject,
  id: 'workspace',
  name: 'Windows workspace',
  type: 'ssh-workspace',
  remotePath: '/C:\\work\\pilot.code-workspace'
};
const workspaceRuntime = resolveSshProjectRuntime(workspaceProject, [customPortHost]);
assert.strictEqual(workspaceRuntime.remotePath, 'C:/work/pilot.code-workspace');
assert.match(workspaceRuntime.remoteUri, /\/C:\/work\/pilot\.code-workspace$/);

const legacyTarget = { hostname: 'legacy.example.com', username: 'alice', port: 2222 };
const legacyProject = {
  id: 'legacy',
  name: 'Legacy',
  path: buildRemoteSshUriFromTarget(legacyTarget, '/srv/legacy'),
  type: 'ssh'
};
const legacyRuntime = resolveSshProjectRuntime(legacyProject, []);
assert.strictEqual(legacyRuntime.managed, false);
assert.deepStrictEqual(
  (({ hostname, username, port }) => ({ hostname, username, port }))(legacyRuntime.host),
  legacyTarget
);
assert.strictEqual(legacyRuntime.remotePath, '/srv/legacy');
assert.strictEqual(legacyRuntime.remoteUri, legacyProject.path);

const rawLegacyRuntime = resolveSshProjectRuntime({
  id: 'raw-legacy',
  name: 'Raw legacy',
  path: 'bob@raw.example.com:/srv/raw',
  type: 'ssh'
}, []);
assert.strictEqual(rawLegacyRuntime.managed, false);
assert.strictEqual(rawLegacyRuntime.remotePath, '/srv/raw');
assert.deepStrictEqual(
  (({ hostname, username }) => ({ hostname, username }))(rawLegacyRuntime.host),
  { hostname: 'raw.example.com', username: 'bob' }
);

assert.throws(
  () => resolveSshProjectRuntime({ ...managedProject, sshHostId: 'deleted-host' }, [currentHost]),
  /SSH Host deleted-host was not found/
);
assert.throws(
  () => resolveSshProjectRuntime({ ...managedProject, sshHostId: undefined }, []),
  /missing sshHostId/
);

(async () => {
  const managedResolution = await resolveSshTargetPayload({
    path: managedProject.path,
    project: managedProject
  }, [customPortHost]);
  assert.strictEqual(managedResolution.success, true);
  assert.strictEqual(managedResolution.requestedPath, portRuntime.compatibilityPath);
  assert.doesNotMatch(managedResolution.requestedPath, /192\.0\.2\.1|stale/);

  let probedHost;
  const failedProbe = await testSshProjectConnection(
    managedProject,
    [customPortHost],
    async host => {
      probedHost = host;
      return { success: false, code: 'timeout', message: 'network probe timed out' };
    }
  );
  assert.strictEqual(failedProbe.success, false, 'a valid path is not a successful connection');
  assert.strictEqual(failedProbe.message, 'network probe timed out');
  assert.deepStrictEqual(probedHost, customPortHost, 'the probe uses the current Host, not stale project.path');

  let workspaceProbeCalled = false;
  const invalidWorkspaceResult = await testSshProjectConnection(
    { ...workspaceProject, remotePath: '/srv/not-a-workspace.txt' },
    [customPortHost],
    async () => {
      workspaceProbeCalled = true;
      return { success: true, code: 'ok', message: 'unexpected' };
    }
  );
  assert.strictEqual(invalidWorkspaceResult.success, false);
  assert.match(invalidWorkspaceResult.message, /should end with \.code-workspace/i);
  assert.strictEqual(workspaceProbeCalled, false, 'workspace suffix validation happens before probing');

  const missingOpenSsh = await testSshProjectConnection(
    legacyProject,
    [],
    async () => ({
      success: false,
      code: 'ssh-not-found',
      message: 'OpenSSH was not found.'
    })
  );
  assert.strictEqual(missingOpenSsh.success, false);
  assert.strictEqual(missingOpenSsh.code, 'ssh-not-found');
  assert.match(missingOpenSsh.message, /configuration is valid.*connection was not tested/i);

  console.log('sshProjectRuntime tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
