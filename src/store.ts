import * as vscode from 'vscode';
import {
  materializeManagedProject,
  migrateSshState,
  resolveManagedSshProject,
  validateSshHost,
  type SshHost,
  type SshMigrationWarning,
  type SshStateLike
} from './sshHosts';

export type ProjectType = 'local' | 'workspace' | 'ssh' | 'ssh-workspace';

export interface ProjectItem {
  id?: string;
  name: string;
  path: string;
  description?: string;
  icon?: string; // base64 data URL
  color?: string;
  tags?: string[];
  group?: string; // 项目分组
  type: ProjectType;
  isFavorite?: boolean; // 是否收藏
  clickCount?: number; // 点击次数
  lastAccessed?: string; // 最后访问时间
  sshHostId?: string;
  remotePath?: string;
}

export interface UISettings {
  compactMode?: boolean;
  viewMode?: 'grid' | 'list' | 'mini';
  selectedGroup?: string;
  outlineMode?: 'group' | 'host' | 'type' | 'flat';
}

type UISettingsUpdate = Omit<Partial<UISettings>, 'outlineMode'> & {
  outlineMode?: UISettings['outlineMode'] | 'target';
};

export interface State {
  schemaVersion: 2;
  sshHosts: SshHost[];
  projects: ProjectItem[];
  uiSettings?: UISettings;
}

export class ConfigStore {
  private _state: State = { schemaVersion: 2, sshHosts: [], projects: [] };
  private _migrationWarnings: SshMigrationWarning[] = [];
  private fileUri!: vscode.Uri;
  private fileWatcher?: vscode.FileSystemWatcher;
  private onChangeCallback?: () => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get state() { return this._state; }

  get migrationWarnings(): readonly SshMigrationWarning[] {
    return this._migrationWarnings;
  }
  
  get uiSettings(): UISettings {
    return this._state.uiSettings || {
      compactMode: false,
      viewMode: 'grid',
      selectedGroup: ''
    };
  }

  setOnChangeCallback(callback: () => void) {
    this.onChangeCallback = callback;
  }

  private normalizeIncomingState(incoming: unknown): {
    state: State;
    warnings: SshMigrationWarning[];
    changed: boolean;
  } {
    if (!incoming || typeof incoming !== 'object' || !Array.isArray((incoming as { projects?: unknown }).projects)) {
      throw new Error('Invalid config state: projects must be an array');
    }

    const migration = migrateSshState(incoming as SshStateLike);
    const sshHosts: SshHost[] = [];
    for (const host of migration.state.sshHosts) {
      sshHosts.push(validateSshHost(host, sshHosts));
    }

    const projects = migration.state.projects.map(project => {
      const isSshProject = project.type === 'ssh' || project.type === 'ssh-workspace';
      const hasManagedFields = project.sshHostId !== undefined || project.remotePath !== undefined;
      if (!isSshProject || !hasManagedFields) {
        return project;
      }
      if (typeof project.sshHostId !== 'string' || !project.sshHostId.trim()) {
        throw new Error(`Managed SSH project "${project.name}" must reference an SSH Host`);
      }
      if (typeof project.remotePath !== 'string' || !project.remotePath.trim()) {
        throw new Error('SSH project remote path cannot be empty');
      }

      // The resolver validates the Host reference and path before materialization.
      resolveManagedSshProject(project, sshHosts);
      return materializeManagedProject(project, sshHosts) as ProjectItem;
    });

    const outlineMode = migration.state.uiSettings?.outlineMode;
    if (outlineMode !== undefined && !['group', 'host', 'type', 'flat'].includes(outlineMode)) {
      throw new Error(`Invalid outline mode "${outlineMode}"`);
    }
    const uiSettings = migration.state.uiSettings as UISettings | undefined;
    const state: State = {
      schemaVersion: 2,
      sshHosts,
      projects,
      ...(uiSettings ? { uiSettings } : {})
    };

    return {
      state,
      warnings: migration.warnings,
      changed: migration.changed || JSON.stringify(state) !== JSON.stringify(migration.state)
    };
  }

  private async applyIncomingState(
    incoming: unknown,
    options: { persist: 'always' | 'if-changed' | 'never'; notify?: boolean }
  ): Promise<void> {
    const normalized = this.normalizeIncomingState(incoming);
    const previousState = this._state;
    const previousWarnings = this._migrationWarnings;
    this._state = normalized.state;
    this._migrationWarnings = normalized.warnings;

    try {
      if (options.persist === 'always' || (options.persist === 'if-changed' && normalized.changed)) {
        await this.save();
      }
    } catch (error) {
      this._state = previousState;
      this._migrationWarnings = previousWarnings;
      throw error;
    }

    if (options.notify) {
      this.onChangeCallback?.();
    }
  }

  private async mutate(mutator: (draft: State) => void): Promise<void> {
    const previousState = this._state;
    const previousWarnings = this._migrationWarnings;
    const draft = cloneState(this._state);
    mutator(draft);
    const normalized = this.normalizeIncomingState(draft);

    this._state = normalized.state;
    this._migrationWarnings = normalized.warnings;
    try {
      await this.save();
    } catch (error) {
      this._state = previousState;
      this._migrationWarnings = previousWarnings;
      throw error;
    }

    this.onChangeCallback?.();
  }

  async init() {
    // 确保配置存储在本地 - 即使连接到远程机器，项目配置也始终在本地管理
    console.log('Project Pilot: Initializing local configuration storage...');
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, 'data');
    await vscode.workspace.fs.createDirectory(dir);
    this.fileUri = vscode.Uri.joinPath(dir, 'projects.json');
    console.log('Project Pilot: Configuration will be stored at:', this.fileUri.fsPath);
    
    let buf: Uint8Array | undefined;
    try {
      buf = await vscode.workspace.fs.readFile(this.fileUri);
    } catch {
      // 如果配置文件不存在，创建一个示例项目
      this._state = {
        schemaVersion: 2,
        sshHosts: [],
        projects: [
          {
            id: 'welcome-demo',
            name: 'Welcome to Project Pilot',
            path: 'This is a demo project - you can delete it anytime',
            description: 'This is a sample project to show you how Project Pilot works. You can add your own projects using the commands or buttons in the interface.',
            type: 'local' as const,
            color: '#3b82f6',
            tags: ['demo', 'welcome'],
            group: 'Getting Started',
            icon: ''
          }
        ],
        uiSettings: {
          compactMode: false,
          viewMode: 'grid',
          selectedGroup: '',
          outlineMode: 'group'
        }
      };
      await this.save();
    }

    if (buf) {
      const incoming = JSON.parse(Buffer.from(buf).toString('utf8')) as unknown;
      await this.applyIncomingState(incoming, { persist: 'if-changed' });
    }
    
    // 设置文件监听器
    this.setupFileWatcher();
  }
  
  private setupFileWatcher() {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.fileUri, '*'),
      false, // 不忽略创建事件
      false, // 不忽略修改事件
      true   // 忽略删除事件
    );
    
    this.fileWatcher.onDidChange(async () => {
      console.log('Project Pilot: Configuration file changed, reloading...');
      try {
        const buf = await vscode.workspace.fs.readFile(this.fileUri);
        const incoming = JSON.parse(Buffer.from(buf).toString('utf8')) as unknown;
        await this.applyIncomingState(incoming, { persist: 'if-changed', notify: true });
        vscode.window.showInformationMessage('Project Pilot configuration reloaded');
      } catch (error) {
        console.error('Project Pilot: Failed to reload configuration:', error);
        vscode.window.showWarningMessage('Failed to reload Project Pilot configuration. Please check the JSON syntax.');
      }
    });
  }
  
  dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
  }
  
  // 手动重新加载配置
  async reload() {
    console.log('Project Pilot: Manually reloading configuration...');
    try {
      const buf = await vscode.workspace.fs.readFile(this.fileUri);
      const incoming = JSON.parse(Buffer.from(buf).toString('utf8')) as unknown;
      await this.applyIncomingState(incoming, { persist: 'if-changed', notify: true });
    } catch (error) {
      console.error('Project Pilot: Failed to reload configuration:', error);
      throw error;
    }
  }

  async save() {
    const data = Buffer.from(JSON.stringify(this._state, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(this.fileUri, data);
  }

  async addProject(p: ProjectItem) {
    p.id = p.id ?? genId();
    await this.mutate(state => {
      state.projects.push({ ...p });
    });
  }

  async upsertProject(p: ProjectItem) {
    if (!p.id) p.id = genId();
    await this.mutate(state => {
      const idx = state.projects.findIndex(x => x.id === p.id);
      if (idx >= 0) state.projects[idx] = { ...p }; else state.projects.push({ ...p });
    });
  }

  async deleteProject(id: string) {
    await this.mutate(state => {
      state.projects = state.projects.filter(p => p.id !== id);
    });
  }

  async recordProjectAccess(id: string) {
    if (!this._state.projects.some(project => project.id === id)) return;
    await this.mutate(state => {
      const project = state.projects.find(candidate => candidate.id === id)!;
      project.clickCount = (project.clickCount || 0) + 1;
      project.lastAccessed = new Date().toISOString();
    });
  }

  async toggleFavorite(id: string) {
    if (!this._state.projects.some(project => project.id === id)) return;
    await this.mutate(state => {
      const project = state.projects.find(candidate => candidate.id === id)!;
      project.isFavorite = !project.isFavorite;
      
      // 收藏功能完全独立于分组系统
      if (project.isFavorite) {
        // 只添加favorite标签，不改变分组
        if (!project.tags) {
          project.tags = [];
        }
        if (!project.tags.includes('favorite')) {
          project.tags.push('favorite');
        }
      } else {
        // 取消收藏时，只移除favorite标签
        if (project.tags) {
          project.tags = project.tags.filter(tag => tag !== 'favorite');
        }
      }
      
    });
  }

  async updateUISettings(settings: UISettingsUpdate) {
    const normalizedSettings: Partial<UISettings> = settings.outlineMode === 'target'
      ? { ...settings, outlineMode: 'host' }
      : settings as Partial<UISettings>;
    await this.mutate(state => {
      if (!state.uiSettings) {
        state.uiSettings = {
          compactMode: false,
          viewMode: 'grid',
          selectedGroup: '',
          outlineMode: 'group'
        };
      }

      state.uiSettings = {
        ...state.uiSettings,
        ...normalizedSettings
      };
    });
  }

  async addSshHost(host: SshHost): Promise<void> {
    await this.mutate(state => {
      state.sshHosts.push(validateSshHost(host, state.sshHosts));
    });
  }

  async updateSshHost(host: SshHost): Promise<void> {
    await this.mutate(state => {
      const index = state.sshHosts.findIndex(candidate => candidate.id === host.id);
      if (index < 0) {
        throw new Error(`SSH Host ${host.id} was not found`);
      }
      state.sshHosts[index] = validateSshHost(host, state.sshHosts, state.sshHosts[index].id);
    });
  }

  async deleteSshHost(id: string): Promise<void> {
    await this.mutate(state => {
      const index = state.sshHosts.findIndex(host => host.id === id);
      if (index < 0) {
        throw new Error(`SSH Host ${id} was not found`);
      }
      const linked = state.projects.filter(project => project.sshHostId === id);
      if (linked.length > 0) {
        throw new Error(`SSH Host ${id} is used by projects: ${linked.map(project => project.name).join(', ')}`);
      }
      state.sshHosts.splice(index, 1);
    });
  }

  async migrateSshHostProjects(sourceId: string, targetId: string, projectIds?: string[]): Promise<void> {
    await this.mutate(state => {
      if (sourceId === targetId) {
        throw new Error('Source and target SSH Hosts must be different');
      }
      if (!state.sshHosts.some(host => host.id === sourceId)) {
        throw new Error(`Source SSH Host ${sourceId} was not found`);
      }
      if (!state.sshHosts.some(host => host.id === targetId)) {
        throw new Error(`Target SSH Host ${targetId} was not found`);
      }

      const selectedIds = projectIds ? new Set(projectIds) : undefined;
      if (selectedIds) {
        for (const projectId of selectedIds) {
          const project = state.projects.find(candidate => candidate.id === projectId);
          if (!project) {
            throw new Error(`Project ${projectId} was not found`);
          }
          if (project.sshHostId !== sourceId) {
            throw new Error(`Project ${projectId} does not belong to source SSH Host ${sourceId}`);
          }
        }
      }

      for (const project of state.projects) {
        if (project.sshHostId === sourceId && (!selectedIds || (project.id && selectedIds.has(project.id)))) {
          project.sshHostId = targetId;
        }
      }
    });
  }

  resolveSshProject(project: ProjectItem): ReturnType<typeof resolveManagedSshProject> {
    return resolveManagedSshProject(project, this._state.sshHosts);
  }

  async importFromFile(src: vscode.Uri) {
    const buf = await vscode.workspace.fs.readFile(src);
    const fileSize = buf.length;
    console.log(`Project Pilot: Reading config file, size: ${fileSize} bytes`);
    
    // Check file size (warn if > 10MB)
    if (fileSize > 10 * 1024 * 1024) {
      console.warn('Project Pilot: Large config file detected, this might cause issues');
    }
    
    let jsonString = Buffer.from(buf).toString('utf8');
    console.log(`Project Pilot: JSON string length: ${jsonString.length}`);
    
    // If file is very large, try to clean up potential Base64 issues
    if (fileSize > 1024 * 1024) { // > 1MB
      console.log('Project Pilot: Large file detected, attempting to clean Base64 data');
      // Replace potentially problematic Base64 data with empty strings for import
      jsonString = jsonString.replace(/"icon"\s*:\s*"data:image\/[^"]*"/g, '"icon": ""');
      console.log(`Project Pilot: Cleaned JSON string length: ${jsonString.length}`);
    }
    
    let incoming: any;
    try {
      incoming = JSON.parse(jsonString);
      console.log('Project Pilot: JSON parsed successfully');
    } catch (parseError) {
      console.error('Project Pilot: JSON parse error, attempting to fix...', parseError);
      
      // Try to fix common JSON issues
      try {
        // Remove potentially problematic Base64 data and try again
        const cleanedJson = jsonString.replace(/"icon"\s*:\s*"data:image\/[^"]*"/g, '"icon": ""');
        incoming = JSON.parse(cleanedJson);
        console.log('Project Pilot: JSON parsed successfully after cleaning Base64 data');
      } catch (secondError) {
        console.error('Project Pilot: Failed to parse even after cleaning:', secondError);
        throw new Error(`Invalid JSON format: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
      }
    }
    
    console.log('Project Pilot: Config structure:', {
      hasProjects: !!incoming.projects,
      projectsLength: incoming.projects?.length,
      isArray: Array.isArray(incoming),
      hasFolders: !!incoming.folders,
      keys: Object.keys(incoming || {}),
      typeOfIncoming: typeof incoming,
      incomingValue: incoming
    });
    
    // Validate config structure
    if (!incoming || typeof incoming !== 'object') {
      throw new Error('Invalid config file: not a valid JSON object');
    }
    
    // 支持多种格式
    let projects: any[] = [];
    const preserveSchemaV2 = incoming.schemaVersion === 2
      && Array.isArray(incoming.sshHosts)
      && Array.isArray(incoming.projects);
    
    if (incoming.projects && Array.isArray(incoming.projects)) {
      // 标准格式: { projects: [...] }
      projects = incoming.projects;
    } else if (Array.isArray(incoming)) {
      // 直接数组格式: [...]
      projects = incoming;
    } else if (incoming.folders && Array.isArray(incoming.folders)) {
      // VSCode workspace格式: { folders: [...] }
      projects = incoming.folders.map((folder: any) => ({
        name: folder.name || 'Imported Project',
        path: folder.path || folder.uri || '',
        type: 'workspace' as const,
        color: '#10b981',
        tags: ['imported', 'workspace']
      }));
    } else {
      // Last attempt: try to find any array-like structure
      const possibleArrays = Object.values(incoming).filter(value => Array.isArray(value));
      if (possibleArrays.length > 0) {
        console.log('Project Pilot: Found array structure, attempting to use as projects');
        projects = possibleArrays[0] as any[];
      } else {
        console.error('Project Pilot: No recognizable project structure found');
        console.error('Available keys:', Object.keys(incoming));
        throw new Error('Invalid config file: no recognizable project data found. Expected { projects: [...] }, [...], or { folders: [...] }');
      }
    }
    
    // Validate each project
    for (let i = 0; i < projects.length; i++) {
      const project = projects[i];
      if (!project || typeof project !== 'object') {
        throw new Error(`Invalid project at index ${i}: not an object`);
      }
      
      if (!project.name || typeof project.name !== 'string') {
        throw new Error(`Invalid project at index ${i}: missing or invalid name`);
      }
      
      if (!project.path || typeof project.path !== 'string') {
        throw new Error(`Invalid project at index ${i}: missing or invalid path`);
      }
      
      if (!project.type || !['local', 'workspace', 'ssh', 'ssh-workspace'].includes(project.type)) {
        throw new Error(`Invalid project at index ${i}: invalid type "${project.type}"`);
      }
      
      // Legacy imports keep the historical defaults; schema v2 round-trips unchanged.
      if (!preserveSchemaV2) {
        project.id = project.id || genId();
        project.color = project.color || '#3b82f6';
        project.tags = project.tags || [];
        project.description = project.description || '';
      }
      
      // Validate and clean icon data
      if (project.icon && typeof project.icon === 'string') {
        try {
          // Check if it's a valid base64 data URL
          if (project.icon.startsWith('data:image/')) {
            // Validate base64 format
            const base64Part = project.icon.split(',')[1];
            if (base64Part) {
              // Try to decode to validate
              atob(base64Part);
            }
          } else if (project.icon.length > 0) {
            // If it's not empty but not a data URL, clear it
            project.icon = '';
          }
        } catch (error) {
          console.warn(`Invalid icon data for project ${project.name}, clearing icon`);
          project.icon = '';
        }
      } else if (!preserveSchemaV2) {
        project.icon = '';
      }
    }
    
    // Create backup before importing
    await this.createBackup();

    const stateToImport = incoming.projects && Array.isArray(incoming.projects)
      ? {
          schemaVersion: incoming.schemaVersion,
          sshHosts: incoming.sshHosts,
          projects: projects as ProjectItem[],
          uiSettings: incoming.uiSettings
        }
      : { projects: projects as ProjectItem[] };
    await this.applyIncomingState(stateToImport, { persist: 'always', notify: true });
  }

  async exportToFile(dest: vscode.Uri) {
    const normalized = this.normalizeIncomingState(cloneState(this._state));
    const exportData = {
      ...normalized.state,
      metadata: {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        projectCount: normalized.state.projects.length
      }
    };
    const data = Buffer.from(JSON.stringify(exportData, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(dest, data);
  }


  async createBackup() {
    try {
      const backupDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'backups');
      await vscode.workspace.fs.createDirectory(backupDir);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = vscode.Uri.joinPath(backupDir, `projects-backup-${timestamp}.json`);
      
      await this.exportToFile(backupFile);
      
      // Keep only the last 5 backups
      await this.cleanupOldBackups(backupDir);
    } catch (error) {
      console.warn('Failed to create backup:', error);
    }
  }

  private async cleanupOldBackups(backupDir: vscode.Uri) {
    try {
      const files = await vscode.workspace.fs.readDirectory(backupDir);
      const backupFiles = files
        .filter(([name, type]) => type === vscode.FileType.File && name.startsWith('projects-backup-'))
        .sort(([a], [b]) => b.localeCompare(a)); // Sort by name (timestamp) descending
      
      // Keep only the 5 most recent backups
      for (let i = 5; i < backupFiles.length; i++) {
        const fileUri = vscode.Uri.joinPath(backupDir, backupFiles[i][0]);
        await vscode.workspace.fs.delete(fileUri);
      }
    } catch (error) {
      console.warn('Failed to cleanup old backups:', error);
    }
  }

  async getConfigPath(): Promise<string> {
    return this.fileUri.fsPath;
  }

  async getBackupFiles(): Promise<vscode.Uri[]> {
    try {
      const backupDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'backups');
      const files = await vscode.workspace.fs.readDirectory(backupDir);
      return files
        .filter(([name, type]) => type === vscode.FileType.File && name.startsWith('projects-backup-'))
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([name]) => vscode.Uri.joinPath(backupDir, name));
    } catch (error) {
      return [];
    }
  }
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function cloneState(state: State): State {
  return JSON.parse(JSON.stringify(state)) as State;
}
