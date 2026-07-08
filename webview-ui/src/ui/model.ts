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
  outlineMode?: 'group' | 'target' | 'host' | 'type' | 'flat';
}

export interface ConfigSettings {
  autoOpenFullscreen?: boolean;
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
