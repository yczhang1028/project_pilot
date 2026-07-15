export type ProjectType = 'local' | 'workspace' | 'ssh' | 'ssh-workspace';

export interface SshHost {
  id: string;
  name: string;
  hostname: string;
  username?: string;
  port?: number;
}

export interface ProjectItem {
  id?: string;
  name: string;
  path: string;
  description?: string;
  icon?: string;
  color?: string;
  tags?: string[];
  group?: string;
  type: ProjectType;
  isFavorite?: boolean;
  clickCount?: number;
  lastAccessed?: string;
  sshHostId?: string;
  remotePath?: string;
}

export interface UISettings {
  /** @deprecated Layout density is now defined by the selected Manager layout. */
  compactMode?: boolean;
  viewMode?: 'grid' | 'list' | 'mini';
  selectedGroup?: string;
  collapsedGroups?: string[];
  outlineMode?: 'group' | 'target' | 'host' | 'type' | 'flat';
}

export interface ConfigSettings {
  autoOpenFullscreen?: boolean;
  demoMode?: boolean;
}

export interface SshMigrationWarning {
  projectId?: string;
  projectName: string;
  message: string;
}

export interface State {
  schemaVersion?: number;
  projects: ProjectItem[];
  sshHosts: SshHost[];
  migrationWarnings: SshMigrationWarning[];
  uiSettings?: UISettings;
  config?: ConfigSettings;
}

export type SshHostOperation = 'add' | 'update' | 'delete' | 'migrate';

export interface SshHostOperationResult {
  success: boolean;
  operation: SshHostOperation;
  message?: string;
  requestId?: string;
  hostId?: string;
  targetHostId?: string;
}

export type SshProbeCode =
  | 'ok'
  | 'ssh-not-found'
  | 'dns'
  | 'timeout'
  | 'host-key'
  | 'auth'
  | 'remote-command';

export interface SshHostTestResult {
  success: boolean;
  code: SshProbeCode;
  message: string;
  requestId?: string;
  hostId?: string;
  resolution?: {
    host?: string;
    resolvedHostname?: string;
    ip?: string;
    resolvedUsername?: string;
    port?: string;
    warnings?: string[];
  };
}

export interface SshHostDraft {
  name: string;
  hostname: string;
  username: string;
  port: string;
}

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

export interface AgentAssetOperationResult {
  success: boolean;
  message: string;
}
