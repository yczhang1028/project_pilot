import { Buffer } from 'buffer';
import type { AgentAsset, AgentAssetBinding, AgentInventorySnapshot } from './agentAssets/types';
import type { SshHost } from './sshHosts';
import type { ProjectItem, State, UISettings } from './store';

const DEMO_TIMESTAMP = '2026-07-15T08:00:00.000Z';

function svgIcon(body: string, stroke: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="3" y="3" width="58" height="58" rx="15" fill="#171b26" stroke="${stroke}" stroke-width="3"/>${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const FOLDER_ICON = svgIcon(
  '<path d="M15 23h13l5 6h16v20H15V23Z" stroke="#f0c94c" stroke-width="3" stroke-linejoin="round"/>',
  '#f0c94c'
);
const TERMINAL_ICON = svgIcon(
  '<rect x="14" y="17" width="36" height="27" rx="3" stroke="#70a7ff" stroke-width="3"/><path d="m21 27 6 5-6 5m11 0h10M25 50h14" stroke="#70a7ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  '#70a7ff'
);
const SERVER_ICON = svgIcon(
  '<rect x="15" y="15" width="34" height="13" rx="3" stroke="#79b8ff" stroke-width="3"/><rect x="15" y="36" width="34" height="13" rx="3" stroke="#79b8ff" stroke-width="3"/><circle cx="22" cy="21.5" r="2" fill="#79b8ff"/><circle cx="22" cy="42.5" r="2" fill="#79b8ff"/>',
  '#79b8ff'
);

const DEMO_HOSTS: SshHost[] = [
  { id: 'demo-build-lab', name: 'Build Lab', hostname: 'build-lab.example', username: 'demo' },
  { id: 'demo-gpu-lab', name: 'GPU Lab', hostname: 'gpu-lab.example', username: 'demo', port: 2222 }
];

const DEMO_PROJECTS: ProjectItem[] = [
  remoteProject('workflow-lab', 'Workflow Lab', 'Automation', 'demo-build-lab', '/srv/demo/workflow-lab', ['ssh', 'automation'], true),
  remoteProject('agent-toolkit-linux', 'Agent Toolkit Linux', 'Agent Toolkit', 'demo-build-lab', '/srv/demo/agent-toolkit-linux', ['ssh', 'agents']),
  localProject('agent-toolkit-windows', 'Agent Toolkit Windows', 'Agent Toolkit', 'C:\\Demo\\agent-toolkit', ['agents', 'typescript']),
  localProject('review-helper', 'Review Helper', 'Personal', 'C:\\Demo\\review-helper', ['python', 'review']),
  localProject('project-pilot', 'Project Pilot', 'Personal', 'C:\\Demo\\project-pilot', ['typescript', 'vscode'], true),
  localProject('terminal-helper', 'Terminal Helper', 'Personal', 'C:\\Demo\\terminal-helper', ['react', 'terminal']),
  remoteProject('linux-sandbox', 'Linux Sandbox', 'Sandbox', 'demo-build-lab', '/srv/demo/linux-sandbox', ['ssh', 'sandbox']),
  remoteProject('build-sandbox', 'Build Sandbox', 'Sandbox', 'demo-build-lab', '/srv/demo/build-sandbox', ['ssh', 'build']),
  localProject('windows-sandbox', 'Windows Sandbox', 'Sandbox', 'C:\\Demo\\windows-sandbox', ['windows', 'sandbox']),
  remoteProject('issue-tracker', 'Issue Tracker', 'Product Suite', 'demo-gpu-lab', '/srv/demo/issue-tracker', ['ssh', 'service'], true, SERVER_ICON),
  remoteProject('community-console', 'Community Console', 'Product Suite', 'demo-gpu-lab', '/srv/demo/community-console', ['ssh', 'service'], false, SERVER_ICON),
  remoteProject('infra-report', 'Infra Report', 'Product Suite', 'demo-gpu-lab', '/srv/demo/infra-report', ['ssh', 'reporting']),
  remoteProject('automation-api', 'Automation API', 'Product Suite', 'demo-gpu-lab', '/srv/demo/automation-api', ['ssh', 'api']),
  remoteProject('telemetry-studio', 'Telemetry Studio', 'Product Suite', 'demo-gpu-lab', '/srv/demo/telemetry-studio', ['ssh', 'telemetry'], false, SERVER_ICON),
  remoteProject('service-api', 'Service API', 'Product Suite', 'demo-gpu-lab', '/srv/demo/service-api', ['ssh', 'api']),
  remoteProject('developer-portal', 'Developer Portal', 'Product Suite', 'demo-gpu-lab', '/srv/demo/developer-portal', ['ssh', 'web']),
  remoteProject('developer-portal-remote', 'Developer Portal Remote', 'Product Suite', 'demo-build-lab', '/srv/demo/developer-portal-remote', ['ssh', 'web']),
  remoteProject('tooling-services', 'Tooling Services', 'Product Suite', 'demo-gpu-lab', '/srv/demo/tooling-services', ['ssh', 'tools'])
];

function localProject(
  id: string,
  name: string,
  group: string,
  projectPath: string,
  tags: string[],
  isFavorite = false
): ProjectItem {
  return {
    id: `demo-${id}`,
    name,
    group,
    path: projectPath,
    description: `${name} demo workspace`,
    type: 'local',
    tags,
    icon: FOLDER_ICON,
    color: '#5f7cff',
    isFavorite,
    clickCount: 12,
    lastAccessed: DEMO_TIMESTAMP
  };
}

function remoteProject(
  id: string,
  name: string,
  group: string,
  sshHostId: string,
  remotePath: string,
  tags: string[],
  isFavorite = false,
  icon = TERMINAL_ICON
): ProjectItem {
  const host = DEMO_HOSTS.find(candidate => candidate.id === sshHostId)!;
  return {
    id: `demo-${id}`,
    name,
    group,
    path: `${host.username}@${host.hostname}:${remotePath}`,
    description: `${name} demo environment`,
    type: 'ssh',
    tags,
    icon,
    color: '#70a7ff',
    sshHostId,
    remotePath,
    isFavorite,
    clickCount: 8,
    lastAccessed: DEMO_TIMESTAMP
  };
}

function binding(
  providerId: AgentAssetBinding['providerId'],
  scope: AgentAssetBinding['scope'] = 'global',
  project?: { id: string; name: string }
): AgentAssetBinding {
  const providerLabel = providerId === 'codex' ? 'Codex' : providerId === 'claude' ? 'Claude Code' : 'Cursor';
  return {
    key: `${providerId}:${scope}:${project?.id ?? 'global'}`,
    providerId,
    providerLabel,
    scope,
    projectId: project?.id,
    projectName: project?.name,
    sourceKind: 'native'
  };
}

function skill(
  machineId: string,
  name: string,
  description: string,
  bindings: AgentAssetBinding[],
  root: string
): AgentAsset {
  const pathSeparator = root.includes('\\') ? '\\' : '/';
  const assetPath = `${root}${pathSeparator}skills${pathSeparator}${name}`;
  return {
    id: `${machineId}:skill:${name}`,
    physicalId: `${machineId}:${assetPath}`,
    machineId,
    kind: 'skill',
    name,
    description,
    path: assetPath,
    modifiedAt: DEMO_TIMESTAMP,
    status: 'ready',
    bindings
  };
}

function mcp(
  machineId: string,
  name: string,
  configPath: string,
  bindings: AgentAssetBinding[],
  details: NonNullable<AgentAsset['mcp']>
): AgentAsset {
  return {
    id: `${machineId}:mcp:${name}`,
    physicalId: `${machineId}:${configPath}:${name}`,
    machineId,
    kind: 'mcp',
    name,
    description: `${name} tool connection`,
    path: configPath,
    entryKey: name,
    modifiedAt: DEMO_TIMESTAMP,
    status: 'ready',
    mcp: details,
    bindings
  };
}

function setting(
  machineId: string,
  name: string,
  settingPath: string,
  bindings: AgentAssetBinding[],
  invalid = false
): AgentAsset {
  return {
    id: `${machineId}:settings:${name}:${settingPath}`,
    physicalId: `${machineId}:${settingPath}`,
    machineId,
    kind: 'settings',
    name,
    path: settingPath,
    modifiedAt: DEMO_TIMESTAMP,
    status: invalid ? 'invalid' : 'ready',
    statusMessage: invalid ? 'JSON could not be parsed.' : undefined,
    bindings
  };
}

function createDemoAssets(): AgentAsset[] {
  const localRoot = 'C:\\Demo\\agent-assets\\.agents';
  const buildRoot = '/home/demo/.agents';
  const gpuRoot = '/home/demo/.agents';
  const project = { id: 'demo-project-pilot', name: 'Project Pilot' };
  return [
    skill('local', 'api-design', 'Plan stable APIs and review compatibility boundaries.', [binding('codex'), binding('claude')], localRoot),
    skill('local', 'docs-writer', 'Create concise user and developer documentation.', [binding('claude')], localRoot),
    skill('local', 'incident-triage', 'Collect evidence and organize incident response.', [binding('codex')], localRoot),
    skill('local', 'memory-bank', 'Maintain durable project knowledge and decisions.', [binding('cursor', 'project', project)], localRoot),
    skill('local', 'release-notes', 'Turn completed changes into audience-ready release notes.', [binding('claude'), binding('cursor')], localRoot),
    skill('local', 'repo-reviewer', 'Review repository changes against local engineering rules.', [binding('codex'), binding('cursor')], localRoot),
    skill('local', 'test-planner', 'Design focused tests around behavior and risk.', [binding('codex', 'project', project)], localRoot),
    skill('local', 'visual-qa', 'Inspect product surfaces for layout and interaction regressions.', [binding('claude')], localRoot),
    skill('local', 'workflow-runner', 'Coordinate repeatable development workflows.', [binding('cursor')], localRoot),
    skill('local', 'workspace-audit', 'Inventory workspace configuration and dependencies.', [binding('codex')], localRoot),
    skill('local', 'changelog-editor', 'Keep release history structured and readable.', [binding('claude')], localRoot),
    skill('local', 'performance-check', 'Measure startup and interaction performance.', [binding('cursor', 'project', project)], localRoot),
    mcp('local', 'issue-tracker', 'C:\\Demo\\agent-assets\\.codex\\config.toml', [binding('codex')], {
      transport: 'http', url: 'https://issues.example/api/mcp', envKeys: ['ISSUE_TRACKER_TOKEN'], enabled: true
    }),
    mcp('local', 'local-tools', 'C:\\Demo\\agent-assets\\.cursor\\mcp.json', [binding('cursor')], {
      transport: 'stdio', command: 'node', args: ['tools/demo-server.js'], envKeys: ['DEMO_WORKSPACE'], enabled: true
    }),
    mcp('local', 'docs-search', 'C:\\Demo\\agent-assets\\.claude\\settings.json', [binding('claude')], {
      transport: 'sse', url: 'https://docs.example/mcp', headerKeys: ['Authorization'], enabled: true
    }),
    mcp('local', 'disabled-sample', 'C:\\Demo\\agent-assets\\.cursor\\mcp.json', [binding('cursor')], {
      transport: 'stdio', command: 'demo-mcp', args: ['--readonly'], enabled: false
    }),
    setting('local', 'config.toml', 'C:\\Demo\\agent-assets\\.codex\\config.toml', [binding('codex')]),
    setting('local', 'settings.json', 'C:\\Demo\\agent-assets\\.claude\\settings.json', [binding('claude')]),
    setting('local', 'settings.json', 'C:\\Demo\\agent-assets\\.cursor\\settings.json', [binding('cursor')], true),
    setting('local', 'rules.md', 'C:\\Demo\\project-pilot\\.cursor\\rules.md', [binding('cursor', 'project', project)]),
    setting('local', 'CLAUDE.md', 'C:\\Demo\\project-pilot\\CLAUDE.md', [binding('claude', 'project', project)]),

    skill('ssh:demo-build-lab', 'build-diagnostics', 'Diagnose build failures on remote workers.', [binding('codex')], buildRoot),
    skill('ssh:demo-build-lab', 'dependency-audit', 'Review dependency health without modifying the environment.', [binding('claude')], buildRoot),
    skill('ssh:demo-build-lab', 'log-summarizer', 'Summarize structured build and service logs.', [binding('cursor')], buildRoot),
    skill('ssh:demo-build-lab', 'remote-release', 'Prepare repeatable remote release checks.', [binding('codex')], buildRoot),
    skill('ssh:demo-build-lab', 'shell-review', 'Review shell automation for correctness and safety.', [binding('claude')], buildRoot),
    skill('ssh:demo-build-lab', 'test-matrix', 'Build a compact cross-platform test matrix.', [binding('cursor')], buildRoot),
    mcp('ssh:demo-build-lab', 'build-service', '/home/demo/.codex/config.toml', [binding('codex')], {
      transport: 'http', url: 'https://build.example/mcp', envKeys: ['BUILD_API_TOKEN'], enabled: true
    }),
    mcp('ssh:demo-build-lab', 'artifact-index', '/home/demo/.cursor/mcp.json', [binding('cursor')], {
      transport: 'stdio', command: 'python3', args: ['-m', 'demo_artifacts'], enabled: true
    }),
    setting('ssh:demo-build-lab', 'config.toml', '/home/demo/.codex/config.toml', [binding('codex')]),
    setting('ssh:demo-build-lab', 'settings.json', '/home/demo/.claude/settings.json', [binding('claude')]),

    skill('ssh:demo-gpu-lab', 'benchmark-review', 'Review benchmark setup and result quality.', [binding('codex')], gpuRoot),
    skill('ssh:demo-gpu-lab', 'environment-check', 'Inspect runtime prerequisites and versions.', [binding('claude')], gpuRoot),
    skill('ssh:demo-gpu-lab', 'experiment-notes', 'Capture repeatable experiment context.', [binding('cursor')], gpuRoot),
    skill('ssh:demo-gpu-lab', 'performance-report', 'Summarize performance findings for engineering teams.', [binding('codex'), binding('claude')], gpuRoot),
    mcp('ssh:demo-gpu-lab', 'metrics-service', '/home/demo/.codex/config.toml', [binding('codex')], {
      transport: 'sse', url: 'https://metrics.example/mcp', headerKeys: ['X-Demo-Key'], enabled: true
    }),
    setting('ssh:demo-gpu-lab', 'config.toml', '/home/demo/.codex/config.toml', [binding('codex')]),
    setting('ssh:demo-gpu-lab', 'settings.json', '/home/demo/.cursor/settings.json', [binding('cursor')])
  ];
}

export function createDemoProjectState(uiSettings?: UISettings): State {
  return {
    schemaVersion: 2,
    sshHosts: DEMO_HOSTS.map(host => ({ ...host })),
    projects: DEMO_PROJECTS.map(project => ({ ...project, tags: [...(project.tags ?? [])] })),
    uiSettings: {
      ...uiSettings,
      selectedGroup: '',
      collapsedGroups: []
    }
  };
}

export function createDemoAgentInventory(): AgentInventorySnapshot {
  const assets = createDemoAssets();
  const machines = [
    { id: 'local', kind: 'local' as const, label: 'Demo Workstation', isCurrent: true },
    { id: 'ssh:demo-build-lab', kind: 'ssh' as const, label: 'Build Lab', hostId: 'demo-build-lab' },
    { id: 'ssh:demo-gpu-lab', kind: 'ssh' as const, label: 'GPU Lab', hostId: 'demo-gpu-lab' }
  ];
  const summaries = machines.map(machine => {
    const machineAssets = assets.filter(asset => asset.machineId === machine.id);
    return {
      machineId: machine.id,
      status: 'fresh' as const,
      scannedAt: DEMO_TIMESTAMP,
      attemptedAt: DEMO_TIMESTAMP,
      skillCount: machineAssets.filter(asset => asset.kind === 'skill').length,
      mcpCount: machineAssets.filter(asset => asset.kind === 'mcp').length,
      settingsCount: machineAssets.filter(asset => asset.kind === 'settings').length,
      errors: []
    };
  });
  return {
    schemaVersion: 2,
    generatedAt: DEMO_TIMESTAMP,
    machines,
    assets,
    summaries
  };
}
