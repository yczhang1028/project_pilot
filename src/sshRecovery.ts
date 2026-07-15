import * as path from 'path';
import * as vscode from 'vscode';
import type { ConfigStore } from './store';
import type { SshHost } from './sshHosts';

export type SshRecoveryAction = 'key-login' | 'known-host';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizedHostname(hostname: string): string {
  const trimmed = hostname.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
}

function sshTarget(host: SshHost): string {
  const hostname = normalizedHostname(host.hostname);
  const formattedHost = hostname.includes(':') ? `[${hostname}]` : hostname;
  return host.username?.trim() ? `${host.username.trim()}@${formattedHost}` : formattedHost;
}

function knownHostTarget(host: SshHost): string {
  const hostname = normalizedHostname(host.hostname);
  return host.port && host.port !== 22 ? `[${hostname}]:${host.port}` : hostname;
}

export function buildSshRecoveryCommand(
  host: SshHost,
  action: SshRecoveryAction,
  platform: NodeJS.Platform = process.platform
): string {
  if (action === 'known-host') {
    const target = knownHostTarget(host);
    return platform === 'win32'
      ? `ssh-keygen -R ${powershellQuote(target)}`
      : `ssh-keygen -R ${shellQuote(target)}`;
  }

  const target = sshTarget(host);
  const portArgs = host.port ? ` -p ${host.port}` : '';
  if (platform === 'win32') {
    return [
      `$key = Join-Path $env:USERPROFILE '.ssh\\id_ed25519'`,
      `if (-not (Test-Path ($key + '.pub'))) { ssh-keygen -t ed25519 -f $key }`,
      `Get-Content ($key + '.pub') | ssh${portArgs} ${powershellQuote(target)} "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; cat >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys"`
    ].join('; ');
  }
  return [
    `test -f "$HOME/.ssh/id_ed25519.pub" || ssh-keygen -t ed25519 -f "$HOME/.ssh/id_ed25519"`,
    `ssh-copy-id -i "$HOME/.ssh/id_ed25519.pub"${portArgs} ${shellQuote(target)}`
  ].join('; ');
}

async function prepareSshRecovery(host: SshHost, action: SshRecoveryAction): Promise<void> {
  if (action === 'known-host') {
    const choice = await vscode.window.showWarningMessage(
      `Remove the saved host key for ${host.name}?`,
      {
        modal: true,
        detail: 'A changed host key can indicate a rebuilt server, but it can also indicate interception. Verify the new fingerprint with the server owner before reconnecting.'
      },
      'Prepare command'
    );
    if (choice !== 'Prepare command') return;
  }

  const command = buildSshRecoveryCommand(host, action);
  const terminal = process.platform === 'win32'
    ? vscode.window.createTerminal({
      name: `Project Pilot · ${host.name}`,
      shellPath: path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      )
    })
    : vscode.window.createTerminal({ name: `Project Pilot · ${host.name}` });
  terminal.show();
  terminal.sendText(command, false);
  await vscode.env.clipboard.writeText(command);
  vscode.window.showInformationMessage(
    action === 'known-host'
      ? 'known_hosts repair command is prefilled and copied. Verify the new fingerprint before reconnecting.'
      : 'Key-login command is prefilled and copied. Review it, press Enter, and provide the remote password once.'
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export async function handleSshRecoveryMessage(
  message: unknown,
  store: Pick<ConfigStore, 'state'>
): Promise<boolean> {
  const record = asRecord(message);
  if (record?.type !== 'prepareSshRecovery') return false;
  const payload = asRecord(record.payload);
  const hostId = typeof payload?.hostId === 'string' ? payload.hostId : undefined;
  const action = payload?.action === 'key-login' || payload?.action === 'known-host'
    ? payload.action
    : undefined;
  if (!hostId || !action) {
    vscode.window.showErrorMessage('Invalid SSH recovery request.');
    return true;
  }
  const host = store.state.sshHosts.find(candidate => candidate.id === hostId);
  if (!host) {
    vscode.window.showErrorMessage('SSH Host was not found.');
    return true;
  }
  await prepareSshRecovery(host, action);
  return true;
}
