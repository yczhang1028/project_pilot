import { execFile } from 'child_process';
import { lookup } from 'dns/promises';
import * as fs from 'fs';
import * as net from 'net';
import { userInfo } from 'os';
import { promisify } from 'util';
import type { SshHost } from './sshHosts';
import {
  buildRemoteSshUriFromTarget,
  getRawSshPathFromRemoteUri,
  normalizeRemoteSshPath,
  parseRawSshPath
} from './sshPath';

const execFileAsync = promisify(execFile);
const WINDOWS_SSH_PATH = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
const INFORMATIONAL_RESOLUTION_TIMEOUT_MS = 1_000;
const ASCII_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

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

interface ChildProcessFailure {
  message: string;
  code?: string | number;
  killed: boolean;
  stdout: string;
  stderr: string;
}

function outputText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return '';
}

function normalizeChildProcessFailure(error: unknown): ChildProcessFailure {
  const properties = typeof error === 'object' && error !== null
    ? error as Record<string, unknown>
    : undefined;
  const code = properties?.code;

  return {
    message: error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'The SSH command failed.',
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    killed: properties?.killed === true,
    stdout: outputText(properties?.stdout),
    stderr: outputText(properties?.stderr)
  };
}

async function runSshConfigLookup(host: string, username?: string): Promise<Record<string, string>> {
  const args = ['-G'];
  if (username) {
    args.push('-l', username);
  }
  args.push('--', host);

  let lastError: ChildProcessFailure | undefined;

  for (const candidate of getSshCommandCandidates()) {
    try {
      const { stdout } = await execFileAsync(candidate, args, {
        timeout: 4000,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      });
      return parseSshConfig(stdout);
    } catch (error: unknown) {
      const failure = normalizeChildProcessFailure(error);
      if (failure.stdout.trim()) {
        return parseSshConfig(failure.stdout);
      }

      lastError = failure;

      if (failure.code !== 'ENOENT') {
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

  if (ASCII_CONTROL_CHARACTERS.test(host.hostname)) {
    return 'SSH Host hostname cannot contain control characters.';
  }

  if (host.username !== undefined && ASCII_CONTROL_CHARACTERS.test(host.username)) {
    return 'SSH Host username cannot contain control characters.';
  }

  if (
    host.port !== undefined
    && (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535)
  ) {
    return 'SSH port must be an integer between 1 and 65535.';
  }

  return undefined;
}

function getSafeHostName(host: SshHost): string {
  const displayName = host.name?.trim() || host.hostname?.trim() || 'Unnamed';
  return displayName
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Unnamed';
}

function classifyProbeFailure(
  error: ChildProcessFailure,
  allCandidatesMissing: boolean
): Exclude<SshProbeCode, 'ok'> {
  if (allCandidatesMissing) {
    return 'ssh-not-found';
  }

  const diagnosticText = `${error.stderr}\n${error.message}`;
  if (error.killed || error.code === 'ETIMEDOUT' || /timed? out|timeout/i.test(diagnosticText)) {
    return 'timeout';
  }
  if (/could not resolve hostname|name or service not known|no such host/i.test(diagnosticText)) {
    return 'dns';
  }
  if (/host key verification failed|remote host identification (?:has )?changed/i.test(diagnosticText)) {
    return 'host-key';
  }
  if (
    /permission denied|authentication failed|no supported authentication methods|too many authentication failures/i
      .test(diagnosticText)
  ) {
    return 'auth';
  }
  return 'remote-command';
}

function buildProbeFailureMessage(hostName: string, code: Exclude<SshProbeCode, 'ok'>): string {
  const prefix = `SSH Host "${hostName}"`;

  switch (code) {
    case 'ssh-not-found':
      return `${prefix} could not be tested because OpenSSH was not found.`;
    case 'timeout':
      return `${prefix} connection timed out.`;
    case 'dns':
      return `${prefix} hostname could not be resolved.`;
    case 'host-key':
      return `${prefix} failed host-key verification. Review the saved host key before retrying.`;
    case 'auth':
      return `${prefix} authentication failed. Password-only Hosts cannot pass this non-interactive BatchMode probe.`;
    case 'remote-command':
      return `${prefix} transport and authentication may have succeeded, but the remote command failed or is restricted.`;
  }
}

function resolveSshTargetWithinDeadline(input: string): Promise<SshResolutionResult | undefined> {
  const resolution: Promise<SshResolutionResult | undefined> = resolveSshTarget(input)
    .catch(() => undefined);
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<undefined>(resolve => {
    timeout = setTimeout(() => resolve(undefined), INFORMATIONAL_RESOLUTION_TIMEOUT_MS);
  });

  return Promise.race([resolution, deadline]).finally(() => clearTimeout(timeout));
}

type ProbeCommandResult =
  | { success: true }
  | {
    success: false;
    error: ChildProcessFailure;
    allCandidatesMissing: boolean;
  };

async function runSshProbe(args: string[]): Promise<ProbeCommandResult> {
  let lastError: ChildProcessFailure | undefined;
  let missingCandidateCount = 0;
  const candidates = getSshCommandCandidates();
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, args, {
        timeout: 10_000,
        windowsHide: true
      });
      return { success: true };
    } catch (error: unknown) {
      const failure = normalizeChildProcessFailure(error);
      lastError = failure;
      if (failure.code !== 'ENOENT') {
        break;
      }
      missingCandidateCount += 1;
    }
  }

  return {
    success: false,
    error: lastError ?? normalizeChildProcessFailure(new Error('The SSH command failed.')),
    allCandidatesMissing: missingCandidateCount === candidates.length
  };
}

export async function testSshHostConnection(host: SshHost): Promise<SshProbeResult> {
  const validationError = getProbeValidationError(host);
  const hostName = getSafeHostName(host);
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
  const resolutionInput = buildRemoteSshUriFromTarget({
    hostname,
    ...(username ? { username } : {}),
    ...(host.port !== undefined ? { port: host.port } : {})
  }, '/');
  const resolutionPromise = resolveSshTargetWithinDeadline(resolutionInput);

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
  args.push('--', target, 'exit');

  const [probe, resolution] = await Promise.all([
    runSshProbe(args),
    resolutionPromise
  ]);
  if (probe.success) {
    return {
      success: true,
      code: 'ok',
      message: `SSH Host "${hostName}" connection succeeded.`,
      ...(resolution ? { resolution } : {})
    };
  }

  const code = classifyProbeFailure(probe.error, probe.allCandidatesMissing);
  return {
    success: false,
    code,
    message: buildProbeFailureMessage(hostName, code),
    ...(resolution ? { resolution } : {})
  };
}
