import { userInfo } from 'os';

export interface ParsedSshPath {
  userHost: string;
  username?: string;
  hostname: string;
  port?: number;
  remotePath: string;
}

export interface SshAuthority {
  hostname: string;
  username?: string;
  port?: number;
  structured: boolean;
}

export interface SshTarget {
  hostname: string;
  username?: string;
  port?: number;
}

export type StrictSshAuthorityParseResult =
  | { authority: SshAuthority }
  | { error: 'missing-hostname' | 'invalid-port' };

interface ParsedSshAuthorityDetails extends SshAuthority {
  canonicalStructuredAuthority: string;
  invalidExplicitPort: boolean;
}

interface ParsedAuthorityObject {
  json: string;
  properties: Record<string, unknown>;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getStringProperty(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function parseAuthorityObject(value: string): ParsedAuthorityObject | undefined {
  const decoded = safeDecode(value).trim();
  const candidates = [decoded];

  if (/^[0-9a-f]+$/i.test(decoded) && decoded.length % 2 === 0) {
    try {
      candidates.push(Buffer.from(decoded, 'hex').toString('utf8').trim());
    } catch {
      // Fall back to the plain decoded authority below.
    }
  }

  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          json: candidate,
          properties: parsed as Record<string, unknown>
        };
      }
    } catch {
      // Not a JSON authority payload.
    }
  }

  return undefined;
}

function parsePort(value: unknown): number | undefined {
  const numericValue = typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;

  if (
    typeof numericValue !== 'number'
    || !Number.isInteger(numericValue)
    || numericValue < 1
    || numericValue > 65535
  ) {
    return undefined;
  }

  return numericValue;
}

function isSafePlainHostname(hostname: string): boolean {
  return /^[a-z0-9._-]+$/.test(hostname);
}

function getStructuredAuthorityDetails(
  parsed: Record<string, unknown>,
  canonicalStructuredAuthority: string,
  fallbackUsername?: string
): ParsedSshAuthorityDetails | undefined {
  const hostname = getStringProperty(parsed, ['hostName', 'hostname', 'host']);
  if (!hostname) {
    return undefined;
  }

  const hasExplicitPort = Object.prototype.hasOwnProperty.call(parsed, 'port');
  const port = parsePort(parsed.port);
  return {
    hostname,
    username: getStringProperty(parsed, ['user', 'username']) || fallbackUsername,
    port,
    structured: true,
    canonicalStructuredAuthority,
    invalidExplicitPort: hasExplicitPort && port === undefined
  };
}

function parseRemoteSshAuthorityDetails(value: string): ParsedSshAuthorityDetails {
  const decoded = safeDecode(value).trim();
  const parsed = parseAuthorityObject(decoded);

  if (parsed) {
    const canonicalStructuredAuthority = Buffer.from(parsed.json, 'utf8').toString('hex');
    const details = getStructuredAuthorityDetails(
      parsed.properties,
      canonicalStructuredAuthority
    );
    if (details) {
      return details;
    }
  }

  const atIndex = decoded.lastIndexOf('@');
  if (atIndex > 0) {
    const nested = parseAuthorityObject(decoded.slice(atIndex + 1));
    if (nested) {
      const username = decoded.slice(0, atIndex);
      const canonicalNestedAuthority = Buffer.from(nested.json, 'utf8').toString('hex');
      const details = getStructuredAuthorityDetails(
        nested.properties,
        `${username}@${canonicalNestedAuthority}`,
        username
      );
      if (details) {
        return details;
      }
    }
  }

  return {
    hostname: atIndex > 0 ? decoded.slice(atIndex + 1) : decoded,
    username: atIndex > 0 ? decoded.slice(0, atIndex) : undefined,
    port: undefined,
    structured: false,
    canonicalStructuredAuthority: decoded,
    invalidExplicitPort: false
  };
}

export function parseRemoteSshAuthority(value: string): SshAuthority {
  const { hostname, username, port, structured } = parseRemoteSshAuthorityDetails(value);
  return { hostname, username, port, structured };
}

function parseStrictStructuredAuthority(
  properties: Record<string, unknown>,
  fallbackUsername?: string
): StrictSshAuthorityParseResult {
  const hostname = getStringProperty(properties, ['hostName', 'hostname', 'host']);
  if (!hostname) {
    return { error: 'missing-hostname' };
  }

  const hasExplicitPort = Object.prototype.hasOwnProperty.call(properties, 'port');
  const port = properties.port;
  if (hasExplicitPort && (
    typeof port !== 'number'
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
  )) {
    return { error: 'invalid-port' };
  }

  const username = getStringProperty(properties, ['user', 'username'])
    || fallbackUsername?.trim()
    || undefined;
  return {
    authority: {
      hostname,
      username,
      port: hasExplicitPort ? port as number : undefined,
      structured: true
    }
  };
}

export function parseRemoteSshAuthorityStrict(value: string): StrictSshAuthorityParseResult {
  const decoded = safeDecode(value).trim();
  const parsed = parseAuthorityObject(decoded);
  if (parsed) {
    return parseStrictStructuredAuthority(parsed.properties);
  }

  const atIndex = decoded.lastIndexOf('@');
  if (atIndex > 0) {
    const nested = parseAuthorityObject(decoded.slice(atIndex + 1));
    if (nested) {
      return parseStrictStructuredAuthority(nested.properties, decoded.slice(0, atIndex));
    }
  }

  const authority = parseRemoteSshAuthority(value);
  return authority.hostname.trim()
    ? { authority }
    : { error: 'missing-hostname' };
}

export function encodeRemoteSshAuthority(target: SshTarget): string {
  const hostname = target.hostname.trim();
  const username = target.username?.trim() || undefined;
  const port = parsePort(target.port);
  if (target.port !== undefined && port === undefined) {
    throw new RangeError('SSH port must be an integer between 1 and 65535.');
  }

  const mustUseStructuredAuthority = Boolean(
    username
    || target.port !== undefined
    || !isSafePlainHostname(hostname)
  );

  if (!mustUseStructuredAuthority) {
    return hostname;
  }

  const payload: { hostName: string; user?: string; port?: number } = { hostName: hostname };
  if (username) {
    payload.user = username;
  }
  if (port !== undefined) {
    payload.port = port;
  }

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
}

function formatNormalizedStructuredAuthority(authority: SshAuthority): string {
  if (authority.port !== undefined || !isSafePlainHostname(authority.hostname)) {
    return encodeRemoteSshAuthority(authority);
  }

  return authority.username
    ? `${authority.username}@${authority.hostname}`
    : authority.hostname;
}

function getLocalUsername(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

function isSameUsername(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function normalizeRemoteSshAuthority(authority: string): string {
  const decoded = safeDecode(authority).trim();
  const parsed = parseRemoteSshAuthorityDetails(decoded);

  if (!parsed.structured) {
    return decoded;
  }

  if (parsed.invalidExplicitPort) {
    return parsed.canonicalStructuredAuthority;
  }

  return formatNormalizedStructuredAuthority(parsed);
}

export function normalizeRemoteSshUserHost(userHost: string): string {
  const decoded = safeDecode(userHost).trim();
  const atIndex = decoded.lastIndexOf('@');
  if (atIndex <= 0) {
    return normalizeRemoteSshAuthority(decoded);
  }

  const username = decoded.slice(0, atIndex);
  const rawHostAuthority = decoded.slice(atIndex + 1);
  const parsedHostAuthority = parseRemoteSshAuthorityDetails(rawHostAuthority);
  const hostAuthority = normalizeRemoteSshAuthority(rawHostAuthority);

  if (parsedHostAuthority.structured) {
    if (parsedHostAuthority.invalidExplicitPort) {
      if (parsedHostAuthority.username || isSameUsername(username, getLocalUsername())) {
        return parsedHostAuthority.canonicalStructuredAuthority;
      }

      return `${username}@${parsedHostAuthority.canonicalStructuredAuthority}`;
    }

    if (parsedHostAuthority.username) {
      return formatNormalizedStructuredAuthority(parsedHostAuthority);
    }

    if (isSameUsername(username, getLocalUsername())) {
      return hostAuthority;
    }

    return formatNormalizedStructuredAuthority({
      ...parsedHostAuthority,
      username
    });
  }

  const host = hostAuthority.split('@').pop() || hostAuthority;
  return `${username}@${host}`;
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

  const userHost = normalizeRemoteSshUserHost(trimmed.slice(0, separatorIndex).trim());
  const remotePath = trimmed.slice(separatorIndex + 1).trim();

  if (!userHost || !remotePath) {
    return null;
  }

  const authority = parseRemoteSshAuthority(userHost);

  if (!authority.structured && (userHost.includes('/') || userHost.includes('\\'))) {
    return null;
  }

  // Reject Windows local drive paths such as C:\repo or C:/repo.
  if (/^[a-zA-Z]$/.test(userHost)) {
    return null;
  }

  const { hostname, username, port } = authority;

  if (!hostname) {
    return null;
  }

  return {
    userHost,
    username,
    hostname,
    ...(port !== undefined ? { port } : {}),
    remotePath
  };
}

export function extractHostnameFromSshPath(input: string): string {
  const trimmed = input.trim();

  if (trimmed.startsWith('vscode-remote://ssh-remote+')) {
    try {
      const authority = trimmed.replace('vscode-remote://ssh-remote+', '').split('/')[0];
      const normalizedAuthority = normalizeRemoteSshUserHost(authority);
      return parseRemoteSshAuthority(normalizedAuthority).hostname;
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

  const userHost = normalizeRemoteSshUserHost(withoutPrefix.slice(0, slashIndex));
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

export function buildRemoteSshUriFromTarget(target: SshTarget, remotePath: string): string {
  const authority = encodeRemoteSshAuthority(target);
  const normalizedRemotePath = normalizeRemoteSshPath(remotePath);
  const uriPath = normalizedRemotePath.startsWith('/') ? normalizedRemotePath : `/${normalizedRemotePath}`;
  return `vscode-remote://ssh-remote+${authority}${uriPath}`;
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

  const sourceAuthority = parseRemoteSshAuthorityDetails(parsed.userHost);
  if (sourceAuthority.structured && sourceAuthority.invalidExplicitPort) {
    const remotePath = normalizeRemoteSshPath(parsed.remotePath);
    const uriPath = remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
    return `vscode-remote://ssh-remote+${sourceAuthority.canonicalStructuredAuthority}${uriPath}`;
  }

  return buildRemoteSshUriFromTarget(parsed, parsed.remotePath);
}
