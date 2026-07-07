import { execFile } from 'child_process';
import { lookup } from 'dns/promises';
import * as fs from 'fs';
import * as net from 'net';
import { userInfo } from 'os';
import { promisify } from 'util';
import type { SshHost } from './sshHosts';
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

export type SshProbeCode = 'ok' | 'ssh-not-found' | 'dns' | 'timeout' | 'host-key' | 'auth' | 'remote-command';

export interface SshProbeResult {
  success: boolean;
  code: SshProbeCode;
  message: string;
  resolution?: SshResolutionResult;
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

function getLocalUsername(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

function getExplicitResolvedUsername(configUser: string | undefined, parsedUsername: string | undefined): string | undefined {
  if (parsedUsername) {
    return parsedUsername;
  }

  if (!configUser) {
    return undefined;
  }

  return configUser === getLocalUsername() ? undefined : configUser;
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
    resolvedUsername = getExplicitResolvedUsername(config.user, parsed.username);
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

function getProbeValidationError(host: SshHost): string | undefined {
  if (!host.hostname?.trim()) {
    return 'SSH Host hostname is required.';
  }

  if (
    host.port !== undefined
    && (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535)
  ) {
    return 'SSH port must be an integer between 1 and 65535.';
  }

  return undefined;
}

function getUsefulErrorMessage(error: any): string {
  const rawMessage = [error?.stderr, error?.message]
    .find(value => typeof value === 'string' && value.trim()) ?? 'The SSH command failed.';

  return rawMessage
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function classifyProbeFailure(error: any, allCandidatesMissing: boolean): Exclude<SshProbeCode, 'ok'> {
  if (allCandidatesMissing) {
    return 'ssh-not-found';
  }

  const details = getUsefulErrorMessage(error);
  if (error?.killed || error?.code === 'ETIMEDOUT' || /timed? out|timeout/i.test(details)) {
    return 'timeout';
  }
  if (/could not resolve hostname|name or service not known|no such host/i.test(details)) {
    return 'dns';
  }
  if (/host key verification failed|remote host identification (?:has )?changed/i.test(details)) {
    return 'host-key';
  }
  if (/permission denied|authentication failed/i.test(details)) {
    return 'auth';
  }
  return 'remote-command';
}

function buildProbeFailureMessage(hostName: string, code: Exclude<SshProbeCode, 'ok'>, error: any): string {
  const prefix = `SSH Host "${hostName}"`;
  const details = getUsefulErrorMessage(error);

  switch (code) {
    case 'ssh-not-found':
      return `${prefix} could not be tested because OpenSSH was not found.`;
    case 'timeout':
      return `${prefix} connection timed out.`;
    case 'dns':
      return `${prefix} hostname could not be resolved. ${details}`;
    case 'host-key':
      return `${prefix} failed host-key verification. ${details}`;
    case 'auth':
      return `${prefix} authentication failed. Password-only Hosts cannot pass this non-interactive BatchMode probe.`;
    case 'remote-command':
      return `${prefix} connection probe failed. ${details}`;
  }
}

export async function testSshHostConnection(host: SshHost): Promise<SshProbeResult> {
  const validationError = getProbeValidationError(host);
  const hostName = host.name?.trim() || host.hostname?.trim() || 'Unnamed';
  if (validationError) {
    return {
      success: false,
      code: 'remote-command',
      message: `SSH Host "${hostName}" is invalid. ${validationError}`
    };
  }

  const hostname = host.hostname.trim();
  const username = host.username?.trim();
  const target = username ? `${username}@${hostname}` : hostname;
  let resolution: SshResolutionResult | undefined;
  try {
    resolution = await resolveSshTarget(`${target}:/`);
  } catch {
    // A failed informational resolution must not replace the real SSH probe result.
  }

  const args = [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5'
  ];
  if (host.port !== undefined) {
    args.push('-p', String(host.port));
  }
  args.push(target, 'exit');

  let lastError: any;
  let missingCandidateCount = 0;
  const candidates = getSshCommandCandidates();
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, args, {
        timeout: 10_000,
        windowsHide: true
      });
      return {
        success: true,
        code: 'ok',
        message: `SSH Host "${hostName}" connection succeeded.`,
        ...(resolution ? { resolution } : {})
      };
    } catch (error: any) {
      lastError = error;
      if (error?.code !== 'ENOENT') {
        break;
      }
      missingCandidateCount += 1;
    }
  }

  const code = classifyProbeFailure(lastError, missingCandidateCount === candidates.length);
  return {
    success: false,
    code,
    message: buildProbeFailureMessage(hostName, code, lastError),
    ...(resolution ? { resolution } : {})
  };
}
