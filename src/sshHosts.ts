import type { ProjectItem, UISettings } from './store';
import {
  buildRemoteSshUriFromTarget,
  normalizeRemoteSshPath,
  parseRemoteSshAuthority,
  parseRawSshPath
} from './sshPath';

export interface SshHost {
  id: string;
  name: string;
  hostname: string;
  username?: string;
  port?: number;
}

export type SshProjectItem = ProjectItem & {
  sshHostId?: string;
  remotePath?: string;
};

export type UISettingsWithLegacyTarget = Omit<UISettings, 'outlineMode'> & {
  outlineMode?: 'group' | 'target' | 'host' | 'type' | 'flat';
};

export interface SshMigrationWarning {
  projectId?: string;
  projectName: string;
  message: string;
}

export interface SshStateLike {
  schemaVersion?: number;
  sshHosts?: SshHost[];
  projects: SshProjectItem[];
  uiSettings?: UISettingsWithLegacyTarget;
}

export interface SshStateV2 extends Omit<SshStateLike, 'schemaVersion' | 'sshHosts'> {
  schemaVersion: 2;
  sshHosts: SshHost[];
}

export interface ResolvedManagedSshProject {
  host: SshHost;
  remotePath: string;
  displayPath: string;
  compatibilityPath: string;
  remoteUri: string;
}

export interface HostBucket {
  hostId?: string;
  name: string;
  host?: SshHost;
  projects: SshProjectItem[];
  local: boolean;
  unmanaged?: boolean;
}

function normalizedOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function hostConnectionKey(host: Pick<SshHost, 'hostname' | 'username' | 'port'>): string {
  return JSON.stringify([
    normalizedOptional(host.username)?.toLowerCase() ?? null,
    host.hostname.trim().toLowerCase(),
    host.port ?? null
  ]);
}

export function validateSshHost(
  host: SshHost,
  existingHosts: readonly SshHost[],
  excludeId?: string
): SshHost {
  const username = normalizedOptional(host.username);
  const normalized: SshHost = {
    id: host.id.trim(),
    name: host.name.trim(),
    hostname: host.hostname.trim(),
    ...(username ? { username } : {}),
    ...(host.port !== undefined ? { port: host.port } : {})
  };

  if (!normalized.name) {
    throw new Error('SSH Host name is required');
  }
  if (!normalized.hostname) {
    throw new Error('SSH Host hostname is required');
  }
  if (
    normalized.port !== undefined
    && (!Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535)
  ) {
    throw new Error('SSH port must be an integer between 1 and 65535');
  }

  const otherHosts = existingHosts.filter(existing => existing.id !== excludeId);
  if (otherHosts.some(existing => existing.name.trim().toLowerCase() === normalized.name.toLowerCase())) {
    throw new Error(`SSH Host name "${normalized.name}" already exists`);
  }
  if (otherHosts.some(existing => hostConnectionKey(existing) === hostConnectionKey(normalized))) {
    throw new Error('An SSH Host with the same connection already exists');
  }

  return normalized;
}

function isSshProject(project: SshProjectItem): boolean {
  return project.type === 'ssh' || project.type === 'ssh-workspace';
}

function isManagedSshProject(project: SshProjectItem): project is SshProjectItem & {
  sshHostId: string;
  remotePath: string;
} {
  return isSshProject(project)
    && typeof project.sshHostId === 'string'
    && project.sshHostId.length > 0
    && typeof project.remotePath === 'string';
}

function readablePath(host: SshHost, remotePath: string, includePort: boolean): string {
  const username = normalizedOptional(host.username);
  const target = `${username ? `${username}@` : ''}${host.hostname.trim()}`;
  return `${target}${includePort && host.port !== undefined ? `:${host.port}` : ''}:${remotePath}`;
}

function canUseReadableRawAuthority(host: SshHost): boolean {
  if (host.port !== undefined) {
    return false;
  }

  const probePath = '/.__project_pilot_raw_probe__';
  const parsed = parseRawSshPath(readablePath(host, probePath, false));
  return parsed !== null
    && parsed.remotePath === probePath
    && hostConnectionKey(parsed) === hostConnectionKey(host);
}

export function resolveManagedSshProject(
  project: SshProjectItem,
  hosts: readonly SshHost[]
): ResolvedManagedSshProject {
  if (!isManagedSshProject(project)) {
    throw new Error(`Project ${project.name} is not a managed SSH project`);
  }

  const host = hosts.find(candidate => candidate.id === project.sshHostId);
  if (!host) {
    throw new Error(`SSH Host ${project.sshHostId} was not found`);
  }

  const remotePath = normalizeRemoteSshPath(project.remotePath.trim());
  const target = {
    hostname: host.hostname.trim(),
    ...(normalizedOptional(host.username) ? { username: normalizedOptional(host.username) } : {}),
    ...(host.port !== undefined ? { port: host.port } : {})
  };
  const remoteUri = buildRemoteSshUriFromTarget(target, remotePath);
  const displayPath = readablePath(host, remotePath, true);

  return {
    host,
    remotePath,
    displayPath,
    compatibilityPath: canUseReadableRawAuthority(host)
      ? readablePath(host, remotePath, false)
      : remoteUri,
    remoteUri
  };
}

export function materializeManagedProject(
  project: SshProjectItem,
  hosts: readonly SshHost[]
): SshProjectItem {
  if (!isManagedSshProject(project)) {
    return project;
  }

  return {
    ...project,
    path: resolveManagedSshProject(project, hosts).compatibilityPath
  };
}

function deterministicHostId(connectionKey: string, usedIds: Set<string>): string {
  let hash = 2166136261;
  for (let index = 0; index < connectionKey.length; index += 1) {
    hash ^= connectionKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const base = `ssh-host-${(hash >>> 0).toString(36)}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function uniqueHostName(hostname: string, usedNames: Set<string>): string {
  const base = hostname.trim();
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base} ${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function parseLegacyProject(project: SshProjectItem) {
  const trimmedPath = project.path.trim();
  const remoteUriPrefix = 'vscode-remote://ssh-remote+';

  if (trimmedPath.startsWith(remoteUriPrefix)) {
    const authorityAndPath = trimmedPath.slice(remoteUriPrefix.length);
    const pathIndex = authorityAndPath.indexOf('/');
    if (pathIndex <= 0) {
      return null;
    }

    const authority = parseRemoteSshAuthority(authorityAndPath.slice(0, pathIndex));
    const remotePath = normalizeRemoteSshPath(authorityAndPath.slice(pathIndex).trim());
    if (!authority.hostname.trim() || !remotePath) {
      return null;
    }

    return {
      hostname: authority.hostname.trim(),
      ...(normalizedOptional(authority.username) ? { username: normalizedOptional(authority.username) } : {}),
      ...(authority.port !== undefined ? { port: authority.port } : {}),
      remotePath
    };
  }

  const parsed = parseRawSshPath(trimmedPath);
  if (!parsed) {
    return null;
  }

  return {
    hostname: parsed.hostname.trim(),
    ...(normalizedOptional(parsed.username) ? { username: normalizedOptional(parsed.username) } : {}),
    ...(parsed.port !== undefined ? { port: parsed.port } : {}),
    remotePath: normalizeRemoteSshPath(parsed.remotePath.trim())
  };
}

export function migrateSshState(input: SshStateLike): {
  state: SshStateV2;
  warnings: SshMigrationWarning[];
  changed: boolean;
} {
  const originalJson = JSON.stringify(input);
  const hosts = (input.sshHosts ?? []).map(host => ({ ...host }));
  const hostsByConnection = new Map<string, SshHost>();
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  for (const host of hosts) {
    if (!hostsByConnection.has(hostConnectionKey(host))) {
      hostsByConnection.set(hostConnectionKey(host), host);
    }
    usedIds.add(host.id);
    usedNames.add(host.name.trim().toLowerCase());
  }

  const warnings: SshMigrationWarning[] = [];
  const projects = input.projects.map(project => {
    if (!isSshProject(project) || isManagedSshProject(project)) {
      return project;
    }

    const parsed = parseLegacyProject(project);
    if (!parsed) {
      warnings.push({
        ...(project.id ? { projectId: project.id } : {}),
        projectName: project.name,
        message: `Could not parse the legacy SSH path for ${project.name}`
      });
      return project;
    }

    const connectionKey = hostConnectionKey(parsed);
    let host = hostsByConnection.get(connectionKey);
    if (!host) {
      const id = deterministicHostId(connectionKey, usedIds);
      host = {
        id,
        name: uniqueHostName(parsed.hostname, usedNames),
        hostname: parsed.hostname,
        ...(parsed.username ? { username: parsed.username } : {}),
        ...(parsed.port !== undefined ? { port: parsed.port } : {})
      };
      hosts.push(host);
      hostsByConnection.set(connectionKey, host);
      usedIds.add(id);
    }

    return materializeManagedProject({
      ...project,
      sshHostId: host.id,
      remotePath: parsed.remotePath
    }, hosts);
  });

  const uiSettings = input.uiSettings?.outlineMode === 'target'
    ? { ...input.uiSettings, outlineMode: 'host' as const }
    : input.uiSettings;
  const state: SshStateV2 = {
    ...input,
    schemaVersion: 2,
    sshHosts: hosts,
    projects,
    ...(uiSettings ? { uiSettings } : {})
  };

  return {
    state,
    warnings,
    changed: JSON.stringify(state) !== originalJson
  };
}

export function buildHostBuckets(
  projects: readonly SshProjectItem[],
  hosts: readonly SshHost[]
): HostBucket[] {
  const sortedHosts = [...hosts].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    return byName || left.id.localeCompare(right.id);
  });
  const hostIds = new Set(hosts.map(host => host.id));
  const buckets: HostBucket[] = sortedHosts.map(host => ({
    hostId: host.id,
    name: host.name,
    host,
    projects: projects.filter(project => isManagedSshProject(project) && project.sshHostId === host.id),
    local: false
  }));
  const localProjects = projects.filter(project => project.type === 'local' || project.type === 'workspace');
  if (localProjects.length > 0) {
    buckets.push({
      name: 'Local',
      projects: localProjects,
      local: true
    });
  }

  const unmanagedProjects = projects.filter(project => isSshProject(project) && (
    !isManagedSshProject(project) || !hostIds.has(project.sshHostId)
  ));
  if (unmanagedProjects.length > 0) {
    buckets.push({
      name: 'Unmanaged SSH',
      projects: unmanagedProjects,
      local: false,
      unmanaged: true
    });
  }

  return buckets;
}
