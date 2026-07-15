const assert = require('assert');
const { createDemoAgentInventory, createDemoProjectState } = require('../out/demoData');

const state = createDemoProjectState({ viewMode: 'mini', selectedGroup: 'Private', collapsedGroups: ['Private'] });
assert.strictEqual(state.schemaVersion, 2);
assert.ok(state.projects.length >= 15, 'demo mode should provide a useful screenshot collection');
assert.ok(state.sshHosts.length >= 2, 'demo mode should include multiple SSH Hosts');
assert.strictEqual(state.uiSettings.viewMode, 'mini');
assert.strictEqual(state.uiSettings.selectedGroup, '');
assert.deepStrictEqual(state.uiSettings.collapsedGroups, []);

const projectIds = state.projects.map(project => project.id);
assert.strictEqual(new Set(projectIds).size, projectIds.length, 'demo project IDs must be unique');
assert.ok(state.projects.every(project => project.id.startsWith('demo-')));
assert.ok(state.projects.every(project => project.icon.startsWith('data:image/svg+xml;base64,')));

const inventory = createDemoAgentInventory();
assert.strictEqual(inventory.schemaVersion, 2);
assert.strictEqual(inventory.machines.length, 3);
assert.ok(inventory.assets.some(asset => asset.kind === 'skill'));
assert.ok(inventory.assets.some(asset => asset.kind === 'mcp' && asset.mcp));
assert.ok(inventory.assets.some(asset => asset.kind === 'settings'));

for (const summary of inventory.summaries) {
  const assets = inventory.assets.filter(asset => asset.machineId === summary.machineId);
  assert.strictEqual(summary.skillCount, assets.filter(asset => asset.kind === 'skill').length);
  assert.strictEqual(summary.mcpCount, assets.filter(asset => asset.kind === 'mcp').length);
  assert.strictEqual(summary.settingsCount, assets.filter(asset => asset.kind === 'settings').length);
}

const serialized = JSON.stringify({ state, inventory }).toLowerCase();
for (const sensitiveMarker of ['yiczhang', 'swqa', '10.172.', 'nvidia', 'c:\\yichi', '/home/swqa']) {
  assert.ok(!serialized.includes(sensitiveMarker), `demo data must not contain ${sensitiveMarker}`);
}

console.log('demo data tests passed');
