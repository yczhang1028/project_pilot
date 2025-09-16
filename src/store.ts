import * as vscode from 'vscode';

export type ProjectType = 'local' | 'workspace' | 'ssh';

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
}

interface State {
  projects: ProjectItem[];
}

export class ConfigStore {
  private _state: State = { projects: [] };
  private fileUri!: vscode.Uri;
  private fileWatcher?: vscode.FileSystemWatcher;
  private onChangeCallback?: () => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get state() { return this._state; }

  setOnChangeCallback(callback: () => void) {
    this.onChangeCallback = callback;
  }

  async init() {
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, 'data');
    await vscode.workspace.fs.createDirectory(dir);
    this.fileUri = vscode.Uri.joinPath(dir, 'projects.json');
    try {
      const buf = await vscode.workspace.fs.readFile(this.fileUri);
      this._state = JSON.parse(Buffer.from(buf).toString('utf8')) as State;
      if (!this._state.projects) this._state.projects = [];
    } catch {
      // 如果配置文件不存在，创建一个示例项目
      this._state = {
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
        ]
      };
      await this.save();
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
        const newState = JSON.parse(Buffer.from(buf).toString('utf8')) as State;
        if (newState.projects) {
          this._state = newState;
          vscode.window.showInformationMessage('Project Pilot configuration reloaded');
          // 通知视图更新
          if (this.onChangeCallback) {
            this.onChangeCallback();
          }
        }
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

  async save() {
    const data = Buffer.from(JSON.stringify(this._state, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(this.fileUri, data);
  }

  async addProject(p: ProjectItem) {
    p.id = p.id ?? genId();
    this._state.projects.push(p);
    await this.save();
    if (this.onChangeCallback) {
      this.onChangeCallback();
    }
  }

  async upsertProject(p: ProjectItem) {
    if (!p.id) p.id = genId();
    const idx = this._state.projects.findIndex(x => x.id === p.id);
    if (idx >= 0) this._state.projects[idx] = p; else this._state.projects.push(p);
    await this.save();
    if (this.onChangeCallback) {
      this.onChangeCallback();
    }
  }

  async deleteProject(id: string) {
    this._state.projects = this._state.projects.filter(p => p.id !== id);
    await this.save();
    if (this.onChangeCallback) {
      this.onChangeCallback();
    }
  }

  async importFromFile(src: vscode.Uri) {
    const buf = await vscode.workspace.fs.readFile(src);
    const incoming = JSON.parse(Buffer.from(buf).toString('utf8')) as any;
    
    // Validate config structure
    if (!incoming || typeof incoming !== 'object') {
      throw new Error('Invalid config file: not a valid JSON object');
    }
    
    if (!incoming.projects || !Array.isArray(incoming.projects)) {
      throw new Error('Invalid config file: missing or invalid projects array');
    }
    
    // Validate each project
    for (let i = 0; i < incoming.projects.length; i++) {
      const project = incoming.projects[i];
      if (!project || typeof project !== 'object') {
        throw new Error(`Invalid project at index ${i}: not an object`);
      }
      
      if (!project.name || typeof project.name !== 'string') {
        throw new Error(`Invalid project at index ${i}: missing or invalid name`);
      }
      
      if (!project.path || typeof project.path !== 'string') {
        throw new Error(`Invalid project at index ${i}: missing or invalid path`);
      }
      
      if (!project.type || !['local', 'workspace', 'ssh'].includes(project.type)) {
        throw new Error(`Invalid project at index ${i}: invalid type "${project.type}"`);
      }
      
      // Ensure required fields exist
      project.id = project.id || genId();
      project.color = project.color || '#3b82f6';
      project.tags = project.tags || [];
      project.icon = project.icon || '';
      project.description = project.description || '';
    }
    
    // Create backup before importing
    await this.createBackup();
    
    this._state = { projects: incoming.projects as ProjectItem[] };
    await this.save();
    if (this.onChangeCallback) {
      this.onChangeCallback();
    }
  }

  async exportToFile(dest: vscode.Uri) {
    const exportData = {
      ...this._state,
      metadata: {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        projectCount: this._state.projects.length
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
