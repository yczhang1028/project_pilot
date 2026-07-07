import type { ProjectItem } from './store';
import {
  resolveManagedSshProject,
  type ResolvedManagedSshProject,
  type SshHost
} from './sshHosts';
import {
  buildRemoteSshUri,
  buildRemoteSshUriFromTarget,
  normalizeRemoteSshPath,
  parseRawSshPath,
  parseRemoteSshAuthorityStrict
} from './sshPath';
import {
  resolveSshTarget,
  testSshHostConnection,
  type SshProbeResult,
  type SshResolutionResult
} from './sshResolve';

export interface ResolvedSshProjectRuntime extends ResolvedManagedSshProject {
  managed: boolean;
}

export type SshProbe = (host: SshHost) => Promise<SshProbeResult>;

export interface SshResolutionPayload {
  path: string;
  project?: ProjectItem;
}

function isSshProject(project: ProjectItem): boolean {
  return project.type === 'ssh' || project.type === 'ssh-workspace';
}

function hasManagedFields(project: ProjectItem): boolean {
  return project.sshHostId !== undefined || project.remotePath !== undefined;
}

function formatDisplayPath(host: SshHost, remotePath: string): string {
  const username = host.username?.trim();
  const hostname = host.hostname.trim();
  const displayHostname = hostname.includes(':') && !hostname.startsWith('[')
    ? `[${hostname}]`
    : hostname;
  const target = `${username ? `${username}@` : ''}${displayHostname}`;
  return `${target}${host.port !== undefined ? `:${host.port}` : ''}:${remotePath}`;
}

function parseLegacyRemoteUri(project: ProjectItem): ResolvedSshProjectRuntime | undefined {
  const prefix = 'vscode-remote://ssh-remote+';
  const input = project.path.trim();
  if (!input.startsWith(prefix)) {
    return undefined;
  }

  const authorityAndPath = input.slice(prefix.length);
  const pathIndex = authorityAndPath.indexOf('/');
  if (pathIndex <= 0) {
    throw new Error(`Invalid SSH project path for "${project.name}": missing remote authority or path`);
  }
  const parsedAuthority = parseRemoteSshAuthorityStrict(authorityAndPath.slice(0, pathIndex));
  if ('error' in parsedAuthority) {
    throw new Error(
      `Invalid SSH project path for "${project.name}": ${parsedAuthority.error === 'invalid-port' ? 'invalid SSH port' : 'missing hostname'}`
    );
  }

  const remotePath = normalizeRemoteSshPath(authorityAndPath.slice(pathIndex));
  if (!remotePath.trim()) {
    throw new Error(`Invalid SSH project path for "${project.name}": missing remote path`);
  }
  const authority = parsedAuthority.authority;
  const host: SshHost = {
    id: `legacy:${project.id ?? project.name}`,
    name: project.name || authority.hostname,
    hostname: authority.hostname,
    ...(authority.username ? { username: authority.username } : {}),
    ...(authority.port !== undefined ? { port: authority.port } : {})
  };

  return {
    managed: false,
    host,
    remotePath,
    displayPath: formatDisplayPath(host, remotePath),
    compatibilityPath: input,
    remoteUri: buildRemoteSshUriFromTarget(host, remotePath)
  };
}

function parseLegacyRawPath(project: ProjectItem): ResolvedSshProjectRuntime {
  const parsed = parseRawSshPath(project.path);
  if (!parsed) {
    throw new Error(`Invalid SSH project path for "${project.name}"`);
  }
  const remotePath = normalizeRemoteSshPath(parsed.remotePath);
  const host: SshHost = {
    id: `legacy:${project.id ?? project.name}`,
    name: project.name || parsed.hostname,
    hostname: parsed.hostname,
    ...(parsed.username ? { username: parsed.username } : {}),
    ...(parsed.port !== undefined ? { port: parsed.port } : {})
  };
  const remoteUri = buildRemoteSshUri(project.path);
  if (!remoteUri) {
    throw new Error(`Invalid SSH project path for "${project.name}"`);
  }

  return {
    managed: false,
    host,
    remotePath,
    displayPath: formatDisplayPath(host, remotePath),
    compatibilityPath: project.path.trim(),
    remoteUri
  };
}

/** Resolve the usable SSH data for an operation. Managed projects never read project.path. */
export function resolveSshProjectRuntime(
  project: ProjectItem,
  hosts: readonly SshHost[]
): ResolvedSshProjectRuntime {
  if (!isSshProject(project)) {
    throw new Error(`Project "${project.name}" is not an SSH project`);
  }

  if (hasManagedFields(project)) {
    if (!project.sshHostId?.trim()) {
      throw new Error(`Managed SSH project "${project.name}" is missing sshHostId`);
    }
    if (typeof project.remotePath !== 'string' || !project.remotePath.trim()) {
      throw new Error(`Managed SSH project "${project.name}" is missing remotePath`);
    }
    return {
      managed: true,
      ...resolveManagedSshProject(project, hosts)
    };
  }

  return parseLegacyRemoteUri(project) ?? parseLegacyRawPath(project);
}

/** Return a webview/copy-compatible snapshot without mutating the Store object. */
export function materializeRuntimeProject(
  project: ProjectItem,
  hosts: readonly SshHost[]
): ProjectItem {
  if (!isSshProject(project) || !hasManagedFields(project)) {
    return { ...project };
  }
  return {
    ...project,
    path: resolveSshProjectRuntime(project, hosts).compatibilityPath
  };
}

export function materializeRuntimeProjects(
  projects: readonly ProjectItem[],
  hosts: readonly SshHost[]
): ProjectItem[] {
  return projects.map(project => materializeRuntimeProject(project, hosts));
}

export async function resolveSshTargetPayload(
  payload: SshResolutionPayload,
  hosts: readonly SshHost[]
): Promise<SshResolutionResult> {
  try {
    const input = payload.project && isSshProject(payload.project)
      ? resolveSshProjectRuntime(payload.project, hosts).compatibilityPath
      : payload.path;
    return await resolveSshTarget(input);
  } catch (error) {
    const requestedPath = typeof payload.path === 'string' ? payload.path.trim() : '';
    return {
      success: false,
      requestedPath,
      normalizedPath: requestedPath,
      isWindowsRemotePath: false,
      message: error instanceof Error ? error.message : 'SSH path could not be resolved.',
      warnings: []
    };
  }
}

export async function testSshProjectConnection(
  project: ProjectItem,
  hosts: readonly SshHost[],
  probe: SshProbe = testSshHostConnection
): Promise<SshProbeResult> {
  try {
    const resolved = resolveSshProjectRuntime(project, hosts);
    if (project.type === 'ssh-workspace' && !/\.code-workspace$/i.test(resolved.remotePath)) {
      return {
        success: false,
        code: 'remote-command',
        message: 'SSH workspace path should end with .code-workspace.'
      };
    }
    const result = await probe(resolved.host);
    if (!result.success && result.code === 'ssh-not-found') {
      return {
        ...result,
        message: `${result.message} SSH configuration is valid, but the connection was not tested.`
      };
    }
    return result;
  } catch (error) {
    return {
      success: false,
      code: 'remote-command',
      message: error instanceof Error ? error.message : 'SSH connection test failed.'
    };
  }
}
