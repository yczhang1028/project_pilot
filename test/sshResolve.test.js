const assert = require('assert');
const childProcess = require('child_process');
const dnsPromises = require('dns/promises');
const fs = require('fs');
const os = require('os');
const util = require('util');

const originalExecFile = childProcess.execFile;
const originalLookup = dnsPromises.lookup;
const originalExistsSync = fs.existsSync;
const originalUserInfo = os.userInfo;
const windowsSshPath = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';

function sshError(message, fields = {}) {
  return Object.assign(new Error(message), fields);
}

function loadSshResolveWithMocks({
  sshConfigStdout = '',
  localUsername = 'yiczhang',
  configHandler,
  probeHandler,
  lookupHandler,
  windowsSshAvailable = true
} = {}) {
  delete require.cache[require.resolve('../out/sshResolve')];

  const calls = [];
  childProcess.execFile = function execFileMock() {};
  childProcess.execFile[util.promisify.custom] = async (command, args, options) => {
    const call = { command, args: [...args], options: { ...options } };
    calls.push(call);

    if (args[0] === '-G') {
      if (configHandler) {
        return configHandler(call);
      }
      return { stdout: sshConfigStdout, stderr: '' };
    }

    if (probeHandler) {
      return probeHandler(call);
    }
    return { stdout: '', stderr: '' };
  };
  dnsPromises.lookup = lookupHandler ?? (async () => ({ address: '10.0.0.8', family: 4 }));
  fs.existsSync = path => path === windowsSshPath ? windowsSshAvailable : originalExistsSync(path);
  os.userInfo = () => ({ username: localUsername });

  return {
    module: require('../out/sshResolve'),
    calls,
    configCalls: () => calls.filter(call => call.args[0] === '-G'),
    probeCalls: () => calls.filter(call => call.args[0] !== '-G')
  };
}

async function testUsernameResolution() {
  const configuredUserModule = loadSshResolveWithMocks({
    sshConfigStdout: [
      'user swqa',
      'hostname tools-linux-yichi',
      'port 22'
    ].join('\n')
  }).module;
  const configuredUser = await configuredUserModule.resolveSshTarget('tools-linux-yichi:/home/swqa/project');
  assert.strictEqual(
    configuredUser.canonicalPath,
    'swqa@tools-linux-yichi:/home/swqa/project',
    'uses non-default SSH config User in canonical path'
  );
  assert.strictEqual(configuredUser.resolvedUsername, 'swqa');

  const defaultUserModule = loadSshResolveWithMocks({
    sshConfigStdout: [
      'user yiczhang',
      'hostname tools-linux-yichi',
      'port 22'
    ].join('\n')
  }).module;
  const defaultUser = await defaultUserModule.resolveSshTarget('tools-linux-yichi:/home/swqa/project');
  assert.strictEqual(
    defaultUser.canonicalPath,
    'tools-linux-yichi:/home/swqa/project',
    'does not persist local default username from ssh -G as an explicit remote user'
  );
  assert.strictEqual(defaultUser.resolvedUsername, undefined);
}

async function testSuccessfulProbeArguments() {
  const loaded = loadSshResolveWithMocks();
  const result = await loaded.module.testSshHostConnection({
    name: 'GPU',
    hostname: '10.7.8.9',
    username: 'yichi',
    port: 2222
  });

  assert.deepStrictEqual(loaded.probeCalls(), [{
    command: 'ssh',
    args: [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=5',
      '-p',
      '2222',
      '--',
      'yichi@10.7.8.9',
      'exit'
    ],
    options: {
      timeout: 10_000,
      windowsHide: true
    }
  }]);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.code, 'ok');
  assert.match(result.message, /GPU/);
  assert.strictEqual(result.resolution.success, true);
}

async function testProbeWithoutOptionalUserOrPort() {
  const loaded = loadSshResolveWithMocks();
  const result = await loaded.module.testSshHostConnection({
    name: 'Build host',
    hostname: 'build-box'
  });

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(loaded.probeCalls()[0].args, [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
    '--',
    'build-box',
    'exit'
  ]);
  assert.strictEqual(loaded.probeCalls()[0].args.includes('-p'), false);
  assert.strictEqual(loaded.probeCalls()[0].args.some(arg => arg.includes('@')), false);
}

async function assertProbeFailure({ error, expectedCode, messagePattern }) {
  const loaded = loadSshResolveWithMocks({
    probeHandler: async () => { throw error; }
  });
  const result = await loaded.module.testSshHostConnection({
    name: 'Broken host',
    hostname: 'broken.example'
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, expectedCode);
  if (messagePattern) {
    assert.match(result.message, messagePattern);
  }
  return { loaded, result };
}

async function testFailureClassifications() {
  await assertProbeFailure({
    error: sshError('spawn ssh ENOENT', { code: 'ENOENT' }),
    expectedCode: 'ssh-not-found'
  });
  await assertProbeFailure({
    error: sshError('ssh failed', { stderr: 'ssh: Could not resolve hostname missing: Name or service not known' }),
    expectedCode: 'dns'
  });
  await assertProbeFailure({
    error: sshError('Command timed out', { code: 'ETIMEDOUT', killed: true }),
    expectedCode: 'timeout'
  });
  await assertProbeFailure({
    error: sshError('ssh failed', { stderr: 'REMOTE HOST IDENTIFICATION HAS CHANGED!' }),
    expectedCode: 'host-key'
  });
  await assertProbeFailure({
    error: sshError('ssh failed', { stderr: 'Permission denied (publickey,password).' }),
    expectedCode: 'auth',
    messagePattern: /password-only Hosts cannot pass.*BatchMode/i
  });
  await assertProbeFailure({
    error: sshError('No supported authentication methods available'),
    expectedCode: 'auth'
  });
  await assertProbeFailure({
    error: sshError('ssh failed', { stderr: 'Too many authentication failures' }),
    expectedCode: 'auth'
  });
  await assertProbeFailure({
    error: sshError('ssh failed', { stderr: 'subsystem request failed on channel 0' }),
    expectedCode: 'remote-command',
    messagePattern: /transport and authentication may have succeeded.*remote command failed or is restricted/i
  });
}

async function testUntrustedDestinationsFollowOptionTerminator() {
  for (const host of [
    {
      name: 'Hostile hostname',
      hostname: '-oProxyCommand=calc.exe'
    },
    {
      name: 'Hostile username',
      hostname: 'safe.example',
      username: '-oProxyCommand=calc.exe'
    }
  ]) {
    const loaded = loadSshResolveWithMocks();
    const result = await loaded.module.testSshHostConnection(host);
    const target = host.username ? `${host.username}@${host.hostname}` : host.hostname;

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(
      loaded.configCalls()[0].args.slice(-2),
      ['--', host.hostname],
      'ssh -G terminates option parsing before the untrusted hostname'
    );
    assert.deepStrictEqual(
      loaded.probeCalls()[0].args.slice(-3),
      ['--', target, 'exit'],
      'the real probe terminates option parsing before the untrusted destination'
    );
  }
}

async function testBoundedInformationalResolution() {
  const loaded = loadSshResolveWithMocks({
    lookupHandler: () => new Promise(() => {})
  });
  const marginMs = 2_500;
  const didNotSettle = Symbol('did-not-settle');
  const result = await Promise.race([
    loaded.module.testSshHostConnection({
      name: 'Slow DNS host',
      hostname: 'slow-dns.example'
    }),
    new Promise(resolve => setTimeout(() => resolve(didNotSettle), marginMs))
  ]);

  assert.notStrictEqual(result, didNotSettle, `probe settles within the ${marginMs}ms test margin`);
  assert.strictEqual(result.success, true);
  assert.strictEqual(loaded.probeCalls().length, 1);
}

async function testIpv6ResolutionInput() {
  const loaded = loadSshResolveWithMocks();
  const result = await loaded.module.testSshHostConnection({
    name: 'IPv6 host',
    hostname: '2001:db8::7',
    username: 'alice'
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.resolution.host, '2001:db8::7');
  assert.deepStrictEqual(loaded.configCalls()[0].args, [
    '-G',
    '-l',
    'alice',
    '--',
    '2001:db8::7'
  ]);
  assert.deepStrictEqual(loaded.probeCalls()[0].args.slice(-3), [
    '--',
    'alice@2001:db8::7',
    'exit'
  ]);
}

async function testSafeFailureMessages() {
  const hostKeyFailure = await assertProbeFailure({
    error: sshError('ssh failed', {
      stderr: 'Offending key in C:\\Users\\alice\\.ssh\\known_hosts:7\nREMOTE HOST IDENTIFICATION HAS CHANGED!'
    }),
    expectedCode: 'host-key'
  });
  assert.doesNotMatch(hostKeyFailure.result.message, /C:\\Users|known_hosts|:7/);

  const remoteCommandFailure = await assertProbeFailure({
    error: sshError('Command failed using C:\\Users\\alice\\.ssh\\id_rsa', {
      stderr: '\u001b[31mUNTRUSTED REMOTE BANNER\u001b[0m\nsubsystem request failed on channel 0\u0007'
    }),
    expectedCode: 'remote-command'
  });
  assert.strictEqual(
    remoteCommandFailure.result.message,
    'SSH Host "Broken host" transport and authentication may have succeeded, but the remote command failed or is restricted.'
  );
  assert.doesNotMatch(
    remoteCommandFailure.result.message,
    /C:\\Users|id_rsa|UNTRUSTED REMOTE BANNER|\u001b|\u0007/
  );
}

async function testCandidateFallbackAfterEnoent() {
  const loaded = loadSshResolveWithMocks({
    probeHandler: async call => {
      if (call.command === 'ssh') {
        throw sshError('spawn ssh ENOENT', { code: 'ENOENT' });
      }
      return { stdout: '', stderr: '' };
    }
  });
  const result = await loaded.module.testSshHostConnection({
    name: 'Fallback host',
    hostname: 'fallback.example'
  });

  const expectedCandidates = process.platform === 'win32'
    ? ['ssh', windowsSshPath]
    : ['ssh'];
  assert.deepStrictEqual(loaded.probeCalls().map(call => call.command), expectedCandidates);
  assert.strictEqual(result.success, process.platform === 'win32');
  assert.strictEqual(result.code, process.platform === 'win32' ? 'ok' : 'ssh-not-found');
}

async function testNonEnoentStopsCandidateFallback() {
  const loaded = loadSshResolveWithMocks({
    probeHandler: async () => {
      throw sshError('remote command failed');
    }
  });
  const result = await loaded.module.testSshHostConnection({
    name: 'No fallback host',
    hostname: 'no-fallback.example'
  });

  assert.strictEqual(result.code, 'remote-command');
  assert.deepStrictEqual(loaded.probeCalls().map(call => call.command), ['ssh']);
}

async function testInvalidHostsDoNotSpawn() {
  for (const host of [
    { name: 'Blank host', hostname: '   ' },
    { name: 'Bad port', hostname: 'valid.example', port: 70000 },
    { name: 'Fractional port', hostname: 'valid.example', port: 22.5 },
    { name: 'Hostname control', hostname: 'safe.example\n-oProxyCommand=calc.exe' },
    { name: 'Username control', hostname: 'safe.example', username: 'alice\r-oProxyCommand=calc.exe' }
  ]) {
    const loaded = loadSshResolveWithMocks();
    const result = await loaded.module.testSshHostConnection(host);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'remote-command');
    assert.strictEqual(loaded.calls.length, 0, 'invalid Hosts do not spawn ssh resolution or probe commands');
  }
}

async function main() {
  try {
    await testUsernameResolution();
    await testSuccessfulProbeArguments();
    await testProbeWithoutOptionalUserOrPort();
    await testFailureClassifications();
    await testUntrustedDestinationsFollowOptionTerminator();
    await testBoundedInformationalResolution();
    await testIpv6ResolutionInput();
    await testSafeFailureMessages();
    await testCandidateFallbackAfterEnoent();
    await testNonEnoentStopsCandidateFallback();
    await testInvalidHostsDoNotSpawn();

    console.log('sshResolve tests passed');
  } finally {
    childProcess.execFile = originalExecFile;
    dnsPromises.lookup = originalLookup;
    fs.existsSync = originalExistsSync;
    os.userInfo = originalUserInfo;
    delete require.cache[require.resolve('../out/sshResolve')];
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
