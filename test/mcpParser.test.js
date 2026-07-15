const assert = require('node:assert/strict');
const { parseMcpConfig } = require('../out/agentAssets/mcpParser');

const root = {
  id: 'mcp-test',
  kind: 'mcp',
  providerId: 'cursor',
  providerLabel: 'Cursor',
  scope: 'global',
  sourceKind: 'native',
  base: 'absolute',
  path: '/tmp/mcp.json',
  label: 'MCP test'
};

const jsonAssets = parseMcpConfig(root, '/tmp/mcp.json', JSON.stringify({
  mcpServers: {
    local: {
      command: 'npx',
      args: ['-y', 'example-server', '--token', 'super-secret-value'],
      env: { API_KEY: 'must-not-be-cached' },
      headers: { Authorization: 'must-not-be-cached' },
      disabled: true
    },
    remote: {
      type: 'sse',
      url: 'https://user:password@example.com/mcp/sse?token=secret#fragment'
    }
  }
}));

assert.equal(jsonAssets.length, 2);
assert.deepEqual(jsonAssets[0].mcp.args, ['-y', 'example-server', '--token', '<redacted>']);
assert.deepEqual(jsonAssets[0].mcp.envKeys, ['API_KEY']);
assert.deepEqual(jsonAssets[0].mcp.headerKeys, ['Authorization']);
assert.equal(jsonAssets[0].mcp.enabled, false);
assert.equal(jsonAssets[1].mcp.transport, 'sse');
assert.equal(jsonAssets[1].mcp.url, 'https://example.com/mcp/sse');
assert.doesNotMatch(JSON.stringify(jsonAssets), /must-not-be-cached|super-secret-value|password|token=secret/);

const tomlAssets = parseMcpConfig(root, '/tmp/config.toml', `
[mcp_servers.local]
command = "uvx"
args = ["example-server", "--api-key", "secret-key-value"]

[mcp_servers.local.env]
SERVICE_TOKEN = "must-not-be-cached"

[mcp_servers."docs.server"]
url = "https://docs.example.com/mcp?credential=secret"
enabled = false
`);

assert.equal(tomlAssets.length, 2);
assert.deepEqual(tomlAssets[0].mcp.args, ['example-server', '--api-key', '<redacted>']);
assert.deepEqual(tomlAssets[0].mcp.envKeys, ['SERVICE_TOKEN']);
assert.equal(tomlAssets[1].name, 'docs.server');
assert.equal(tomlAssets[1].mcp.url, 'https://docs.example.com/mcp');
assert.equal(tomlAssets[1].mcp.enabled, false);
assert.doesNotMatch(JSON.stringify(tomlAssets), /must-not-be-cached|secret-key-value|credential=secret/);

const invalid = parseMcpConfig(root, '/tmp/mcp.json', '{not valid json');
assert.equal(invalid.length, 1);
assert.equal(invalid[0].status, 'invalid');
assert.equal(invalid[0].entryKey, '__config__');

console.log('mcpParser tests passed');
