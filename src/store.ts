import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
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
  collapsedGroups?: string[];
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
  private operationQueue: Promise<void> = Promise.resolve();
  private lastWrittenContent?: string;
  private lastObservedContent?: string;
  private dataDirUri!: vscode.Uri;
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
      viewMode: 'mini',
      selectedGroup: '',
      collapsedGroups: []
    };
  }

  setOnChangeCallback(callback: () => void) {
    this.onChangeCallback = callback;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private validateProjectStructure(value: unknown, index: number): ProjectItem {
    if (!value || typeof value !== 'object') {
      throw new Error(`Invalid project at index ${index}: not an object`);
    }
    const project = value as Record<string, unknown>;
    const name = project.name;
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Invalid project at index ${index}: name must be a nonempty string`);
    }
    if (typeof project.path !== 'string' || !project.path.trim()) {
      throw new Error(`Invalid project "${name}": path must be a nonempty string`);
    }
    if (!['local', 'workspace', 'ssh', 'ssh-workspace'].includes(project.type as string)) {
      throw new Error(`Invalid project "${name}": invalid type "${String(project.type)}"`);
    }

    for (const field of ['id', 'description', 'icon', 'color', 'group', 'lastAccessed'] as const) {
      if (project[field] !== undefined && typeof project[field] !== 'string') {
        throw new Error(`Invalid project "${name}": ${field} must be a string`);
      }
    }
    if (
      project.tags !== undefined
      && (!Array.isArray(project.tags) || project.tags.some(tag => typeof tag !== 'string'))
    ) {
      throw new Error(`Invalid project "${name}": tags must be an array of strings`);
    }
    if (project.isFavorite !== undefined && typeof project.isFavorite !== 'boolean') {
      throw new Error(`Invalid project "${name}": isFavorite must be a boolean`);
    }
    if (
      project.clickCount !== undefined
      && (typeof project.clickCount !== 'number' || !Number.isFinite(project.clickCount))
    ) {
      throw new Error(`Invalid project "${name}": clickCount must be a finite number`);
    }
    return value as ProjectItem;
  }

  private validateHostStructure(value: unknown, index: number): SshHost {
    if (!value || typeof value !== 'object') {
      throw new Error(`Invalid SSH Host at index ${index}: not an object`);
    }
    const host = value as Record<string, unknown>;
    for (const field of ['id', 'name', 'hostname'] as const) {
      if (typeof host[field] !== 'string') {
        throw new Error(`Invalid SSH Host at index ${index}: ${field} must be a string`);
      }
    }
    if (host.username !== undefined && typeof host.username !== 'string') {
      throw new Error(`Invalid SSH Host at index ${index}: username must be a string`);
    }
    if (host.port !== undefined && typeof host.port !== 'number') {
      throw new Error(`Invalid SSH Host at index ${index}: port must be a number`);
    }
    return value as SshHost;
  }

  private validateUISettings(value: unknown, allowLegacyTarget: boolean): UISettings | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid uiSettings: expected an object');
    }
    const settings = value as Record<string, unknown>;
    if (settings.compactMode !== undefined && typeof settings.compactMode !== 'boolean') {
      throw new Error('Invalid uiSettings.compactMode: expected a boolean');
    }
    if (settings.viewMode !== undefined && !['grid', 'list', 'mini'].includes(settings.viewMode as string)) {
      throw new Error('Invalid uiSettings.viewMode');
    }
    if (settings.selectedGroup !== undefined && typeof settings.selectedGroup !== 'string') {
      throw new Error('Invalid uiSettings.selectedGroup: expected a string');
    }
    if (
      settings.collapsedGroups !== undefined
      && (!Array.isArray(settings.collapsedGroups) || settings.collapsedGroups.some(group => typeof group !== 'string'))
    ) {
      throw new Error('Invalid uiSettings.collapsedGroups: expected an array of strings');
    }
    const outlineModes = allowLegacyTarget
      ? ['group', 'target', 'host', 'type', 'flat']
      : ['group', 'host', 'type', 'flat'];
    if (settings.outlineMode !== undefined && !outlineModes.includes(settings.outlineMode as string)) {
      throw new Error('Invalid uiSettings.outlineMode');
    }
    return value as UISettings;
  }

  private normalizeIncomingState(incoming: unknown): {
    state: State;
    warnings: SshMigrationWarning[];
    changed: boolean;
  } {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      throw new Error('Invalid config state: expected an object');
    }
    const rawState = incoming as Record<string, unknown>;
    const isSchemaV2 = rawState.schemaVersion === 2;
    if (!Array.isArray(rawState.projects)) {
      throw new Error('Invalid config state: projects must be an array');
    }
    if (isSchemaV2 && !Array.isArray(rawState.sshHosts)) {
      throw new Error('Invalid schema v2 state: sshHosts must be an array');
    }
    if (rawState.sshHosts !== undefined && !Array.isArray(rawState.sshHosts)) {
      throw new Error('Invalid config state: sshHosts must be an array');
    }
    for (const [index, host] of ((rawState.sshHosts as unknown[] | undefined) ?? []).entries()) {
      this.validateHostStructure(host, index);
    }
    this.validateUISettings(rawState.uiSettings, !isSchemaV2);

    for (const [index, value] of rawState.projects.entries()) {
      const project = this.validateProjectStructure(value, index);
      const projectName = project.name;
      const hasSshHostId = project.sshHostId !== undefined;
      const hasRemotePath = project.remotePath !== undefined;
      const isSshProject = project.type === 'ssh' || project.type === 'ssh-workspace';

      if (!isSshProject && (hasSshHostId || hasRemotePath)) {
        throw new Error(`Project "${projectName}" is non-SSH and cannot include sshHostId or remotePath`);
      }
      if (!isSshProject) continue;
      if (hasSshHostId !== hasRemotePath) {
        const missingField = hasSshHostId ? 'remotePath' : 'sshHostId';
        throw new Error(`SSH project "${projectName}" is missing ${missingField}`);
      }
      if (hasSshHostId && (typeof project.sshHostId !== 'string' || !project.sshHostId.trim())) {
        throw new Error(`Managed SSH project "${projectName}" must reference an SSH Host`);
      }
      if (hasRemotePath && typeof project.remotePath !== 'string') {
        throw new Error(`SSH project "${projectName}" remotePath must be a string`);
      }
    }

    const migration = migrateSshState(incoming as SshStateLike);
    const sshHosts: SshHost[] = [];
    for (const [index, host] of migration.state.sshHosts.entries()) {
      this.validateHostStructure(host, index);
      sshHosts.push(validateSshHost(host, sshHosts));
    }

    const migratedProjects = migration.state.projects.map((project, index) => {
      this.validateProjectStructure(project, index);
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
    const projects = enforceProjectIdentityInvariant(migratedProjects, !isSchemaV2);

    const uiSettings = this.validateUISettings(migration.state.uiSettings, false);
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
    options: {
      persist: 'always' | 'if-changed' | 'never';
      notify?: boolean;
      sourceContent?: string;
    }
  ): Promise<void> {
    return this.enqueue(async () => {
      const normalized = this.normalizeIncomingState(incoming);
      await this.applyNormalizedState(normalized, options);
    });
  }

  private serializeState(state: State): string {
    return JSON.stringify(state, null, 2);
  }

  private async writeState(state: State): Promise<string> {
    const content = this.serializeState(state);
    const tempUri = vscode.Uri.joinPath(
      this.dataDirUri,
      `projects.json.${randomUUID()}.tmp`
    );
    const previousWrittenContent = this.lastWrittenContent;
    const previousObservedContent = this.lastObservedContent;

    // Set suppression markers before the atomic replacement so a watcher event
    // raised by rename cannot enter the queue with stale self-write metadata.
    this.lastWrittenContent = content;
    this.lastObservedContent = content;
    try {
      await vscode.workspace.fs.writeFile(tempUri, Buffer.from(content, 'utf8'));
      await vscode.workspace.fs.rename(tempUri, this.fileUri, { overwrite: true });
      return content;
    } catch (error) {
      this.lastWrittenContent = previousWrittenContent;
      this.lastObservedContent = previousObservedContent;
      try {
        await vscode.workspace.fs.delete(tempUri);
      } catch {
        // The temp write may have failed before creating a file. Cleanup is best effort.
      }
      throw error;
    }
  }

  private async applyNormalizedState(
    normalized: ReturnType<ConfigStore['normalizeIncomingState']>,
    options: {
      persist: 'always' | 'if-changed' | 'never';
      notify?: boolean;
      sourceContent?: string;
    }
  ): Promise<boolean> {
    const stateChanged = this.serializeState(this._state) !== this.serializeState(normalized.state)
      || JSON.stringify(this._migrationWarnings) !== JSON.stringify(normalized.warnings);
    if (options.persist === 'always' || (options.persist === 'if-changed' && normalized.changed)) {
      await this.writeState(normalized.state);
    } else if (options.sourceContent !== undefined) {
      this.lastObservedContent = options.sourceContent;
    }

    this._state = normalized.state;
    this._migrationWarnings = normalized.warnings;
    if (options.notify) {
      this.onChangeCallback?.();
    }
    return stateChanged;
  }

  private async mutate(mutator: (draft: State) => void | false): Promise<void> {
    return this.enqueue(async () => {
      const draft = cloneState(this._state);
      if (mutator(draft) === false) return;
      const normalized = this.normalizeIncomingState(draft);
      await this.writeState(normalized.state);
      this._state = normalized.state;
      this._migrationWarnings = normalized.warnings;
      this.onChangeCallback?.();
    });
  }

  async init() {
    // 确保配置存储在本地 - 即使连接到远程机器，项目配置也始终在本地管理
    console.log('Project Pilot: Initializing local configuration storage...');
    this.dataDirUri = vscode.Uri.joinPath(this.context.globalStorageUri, 'data');
    await vscode.workspace.fs.createDirectory(this.dataDirUri);
    this.fileUri = vscode.Uri.joinPath(this.dataDirUri, 'projects.json');
    console.log('Project Pilot: Configuration will be stored at:', this.fileUri.fsPath);

    let sourceContent: string | undefined;
    try {
      const buf = await vscode.workspace.fs.readFile(this.fileUri);
      sourceContent = Buffer.from(buf).toString('utf8');
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      // 如果配置文件不存在，创建一个示例项目
      const demoState: State = {
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
          viewMode: 'mini',
          selectedGroup: '',
          collapsedGroups: [],
          outlineMode: 'group'
        }
      };
      await this.applyIncomingState(demoState, { persist: 'always' });
    }

    if (sourceContent !== undefined) {
      const incoming = JSON.parse(sourceContent) as unknown;
      await this.applyIncomingState(incoming, { persist: 'if-changed', sourceContent });
    }
    
    // 设置文件监听器
    this.setupFileWatcher();
  }
  
  private setupFileWatcher() {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.dataDirUri, 'projects.json'),
      false, // 不忽略创建事件
      false, // 不忽略修改事件
      true   // 忽略删除事件
    );

    const reloadFromWatcher = () => this.enqueue(async () => {
      console.log('Project Pilot: Configuration file changed, reloading...');
      try {
        const buf = await vscode.workspace.fs.readFile(this.fileUri);
        const sourceContent = Buffer.from(buf).toString('utf8');
        const isSelfWrite = sourceContent === this.lastWrittenContent
          && sourceContent === this.lastObservedContent;
        if (isSelfWrite || sourceContent === this.lastObservedContent) return;

        const incoming = JSON.parse(sourceContent) as unknown;
        const normalized = this.normalizeIncomingState(incoming);
        const changed = await this.applyNormalizedState(normalized, {
          persist: 'if-changed',
          sourceContent
        });
        if (changed) {
          this.onChangeCallback?.();
          vscode.window.showInformationMessage('Project Pilot configuration reloaded');
        }
      } catch (error) {
        console.error('Project Pilot: Failed to reload configuration:', error);
        vscode.window.showWarningMessage('Failed to reload Project Pilot configuration. Please check the JSON syntax.');
      }
    });
    this.fileWatcher.onDidCreate(reloadFromWatcher);
    this.fileWatcher.onDidChange(reloadFromWatcher);
  }
  
  dispose() {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
  }
  
  // 手动重新加载配置
  async reload() {
    console.log('Project Pilot: Manually reloading configuration...');
    return this.enqueue(async () => {
      try {
        const buf = await vscode.workspace.fs.readFile(this.fileUri);
        const sourceContent = Buffer.from(buf).toString('utf8');
        const incoming = JSON.parse(sourceContent) as unknown;
        const normalized = this.normalizeIncomingState(incoming);
        await this.applyNormalizedState(normalized, {
          persist: 'if-changed',
          notify: true,
          sourceContent
        });
      } catch (error) {
        console.error('Project Pilot: Failed to reload configuration:', error);
        throw error;
      }
    });
  }

  async save() {
    return this.enqueue(async () => {
      await this.writeState(cloneState(this._state));
    });
  }

  async addProject(p: ProjectItem) {
    const input = cloneValue(p);
    await this.mutate(state => {
      const usedIds = collectProjectIds(state.projects);
      state.projects.push({ ...input, id: input.id ?? generateUniqueProjectId(usedIds) });
    });
  }

  async upsertProject(p: ProjectItem) {
    const input = cloneValue(p);
    await this.mutate(state => {
      const usedIds = collectProjectIds(state.projects);
      const project = { ...input, id: input.id ?? generateUniqueProjectId(usedIds) };
      const idx = state.projects.findIndex(x => x.id === project.id);
      if (idx >= 0) state.projects[idx] = project; else state.projects.push(project);
    });
  }

  async deleteProject(id: string) {
    await this.mutate(state => {
      state.projects = state.projects.filter(p => p.id !== id);
    });
  }

  async recordProjectAccess(id: string) {
    await this.mutate(state => {
      const project = state.projects.find(candidate => candidate.id === id);
      if (!project) return false;
      project.clickCount = (project.clickCount || 0) + 1;
      project.lastAccessed = new Date().toISOString();
    });
  }

  async toggleFavorite(id: string) {
    await this.mutate(state => {
      const project = state.projects.find(candidate => candidate.id === id);
      if (!project) return false;
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
    const input = cloneValue(settings);
    const normalizedSettings: Partial<UISettings> = input.outlineMode === 'target'
      ? { ...input, outlineMode: 'host' }
      : input as Partial<UISettings>;
    await this.mutate(state => {
      if (!state.uiSettings) {
        state.uiSettings = {
          compactMode: false,
          viewMode: 'mini',
          selectedGroup: '',
          collapsedGroups: [],
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
    const input = cloneValue(host);
    await this.mutate(state => {
      state.sshHosts.push(validateSshHost(input, state.sshHosts));
    });
  }

  async updateSshHost(host: SshHost): Promise<void> {
    const input = cloneValue(host);
    await this.mutate(state => {
      const index = state.sshHosts.findIndex(candidate => candidate.id === input.id);
      if (index < 0) {
        throw new Error(`SSH Host ${input.id} was not found`);
      }
      state.sshHosts[index] = validateSshHost(input, state.sshHosts, state.sshHosts[index].id);
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
    const selectedProjectIds = projectIds ? [...projectIds] : undefined;
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

      if (selectedProjectIds) {
        const uniqueSelectedIds = new Set<string>();
        const selectedProjects: ProjectItem[] = [];
        for (const projectId of selectedProjectIds) {
          if (uniqueSelectedIds.has(projectId)) {
            throw new Error(`Duplicate selected project ID "${projectId}"`);
          }
          uniqueSelectedIds.add(projectId);

          const matches = state.projects.filter(candidate => candidate.id === projectId);
          if (matches.length === 0) {
            throw new Error(`Project ${projectId} was not found`);
          }
          if (matches.length !== 1) {
            throw new Error(`Project ${projectId} must map to exactly one current project`);
          }
          const project = matches[0];
          if (project.sshHostId !== sourceId) {
            throw new Error(`Project ${projectId} does not belong to source SSH Host ${sourceId}`);
          }
          selectedProjects.push(project);
        }

        for (const project of selectedProjects) {
          project.sshHostId = targetId;
        }
        return;
      }

      for (const project of state.projects) {
        if (project.sshHostId === sourceId) {
          project.sshHostId = targetId;
        }
      }
    });
  }

  resolveSshProject(project: ProjectItem): ReturnType<typeof resolveManagedSshProject> {
    return resolveManagedSshProject(project, this._state.sshHosts);
  }

  private async readImportFile(src: vscode.Uri): Promise<any> {
    const buf = await vscode.workspace.fs.readFile(src);
    const fileSize = buf.length;
    console.log(`Project Pilot: Reading config file, size: ${fileSize} bytes`);

    if (fileSize > 10 * 1024 * 1024) {
      console.warn('Project Pilot: Large config file detected, this might cause issues');
    }

    let jsonString = Buffer.from(buf).toString('utf8');
    console.log(`Project Pilot: JSON string length: ${jsonString.length}`);
    if (fileSize > 1024 * 1024) {
      console.log('Project Pilot: Large file detected, attempting to clean Base64 data');
      jsonString = jsonString.replace(/"icon"\s*:\s*"data:image\/[^"]*"/g, '"icon": ""');
      console.log(`Project Pilot: Cleaned JSON string length: ${jsonString.length}`);
    }

    let incoming: any;
    try {
      incoming = JSON.parse(jsonString);
      console.log('Project Pilot: JSON parsed successfully');
    } catch (parseError) {
      console.error('Project Pilot: JSON parse error, attempting to fix...', parseError);
      try {
        const cleanedJson = jsonString.replace(/"icon"\s*:\s*"data:image\/[^"]*"/g, '"icon": ""');
        incoming = JSON.parse(cleanedJson);
        console.log('Project Pilot: JSON parsed successfully after cleaning Base64 data');
      } catch (secondError) {
        console.error('Project Pilot: Failed to parse even after cleaning:', secondError);
        throw new Error(`Invalid JSON format: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
      }
    }

    console.log('Project Pilot: Config structure:', {
      hasProjects: !!incoming?.projects,
      projectsLength: incoming?.projects?.length,
      isArray: Array.isArray(incoming),
      hasFolders: !!incoming?.folders,
      keys: Object.keys(incoming || {}),
      typeOfIncoming: typeof incoming,
      incomingValue: incoming
    });
    return incoming;
  }

  private preprocessImport(incoming: any): unknown {
    if (!incoming || typeof incoming !== 'object') {
      throw new Error('Invalid config file: not a valid JSON object');
    }

    let projects: any[] = [];
    if (incoming.schemaVersion === 2) {
      if (!Array.isArray(incoming.projects)) {
        throw new Error('Invalid schema v2 state: projects must be an array');
      }
      if (!Array.isArray(incoming.sshHosts)) {
        throw new Error('Invalid schema v2 state: sshHosts must be an array');
      }
    }
    const preserveSchemaV2 = incoming.schemaVersion === 2
      && Array.isArray(incoming.sshHosts)
      && Array.isArray(incoming.projects);

    if (incoming.projects && Array.isArray(incoming.projects)) {
      projects = incoming.projects;
    } else if (Array.isArray(incoming)) {
      projects = incoming;
    } else if (incoming.folders && Array.isArray(incoming.folders)) {
      projects = incoming.folders.map((folder: any) => ({
        name: folder.name || 'Imported Project',
        path: folder.path || folder.uri || '',
        type: 'workspace' as const,
        color: '#10b981',
        tags: ['imported', 'workspace']
      }));
    } else {
      const possibleArrays = Object.values(incoming).filter(value => Array.isArray(value));
      if (possibleArrays.length === 0) {
        console.error('Project Pilot: No recognizable project structure found');
        console.error('Available keys:', Object.keys(incoming));
        throw new Error('Invalid config file: no recognizable project data found. Expected { projects: [...] }, [...], or { folders: [...] }');
      }
      console.log('Project Pilot: Found array structure, attempting to use as projects');
      projects = possibleArrays[0] as any[];
    }

    for (let index = 0; index < projects.length; index += 1) {
      const project = projects[index];
      this.validateProjectStructure(project, index);

      if (!preserveSchemaV2) {
        project.color = project.color || '#3b82f6';
        project.tags = project.tags || [];
        project.description = project.description || '';
      }

      if (project.icon && typeof project.icon === 'string') {
        try {
          if (project.icon.startsWith('data:image/')) {
            const base64Part = project.icon.split(',')[1];
            if (base64Part) atob(base64Part);
          } else if (project.icon.length > 0) {
            project.icon = '';
          }
        } catch {
          console.warn(`Invalid icon data for project ${project.name}, clearing icon`);
          project.icon = '';
        }
      } else if (!preserveSchemaV2) {
        project.icon = '';
      }
    }

    return incoming.projects && Array.isArray(incoming.projects)
      ? {
          schemaVersion: incoming.schemaVersion,
          sshHosts: incoming.sshHosts,
          projects: projects as ProjectItem[],
          uiSettings: incoming.uiSettings
        }
      : { projects: projects as ProjectItem[] };
  }

  async importFromFile(src: vscode.Uri) {
    return this.enqueue(async () => {
      const incoming = await this.readImportFile(src);
      const stateToImport = this.preprocessImport(incoming);
      const normalized = this.normalizeIncomingState(stateToImport);

      const autoBackup = vscode.workspace.getConfiguration('projectPilot').get<boolean>('autoBackup', true);
      if (autoBackup) {
        await this.createBackupNow();
      }
      await this.writeState(normalized.state);
      this._state = normalized.state;
      this._migrationWarnings = normalized.warnings;
      this.onChangeCallback?.();
    });
  }

  async exportToFile(dest: vscode.Uri) {
    const snapshot = cloneState(this._state);
    await this.exportStateToFile(dest, snapshot);
  }

  private async exportStateToFile(dest: vscode.Uri, state: State) {
    const normalized = this.normalizeIncomingState(state);
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
    return this.enqueue(() => this.createBackupNow());
  }

  private async createBackupNow() {
    const backupDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'backups');
    await vscode.workspace.fs.createDirectory(backupDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = vscode.Uri.joinPath(backupDir, `projects-backup-${timestamp}.json`);

    await this.exportStateToFile(backupFile, this._state);

    // Keep only the last 5 backups
    await this.cleanupOldBackups(backupDir);
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

function collectProjectIds(projects: readonly ProjectItem[]): Set<string> {
  return new Set(projects.flatMap(project => (
    typeof project.id === 'string' && project.id.trim().length > 0 ? [project.id] : []
  )));
}

function generateUniqueProjectId(usedIds: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = genId();
    if (candidate.trim().length > 0 && !usedIds.has(candidate)) {
      return candidate;
    }
  }

  let suffix = usedIds.size + 1;
  let candidate = `project-${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `project-${suffix}`;
  }
  return candidate;
}

function enforceProjectIdentityInvariant(
  projects: readonly ProjectItem[],
  repairLegacyIds: boolean
): ProjectItem[] {
  const usedIds = new Set<string>();
  // Legacy policy: preserve the first explicit nonempty ID and repair every
  // missing/blank or later duplicate ID without consuming a reserved ID.
  const reservedIds = collectProjectIds(projects);
  return projects.map((project, index) => {
    const id = project.id;
    const hasNonemptyId = typeof id === 'string' && id.trim().length > 0;
    const isDuplicate = hasNonemptyId && usedIds.has(id);
    if ((!hasNonemptyId || isDuplicate) && !repairLegacyIds) {
      if (!hasNonemptyId) {
        throw new Error(`Project ID at index ${index} must be a nonempty string`);
      }
      throw new Error(`Duplicate project ID "${id}" at index ${index}`);
    }

    if (!hasNonemptyId || isDuplicate) {
      const generatedId = generateUniqueProjectId(reservedIds);
      usedIds.add(generatedId);
      reservedIds.add(generatedId);
      return { ...project, id: generatedId };
    }

    usedIds.add(id);
    return project;
  });
}

function cloneState(state: State): State {
  return JSON.parse(JSON.stringify(state)) as State;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isFileNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return candidate.code === 'FileNotFound'
    || candidate.code === 'ENOENT'
    || candidate.name === 'EntryNotFound (FileSystemError)';
}
