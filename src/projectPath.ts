import * as path from 'path';
import * as vscode from 'vscode';
import type { ProjectItem, ProjectType } from './store';
import {
  getRawSshPathFromRemoteUri,
  getSuggestedNameFromSshPath,
  normalizeRemoteSshPath,
  parseRawSshPath
} from './sshPath';

export type ProjectSelectionKind = 'folder' | 'workspace';

export interface NormalizedProjectSelection {
  path: string;
  type: ProjectType;
  suggestedName: string;
  isRemote: boolean;
  sshHost?: string;
}

const SSH_REMOTE_AUTHORITY_PREFIX = 'ssh-remote+';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getLocalSuggestedName(targetPath: string, isWorkspace: boolean): string {
  const baseName = path.basename(targetPath);
  return isWorkspace ? baseName.replace(/\.code-workspace$/i, '') : baseName;
}

function normalizeRemotePath(remotePath: string): string {
  const decoded = safeDecode(remotePath).replace(/\\/g, '/');

  if (!decoded) {
    return '/';
  }

  if (/^\/[a-zA-Z]:\//.test(decoded)) {
    return decoded.slice(1);
  }

  if (/^\/{2,}/.test(decoded)) {
    return `/${decoded.replace(/^\/+/, '')}`;
  }

  return decoded;
}

function getSshHostFromUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== 'vscode-remote' || !uri.authority.startsWith(SSH_REMOTE_AUTHORITY_PREFIX)) {
    return undefined;
  }

  return safeDecode(uri.authority.slice(SSH_REMOTE_AUTHORITY_PREFIX.length));
}

export function normalizeProjectPathForStorage(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    return '';
  }

  const rawSshPath = getRawSshPathFromRemoteUri(trimmed);
  if (rawSshPath) {
    return rawSshPath;
  }

  const parsed = parseRawSshPath(trimmed);
  if (parsed) {
    return `${parsed.userHost}:${normalizeRemoteSshPath(parsed.remotePath)}`;
  }

  return trimmed;
}

export function detectProjectTypeFromPath(input: string): ProjectType {
  const normalizedPath = normalizeProjectPathForStorage(input);
  const parsed = parseRawSshPath(normalizedPath);

  if (parsed) {
    return /\.code-workspace$/i.test(parsed.remotePath) ? 'ssh-workspace' : 'ssh';
  }

  return /\.code-workspace$/i.test(normalizedPath) ? 'workspace' : 'local';
}

export function normalizeProjectItemForStorage(project: ProjectItem): ProjectItem {
  const normalizedPath = normalizeProjectPathForStorage(project.path);

  return {
    ...project,
    name: project.name.trim(),
    path: normalizedPath,
    type: detectProjectTypeFromPath(normalizedPath)
  };
}

export function normalizeSelectedProjectUri(uri: vscode.Uri, kind: ProjectSelectionKind): NormalizedProjectSelection {
  const isWorkspace = kind === 'workspace';

  if (uri.scheme === 'file') {
    return {
      path: uri.fsPath,
      type: isWorkspace ? 'workspace' : 'local',
      suggestedName: getLocalSuggestedName(uri.fsPath, isWorkspace),
      isRemote: false
    };
  }

  const sshHost = getSshHostFromUri(uri);
  if (sshHost) {
    const remotePath = normalizeRemotePath(uri.path);
    const sshPath = `${sshHost}:${remotePath}`;

    return {
      path: sshPath,
      type: isWorkspace ? 'ssh-workspace' : 'ssh',
      suggestedName: getSuggestedNameFromSshPath(
        sshPath,
        isWorkspace ? 'SSH Workspace' : 'SSH Project',
        isWorkspace
      ),
      isRemote: true,
      sshHost
    };
  }

  const fallbackPath = uri.fsPath || safeDecode(uri.path) || uri.toString(true);
  return {
    path: fallbackPath,
    type: isWorkspace ? 'workspace' : 'local',
    suggestedName: getLocalSuggestedName(fallbackPath, isWorkspace),
    isRemote: uri.scheme !== 'file'
  };
}
