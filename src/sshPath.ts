export interface ParsedSshPath {
  userHost: string;
  username?: string;
  hostname: string;
  remotePath: string;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeRemoteSshPath(input: string): string {
  const decoded = safeDecode(input).replace(/\\/g, '/');

  if (!decoded) {
    return '';
  }

  if (/^\/[a-zA-Z]:\//.test(decoded)) {
    return decoded.slice(1);
  }

  if (/^\/{2,}/.test(decoded)) {
    return `/${decoded.replace(/^\/+/, '')}`;
  }

  return decoded;
}

export function parseRawSshPath(input: string): ParsedSshPath | null {
  const trimmed = input.trim();
  const separatorIndex = trimmed.indexOf(':');

  if (separatorIndex <= 0) {
    return null;
  }

  const userHost = trimmed.slice(0, separatorIndex).trim();
  const remotePath = trimmed.slice(separatorIndex + 1).trim();

  if (!userHost || !remotePath) {
    return null;
  }

  if (userHost.includes('/') || userHost.includes('\\')) {
    return null;
  }

  // Reject Windows local drive paths such as C:\repo or C:/repo.
  if (/^[a-zA-Z]$/.test(userHost)) {
    return null;
  }

  const atIndex = userHost.lastIndexOf('@');
  const username = atIndex > 0 ? userHost.slice(0, atIndex) : undefined;
  const hostname = atIndex > 0 ? userHost.slice(atIndex + 1) : userHost;

  if (!hostname) {
    return null;
  }

  return { userHost, username, hostname, remotePath };
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

export function getRawSshPathFromRemoteUri(input: string): string | null {
  const trimmed = input.trim();

  if (!trimmed.startsWith('vscode-remote://ssh-remote+')) {
    return null;
  }

  const withoutPrefix = trimmed.replace('vscode-remote://ssh-remote+', '');
  const slashIndex = withoutPrefix.indexOf('/');

  if (slashIndex === -1) {
    return null;
  }

  const userHost = safeDecode(withoutPrefix.slice(0, slashIndex));
  const remotePath = normalizeRemoteSshPath(withoutPrefix.slice(slashIndex));

  if (!userHost || !remotePath) {
    return null;
  }

  return `${userHost}:${remotePath}`;
}

function getRemotePath(input: string): string {
  if (input.startsWith('vscode-remote://ssh-remote+')) {
    return getRawSshPathFromRemoteUri(input)?.split(':').slice(1).join(':') || '';
  }

  return normalizeRemoteSshPath(parseRawSshPath(input)?.remotePath || '');
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

  const remotePath = normalizeRemoteSshPath(parsed.remotePath);
  const normalizedRemotePath = remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
  return `vscode-remote://ssh-remote+${encodeURIComponent(parsed.userHost)}${normalizedRemotePath}`;
}
