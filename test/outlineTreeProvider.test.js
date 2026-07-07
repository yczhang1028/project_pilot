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
  assert.strictEqual(usedHostNode.id, JSON.stringify(['host', 'host-build']));
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
  assert.strictEqual(usedHostItem.contextValue, 'outline-host-used');
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
  assert.strictEqual(unusedHostItem.contextValue, 'outline-host-unused');
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

  const maliciousHostId = 'used,host-unused';
  const injectionProvider = new OutlineTreeProvider({
    state: {
      sshHosts: [{ id: maliciousHostId, name: 'Injected Host', hostname: 'injected.example.com' }],
      projects: [{
        id: 'injected-project',
        name: 'Injected Project',
        path: 'injected.example.com:/srv/project',
        remotePath: '/srv/project',
        sshHostId: maliciousHostId,
        type: 'ssh'
      }]
    }
  }, workspaceState, 'host');
  const injectionModeRoot = injectionProvider.getChildren().find(node => node.sectionKind === 'mode-root');
  const injectionHostNode = injectionModeRoot.children[0];
  assert.strictEqual(injectionHostNode.hostId, maliciousHostId, 'Host identity stays on the node');
  assert.strictEqual(
    injectionProvider.getTreeItem(injectionHostNode).contextValue,
    'outline-host-used',
    'Host IDs cannot inject context-menu capabilities'
  );

  const collisionProvider = new OutlineTreeProvider({
    state: {
      sshHosts: [
        { id: 'a', name: 'Host A', hostname: 'a.example.com' },
        { id: 'a:b', name: 'Host AB', hostname: 'ab.example.com' }
      ],
      projects: [
        {
          id: 'b:c',
          name: 'Project BC',
          path: 'a.example.com:/srv/bc',
          remotePath: '/srv/bc',
          sshHostId: 'a',
          group: 'Ops:Prod',
          type: 'ssh'
        },
        {
          id: 'c',
          name: 'Project C',
          path: 'ab.example.com:/srv/c',
          remotePath: '/srv/c',
          sshHostId: 'a:b',
          group: 'Ops:Prod',
          type: 'ssh'
        }
      ]
    }
  }, workspaceState, 'host');
  const collisionHostNodes = collisionProvider
    .getChildren()
    .find(node => node.sectionKind === 'mode-root')
    .children;
  assert.deepStrictEqual(
    collisionHostNodes.map(node => JSON.parse(node.id)),
    [['host', 'a'], ['host', 'a:b']]
  );
  assert.notStrictEqual(
    collisionHostNodes[0].children[0].id,
    collisionHostNodes[1].children[0].id,
    'Host a/project b:c cannot collide with Host a:b/project c'
  );
  collisionProvider.setMode('group');
  const encodedGroup = collisionProvider
    .getChildren()
    .find(node => node.sectionKind === 'mode-root')
    .children[0];
  assert.strictEqual(encodedGroup.id, 'group:group:Ops:Prod');

  const legacyExpansionWorkspaceState = {
    get(key, fallback) {
      return key === 'projectPilot.outlineExpansionState'
        ? { 'group:group:Ops': false }
        : fallback;
    },
    async update() {}
  };
  const expansionProvider = new OutlineTreeProvider({
    state: {
      sshHosts: [],
      projects: [
        { id: 'ops-one', name: 'Ops One', path: 'C:\\ops-one', group: 'Ops', type: 'local' },
        { id: 'ops-two', name: 'Ops Two', path: 'C:\\ops-two', group: 'Ops', type: 'local' }
      ]
    }
  }, legacyExpansionWorkspaceState, 'group');
  const expansionGroup = expansionProvider
    .getChildren()
    .find(node => node.sectionKind === 'mode-root')
    .children[0];
  assert.strictEqual(expansionGroup.id, 'group:group:Ops');
  assert.strictEqual(
    expansionProvider.getTreeItem(expansionGroup).collapsibleState,
    vscodeMock.TreeItemCollapsibleState.Collapsed,
    'legacy group expansion keys remain effective'
  );
  assert.strictEqual(
    new Set(expansionGroup.children.map(node => node.id)).size,
    expansionGroup.children.length,
    'valid unique projects under one parent always receive distinct tree IDs'
  );

  const displayProvider = new OutlineTreeProvider({
    state: {
      sshHosts: [{
        id: 'display-host',
        name: 'Build\r\nHost\u0000',
        hostname: 'build\r\n.example.com',
        username: 'user\u001b'
      }],
      projects: [{
        id: 'display-project',
        name: 'Repo\r\nInjected\u0000',
        path: 'build.example.com:/srv/repo\r\nspoofed',
        remotePath: '/srv/repo',
        sshHostId: 'display-host',
        description: 'Description\u0007Injected',
        type: 'ssh'
      }]
    }
  }, workspaceState, 'host');
  const displayHostNode = displayProvider
    .getChildren()
    .find(node => node.sectionKind === 'mode-root')
    .children[0];
  const unsafeDisplayControl = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/;
  assert.strictEqual(displayHostNode.label, 'Build Host');
  assert.match(displayHostNode.tooltip, /Connection: user@build \.example\.com/);
  assert.doesNotMatch(displayHostNode.tooltip, unsafeDisplayControl);
  const displayProjectNode = displayHostNode.children[0];
  assert.strictEqual(displayProjectNode.label, 'Repo Injected');
  const displayProjectItem = displayProvider.getTreeItem(displayProjectNode);
  assert.strictEqual(displayProjectItem.label, 'Repo Injected');
  assert.doesNotMatch(displayProjectItem.description, unsafeDisplayControl);
  assert.doesNotMatch(displayProjectItem.tooltip, unsafeDisplayControl);

  const manifest = require('../package.json');
  assert.match(
    manifest.scripts['test:outline'],
    /outlineHostActions\.test\.js/,
    'the focused Outline command helper regression runs with test:outline'
  );
  const contextMenus = manifest.contributes.menus['view/item/context'];
  const editMenu = contextMenus.find(menu => menu.command === 'projectPilot.editSshHostFromOutline');
  const testMenu = contextMenus.find(menu => menu.command === 'projectPilot.testSshHostFromOutline');
  const migrateMenu = contextMenus.find(menu => menu.command === 'projectPilot.migrateSshHostProjects');
  const deleteMenu = contextMenus.find(menu => menu.command === 'projectPilot.deleteSshHostFromOutline');
  assert.strictEqual(
    editMenu.when,
    'view == projectPilot.outline && viewItem =~ /^outline-host-(used|unused)$/'
  );
  assert.strictEqual(
    testMenu.when,
    'view == projectPilot.outline && viewItem =~ /^outline-host-(used|unused)$/'
  );
  assert.strictEqual(
    migrateMenu.when,
    'view == projectPilot.outline && viewItem == outline-host-used'
  );
  assert.strictEqual(
    deleteMenu.when,
    'view == projectPilot.outline && viewItem == outline-host-unused'
  );

  console.log('outlineTreeProvider tests passed');
} finally {
  Module._load = originalLoad;
  for (const modulePath of Object.keys(require.cache)) {
    if (!originalCacheEntries.has(modulePath)) {
      delete require.cache[modulePath];
    }
  }
}
