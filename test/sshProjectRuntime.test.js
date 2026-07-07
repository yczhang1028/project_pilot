const assert = require('assert');
const { buildRemoteSshUriFromTarget } = require('../out/sshPath');
const {
  materializeRuntimeProject,
  resolveCurrentProject,
  resolveSshProjectRuntime,
  resolveSshTargetPayload,
  testSubmittedSshProjectConnection,
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

const validStructuredRawAuthority = Buffer.from(JSON.stringify({
  hostName: 'structured.example.com',
  user: 'carol',
  port: 2222
}), 'utf8').toString('hex');
const validStructuredRawRuntime = resolveSshProjectRuntime({
  id: 'structured-raw',
  name: 'Structured raw',
  path: `${validStructuredRawAuthority}:/srv/structured`,
  type: 'ssh'
}, []);
assert.deepStrictEqual(
  (({ hostname, username, port }) => ({ hostname, username, port }))(validStructuredRawRuntime.host),
  { hostname: 'structured.example.com', username: 'carol', port: 2222 }
);
const prefixedStructuredAuthority = Buffer.from(JSON.stringify({
  hostName: 'prefixed.example.com',
  port: 2200
}), 'utf8').toString('hex');
const prefixedStructuredRuntime = resolveSshProjectRuntime({
  id: 'prefixed-structured-raw',
  name: 'Prefixed structured raw',
  path: `dave@${prefixedStructuredAuthority}:/srv/prefixed`,
  type: 'ssh'
}, []);
assert.deepStrictEqual(
  (({ hostname, username, port }) => ({ hostname, username, port }))(prefixedStructuredRuntime.host),
  { hostname: 'prefixed.example.com', username: 'dave', port: 2200 }
);

const invalidStructuredRawAuthority = Buffer.from(JSON.stringify({
  hostName: 'bad.example.com',
  port: 70000
}), 'utf8').toString('hex');
const invalidStructuredRawProject = {
  id: 'invalid-structured-raw',
  name: 'Invalid structured raw',
  path: `mallory@${invalidStructuredRawAuthority}:/srv/bad`,
  type: 'ssh'
};
assert.throws(
  () => resolveSshProjectRuntime(invalidStructuredRawProject, []),
  /invalid SSH port/i
);

assert.throws(
  () => resolveSshProjectRuntime({ ...managedProject, sshHostId: 'deleted-host' }, [currentHost]),
  /SSH Host deleted-host was not found/
);
assert.throws(
  () => resolveSshProjectRuntime({ ...managedProject, sshHostId: undefined }, []),
  /missing sshHostId/
);

const currentStoredProject = { ...managedProject, path: 'current snapshot' };
assert.strictEqual(
  resolveCurrentProject({ ...managedProject }, [currentStoredProject]),
  currentStoredProject,
  'a known project ID resolves to the current Store object'
);
const idlessDraft = { ...managedProject, id: undefined };
assert.strictEqual(
  resolveCurrentProject(idlessDraft, [currentStoredProject]),
  idlessDraft,
  'a genuinely ID-less draft can be resolved without Store membership'
);
assert.throws(
  () => resolveCurrentProject({ ...managedProject, id: 'deleted-project' }, [currentStoredProject]),
  /Project deleted-project no longer exists/
);
assert.throws(
  () => resolveCurrentProject({ ...managedProject, id: '' }, [currentStoredProject]),
  /Project .* no longer exists/,
  'an explicitly empty ID is stale/invalid, not a genuinely ID-less draft'
);

(async () => {
  const managedResolution = await resolveSshTargetPayload({
    path: managedProject.path,
    project: managedProject
  }, [customPortHost]);
  assert.strictEqual(managedResolution.success, true);
  assert.strictEqual(managedResolution.requestedPath, portRuntime.compatibilityPath);
  assert.doesNotMatch(managedResolution.requestedPath, /192\.0\.2\.1|stale/);
  assert.strictEqual(managedResolution.requestId, undefined);

  const correlatedResolution = await resolveSshTargetPayload({
    path: managedProject.path,
    project: managedProject,
    requestId: 42
  }, [customPortHost]);
  assert.strictEqual(correlatedResolution.success, true);
  assert.strictEqual(correlatedResolution.requestId, 42);

  const throwingAccessorPayload = {};
  Object.defineProperty(throwingAccessorPayload, 'path', {
    enumerable: true,
    get() {
      throw new Error('path getter must not run');
    }
  });
  const hostilePayloads = [
    null,
    undefined,
    7,
    'not a payload',
    throwingAccessorPayload,
    new Proxy({ path: 'host:/repo' }, {
      getOwnPropertyDescriptor() {
        throw new Error('descriptor unavailable');
      }
    }),
    new Proxy({ path: 'host:/repo' }, {
      getPrototypeOf() {
        throw new Error('prototype unavailable');
      }
    }),
    {
      path: 'host:/repo',
      requestId: 77,
      project: { name: 123, path: 'host:/repo', type: 'ssh' }
    }
  ];
  for (const payload of hostilePayloads) {
    const result = await resolveSshTargetPayload(payload, [customPortHost]);
    assert.strictEqual(result.success, false, 'invalid payloads return a controlled failure');
  }
  const invalidProjectResult = await resolveSshTargetPayload(hostilePayloads.at(-1), [customPortHost]);
  assert.strictEqual(invalidProjectResult.requestId, 77, 'a safe request ID is retained on validation failure');

  let invalidStructuredProbeCalled = false;
  const invalidStructuredProbe = await testSshProjectConnection(
    invalidStructuredRawProject,
    [],
    async () => {
      invalidStructuredProbeCalled = true;
      return { success: true, code: 'ok', message: 'must not probe' };
    }
  );
  assert.strictEqual(invalidStructuredProbe.success, false);
  assert.match(invalidStructuredProbe.message, /invalid SSH port/i);
  assert.strictEqual(invalidStructuredProbeCalled, false);

  const secondHost = {
    id: 'second',
    name: 'Second host',
    hostname: '198.51.100.77',
    username: 'draft-user',
    port: 2207
  };
  let submittedManagedProbeHost;
  const submittedManagedDraft = {
    ...managedProject,
    sshHostId: 'second',
    remotePath: '/srv/draft-version'
  };
  const submittedManagedTest = await testSubmittedSshProjectConnection(
    submittedManagedDraft,
    [currentStoredProject],
    [currentHost, secondHost],
    async host => {
      submittedManagedProbeHost = host;
      return { success: true, code: 'ok', message: 'draft probed' };
    }
  );
  assert.strictEqual(submittedManagedTest.success, true);
  assert.deepStrictEqual(
    submittedManagedProbeHost,
    secondHost,
    'an existing project test uses the submitted Host instead of its stored Host'
  );

  let invalidDraftPathProbeCalled = false;
  const invalidDraftPathTest = await testSubmittedSshProjectConnection(
    {
      ...submittedManagedDraft,
      type: 'ssh-workspace',
      remotePath: '/srv/draft-version.txt'
    },
    [currentStoredProject],
    [currentHost, secondHost],
    async () => {
      invalidDraftPathProbeCalled = true;
      return { success: true, code: 'ok', message: 'must not probe invalid draft path' };
    }
  );
  assert.strictEqual(invalidDraftPathTest.success, false);
  assert.match(invalidDraftPathTest.message, /should end with \.code-workspace/i);
  assert.strictEqual(
    invalidDraftPathProbeCalled,
    false,
    'submitted remotePath validation is not replaced by the stored remotePath'
  );

  const storedLegacyProject = {
    id: 'stored-legacy',
    name: 'Stored legacy',
    path: 'old-user@old.example.com:/srv/old',
    type: 'ssh'
  };
  const submittedLegacyDraft = {
    ...storedLegacyProject,
    path: 'new-user@new.example.com:/srv/new'
  };
  let submittedLegacyProbeHost;
  const submittedLegacyTest = await testSubmittedSshProjectConnection(
    submittedLegacyDraft,
    [storedLegacyProject],
    [],
    async host => {
      submittedLegacyProbeHost = host;
      return { success: true, code: 'ok', message: 'legacy draft probed' };
    }
  );
  assert.strictEqual(submittedLegacyTest.success, true);
  assert.deepStrictEqual(
    (({ hostname, username }) => ({ hostname, username }))(submittedLegacyProbeHost),
    { hostname: 'new.example.com', username: 'new-user' }
  );

  for (const staleId of ['deleted-project', '']) {
    let staleProjectProbeCalled = false;
    const staleProjectTest = await testSubmittedSshProjectConnection(
      { ...managedProject, id: staleId },
      [currentStoredProject],
      [customPortHost],
      async () => {
        staleProjectProbeCalled = true;
        return { success: true, code: 'ok', message: 'must not probe' };
      }
    );
    assert.strictEqual(staleProjectTest.success, false);
    assert.match(staleProjectTest.message, /Project .* no longer exists/);
    assert.strictEqual(staleProjectProbeCalled, false);
  }

  let idlessDraftProbeHost;
  const idlessDraftTest = await testSubmittedSshProjectConnection(
    {
      name: 'New draft',
      path: 'fresh@new-draft.example.com:/srv/new',
      type: 'ssh'
    },
    [currentStoredProject],
    [],
    async host => {
      idlessDraftProbeHost = host;
      return { success: true, code: 'ok', message: 'new draft probed' };
    }
  );
  assert.strictEqual(idlessDraftTest.success, true);
  assert.strictEqual(idlessDraftProbeHost.hostname, 'new-draft.example.com');

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
