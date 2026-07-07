const assert = require('assert');
const Module = require('module');

class EventEmitter {
  constructor() {
    this.event = () => ({ dispose() {} });
  }

  fire(value) {
    this.lastValue = value;
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

const vscodeMock = {
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2
  },
  ThemeIcon,
  ThemeColor,
  Uri: {
    parse(value) {
      return { value };
    }
  },
  window: {
    async showQuickPick() {
      return undefined;
    }
  }
};

const hosts = [
  {
    id: 'host-build',
    name: 'Build Host',
    hostname: 'build.example.com',
    username: 'builder',
    port: 2200
  },
  {
    id: 'host-alpha',
    name: 'Alpha Unused',
    hostname: 'alpha.example.com'
  }
];

const projects = [
  {
    id: 'managed',
    name: 'Managed Repo',
    path: 'builder@build.example.com:/srv/managed',
    remotePath: '/srv/managed',
    sshHostId: 'host-build',
    type: 'ssh',
    isFavorite: true,
    lastAccessed: '2026-07-07T08:00:00.000Z'
  },
  {
    id: 'local',
    name: 'Local Repo',
    path: 'C:\\work\\local',
    type: 'local',
    isFavorite: true,
    lastAccessed: '2026-07-07T09:00:00.000Z'
  },
  {
    id: 'legacy',
    name: 'Legacy SSH',
    path: 'legacy.example.com:/srv/legacy',
    type: 'ssh'
  }
];

const originalLoad = Module._load;
const providerModulePath = require.resolve('../out/outlineTreeProvider');
const originalCacheEntries = new Set(Object.keys(require.cache));

try {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') {
      return vscodeMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[providerModulePath];

  const { OutlineTreeProvider } = require(providerModulePath);
  const originalProjects = JSON.parse(JSON.stringify(projects));
  const originalHosts = JSON.parse(JSON.stringify(hosts));
  const store = { state: { projects, sshHosts: hosts } };
  const workspaceState = {
    get(_key, fallback) {
      return fallback;
    },
    async update() {}
  };
  const provider = new OutlineTreeProvider(store, workspaceState, 'host');

  assert.strictEqual(provider.getModeLabel(), 'By Host');

  const roots = provider.getChildren();
  assert.deepStrictEqual(
    roots.map(node => node.sectionKind),
    ['favorites', 'recent', 'mode-root'],
    'Favorites and Recent remain top-level flat sections before All Projects'
  );

  const favorites = roots.find(node => node.sectionKind === 'favorites');
  assert.deepStrictEqual(
    favorites.children.map(node => [node.type, node.project.id]),
    [['project', 'local'], ['project', 'managed']],
    'Favorites contains project nodes directly'
  );

  const recent = roots.find(node => node.sectionKind === 'recent');
  assert.deepStrictEqual(
    recent.children.map(node => [node.type, node.project.id]),
    [['project', 'local'], ['project', 'managed']],
    'Recent contains project nodes directly'
  );

  const modeRoot = roots.find(node => node.sectionKind === 'mode-root');
  assert.strictEqual(modeRoot.label, 'All Projects');
  assert.deepStrictEqual(
    modeRoot.children.map(node => node.label),
    ['Alpha Unused', 'Build Host', 'Local', 'Unmanaged SSH']
  );

  const unusedHostNode = modeRoot.children[0];
  const usedHostNode = modeRoot.children[1];
  const localNode = modeRoot.children[2];
  const unmanagedNode = modeRoot.children[3];

  assert.strictEqual(usedHostNode.type, 'host');
  assert.strictEqual(usedHostNode.id, 'host:host-build');
  assert.strictEqual(usedHostNode.hostId, 'host-build');
  assert.strictEqual(usedHostNode.label, 'Build Host');
  assert.strictEqual(usedHostNode.description, '1 project');
  assert.match(usedHostNode.tooltip, /builder@build\.example\.com/);
  assert.match(usedHostNode.tooltip, /Port: 2200/);
  assert.match(usedHostNode.tooltip, /1 linked project/);
  assert.match(usedHostNode.tooltip, /Managed Repo/);
  assert.deepStrictEqual(
    usedHostNode.children.map(node => node.project.id),
    ['managed']
  );

  const usedHostItem = provider.getTreeItem(usedHostNode);
  assert.match(usedHostItem.contextValue, /(?:^|,)outline-host(?:,|$)/);
  assert.match(usedHostItem.contextValue, /(?:^|,)host-used(?:,|$)/);
  assert.match(usedHostItem.contextValue, /(?:^|,)host-id:host-build(?:,|$)/);
  assert.strictEqual(usedHostItem.collapsibleState, vscodeMock.TreeItemCollapsibleState.Expanded);
  assert.strictEqual(usedHostItem.command, undefined, 'Host nodes never open projects');

  assert.strictEqual(unusedHostNode.type, 'host');
  assert.strictEqual(unusedHostNode.hostId, 'host-alpha');
  assert.strictEqual(unusedHostNode.description, '0 projects');
  assert.match(unusedHostNode.tooltip, /alpha\.example\.com/);
  assert.match(unusedHostNode.tooltip, /Port: SSH config\/default/);
  assert.match(unusedHostNode.tooltip, /0 linked projects/);
  assert.deepStrictEqual(unusedHostNode.children, []);

  const unusedHostItem = provider.getTreeItem(unusedHostNode);
  assert.match(unusedHostItem.contextValue, /(?:^|,)outline-host(?:,|$)/);
  assert.match(unusedHostItem.contextValue, /(?:^|,)host-unused(?:,|$)/);
  assert.match(unusedHostItem.contextValue, /(?:^|,)host-id:host-alpha(?:,|$)/);
  assert.doesNotMatch(unusedHostItem.contextValue, /(?:^|,)host-used(?:,|$)/);
  assert.strictEqual(unusedHostItem.collapsibleState, vscodeMock.TreeItemCollapsibleState.None);
  assert.strictEqual(unusedHostItem.command, undefined);

  assert.strictEqual(localNode.type, 'group');
  assert.strictEqual(unmanagedNode.type, 'group');
  assert.deepStrictEqual(localNode.children.map(node => node.project.id), ['local']);
  assert.deepStrictEqual(unmanagedNode.children.map(node => node.project.id), ['legacy']);
  assert.doesNotMatch(provider.getTreeItem(localNode).contextValue, /outline-host/);
  assert.doesNotMatch(provider.getTreeItem(unmanagedNode).contextValue, /outline-host/);

  assert.deepStrictEqual(
    modeRoot.children.flatMap(node => node.children.map(child => child.project.id)),
    ['managed', 'local', 'legacy'],
    'every project appears exactly once in the host mode section'
  );

  provider.setMode('group');
  assert.deepStrictEqual(
    [provider.cycleMode(), provider.cycleMode(), provider.cycleMode(), provider.cycleMode()],
    ['host', 'type', 'flat', 'group']
  );
  provider.setMode('host');
  assert.strictEqual(provider.getModeLabel(), 'By Host');

  assert.deepStrictEqual(projects, originalProjects, 'provider does not mutate project state');
  assert.deepStrictEqual(hosts, originalHosts, 'provider does not mutate Host state');

  console.log('outlineTreeProvider tests passed');
} finally {
  Module._load = originalLoad;
  for (const modulePath of Object.keys(require.cache)) {
    if (!originalCacheEntries.has(modulePath)) {
      delete require.cache[modulePath];
    }
  }
}
