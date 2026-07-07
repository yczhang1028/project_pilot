import type { ProjectItem } from './store';
import {
  resolveManagedSshProject,
  type ResolvedManagedSshProject,
  type SshHost
} from './sshHosts';
import {
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
  requestId?: number;
}

export interface SshResolutionPayloadResult extends SshResolutionResult {
  requestId?: number;
}

type OwnDataProperty =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: unknown };

function asPlainRecord(value: unknown): object | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  try {
    if (Array.isArray(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value : undefined;
  } catch {
    return undefined;
  }
}

function readOwnDataProperty(record: object, key: PropertyKey): OwnDataProperty {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
      return { kind: 'missing' };
    }
    return 'value' in descriptor
      ? { kind: 'value', value: descriptor.value }
      : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

function readOptionalString(record: object, key: string): string | undefined | null {
  const property = readOwnDataProperty(record, key);
  if (property.kind === 'missing' || (property.kind === 'value' && property.value === undefined)) {
    return undefined;
  }
  return property.kind === 'value' && typeof property.value === 'string'
    ? property.value
    : null;
}

function sanitizeProject(value: unknown): ProjectItem | undefined {
  const record = asPlainRecord(value);
  if (!record) {
    return undefined;
  }
  const name = readOwnDataProperty(record, 'name');
  const path = readOwnDataProperty(record, 'path');
  const type = readOwnDataProperty(record, 'type');
  if (
    name.kind !== 'value'
    || typeof name.value !== 'string'
    || path.kind !== 'value'
    || typeof path.value !== 'string'
    || type.kind !== 'value'
    || (type.value !== 'ssh' && type.value !== 'ssh-workspace')
  ) {
    return undefined;
  }

  const id = readOptionalString(record, 'id');
  const sshHostId = readOptionalString(record, 'sshHostId');
  const remotePath = readOptionalString(record, 'remotePath');
  if (id === null || sshHostId === null || remotePath === null) {
    return undefined;
  }
  return {
    name: name.value,
    path: path.value,
    type: type.value,
    ...(id !== undefined ? { id } : {}),
    ...(sshHostId !== undefined ? { sshHostId } : {}),
    ...(remotePath !== undefined ? { remotePath } : {})
  };
}

function sanitizeResolutionPayload(value: unknown):
  | { valid: true; path: string; project?: ProjectItem; requestId?: number }
  | { valid: false; requestId?: number } {
  const record = asPlainRecord(value);
  if (!record) {
    return { valid: false };
  }

  const requestIdProperty = readOwnDataProperty(record, 'requestId');
  let requestId: number | undefined;
  if (requestIdProperty.kind === 'invalid') {
    return { valid: false };
  }
  if (requestIdProperty.kind === 'value') {
    if (typeof requestIdProperty.value !== 'number' || !Number.isSafeInteger(requestIdProperty.value)) {
      return { valid: false };
    }
    requestId = requestIdProperty.value;
  }

  const pathProperty = readOwnDataProperty(record, 'path');
  if (pathProperty.kind !== 'value' || typeof pathProperty.value !== 'string') {
    return { valid: false, ...(requestId !== undefined ? { requestId } : {}) };
  }

  const projectProperty = readOwnDataProperty(record, 'project');
  if (projectProperty.kind === 'invalid') {
    return { valid: false, ...(requestId !== undefined ? { requestId } : {}) };
  }
  let project: ProjectItem | undefined;
  if (projectProperty.kind === 'value' && projectProperty.value !== undefined) {
    project = sanitizeProject(projectProperty.value);
    if (!project) {
      return { valid: false, ...(requestId !== undefined ? { requestId } : {}) };
    }
  }

  return {
    valid: true,
    path: pathProperty.value,
    ...(project ? { project } : {}),
    ...(requestId !== undefined ? { requestId } : {})
  };
}

function invalidResolutionPayload(requestId?: number, message = 'Invalid SSH resolution payload.'): SshResolutionPayloadResult {
  return {
    success: false,
    requestedPath: '',
    normalizedPath: '',
    isWindowsRemotePath: false,
    message,
    warnings: [],
    ...(requestId !== undefined ? { requestId } : {})
  };
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
  const strictAuthority = parseRemoteSshAuthorityStrict(parsed.userHost);
  if ('error' in strictAuthority) {
    throw new Error(
      `Invalid SSH project path for "${project.name}": ${strictAuthority.error === 'invalid-port' ? 'invalid SSH port' : 'missing hostname'}`
    );
  }
  const authority = strictAuthority.authority;
  const host: SshHost = {
    id: `legacy:${project.id ?? project.name}`,
    name: project.name || authority.hostname,
    hostname: authority.hostname,
    ...(authority.username ? { username: authority.username } : {}),
    ...(authority.port !== undefined ? { port: authority.port } : {})
  };
  const remoteUri = buildRemoteSshUriFromTarget(host, remotePath);

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

export function resolveCurrentProject(
  project: ProjectItem,
  currentProjects: readonly ProjectItem[]
): ProjectItem {
  if (project.id === undefined) {
    return project;
  }
  const current = currentProjects.find(candidate => candidate.id === project.id);
  if (!current) {
    throw new Error(`Project ${project.id || 'with empty ID'} no longer exists`);
  }
  return current;
}

export async function resolveSshTargetPayload(
  value: unknown,
  hosts: readonly SshHost[]
): Promise<SshResolutionPayloadResult> {
  const payload = sanitizeResolutionPayload(value);
  if (!payload.valid) {
    return invalidResolutionPayload(payload.requestId);
  }
  try {
    const input = payload.project && isSshProject(payload.project)
      ? resolveSshProjectRuntime(payload.project, hosts).compatibilityPath
      : payload.path;
    return {
      ...await resolveSshTarget(input),
      ...(payload.requestId !== undefined ? { requestId: payload.requestId } : {})
    };
  } catch (error) {
    return {
      ...invalidResolutionPayload(
        payload.requestId,
        error instanceof Error ? error.message : 'SSH path could not be resolved.'
      ),
      requestedPath: payload.path.trim(),
      normalizedPath: payload.path.trim()
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

export async function testSubmittedSshProjectConnection(
  value: unknown,
  currentProjects: readonly ProjectItem[],
  hosts: readonly SshHost[],
  probe: SshProbe = testSshHostConnection
): Promise<SshProbeResult> {
  try {
    const project = sanitizeProject(value);
    if (!project) {
      throw new Error('Invalid submitted SSH project.');
    }
    if (project.id !== undefined) {
      if (!project.id || !currentProjects.some(candidate => candidate.id === project.id)) {
        throw new Error(`Project ${project.id || 'with empty ID'} no longer exists`);
      }
    }
    return await testSshProjectConnection(project, hosts, probe);
  } catch (error) {
    return {
      success: false,
      code: 'remote-command',
      message: error instanceof Error ? error.message : 'The selected project no longer exists.'
    };
  }
}
