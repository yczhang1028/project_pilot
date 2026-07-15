import * as os from 'os';
import * as path from 'path';
import type { ProjectItem } from '../store';
import type { SshHost } from '../sshHosts';
import { resolveSshProjectRuntime } from '../sshProjectRuntime';
import type { AgentAssetKind, AgentProviderId, ScanRoot } from './types';

interface ProviderPath {
  path: string;
  sourceKind?: 'native' | 'shared';
  base?: 'home' | 'appData';
  assetKind?: Extract<AgentAssetKind, 'mcp' | 'settings'>;
}

interface ProviderDefinition {
  id: AgentProviderId;
  label: string;
  globalSkills: ProviderPath[];
  projectSkills: ProviderPath[];
  globalSettings: ProviderPath[];
  projectSettings: ProviderPath[];
  launchCommand: string;
}

export const AGENT_PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: 'codex',
    label: 'Codex',
    globalSkills: [
      { path: '.codex/skills' },
      { path: '.agents/skills', sourceKind: 'shared' }
    ],
    projectSkills: [
      { path: '.codex/skills' },
      { path: '.agents/skills', sourceKind: 'shared' }
    ],
    globalSettings: [
      { path: '.codex/config.toml' },
      { path: '.codex/config.toml', assetKind: 'mcp' }
    ],
    projectSettings: [
      { path: '.codex/config.toml' },
      { path: '.codex/config.toml', assetKind: 'mcp' }
    ],
    launchCommand: 'codex'
  },
  {
    id: 'claude',
    label: 'Claude Code',
    globalSkills: [{ path: '.claude/skills' }],
    projectSkills: [{ path: '.claude/skills' }],
    globalSettings: [
      { path: '.claude/settings.json' },
      { path: '.claude/settings.local.json' },
      { path: '.claude.json', assetKind: 'mcp' },
      { path: '.claude/.mcp.json', assetKind: 'mcp' }
    ],
    projectSettings: [
      { path: '.claude/settings.json' },
      { path: '.claude/settings.local.json' },
      { path: '.mcp.json', assetKind: 'mcp' }
    ],
    launchCommand: 'claude'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    globalSkills: [
      { path: '.cursor/skills' },
      { path: '.cursor/skills-cursor' },
      { path: '.agents/skills', sourceKind: 'shared' }
    ],
    projectSkills: [
      { path: '.cursor/skills' },
      { path: '.agents/skills', sourceKind: 'shared' }
    ],
    globalSettings: [
      { path: '.cursor/mcp.json', assetKind: 'mcp' },
      { path: 'Cursor/User/settings.json', base: 'appData' },
      { path: '.config/Cursor/User/settings.json' },
      { path: 'Library/Application Support/Cursor/User/settings.json' }
    ],
    projectSettings: [{ path: '.cursor/mcp.json', assetKind: 'mcp' }],
    launchCommand: 'cursor .'
  }
] as const;

export function getProvider(providerId: AgentProviderId): ProviderDefinition {
  const provider = AGENT_PROVIDERS.find(candidate => candidate.id === providerId);
  if (!provider) {
    throw new Error(`Unknown agent provider: ${providerId}`);
  }
  return provider;
}

function safeRootId(parts: readonly string[]): string {
  return parts
    .join(':')
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-');
}

function addGlobalRoots(roots: ScanRoot[], provider: ProviderDefinition): void {
  for (const [index, item] of provider.globalSkills.entries()) {
    roots.push({
      id: safeRootId(['global', provider.id, 'skills', String(index), item.path]),
      kind: 'skill',
      providerId: provider.id,
      providerLabel: provider.label,
      scope: 'global',
      sourceKind: item.sourceKind ?? 'native',
      base: item.base ?? 'home',
      path: item.path,
      label: `${provider.label} · Global · ${item.path}`
    });
  }
  for (const [index, item] of provider.globalSettings.entries()) {
    roots.push({
      id: safeRootId(['global', provider.id, 'settings', String(index), item.path]),
      kind: item.assetKind ?? 'settings',
      providerId: provider.id,
      providerLabel: provider.label,
      scope: 'global',
      sourceKind: 'native',
      base: item.base ?? 'home',
      path: item.path,
      label: `${provider.label} · Global ${item.assetKind === 'mcp' ? 'MCP' : 'settings'} · ${item.path}`
    });
  }
}

function addProjectRoots(
  roots: ScanRoot[],
  provider: ProviderDefinition,
  project: ProjectItem,
  projectRoot: string
): void {
  if (!project.id) return;
  for (const [index, item] of provider.projectSkills.entries()) {
    roots.push({
      id: safeRootId(['project', project.id, provider.id, 'skills', String(index), item.path]),
      kind: 'skill',
      providerId: provider.id,
      providerLabel: provider.label,
      scope: 'project',
      sourceKind: item.sourceKind ?? 'native',
      base: 'absolute',
      path: path.posix.join(projectRoot.replace(/\\/g, '/'), item.path),
      label: `${project.name} · ${provider.label} · ${item.path}`,
      projectId: project.id,
      projectName: project.name
    });
  }
  for (const [index, item] of provider.projectSettings.entries()) {
    roots.push({
      id: safeRootId(['project', project.id, provider.id, 'settings', String(index), item.path]),
      kind: item.assetKind ?? 'settings',
      providerId: provider.id,
      providerLabel: provider.label,
      scope: 'project',
      sourceKind: 'native',
      base: 'absolute',
      path: path.posix.join(projectRoot.replace(/\\/g, '/'), item.path),
      label: `${project.name} · ${provider.label} ${item.assetKind === 'mcp' ? 'MCP' : 'settings'} · ${item.path}`,
      projectId: project.id,
      projectName: project.name
    });
  }
}

function localProjectRoot(project: ProjectItem): string | undefined {
  if (project.type === 'local') {
    return path.isAbsolute(project.path) ? project.path : undefined;
  }
  if (project.type === 'workspace') {
    return path.isAbsolute(project.path) ? path.dirname(project.path) : undefined;
  }
  return undefined;
}

function remoteProjectRoot(project: ProjectItem, hosts: readonly SshHost[]): string | undefined {
  if (project.type !== 'ssh' && project.type !== 'ssh-workspace') {
    return undefined;
  }
  try {
    const runtime = resolveSshProjectRuntime(project, hosts);
    return project.type === 'ssh-workspace'
      ? path.posix.dirname(runtime.remotePath.replace(/\\/g, '/'))
      : runtime.remotePath;
  } catch {
    return undefined;
  }
}

export function buildLocalScanPlan(projects: readonly ProjectItem[]): ScanRoot[] {
  const roots: ScanRoot[] = [];
  for (const provider of AGENT_PROVIDERS) {
    addGlobalRoots(roots, provider);
    for (const project of projects) {
      const projectRoot = localProjectRoot(project);
      if (projectRoot) addProjectRoots(roots, provider, project, projectRoot);
    }
  }
  return roots;
}

export function buildRemoteScanPlan(
  host: SshHost,
  projects: readonly ProjectItem[],
  hosts: readonly SshHost[]
): ScanRoot[] {
  const roots: ScanRoot[] = [];
  for (const provider of AGENT_PROVIDERS) {
    addGlobalRoots(roots, provider);
    for (const project of projects) {
      if (project.sshHostId !== host.id) continue;
      const projectRoot = remoteProjectRoot(project, hosts);
      if (projectRoot) addProjectRoots(roots, provider, project, projectRoot);
    }
  }
  return roots;
}

export function resolveLocalRoot(root: ScanRoot): string | undefined {
  if (root.base === 'absolute') return path.normalize(root.path);
  if (root.base === 'home') return path.join(os.homedir(), root.path);
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, root.path) : undefined;
}
