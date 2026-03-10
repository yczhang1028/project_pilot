export interface ParsedSshPath {
  userHost: string;
  hostname: string;
  remotePath: string;
}

export function parseRawSshPath(input: string): ParsedSshPath | null {
  const trimmed = input.trim();
  const separatorIndex = trimmed.indexOf(':');

  if (separatorIndex <= 0) {
    return null;
  }

  const userHost = trimmed.slice(0, separatorIndex).trim();
  const remotePath = trimmed.slice(separatorIndex + 1).trim();

  if (!userHost.includes('@') || !remotePath) {
    return null;
  }

  const hostname = userHost.split('@')[1] || '';
  return { userHost, hostname, remotePath };
}

export function extractHostnameFromSshPath(input: string): string {
  const trimmed = input.trim();

  if (trimmed.startsWith('vscode-remote://ssh-remote+')) {
    try {
      const authority = trimmed.replace('vscode-remote://ssh-remote+', '').split('/')[0];
      const decodedAuthority = decodeURIComponent(authority);
      return decodedAuthority.split('@')[1] || decodedAuthority;
    } catch {
      return '';
    }
  }

  return parseRawSshPath(trimmed)?.hostname || '';
}

function getRemotePath(input: string): string {
  if (input.startsWith('vscode-remote://ssh-remote+')) {
    const withoutPrefix = input.replace('vscode-remote://ssh-remote+', '');
    const slashIndex = withoutPrefix.indexOf('/');

    if (slashIndex === -1) {
      return '';
    }

    return withoutPrefix.slice(slashIndex + 1);
  }

  return parseRawSshPath(input)?.remotePath || '';
}

export function getSuggestedNameFromSshPath(input: string, fallbackName: string, stripWorkspaceExtension = false): string {
  const remotePath = getRemotePath(input).replace(/\\/g, '/');
  const segments = remotePath.split('/').filter(Boolean);
  let suggestedName = segments.at(-1) || fallbackName;

  if (stripWorkspaceExtension) {
    suggestedName = suggestedName.replace(/\.code-workspace$/i, '');
  }

  return suggestedName || fallbackName;
}

export function buildRemoteSshUri(input: string): string | null {
  const trimmed = input.trim();

  if (trimmed.startsWith('vscode-remote://')) {
    return trimmed;
  }

  const parsed = parseRawSshPath(trimmed);
  if (!parsed) {
    return null;
  }

  const normalizedRemotePath = parsed.remotePath.startsWith('/') ? parsed.remotePath : `/${parsed.remotePath}`;
  return `vscode-remote://ssh-remote+${encodeURIComponent(parsed.userHost)}${normalizedRemotePath}`;
}
