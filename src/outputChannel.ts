import * as vscode from 'vscode';

export type ProjectPilotLogLevel = 'INFO' | 'WARN' | 'ERROR';

let outputChannel: vscode.OutputChannel | undefined;

export function initializeProjectPilotOutput(
  context: Pick<vscode.ExtensionContext, 'subscriptions'>
): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Project Pilot');
    context.subscriptions.push(outputChannel);
  }
  return outputChannel;
}

export function writeProjectPilotOutput(
  level: ProjectPilotLogLevel,
  message: string,
  now: Date = new Date()
): void {
  outputChannel?.appendLine(`[${now.toISOString()}] [${level}] ${message}`);
}

export function writeStartupPerformance(message: string): void {
  writeProjectPilotOutput('INFO', message);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function logSshHostResult(result: unknown, now: Date = new Date()): void {
  const envelope = asRecord(result);
  const payload = asRecord(envelope?.payload);
  if (!envelope || !payload) {
    return;
  }

  const success = payload.success === true;
  const level: ProjectPilotLogLevel = success ? 'INFO' : 'WARN';
  const hostId = typeof payload.hostId === 'string' && payload.hostId ? ` [${payload.hostId}]` : '';
  if (envelope.type === 'sshHostTestResult') {
    const code = typeof payload.code === 'string' ? ` (${payload.code})` : '';
    const message = typeof payload.message === 'string' ? payload.message : success ? 'succeeded' : 'failed';
    writeProjectPilotOutput(level, `SSH Host test${hostId}${code}: ${message}`, now);
    return;
  }

  if (envelope.type === 'sshHostOperationResult') {
    const operation = typeof payload.operation === 'string' ? payload.operation : 'operation';
    const message = typeof payload.message === 'string' && payload.message
      ? `: ${payload.message}`
      : success ? ' completed' : ' failed';
    writeProjectPilotOutput(level, `SSH Host ${operation}${hostId}${message}`, now);
  }
}

export function logSshConnectionResult(label: string, result: unknown, now: Date = new Date()): void {
  const payload = asRecord(result);
  if (!payload) {
    return;
  }
  const success = payload.success === true;
  const message = typeof payload.message === 'string'
    ? payload.message
    : success ? 'succeeded' : 'failed';
  writeProjectPilotOutput(
    success ? 'INFO' : 'WARN',
    `SSH connection test [${label || 'project'}]: ${message}`,
    now
  );
}
