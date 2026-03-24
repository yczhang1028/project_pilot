import * as vscode from 'vscode';
import { normalizeSelectedProjectUri } from './projectPath';
import { resolveSshTarget } from './sshResolve';
import type { ProjectType } from './store';

export interface CurrentRemoteStatus {
  isRemote: boolean;
  remoteName?: string;
  sshHost?: string;
  currentPath?: string;
  currentType?: Extract<ProjectType, 'ssh' | 'ssh-workspace'>;
  username?: string;
  host?: string;
  ip?: string;
  port?: string;
  message?: string;
}

function getCurrentRemoteUri(): vscode.Uri | undefined {
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile?.scheme === 'vscode-remote') {
    return workspaceFile;
  }

  return vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'vscode-remote')?.uri;
}

export async function getCurrentRemoteStatus(): Promise<CurrentRemoteStatus> {
  const remoteName = vscode.env.remoteName;

  if (!remoteName) {
    return { isRemote: false };
  }

  if (remoteName !== 'ssh-remote') {
    return { isRemote: false, remoteName };
  }

  const currentUri = getCurrentRemoteUri();
  if (!currentUri) {
    return { isRemote: true, remoteName };
  }

  const kind = currentUri.path.toLowerCase().endsWith('.code-workspace') ? 'workspace' : 'folder';
  const selection = normalizeSelectedProjectUri(currentUri, kind);

  if (selection.type !== 'ssh' && selection.type !== 'ssh-workspace') {
    return {
      isRemote: true,
      remoteName,
      sshHost: selection.sshHost
    };
  }

  const resolved = await resolveSshTarget(selection.path);

  return {
    isRemote: true,
    remoteName,
    sshHost: selection.sshHost || resolved.authority,
    currentPath: resolved.canonicalPath || selection.path,
    currentType: selection.type,
    username: resolved.resolvedUsername || resolved.username,
    host: resolved.resolvedHostname || resolved.host,
    ip: resolved.ip,
    port: resolved.port,
    message: resolved.message
  };
}
