const assert = require('assert');
const { userInfo } = require('os');
const {
  buildRemoteSshUri,
  buildRemoteSshUriFromTarget,
  encodeRemoteSshAuthority,
  extractHostnameFromSshPath,
  getRawSshPathFromRemoteUri,
  normalizeRemoteSshAuthority,
  parseRemoteSshAuthority,
  parseRemoteSshAuthorityStrict,
  parseRawSshPath
} = require('../out/sshPath');

const localUsername = userInfo().username;
const encodedAuthority = '7b22686f73744e616d65223a22746f6f6c732d6c696e75782d7969636869227d';
const remoteUri = `vscode-remote://ssh-remote+${encodedAuthority}/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace`;
const remoteUriWithLocalUser = `vscode-remote://ssh-remote+${localUsername}@${encodedAuthority}/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace`;
const rawSshPath = `${localUsername}@${encodedAuthority}:/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace`;
const encodedAuthorityWithRemoteUser = '7b2275736572223a2273777161222c22686f73744e616d65223a22746f6f6c732d6c696e75782d7969636869227d';
const encodedAuthorityWithUserAndPort = Buffer.from(JSON.stringify({
  hostName: '10.7.8.9',
  user: 'yichi',
  port: 2222
})).toString('hex');

assert.strictEqual(typeof parseRemoteSshAuthorityStrict, 'function');
assert.deepStrictEqual(
  parseRemoteSshAuthorityStrict(encodedAuthorityWithUserAndPort),
  {
    authority: {
      hostname: '10.7.8.9',
      username: 'yichi',
      port: 2222,
      structured: true
    }
  }
);
assert.deepStrictEqual(
  parseRemoteSshAuthorityStrict(Buffer.from(JSON.stringify({
    hostName: 'example.com',
    port: '2222'
  })).toString('hex')),
  {
    authority: {
      hostname: 'example.com',
      username: undefined,
      port: 2222,
      structured: true
    }
  }
);
for (const invalidPort of [0, 70000, 'not-a-port']) {
  assert.deepStrictEqual(
    parseRemoteSshAuthorityStrict(Buffer.from(JSON.stringify({
      hostName: '10.7.8.9',
      port: invalidPort
    })).toString('hex')),
    { error: 'invalid-port' }
  );
}
assert.deepStrictEqual(
  parseRemoteSshAuthorityStrict(Buffer.from(JSON.stringify({
    user: 'yichi',
    port: 2222
  })).toString('hex')),
  { error: 'missing-hostname' }
);

assert.deepStrictEqual(
  parseRemoteSshAuthority(encodedAuthorityWithUserAndPort),
  {
    hostname: '10.7.8.9',
    username: 'yichi',
    port: 2222,
    structured: true
  },
  'parses host, user, and port from a hex-encoded Remote-SSH authority'
);

const uriBuiltFromTarget = buildRemoteSshUriFromTarget(
  { hostname: '10.7.8.9', username: 'yichi', port: 2222 },
  'C:/repo'
);
const builtAuthority = uriBuiltFromTarget
  .replace('vscode-remote://ssh-remote+', '')
  .split('/')[0];

assert.strictEqual(
  uriBuiltFromTarget,
  `vscode-remote://ssh-remote+${encodedAuthorityWithUserAndPort}/C:/repo`,
  'builds a Remote-SSH URI with a structured authority when user and port are explicit'
);
assert.deepStrictEqual(
  JSON.parse(Buffer.from(builtAuthority, 'hex').toString('utf8')),
  { hostName: '10.7.8.9', user: 'yichi', port: 2222 },
  'retains all explicit target fields in the structured authority payload'
);
for (const hostname of ['BuildHost', 'team/host', 'team\\host', 'team+host']) {
  assert.strictEqual(
    parseRemoteSshAuthority(encodeRemoteSshAuthority({ hostname })).structured,
    true,
    `encodes the unsafe hostname ${hostname} as a structured authority`
  );
}
assert.strictEqual(
  parseRemoteSshAuthority(encodeRemoteSshAuthority({
    hostname: 'tools-linux-yichi',
    username: 'swqa'
  })).structured,
  true,
  'encodes an explicit username as a structured authority even without a port'
);
assert.strictEqual(
  parseRemoteSshAuthority(encodeRemoteSshAuthority({
    hostname: 'tools-linux-yichi',
    port: 2222
  })).structured,
  true,
  'encodes an explicit port as a structured authority even without a username'
);
assert.deepStrictEqual(
  parseRemoteSshAuthority(Buffer.from(JSON.stringify({
    hostName: '10.7.8.9',
    user: 'yichi',
    port: '2222'
  })).toString('hex')),
  {
    hostname: '10.7.8.9',
    username: 'yichi',
    port: 2222,
    structured: true
  },
  'accepts a digit-only string port from structured authorities'
);
for (const invalidPort of [0, 70000, 'not-a-port']) {
  const invalidPortAuthority = Buffer.from(JSON.stringify({
    hostName: '10.7.8.9',
    port: invalidPort
  })).toString('hex');
  assert.deepStrictEqual(
    parseRemoteSshAuthority(invalidPortAuthority),
    {
      hostname: '10.7.8.9',
      username: undefined,
      port: undefined,
      structured: true
    },
    `ignores invalid structured port ${invalidPort} without rejecting the host`
  );
}

for (const invalidPort of [0, 65536, 1.5, NaN]) {
  assert.throws(
    () => encodeRemoteSshAuthority({ hostname: '10.7.8.9', port: invalidPort }),
    /SSH port must be an integer between 1 and 65535/,
    `rejects invalid explicit port ${invalidPort} during authority encoding`
  );
  assert.throws(
    () => buildRemoteSshUriFromTarget({ hostname: '10.7.8.9', port: invalidPort }, '/repo'),
    /SSH port must be an integer between 1 and 65535/,
    `rejects invalid explicit port ${invalidPort} during URI construction`
  );
}

const invalidImportedJson = JSON.stringify({
  hostName: '10.7.8.9',
  user: 'yichi',
  port: 70000
});
const invalidImportedAuthority = Buffer.from(invalidImportedJson).toString('hex');
for (const [label, importedAuthority] of [
  ['raw JSON', invalidImportedJson],
  ['percent-encoded JSON', encodeURIComponent(invalidImportedJson)],
  ['hex JSON', invalidImportedAuthority]
]) {
  const importedUri = `vscode-remote://ssh-remote+${importedAuthority}/C:/repo`;
  const canonicalRawPath = `${invalidImportedAuthority}:C:/repo`;
  const canonicalUri = `vscode-remote://ssh-remote+${invalidImportedAuthority}/C:/repo`;

  assert.strictEqual(
    normalizeRemoteSshAuthority(importedAuthority),
    invalidImportedAuthority,
    `normalizes an invalid-port ${label} authority to delimiter-safe hex`
  );
  assert.strictEqual(
    getRawSshPathFromRemoteUri(importedUri),
    canonicalRawPath,
    `converts an invalid-port ${label} URI to a delimiter-safe raw SSH path`
  );
  assert.deepStrictEqual(
    parseRawSshPath(canonicalRawPath),
    {
      userHost: invalidImportedAuthority,
      username: 'yichi',
      hostname: '10.7.8.9',
      remotePath: 'C:/repo'
    },
    `parses the canonical raw path produced from an invalid-port ${label} authority`
  );
  assert.strictEqual(
    buildRemoteSshUri(canonicalRawPath),
    canonicalUri,
    `round-trips an invalid-port ${label} authority without selecting the default port`
  );
}

const invalidImportedHostJson = JSON.stringify({
  hostName: '10.7.8.9',
  port: 70000
});
const invalidImportedHostAuthority = Buffer.from(invalidImportedHostJson).toString('hex');
const wrappedInvalidImportedUri = `vscode-remote://ssh-remote+someone@${encodeURIComponent(invalidImportedHostJson)}/C:/repo`;
const canonicalWrappedInvalidUri = `vscode-remote://ssh-remote+someone@${invalidImportedHostAuthority}/C:/repo`;
const wrappedInvalidRawPath = `someone@${invalidImportedHostAuthority}:C:/repo`;
assert.strictEqual(
  getRawSshPathFromRemoteUri(wrappedInvalidImportedUri),
  wrappedInvalidRawPath,
  'canonicalizes an outer-user invalid-port JSON authority before raw-path storage'
);
assert.deepStrictEqual(
  parseRawSshPath(wrappedInvalidRawPath),
  {
    userHost: `someone@${invalidImportedHostAuthority}`,
    username: 'someone',
    hostname: '10.7.8.9',
    remotePath: 'C:/repo'
  },
  'parses a preserved outer user without mistaking the structured authority for a hostname'
);
assert.strictEqual(
  buildRemoteSshUri(wrappedInvalidRawPath),
  canonicalWrappedInvalidUri,
  'round-trips an outer user wrapped around an imported invalid-port authority'
);

assert.deepStrictEqual(
  parseRemoteSshAuthority('tools-linux-yichi'),
  {
    hostname: 'tools-linux-yichi',
    username: undefined,
    port: undefined,
    structured: false
  },
  'keeps a plain lowercase hostname readable'
);
assert.strictEqual(
  buildRemoteSshUriFromTarget({ hostname: 'tools-linux-yichi' }, '/home/swqa/project'),
  'vscode-remote://ssh-remote+tools-linux-yichi/home/swqa/project',
  'does not encode a safe lowercase hostname without an explicit user or port'
);

assert.strictEqual(
  getRawSshPathFromRemoteUri(uriBuiltFromTarget),
  `${encodedAuthorityWithUserAndPort}:C:/repo`,
  'preserves the structured authority when converting a custom-port URI to a raw path'
);
assert.deepStrictEqual(
  parseRawSshPath(`${encodedAuthorityWithUserAndPort}:C:/repo`),
  {
    userHost: encodedAuthorityWithUserAndPort,
    username: 'yichi',
    hostname: '10.7.8.9',
    port: 2222,
    remotePath: 'C:/repo'
  },
  'parses lossless target metadata from a raw structured authority'
);
assert.strictEqual(
  buildRemoteSshUri(`${encodedAuthorityWithUserAndPort}:C:/repo`),
  uriBuiltFromTarget,
  'round-trips a custom-port raw path back to the same structured Remote-SSH URI'
);

assert.deepStrictEqual(
  parseRawSshPath('user@host:2222:/path'),
  {
    userHost: 'user@host',
    username: 'user',
    hostname: 'host',
    remotePath: '2222:/path'
  },
  'does not interpret ambiguous user@host:2222:/path syntax as a custom-port target'
);

assert.strictEqual(
  extractHostnameFromSshPath(remoteUri),
  'tools-linux-yichi',
  'extracts hostName from hex-encoded Remote-SSH authority'
);

assert.strictEqual(
  getRawSshPathFromRemoteUri(remoteUri),
  'tools-linux-yichi:/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace',
  'normalizes Remote-SSH URI authority before storing'
);

assert.strictEqual(
  getRawSshPathFromRemoteUri(remoteUriWithLocalUser),
  'tools-linux-yichi:/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace',
  'drops local default username from structured Remote-SSH authority before storing'
);

assert.deepStrictEqual(
  parseRawSshPath(rawSshPath),
  {
    userHost: 'tools-linux-yichi',
    username: undefined,
    hostname: 'tools-linux-yichi',
    remotePath: '/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace'
  },
  'drops local default username from persisted SSH paths that already contain encoded authority'
);

assert.strictEqual(
  buildRemoteSshUri(rawSshPath),
  'vscode-remote://ssh-remote+tools-linux-yichi/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace',
  'builds Remote-SSH URIs with readable normalized authorities'
);

assert.deepStrictEqual(
  parseRawSshPath(`someone@${encodedAuthority}:/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace`),
  {
    userHost: 'someone@tools-linux-yichi',
    username: 'someone',
    hostname: 'tools-linux-yichi',
    remotePath: '/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace'
  },
  'preserves explicit non-local usernames while decoding structured host authority'
);

assert.deepStrictEqual(
  parseRawSshPath(`${localUsername}@${encodedAuthorityWithRemoteUser}:/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace`),
  {
    userHost: 'swqa@tools-linux-yichi',
    username: 'swqa',
    hostname: 'tools-linux-yichi',
    remotePath: '/home/swqa/yichi/NsysCLIAuto-Dual.code-workspace'
  },
  'trusts the remote user embedded in structured Remote-SSH authority'
);

console.log('sshPath tests passed');
