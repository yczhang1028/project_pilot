import type {
  ProjectItem,
  ProjectType,
  SshHost,
  SshHostDraft,
  SshMigrationWarning,
  State
} from './model';

const isSshType = (type: ProjectType): boolean => type === 'ssh' || type === 'ssh-workspace';

const normalizedConnection = (host: Pick<SshHost, 'hostname' | 'username' | 'port'>): string => JSON.stringify([
  host.username?.trim() || null,
  host.hostname.trim().toLowerCase(),
  host.port ?? null
]);

export function countHostReferences(projects: readonly ProjectItem[], hostId: string): number {
  return projects.filter(project => project.sshHostId === hostId).length;
}

export function formatSshHostAddress(host: Pick<SshHost, 'hostname' | 'username' | 'port'>): string {
  const hostname = host.hostname.trim();
  const displayHostname = hostname.includes(':') && !hostname.startsWith('[')
    ? `[${hostname}]`
    : hostname;
  return `${host.username?.trim() ? `${host.username.trim()}@` : ''}${displayHostname}:${host.port ?? 'default'}`;
}

export function validateSshHostDraft(
  draft: SshHostDraft,
  hosts: readonly SshHost[],
  editingId?: string
): string | null {
  const name = draft.name.trim();
  const hostname = draft.hostname.trim();
  if (!name) {
    return 'Host name is required.';
  }
  if (!hostname) {
    return 'Hostname is required.';
  }

  const portText = draft.port.trim();
  const port = portText ? Number(portText) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    return 'Port must be an integer between 1 and 65535.';
  }

  const otherHosts = hosts.filter(host => host.id !== editingId);
  if (otherHosts.some(host => host.name.trim().toLowerCase() === name.toLowerCase())) {
    return 'A Host with this name already exists.';
  }

  const candidate = { hostname, username: draft.username.trim() || undefined, port };
  if (otherHosts.some(host => normalizedConnection(host) === normalizedConnection(candidate))) {
    return 'A Host with this connection already exists.';
  }
  return null;
}

export function sshHostFromDraft(id: string, draft: SshHostDraft): SshHost {
  const username = draft.username.trim();
  const portText = draft.port.trim();
  return {
    id,
    name: draft.name.trim(),
    hostname: draft.hostname.trim(),
    ...(username ? { username } : {}),
    ...(portText ? { port: Number(portText) } : {})
  };
}

export function getMigrationTargets(hosts: readonly SshHost[], sourceId: string): SshHost[] {
  return hosts.filter(host => host.id !== sourceId);
}

export function validateManagedProjectFields(
  type: ProjectType,
  hostId: string | undefined,
  remotePath: string | undefined,
  hosts: readonly SshHost[]
): string | null {
  if (!isSshType(type)) {
    return null;
  }
  if (!hostId?.trim()) {
    return 'Select an SSH Host.';
  }
  if (!hosts.some(host => host.id === hostId)) {
    return 'The selected SSH Host no longer exists.';
  }
  const normalizedPath = remotePath?.trim();
  if (!normalizedPath) {
    return 'Remote path is required.';
  }
  if (type === 'ssh-workspace' && !/\.code-workspace$/i.test(normalizedPath)) {
    return 'SSH workspace path should end with .code-workspace.';
  }
  return null;
}

function utf8ToHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function buildManagedProjectPath(host: SshHost, remotePath: string): string {
  const authority: { hostName: string; user?: string; port?: number } = {
    hostName: host.hostname.trim()
  };
  if (host.username?.trim()) {
    authority.user = host.username.trim();
  }
  if (host.port !== undefined) {
    authority.port = host.port;
  }
  const normalizedPath = remotePath.trim().replace(/\\/g, '/');
  return `vscode-remote://ssh-remote+${utf8ToHex(JSON.stringify(authority))}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}

export function normalizeUiState(value: Partial<State> | undefined): State {
  return {
    ...value,
    projects: Array.isArray(value?.projects) ? value.projects : [],
    sshHosts: Array.isArray(value?.sshHosts) ? value.sshHosts : [],
    migrationWarnings: Array.isArray(value?.migrationWarnings) ? value.migrationWarnings : []
  };
}

export function extractRemotePathForManagedProject(value: string): string | null {
  const trimmed = value.trim();
  const remotePrefix = 'vscode-remote://ssh-remote+';
  if (trimmed.startsWith(remotePrefix)) {
    const authorityAndPath = trimmed.slice(remotePrefix.length);
    const pathIndex = authorityAndPath.indexOf('/');
    if (pathIndex <= 0) {
      return null;
    }
    const path = authorityAndPath.slice(pathIndex);
    return /^\/[a-zA-Z]:[\\/]/.test(path) ? path.slice(1) : path;
  }

  const firstPathSeparator = trimmed.search(/[\\/]/);
  const authorityPrefix = firstPathSeparator >= 0 ? trimmed.slice(0, firstPathSeparator) : trimmed;
  const colonCount = (authorityPrefix.match(/:/g) ?? []).length;
  const isWindowsRemotePath = /^[^:]+:[a-zA-Z]:$/i.test(authorityPrefix);
  if (!authorityPrefix.includes('[') && colonCount > 1 && !isWindowsRemotePath) {
    return null;
  }

  let separatorIndex = -1;
  let insideBrackets = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '[') {
      if (insideBrackets) {
        return null;
      }
      insideBrackets = true;
    } else if (character === ']') {
      if (!insideBrackets) {
        return null;
      }
      insideBrackets = false;
    } else if (character === ':' && !insideBrackets) {
      separatorIndex = index;
      break;
    }
  }
  if (insideBrackets || separatorIndex <= 0 || (separatorIndex === 1 && /^[a-zA-Z]$/.test(trimmed[0]))) {
    return null;
  }
  const authority = trimmed.slice(0, separatorIndex).trim();
  const remotePath = trimmed.slice(separatorIndex + 1).trim();
  return authority && remotePath ? remotePath : null;
}

export function createManagedSshConversionDraft(project: ProjectItem): ProjectItem {
  const { sshHostId: _sshHostId, remotePath: _remotePath, ...legacyProject } = project;
  return {
    ...legacyProject,
    remotePath: extractRemotePathForManagedProject(project.path) ?? ''
  };
}

export function updateManagedProjectFields(
  project: ProjectItem,
  sshHostId: string,
  remotePath: string,
  hosts: readonly SshHost[]
): ProjectItem {
  const host = hosts.find(candidate => candidate.id === sshHostId);
  return {
    ...project,
    sshHostId: sshHostId || undefined,
    remotePath,
    path: host && remotePath.trim()
      ? buildManagedProjectPath(host, remotePath)
      : project.path
  };
}

export function getMigrationWarningSignature(warnings: readonly SshMigrationWarning[]): string {
  if (!warnings.length) {
    return '';
  }
  return JSON.stringify(warnings
    .map(warning => [warning.projectId ?? null, warning.projectName, warning.message])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}
