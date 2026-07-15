export type AgentProviderId = 'codex' | 'claude' | 'cursor';

export type AgentAssetKind = 'skill' | 'mcp' | 'settings';
export type AgentAssetScope = 'global' | 'project';
export type AgentAssetStatus = 'ready' | 'invalid' | 'broken-link' | 'unreadable';
export type AgentMachineStatus = 'never' | 'fresh' | 'stale' | 'scanning' | 'error';
export type AgentMachineErrorKind = 'connection' | 'authentication' | 'host-key' | 'runtime' | 'scan';

export interface McpServerDetails {
  transport: 'stdio' | 'http' | 'sse' | 'unknown';
  command?: string;
  args?: string[];
  argsTruncated?: boolean;
  url?: string;
  envKeys?: string[];
  headerKeys?: string[];
  authEnvKey?: string;
  enabled?: boolean;
}

export interface AgentMachine {
  id: string;
  kind: 'local' | 'ssh';
  label: string;
  hostId?: string;
  isCurrent?: boolean;
}

export interface AgentAssetBinding {
  key: string;
  providerId: AgentProviderId;
  providerLabel: string;
  scope: AgentAssetScope;
  projectId?: string;
  projectName?: string;
  sourceKind: 'native' | 'shared';
}

export interface AgentAsset {
  id: string;
  physicalId: string;
  machineId: string;
  kind: AgentAssetKind;
  name: string;
  description?: string;
  path: string;
  realPath?: string;
  modifiedAt?: string;
  isSymlink?: boolean;
  status: AgentAssetStatus;
  statusMessage?: string;
  entryKey?: string;
  mcp?: McpServerDetails;
  bindings: AgentAssetBinding[];
}

export interface AgentMachineSummary {
  machineId: string;
  status: AgentMachineStatus;
  scannedAt?: string;
  attemptedAt?: string;
  skillCount: number;
  mcpCount?: number;
  settingsCount: number;
  errors: string[];
  errorKind?: AgentMachineErrorKind;
}

export interface AgentInventorySnapshot {
  schemaVersion: 2;
  generatedAt: string;
  machines: AgentMachine[];
  assets: AgentAsset[];
  summaries: AgentMachineSummary[];
}

export interface AgentScanProgress {
  scanId: string;
  machineId: string;
  completed: number;
  total: number;
  stage: 'connecting' | 'scanning' | 'saving' | 'complete' | 'cancelled' | 'error';
  currentLabel?: string;
  message?: string;
}

export interface ScanRoot {
  id: string;
  kind: AgentAssetKind;
  providerId: AgentProviderId;
  providerLabel: string;
  scope: AgentAssetScope;
  sourceKind: 'native' | 'shared';
  base: 'home' | 'appData' | 'absolute';
  path: string;
  label: string;
  projectId?: string;
  projectName?: string;
}

export interface RawScannedAsset {
  rootId: string;
  kind: AgentAssetKind;
  name: string;
  description?: string;
  path: string;
  realPath?: string;
  modifiedAt?: string;
  isSymlink?: boolean;
  status: AgentAssetStatus;
  statusMessage?: string;
  entryKey?: string;
  mcp?: McpServerDetails;
}

export interface RootScanResult {
  rootId: string;
  status: 'complete' | 'missing' | 'error';
  message?: string;
}

export interface MachineScanResult {
  assets: RawScannedAsset[];
  roots: RootScanResult[];
}
