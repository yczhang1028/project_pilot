import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { writeStartupPerformance } from '../outputChannel';
import { resolveSshProjectRuntime } from '../sshProjectRuntime';
import type { ConfigStore, ProjectItem } from '../store';
import { buildRemoteSshUriFromTarget, parseRemoteSshAuthorityStrict } from '../sshPath';
import type { SshHost } from '../sshHosts';
import { formatPerformanceMessage, monotonicNow } from '../startupPerformance';
import { buildLocalScanPlan, buildRemoteScanPlan, getProvider } from './providerRegistry';
import { scanLocalMachine } from './localScanner';
import { scanRemoteMachine } from './remoteScanner';
import type {
  AgentAsset,
  AgentAssetBinding,
  AgentAssetStatus,
  AgentInventorySnapshot,
  AgentMachine,
  AgentMachineErrorKind,
  AgentMachineSummary,
  AgentScanProgress,
  MachineScanResult,
  ScanRoot
} from './types';

const LOCAL_MACHINE_ID = 'local';
const LOCAL_FRESH_MS = 5 * 60 * 1_000;
const REMOTE_FRESH_MS = 15 * 60 * 1_000;

export type AgentAssetsEvent =
  | { type: 'agentInventorySnapshot'; payload: AgentInventorySnapshot }
  | { type: 'agentScanProgress'; payload: AgentScanProgress }
  | { type: 'agentAssetOperationResult'; payload: { success: boolean; message: string } };

type EventSink = (event: AgentAssetsEvent) => void | PromiseLike<unknown>;

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function normalizePhysicalPath(value: string, caseInsensitive: boolean): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function machineIdForHost(hostId: string): string {
  return `ssh:${hostId}`;
}

function statusRank(status: AgentAssetStatus): number {
  switch (status) {
    case 'unreadable': return 4;
    case 'broken-link': return 3;
    case 'invalid': return 2;
    default: return 1;
  }
}

function emptySnapshot(): AgentInventorySnapshot {
  return {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    machines: [],
    assets: [],
    summaries: []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined
    || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

function isMcpDetails(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value.transport === 'stdio' || value.transport === 'http' || value.transport === 'sse' || value.transport === 'unknown')
    && isOptionalString(value.command)
    && isOptionalStringArray(value.args)
    && (value.argsTruncated === undefined || typeof value.argsTruncated === 'boolean')
    && isOptionalString(value.url)
    && isOptionalStringArray(value.envKeys)
    && isOptionalStringArray(value.headerKeys)
    && isOptionalString(value.authEnvKey)
    && (value.enabled === undefined || typeof value.enabled === 'boolean');
}

function isMachine(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.label === 'string'
    && (value.kind === 'local' || value.kind === 'ssh')
    && isOptionalString(value.hostId)
    && (value.isCurrent === undefined || typeof value.isCurrent === 'boolean');
}

function isBinding(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.key === 'string'
    && (value.providerId === 'codex' || value.providerId === 'claude' || value.providerId === 'cursor')
    && typeof value.providerLabel === 'string'
    && (value.scope === 'global' || value.scope === 'project')
    && (value.sourceKind === 'native' || value.sourceKind === 'shared')
    && isOptionalString(value.projectId)
    && isOptionalString(value.projectName);
}

function isAsset(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.physicalId === 'string'
    && typeof value.machineId === 'string'
    && (value.kind === 'skill' || value.kind === 'mcp' || value.kind === 'settings')
    && typeof value.name === 'string'
    && typeof value.path === 'string'
    && (value.status === 'ready' || value.status === 'invalid' || value.status === 'broken-link' || value.status === 'unreadable')
    && isOptionalString(value.description)
    && isOptionalString(value.realPath)
    && isOptionalString(value.modifiedAt)
    && (value.isSymlink === undefined || typeof value.isSymlink === 'boolean')
    && isOptionalString(value.statusMessage)
    && isOptionalString(value.entryKey)
    && (value.mcp === undefined || isMcpDetails(value.mcp))
    && Array.isArray(value.bindings)
    && value.bindings.every(isBinding);
}

function isSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.machineId === 'string'
    && (value.status === 'never' || value.status === 'fresh' || value.status === 'stale' || value.status === 'scanning' || value.status === 'error')
    && isOptionalString(value.scannedAt)
    && isOptionalString(value.attemptedAt)
    && Number.isSafeInteger(value.skillCount)
    && Number(value.skillCount) >= 0
    && (value.mcpCount === undefined || (Number.isSafeInteger(value.mcpCount) && Number(value.mcpCount) >= 0))
    && Number.isSafeInteger(value.settingsCount)
    && Number(value.settingsCount) >= 0
    && (
      value.errorKind === undefined
      || value.errorKind === 'connection'
      || value.errorKind === 'authentication'
      || value.errorKind === 'host-key'
      || value.errorKind === 'runtime'
      || value.errorKind === 'scan'
    )
    && Array.isArray(value.errors)
    && value.errors.every(error => typeof error === 'string');
}

function isSnapshot(value: unknown): value is AgentInventorySnapshot {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 2
    && typeof value.generatedAt === 'string'
    && Array.isArray(value.machines)
    && value.machines.every(isMachine)
    && Array.isArray(value.assets)
    && value.assets.every(isAsset)
    && Array.isArray(value.summaries)
    && value.summaries.every(isSummary);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500) || 'Unknown scan error.';
}

function classifyScanError(error: unknown): AgentMachineErrorKind {
  const message = safeErrorMessage(error);
  if (/remote host identification has changed|host key verification failed|offending .* key/i.test(message)) {
    return 'host-key';
  }
  if (/permission denied|publickey|authentication failed|no supported authentication methods/i.test(message)) {
    return 'authentication';
  }
  if (/timed out|connection refused|could not resolve hostname|name or service not known|no route to host|network is unreachable|connection reset|host is down|connection closed/i.test(message)) {
    return 'connection';
  }
  if (/command not found|python was not found|openSSH was not found|remote scanner exited/i.test(message)) {
    return 'runtime';
  }
  return 'scan';
}

function isDedicatedMcpPath(value: string): boolean {
  const name = path.basename(value.replace(/\\/g, '/')).toLowerCase();
  return name === 'mcp.json' || name === '.mcp.json';
}

function normalizeCachedSnapshot(snapshot: AgentInventorySnapshot): AgentInventorySnapshot {
  const assets = snapshot.assets.map(asset => (
    asset.kind === 'settings' && isDedicatedMcpPath(asset.path)
      ? { ...asset, kind: 'mcp' as const }
      : asset
  ));
  const summaries = snapshot.summaries.map(summary => {
    const machineAssets = assets.filter(asset => asset.machineId === summary.machineId);
    return {
      ...summary,
      skillCount: machineAssets.filter(asset => asset.kind === 'skill').length,
      mcpCount: machineAssets.filter(asset => asset.kind === 'mcp').length,
      settingsCount: machineAssets.filter(asset => asset.kind === 'settings').length
    };
  });
  return { ...snapshot, assets, summaries };
}

function getCurrentRemoteAuthority(): { hostname: string; username?: string; port?: number } | undefined {
  if (vscode.env.remoteName !== 'ssh-remote') return undefined;
  const uri = vscode.workspace.workspaceFile?.scheme === 'vscode-remote'
    ? vscode.workspace.workspaceFile
    : vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'vscode-remote')?.uri;
  if (!uri?.authority.startsWith('ssh-remote+')) return undefined;
  const parsed = parseRemoteSshAuthorityStrict(uri.authority.slice('ssh-remote+'.length));
  return 'authority' in parsed ? parsed.authority : undefined;
}

function projectCwd(project: ProjectItem | undefined): string | undefined {
  if (!project) return undefined;
  if (project.type === 'local') return project.path;
  if (project.type === 'workspace') return path.dirname(project.path);
  return undefined;
}

export class AgentAssetsService implements vscode.Disposable {
  private snapshot: AgentInventorySnapshot = emptySnapshot();
  private cacheDir!: vscode.Uri;
  private cacheUri!: vscode.Uri;
  private initPromise?: Promise<void>;
  private currentMachineId?: string;
  private readonly activeScans = new Map<string, AbortController>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ConfigStore
  ) {}

  init(): Promise<void> {
    if (!this.initPromise) {
      const startedAt = monotonicNow();
      this.initPromise = this.initialize().finally(() => {
        writeStartupPerformance(formatPerformanceMessage(
          'agent-assets',
          'Cache ready',
          monotonicNow() - startedAt
        ));
      });
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    this.cacheDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'agent-assets');
    this.cacheUri = vscode.Uri.joinPath(this.cacheDir, 'inventory-v2.json');
    await vscode.workspace.fs.createDirectory(this.cacheDir);
    try {
      const content = await vscode.workspace.fs.readFile(this.cacheUri);
      const parsed = JSON.parse(Buffer.from(content).toString('utf8')) as unknown;
      if (isSnapshot(parsed)) this.snapshot = normalizeCachedSnapshot(parsed);
    } catch {
      this.snapshot = emptySnapshot();
    }
    this.currentMachineId = this.resolveCurrentMachineId();
    this.refreshMachines();
  }

  private resolveCurrentMachineId(): string | undefined {
    if (!vscode.env.remoteName) return LOCAL_MACHINE_ID;
    const authority = getCurrentRemoteAuthority();
    if (!authority) return undefined;
    const candidates = this.store.state.sshHosts.filter(host =>
      host.hostname.trim().toLowerCase() === authority.hostname.trim().toLowerCase()
      || host.name.trim().toLowerCase() === authority.hostname.trim().toLowerCase()
    );
    const usernameMatches = authority.username
      ? candidates.filter(host => !host.username || host.username === authority.username)
      : candidates;
    const portMatches = authority.port
      ? usernameMatches.filter(host => !host.port || host.port === authority.port)
      : usernameMatches;
    const host = portMatches.length === 1 ? portMatches[0] : undefined;
    return host ? machineIdForHost(host.id) : undefined;
  }

  private getMachines(): AgentMachine[] {
    return [
      {
        id: LOCAL_MACHINE_ID,
        kind: 'local',
        label: `Local · ${os.hostname() || 'This machine'}`,
        ...(this.currentMachineId === LOCAL_MACHINE_ID ? { isCurrent: true } : {})
      },
      ...this.store.state.sshHosts.map(host => ({
        id: machineIdForHost(host.id),
        kind: 'ssh' as const,
        label: host.name,
        hostId: host.id,
        ...(this.currentMachineId === machineIdForHost(host.id) ? { isCurrent: true } : {})
      }))
    ];
  }

  private refreshMachines(): void {
    const machines = this.getMachines();
    const ids = new Set(machines.map(machine => machine.id));
    this.snapshot = {
      ...this.snapshot,
      machines,
      assets: this.snapshot.assets.filter(asset => ids.has(asset.machineId)),
      summaries: this.snapshot.summaries.filter(summary => ids.has(summary.machineId))
    };
  }

  getSnapshot(): AgentInventorySnapshot {
    this.refreshMachines();
    const now = Date.now();
    const summaries = this.snapshot.summaries.map(summary => {
      if (summary.status !== 'fresh' || !summary.scannedAt) return summary;
      const machine = this.snapshot.machines.find(candidate => candidate.id === summary.machineId);
      const freshness = machine?.kind === 'ssh' ? REMOTE_FRESH_MS : LOCAL_FRESH_MS;
      return now - Date.parse(summary.scannedAt) > freshness
        ? { ...summary, status: 'stale' as const }
        : summary;
    });
    const knownSummaries = new Set(summaries.map(summary => summary.machineId));
    for (const machine of this.snapshot.machines) {
      if (!knownSummaries.has(machine.id)) {
        summaries.push({
          machineId: machine.id,
          status: 'never',
          skillCount: 0,
          mcpCount: 0,
          settingsCount: 0,
          errors: []
        });
      }
    }
    return { ...this.snapshot, summaries };
  }

  private async persist(): Promise<void> {
    const temp = vscode.Uri.joinPath(this.cacheDir, `inventory-v2.${randomUUID()}.tmp`);
    const content = Buffer.from(JSON.stringify(this.snapshot, null, 2), 'utf8');
    try {
      await vscode.workspace.fs.writeFile(temp, content);
      await vscode.workspace.fs.rename(temp, this.cacheUri, { overwrite: true });
    } catch (error) {
      try { await vscode.workspace.fs.delete(temp); } catch { /* best effort */ }
      throw error;
    }
  }

  private emitSnapshot(sink: EventSink): void {
    void sink({ type: 'agentInventorySnapshot', payload: this.getSnapshot() });
  }

  private setSummary(summary: AgentMachineSummary): void {
    const summaries = this.snapshot.summaries.filter(item => item.machineId !== summary.machineId);
    summaries.push(summary);
    this.snapshot = { ...this.snapshot, summaries };
  }

  private resolveMachine(machineId: string): { machine: AgentMachine; host?: SshHost } | undefined {
    const machine = this.getMachines().find(candidate => candidate.id === machineId);
    if (!machine) return undefined;
    if (machine.kind === 'local') return { machine };
    const host = this.store.state.sshHosts.find(candidate => candidate.id === machine.hostId);
    return host ? { machine, host } : undefined;
  }

  private scanPlan(machine: AgentMachine, host?: SshHost): ScanRoot[] {
    return machine.kind === 'local'
      ? buildLocalScanPlan(this.store.state.projects)
      : buildRemoteScanPlan(host!, this.store.state.projects, this.store.state.sshHosts);
  }

  private materializeAssets(
    machineId: string,
    plan: readonly ScanRoot[],
    result: MachineScanResult
  ): AgentAsset[] {
    const roots = new Map(plan.map(root => [root.id, root]));
    const merged = new Map<string, AgentAsset>();
    for (const raw of result.assets) {
      const root = roots.get(raw.rootId);
      if (!root) continue;
      const physicalPath = normalizePhysicalPath(
        raw.realPath || raw.path,
        machineId === LOCAL_MACHINE_ID && process.platform === 'win32'
      );
      const entryKey = raw.entryKey?.trim();
      const physicalKey = `${machineId}:${raw.kind}:${physicalPath}:${entryKey ?? ''}`;
      const binding: AgentAssetBinding = {
        key: stableId(`${physicalKey}:${root.providerId}:${root.scope}:${root.projectId ?? ''}`),
        providerId: root.providerId,
        providerLabel: root.providerLabel,
        scope: root.scope,
        sourceKind: root.sourceKind,
        ...(root.projectId ? { projectId: root.projectId } : {}),
        ...(root.projectName ? { projectName: root.projectName } : {})
      };
      const existing = merged.get(physicalKey);
      if (existing) {
        if (!existing.bindings.some(item => item.key === binding.key)) existing.bindings.push(binding);
        if (statusRank(raw.status) > statusRank(existing.status)) {
          existing.status = raw.status;
          existing.statusMessage = raw.statusMessage;
        }
        if (!existing.mcp && raw.mcp) existing.mcp = raw.mcp;
        continue;
      }
      merged.set(physicalKey, {
        id: stableId(physicalKey),
        physicalId: stableId(`${machineId}:${raw.kind}:${physicalPath}:${entryKey ?? ''}`),
        machineId,
        kind: raw.kind,
        name: raw.name,
        ...(raw.description ? { description: raw.description } : {}),
        path: raw.path,
        ...(raw.realPath ? { realPath: raw.realPath } : {}),
        ...(raw.modifiedAt ? { modifiedAt: raw.modifiedAt } : {}),
        ...(raw.isSymlink !== undefined ? { isSymlink: raw.isSymlink } : {}),
        status: raw.status,
        ...(raw.statusMessage ? { statusMessage: raw.statusMessage } : {}),
        ...(entryKey ? { entryKey } : {}),
        ...(raw.mcp ? { mcp: raw.mcp } : {}),
        bindings: [binding]
      });
    }
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  }

  async scan(machineId: string, sink: EventSink): Promise<void> {
    await this.init();
    const resolved = this.resolveMachine(machineId);
    if (!resolved) {
      void sink({ type: 'agentAssetOperationResult', payload: { success: false, message: 'Scan target was not found.' } });
      return;
    }
    if (this.activeScans.has(machineId)) return;

    const controller = new AbortController();
    this.activeScans.set(machineId, controller);
    const scanId = randomUUID();
    const plan = this.scanPlan(resolved.machine, resolved.host);
    const previousSummary = this.getSnapshot().summaries.find(summary => summary.machineId === machineId);
    let completed = 0;
    this.setSummary({
      machineId,
      status: 'scanning',
      scannedAt: previousSummary?.scannedAt,
      attemptedAt: previousSummary?.attemptedAt,
      skillCount: previousSummary?.skillCount ?? 0,
      mcpCount: previousSummary?.mcpCount ?? 0,
      settingsCount: previousSummary?.settingsCount ?? 0,
      errors: []
    });
    this.emitSnapshot(sink);
    void sink({
      type: 'agentScanProgress',
      payload: {
        scanId,
        machineId,
        completed,
        total: plan.length,
        stage: resolved.machine.kind === 'ssh' ? 'connecting' : 'scanning',
        currentLabel: resolved.machine.kind === 'ssh' ? `Connecting to ${resolved.machine.label}` : plan[0]?.label
      }
    });

    try {
      const onRootComplete = (root: ScanRoot) => {
        completed += 1;
        void sink({
          type: 'agentScanProgress',
          payload: {
            scanId,
            machineId,
            completed,
            total: plan.length,
            stage: 'scanning',
            currentLabel: plan[completed]?.label ?? root.label
          }
        });
      };
      const result = resolved.machine.kind === 'local'
        ? await scanLocalMachine(plan, onRootComplete, controller.signal)
        : await scanRemoteMachine(resolved.host!, plan, onRootComplete, controller.signal);
      if (controller.signal.aborted) throw new Error('Scan cancelled');

      const machineAssets = this.materializeAssets(machineId, plan, result);
      const errors = result.roots
        .filter(root => root.status === 'error')
        .map(root => root.message || 'A scan root failed.')
        .slice(0, 20);
      const scannedAt = new Date().toISOString();
      this.snapshot = {
        ...this.snapshot,
        generatedAt: scannedAt,
        assets: [
          ...this.snapshot.assets.filter(asset => asset.machineId !== machineId),
          ...machineAssets
        ]
      };
      this.setSummary({
        machineId,
        status: errors.length > 0 ? 'error' : 'fresh',
        scannedAt,
        attemptedAt: scannedAt,
        skillCount: machineAssets.filter(asset => asset.kind === 'skill').length,
        mcpCount: machineAssets.filter(asset => asset.kind === 'mcp').length,
        settingsCount: machineAssets.filter(asset => asset.kind === 'settings').length,
        errors,
        ...(errors.length > 0 ? { errorKind: 'scan' as const } : {})
      });
      void sink({
        type: 'agentScanProgress',
        payload: { scanId, machineId, completed: plan.length, total: plan.length, stage: 'saving' }
      });
      await this.persist();
      this.emitSnapshot(sink);
      void sink({
        type: 'agentScanProgress',
        payload: { scanId, machineId, completed: plan.length, total: plan.length, stage: 'complete' }
      });
    } catch (error) {
      const cancelled = controller.signal.aborted || safeErrorMessage(error) === 'Scan cancelled';
      const attemptedAt = new Date().toISOString();
      this.setSummary({
        machineId,
        status: cancelled ? (previousSummary?.scannedAt ? 'stale' : 'never') : 'error',
        scannedAt: previousSummary?.scannedAt,
        attemptedAt: cancelled ? previousSummary?.attemptedAt : attemptedAt,
        skillCount: previousSummary?.skillCount ?? 0,
        mcpCount: previousSummary?.mcpCount ?? 0,
        settingsCount: previousSummary?.settingsCount ?? 0,
        errors: cancelled ? [] : [safeErrorMessage(error)],
        ...(!cancelled ? { errorKind: classifyScanError(error) } : {})
      });
      if (!cancelled) {
        this.snapshot = { ...this.snapshot, generatedAt: attemptedAt };
        try { await this.persist(); } catch { /* Keep the in-memory recovery state. */ }
      }
      this.emitSnapshot(sink);
      void sink({
        type: 'agentScanProgress',
        payload: {
          scanId,
          machineId,
          completed,
          total: plan.length,
          stage: cancelled ? 'cancelled' : 'error',
          ...(!cancelled ? { message: safeErrorMessage(error) } : {})
        }
      });
    } finally {
      this.activeScans.delete(machineId);
    }
  }

  cancel(machineId: string): void {
    this.activeScans.get(machineId)?.abort();
  }

  async openAsset(assetId: string): Promise<string> {
    await this.init();
    const asset = this.snapshot.assets.find(candidate => candidate.id === assetId);
    if (!asset) throw new Error('Agent asset was not found. Refresh the inventory and try again.');
    const targetPath = asset.kind === 'skill'
      ? `${asset.path.replace(/[\\/]$/, '')}/SKILL.md`
      : asset.path;
    let uri: vscode.Uri;
    let locationLabel: string;
    if (asset.machineId === LOCAL_MACHINE_ID) {
      const normalizedPath = path.normalize(targetPath);
      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`The file no longer exists: ${normalizedPath}`);
      }
      uri = vscode.Uri.file(normalizedPath);
      locationLabel = 'the local machine';
    } else {
      const machine = this.getMachines().find(candidate => candidate.id === asset.machineId);
      const host = this.store.state.sshHosts.find(candidate => candidate.id === machine?.hostId);
      if (!host) throw new Error('SSH Host was not found.');
      uri = vscode.Uri.parse(buildRemoteSshUriFromTarget(host, targetPath));
      locationLabel = host.name;
    }

    if (asset.machineId === this.currentMachineId) {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.One
      });
      return `Opened ${asset.name}.`;
    }

    await this.openInNewWindow(uri);
    return `Opening ${asset.name} from ${locationLabel} in a matching window.`;
  }

  private async openInNewWindow(uri: vscode.Uri): Promise<void> {
    const target = uri.scheme === 'file' ? uri.fsPath : uri.toString(true);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--new-window', target], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  async launch(assetId: string, bindingKey: string): Promise<string> {
    await this.init();
    const asset = this.snapshot.assets.find(candidate => candidate.id === assetId);
    const binding = asset?.bindings.find(candidate => candidate.key === bindingKey);
    if (!asset || !binding) throw new Error('Agent launch target was not found. Refresh the inventory and try again.');
    if (asset.machineId !== this.currentMachineId) {
      throw new Error('Open this machine in the current VS Code window before launching its Agent.');
    }
    const provider = getProvider(binding.providerId);
    if (asset.machineId === LOCAL_MACHINE_ID) {
      const project = binding.projectId
        ? this.store.state.projects.find(candidate => candidate.id === binding.projectId)
        : undefined;
      const requestedCwd = projectCwd(project);
      const cwd = requestedCwd && fs.existsSync(requestedCwd) ? requestedCwd : os.homedir();
      const terminal = vscode.window.createTerminal({ name: `Project Pilot · ${provider.label}`, cwd });
      terminal.show();
      terminal.sendText(provider.launchCommand, true);
      return `Launched ${provider.label}.`;
    }
    const project = binding.projectId
      ? this.store.state.projects.find(candidate => candidate.id === binding.projectId)
      : undefined;
    let cwd: string | undefined;
    if (project && (project.type === 'ssh' || project.type === 'ssh-workspace')) {
      const runtime = resolveSshProjectRuntime(project, this.store.state.sshHosts);
      cwd = project.type === 'ssh-workspace'
        ? path.posix.dirname(runtime.remotePath.replace(/\\/g, '/'))
        : runtime.remotePath;
    }
    const terminal = vscode.window.createTerminal({
      name: `Project Pilot · ${provider.label}`,
      ...(cwd ? { cwd } : {})
    });
    terminal.show();
    terminal.sendText(provider.launchCommand, true);
    return `Launched ${provider.label} in the current SSH window.`;
  }

  dispose(): void {
    for (const controller of this.activeScans.values()) controller.abort();
    this.activeScans.clear();
  }
}
