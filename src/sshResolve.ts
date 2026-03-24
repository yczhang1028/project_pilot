import { execFile } from 'child_process';
import { lookup } from 'dns/promises';
import * as fs from 'fs';
import * as net from 'net';
import { promisify } from 'util';
import { getRawSshPathFromRemoteUri, normalizeRemoteSshPath, parseRawSshPath } from './sshPath';

const execFileAsync = promisify(execFile);
const WINDOWS_SSH_PATH = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';

export interface SshResolutionResult {
  success: boolean;
  requestedPath: string;
  normalizedPath: string;
  authority?: string;
  host?: string;
  username?: string;
  resolvedUsername?: string;
  resolvedHostname?: string;
  ip?: string;
  port?: string;
  canonicalPath?: string;
  isWindowsRemotePath: boolean;
  message: string;
  warnings: string[];
}

function getSshCommandCandidates(): string[] {
  const candidates = ['ssh'];

  if (process.platform === 'win32' && fs.existsSync(WINDOWS_SSH_PATH)) {
    candidates.push(WINDOWS_SSH_PATH);
  }

  return [...new Set(candidates)];
}

function parseSshConfig(stdout: string): Record<string, string> {
  const config: Record<string, string> = {};

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^(\S+)\s+(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, value] = match;
    config[key.toLowerCase()] = value.trim();
  }

  return config;
}

async function runSshConfigLookup(host: string, username?: string): Promise<Record<string, string>> {
  const args = ['-G'];
  if (username) {
    args.push('-l', username);
  }
  args.push(host);

  let lastError: unknown;

  for (const candidate of getSshCommandCandidates()) {
    try {
      const { stdout } = await execFileAsync(candidate, args, {
        timeout: 4000,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      });
      return parseSshConfig(stdout);
    } catch (error: any) {
      if (typeof error?.stdout === 'string' && error.stdout.trim()) {
        return parseSshConfig(error.stdout);
      }

      lastError = error;

      if (error?.code !== 'ENOENT') {
        break;
      }
    }
  }

  throw lastError ?? new Error('ssh command is not available');
}

function buildResolutionMessage(result: {
  resolvedUsername?: string;
  host: string;
  resolvedHostname?: string;
  ip?: string;
}): string {
  const parts = [
    result.resolvedUsername ? `user ${result.resolvedUsername}` : 'SSH target',
    `host ${result.host}`
  ];

  if (result.resolvedHostname && result.resolvedHostname !== result.host) {
    parts.push(`hostname ${result.resolvedHostname}`);
  }

  if (result.ip) {
    parts.push(`IP ${result.ip}`);
  }

  return `Resolved ${parts.join(' • ')}.`;
}

export async function resolveSshTarget(input: string): Promise<SshResolutionResult> {
  const requestedPath = input.trim();
  const normalizedPath = getRawSshPathFromRemoteUri(requestedPath) ?? requestedPath;
  const parsed = parseRawSshPath(normalizedPath);

  if (!parsed) {
    return {
      success: false,
      requestedPath,
      normalizedPath,
      isWindowsRemotePath: false,
      message: 'SSH path is incomplete or invalid.',
      warnings: []
    };
  }

  const remotePath = normalizeRemoteSshPath(parsed.remotePath);
  const warnings: string[] = [];
  let resolvedUsername = parsed.username;
  let resolvedHostname = parsed.hostname;
  let port: string | undefined;

  try {
    const config = await runSshConfigLookup(parsed.hostname, parsed.username);
    resolvedUsername = config.user || resolvedUsername;
    resolvedHostname = config.hostname || resolvedHostname;
    port = config.port || undefined;
  } catch {
    warnings.push('Could not expand SSH config via `ssh -G`; using the parsed authority only.');
  }

  let ip: string | undefined;
  if (resolvedHostname) {
    if (net.isIP(resolvedHostname)) {
      ip = resolvedHostname;
    } else {
      try {
        const resolved = await lookup(resolvedHostname);
        ip = resolved.address;
      } catch {
        warnings.push('Could not resolve the SSH hostname to an IP address.');
      }
    }
  }

  const canonicalAuthority = parsed.userHost.includes('@')
    ? parsed.userHost
    : resolvedUsername
      ? `${resolvedUsername}@${parsed.hostname}`
      : parsed.userHost;

  return {
    success: true,
    requestedPath,
    normalizedPath,
    authority: parsed.userHost,
    host: parsed.hostname,
    username: parsed.username,
    resolvedUsername,
    resolvedHostname,
    ip,
    port,
    canonicalPath: `${canonicalAuthority}:${remotePath}`,
    isWindowsRemotePath: /^[a-zA-Z]:[\\/]/.test(remotePath),
    message: buildResolutionMessage({
      resolvedUsername,
      host: parsed.hostname,
      resolvedHostname,
      ip
    }),
    warnings
  };
}
