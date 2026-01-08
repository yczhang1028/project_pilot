import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ManagerViewProvider } from './managerViewProvider';
import { OutlineTreeProvider } from './outlineTreeProvider';
import { ConfigStore, ProjectItem } from './store';

export async function activate(context: vscode.ExtensionContext) {
  console.log('Project Pilot: Extension activating...');
  const store = new ConfigStore(context);
  globalStore = store; // 保存全局引用以便清理
  await store.init();
  console.log('Project Pilot: Store initialized with', store.state.projects.length, 'projects');

  const managerProvider = new ManagerViewProvider(context, store);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('projectPilot.manager', managerProvider)
  );

  const outlineProvider = new OutlineTreeProvider(store);
  context.subscriptions.push(
    vscode.window.createTreeView('projectPilot.outline', { treeDataProvider: outlineProvider })
  );

  // 全屏视图面板引用
  let fullscreenPanel: vscode.WebviewPanel | undefined;

  // 设置store变化时的回调，同步更新所有视图
  store.setOnChangeCallback(() => {
    outlineProvider.refresh();
    managerProvider.postState();
    // 同步更新全屏视图
    if (fullscreenPanel) {
      fullscreenPanel.webview.postMessage({ type: 'state', payload: store.state });
    }
  });

  // 启动时自动打开全屏视图（默认开启）
  const autoOpenFullscreen = vscode.workspace.getConfiguration('projectPilot').get('autoOpenFullscreen', true);
  if (autoOpenFullscreen) {
    // 延迟一点打开，确保扩展完全加载
    setTimeout(() => {
      vscode.commands.executeCommand('projectPilot.openFullscreen');
    }, 500);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('projectPilot.showManager', () => {
      vscode.commands.executeCommand('workbench.view.extension.projectPilot');
    }),
    vscode.commands.registerCommand('projectPilot.openFullscreen', () => {
      // 如果面板已存在，直接显示
      if (fullscreenPanel) {
        fullscreenPanel.reveal(vscode.ViewColumn.One);
        return;
      }

      // 创建新的 Webview Panel
      fullscreenPanel = vscode.window.createWebviewPanel(
        'projectPilot.fullscreen',
        'Project Pilot',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist')]
        }
      );

      // 设置 HTML 内容
      fullscreenPanel.webview.html = getFullscreenHtml(fullscreenPanel.webview, context);
      
      // 设置图标
      fullscreenPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'activity-bar-icon.svg');

      // 处理消息
      fullscreenPanel.webview.onDidReceiveMessage(async (msg) => {
        await handleWebviewMessage(msg, fullscreenPanel!.webview, store);
      });

      // 面板关闭时清理引用
      fullscreenPanel.onDidDispose(() => {
        fullscreenPanel = undefined;
      });

      // 发送初始状态
      fullscreenPanel.webview.postMessage({ type: 'state', payload: store.state });
    }),
    vscode.commands.registerCommand('projectPilot.openNewWindow', async () => {
      // 打开新窗口并显示Project Pilot
      await vscode.commands.executeCommand('workbench.action.newWindow');
      // 等待新窗口加载完成后显示Project Pilot视图
      setTimeout(() => {
        vscode.commands.executeCommand('workbench.view.extension.projectPilot');
      }, 1000);
    }),
    vscode.commands.registerCommand('projectPilot.openProject', async (item?: ProjectItem) => {
      const target = item ?? (await outlineProvider.pickProject());
      if (!target) { return; }
      openProject(target);
    }),
    vscode.commands.registerCommand('projectPilot.addLocalProject', async () => {
      const uri = await vscode.window.showOpenDialog({ 
        canSelectFolders: true, 
        canSelectFiles: false, 
        canSelectMany: false,
        title: 'Select Local Project Folder'
      });
      if (!uri || !uri[0]) { return; }
      const defaultName = path.basename(uri[0].fsPath) || 'New Project';
      const name = await vscode.window.showInputBox({ 
        prompt: 'Project name', 
        value: defaultName,
        validateInput: (value) => value.trim() ? null : 'Project name cannot be empty'
      });
      if (!name) { return; }
      
      // Auto-detect project type and suggest tags
      const tags = await detectProjectTags(uri[0].fsPath);
      await store.addProject({ 
        name: name.trim(), 
        path: uri[0].fsPath, 
        description: '',
        type: 'local', 
        color: '#3b82f6', 
        tags 
      });
      outlineProvider.refresh();
      managerProvider.postState();
      vscode.window.showInformationMessage(`Added local project: ${name}`);
    }),
    vscode.commands.registerCommand('projectPilot.addWorkspaceFile', async () => {
      const uri = await vscode.window.showOpenDialog({ 
        canSelectFiles: true, 
        canSelectFolders: false, 
        canSelectMany: false, 
        filters: { 'Workspace Files': ['code-workspace'] },
        title: 'Select Workspace File'
      });
      if (!uri || !uri[0]) { return; }
      const defaultName = path.basename(uri[0].fsPath, '.code-workspace') || 'New Workspace';
      const name = await vscode.window.showInputBox({ 
        prompt: 'Workspace name', 
        value: defaultName,
        validateInput: (value) => value.trim() ? null : 'Workspace name cannot be empty'
      });
      if (!name) { return; }
      await store.addProject({ 
        name: name.trim(), 
        path: uri[0].fsPath, 
        description: '',
        type: 'workspace', 
        color: '#10b981', 
        tags: ['workspace'] 
      });
      outlineProvider.refresh();
      managerProvider.postState();
      vscode.window.showInformationMessage(`Added workspace: ${name}`);
    }),
    vscode.commands.registerCommand('projectPilot.addSshProject', async () => {
      const input = await vscode.window.showInputBox({ 
        prompt: 'SSH connection string',
        placeHolder: 'user@hostname:/path or vscode-remote://ssh-remote+hostname/path',
        validateInput: (value) => {
          if (!value.trim()) return 'SSH connection string cannot be empty';
          if (!value.includes('@') && !value.startsWith('vscode-remote://')) {
            return 'Please provide a valid SSH format: user@hostname:/path';
          }
          return null;
        }
      });
      if (!input) { return; }
      
      // Extract name suggestion from path
      const pathPart = input.includes(':') ? input.split(':').pop() : input.split('/').pop();
      const defaultName = pathPart?.replace(/^\/+/, '') || 'SSH Project';
      
      // Extract hostname for auto-tagging
      let hostname = '';
      try {
        if (input.includes('@') && input.includes(':')) {
          const userHost = input.split(':')[0];
          hostname = userHost.split('@')[1] || '';
        }
      } catch {
        // Ignore hostname extraction errors
      }
      
      const name = await vscode.window.showInputBox({ 
        prompt: 'Project name', 
        value: defaultName,
        validateInput: (value) => value.trim() ? null : 'Project name cannot be empty'
      });
      if (!name) { return; }
      
      const tags = ['ssh', 'remote'];
      if (hostname) {
        tags.push(hostname);
      }
      
      await store.addProject({ 
        name: name.trim(), 
        path: input.trim(), 
        description: '',
        type: 'ssh', 
        color: '#f59e0b', 
        tags 
      });
      outlineProvider.refresh();
      managerProvider.postState();
      vscode.window.showInformationMessage(`Added SSH project: ${name}`);
    }),
    vscode.commands.registerCommand('projectPilot.addSshWorkspace', async () => {
      const input = await vscode.window.showInputBox({ 
        prompt: 'SSH workspace file path',
        placeHolder: 'user@hostname:/path/to/workspace.code-workspace',
        validateInput: (value) => {
          if (!value.trim()) return 'SSH workspace path cannot be empty';
          if (!value.includes('@') && !value.startsWith('vscode-remote://')) {
            return 'Please provide a valid SSH format: user@hostname:/path/to/workspace.code-workspace';
          }
          if (!value.endsWith('.code-workspace')) {
            return 'Path should end with .code-workspace';
          }
          return null;
        }
      });
      if (!input) { return; }
      
      // Extract name suggestion from path
      const pathPart = input.includes(':') ? input.split(':').pop() : input.split('/').pop();
      const defaultName = pathPart?.replace(/^\/+/, '').replace('.code-workspace', '') || 'SSH Workspace';
      
      // Extract hostname for auto-tagging
      let hostname = '';
      try {
        if (input.includes('@') && input.includes(':')) {
          const userHost = input.split(':')[0];
          hostname = userHost.split('@')[1] || '';
        }
      } catch {
        // Ignore hostname extraction errors
      }
      
      const name = await vscode.window.showInputBox({ 
        prompt: 'Workspace name', 
        value: defaultName,
        validateInput: (value) => value.trim() ? null : 'Workspace name cannot be empty'
      });
      if (!name) { return; }
      
      const tags = ['ssh', 'remote', 'workspace'];
      if (hostname) {
        tags.push(hostname);
      }
      
      await store.addProject({ 
        name: name.trim(), 
        path: input.trim(), 
        description: '',
        type: 'ssh-workspace', 
        color: '#8b5cf6', 
        tags 
      });
      outlineProvider.refresh();
      managerProvider.postState();
      vscode.window.showInformationMessage(`Added SSH workspace: ${name}`);
    }),
    vscode.commands.registerCommand('projectPilot.addCurrentFolder', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('No folder is currently open');
        return;
      }
      
      const defaultName = workspaceFolder.name;
      const name = await vscode.window.showInputBox({ 
        prompt: 'Project name', 
        value: defaultName,
        validateInput: (value) => value.trim() ? null : 'Project name cannot be empty'
      });
      if (!name) { return; }
      
      const tags = await detectProjectTags(workspaceFolder.uri.fsPath);
      await store.addProject({ 
        name: name.trim(), 
        path: workspaceFolder.uri.fsPath, 
        description: '',
        type: 'local', 
        color: '#3b82f6', 
        tags 
      });
      outlineProvider.refresh();
      managerProvider.postState();
      vscode.window.showInformationMessage(`Added current folder as project: ${name}`);
    }),
    vscode.commands.registerCommand('projectPilot.scanWorkspaceFolders', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folders found');
        return;
      }
      
      let addedCount = 0;
      for (const folder of workspaceFolders) {
        // Check if project already exists
        const exists = store.state.projects.some(p => p.path === folder.uri.fsPath);
        if (!exists) {
          const tags = await detectProjectTags(folder.uri.fsPath);
          await store.addProject({
            name: folder.name,
            path: folder.uri.fsPath,
            description: '',
            type: 'local',
            color: '#3b82f6',
            tags
          });
          addedCount++;
        }
      }
      
      outlineProvider.refresh();
      managerProvider.postState();
      vscode.window.showInformationMessage(`Added ${addedCount} workspace folders as projects`);
    }),
    vscode.commands.registerCommand('projectPilot.importConfig', async () => {
      const uri = await vscode.window.showOpenDialog({ 
        canSelectFiles: true, 
        filters: { 'JSON Files': ['json'] },
        title: 'Import Project Pilot Configuration'
      });
      if (!uri) { return; }
      
      try {
      await store.importFromFile(uri[0]);
      outlineProvider.refresh();
      managerProvider.postState();
        vscode.window.showInformationMessage('Configuration imported successfully');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to import configuration: ${error}`);
      }
    }),
    vscode.commands.registerCommand('projectPilot.exportConfig', async () => {
      const uri = await vscode.window.showSaveDialog({ 
        filters: { 'JSON Files': ['json'] }, 
        saveLabel: 'Export Project Pilot Configuration',
        defaultUri: vscode.Uri.file('project-pilot-config.json')
      });
      if (!uri) { return; }
      
      try {
      await store.exportToFile(uri);
        vscode.window.showInformationMessage('Configuration exported successfully');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to export configuration: ${error}`);
      }
    }),
    vscode.commands.registerCommand('projectPilot.showConfigPath', async () => {
      const configPath = await store.getConfigPath();
      const choice = await vscode.window.showInformationMessage(
        `Local configuration file: ${configPath}\n\nNote: All project configurations (including SSH remotes) are stored locally on your machine.`,
        'Open File', 'Copy Path', 'Show in Explorer'
      );
      
      if (choice === 'Open File') {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
        await vscode.window.showTextDocument(doc);
      } else if (choice === 'Copy Path') {
        await vscode.env.clipboard.writeText(configPath);
        vscode.window.showInformationMessage('Configuration path copied to clipboard');
      } else if (choice === 'Show in Explorer') {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(configPath));
      }
    }),
    vscode.commands.registerCommand('projectPilot.restoreBackup', async () => {
      const backups = await store.getBackupFiles();
      if (backups.length === 0) {
        vscode.window.showInformationMessage('No backup files found');
        return;
      }
      
      const items = backups.map(backup => {
        const filename = path.basename(backup.fsPath);
        const timestamp = filename.replace('projects-backup-', '').replace('.json', '').replace(/-/g, ':');
        return {
          label: `Backup from ${new Date(timestamp).toLocaleString()}`,
          description: filename,
          backup
        };
      });
      
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a backup to restore'
      });
      
      if (!selected) return;
      
      const confirm = await vscode.window.showWarningMessage(
        'This will replace your current configuration. Are you sure?',
        { modal: true },
        'Yes, Restore'
      );
      
      if (confirm === 'Yes, Restore') {
        try {
          await store.importFromFile(selected.backup);
          outlineProvider.refresh();
          managerProvider.postState();
          vscode.window.showInformationMessage('Configuration restored from backup');
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to restore backup: ${error}`);
        }
      }
    }),
    vscode.commands.registerCommand('projectPilot.createBackup', async () => {
      try {
        await store.createBackup();
        vscode.window.showInformationMessage('Backup created successfully');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create backup: ${error}`);
      }
    }),
    vscode.commands.registerCommand('projectPilot.testSshConnection', async () => {
      const sshProjects = store.state.projects.filter(p => p.type === 'ssh');
      if (sshProjects.length === 0) {
        vscode.window.showInformationMessage('No SSH projects found');
        return;
      }
      
      const items = sshProjects.map(p => ({
        label: p.name,
        description: p.path,
        project: p
      }));
      
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an SSH project to test'
      });
      
      if (!selected) return;
      
      await testSshConnection(selected.project);
    }),
    vscode.commands.registerCommand('projectPilot.openConfigFile', async () => {
      try {
        const configPath = await store.getConfigPath();
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage('Configuration file opened. Changes will be applied after saving.');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open configuration file: ${error}`);
      }
    }),
    vscode.commands.registerCommand('projectPilot.refreshOutline', () => {
      outlineProvider.refresh();
      managerProvider.postState();
      vscode.window.showInformationMessage('Project Pilot outline refreshed');
    }),
    vscode.commands.registerCommand('projectPilot.toggleOutlineView', () => {
      outlineProvider.toggleView();
      vscode.window.showInformationMessage('Outline view toggled');
    }),
    vscode.commands.registerCommand('projectPilot.syncConfig', async () => {
      const choice = await vscode.window.showQuickPick([
        {
          label: '📤 Export to File',
          description: 'Export configuration to a file for manual sharing',
          action: 'export'
        },
        {
          label: '📁 Export to Default Location',
          description: 'Export to a standard location for easy sharing',
          action: 'exportDefault'
        },
        {
          label: '📥 Import from File',
          description: 'Import configuration from a file',
          action: 'import'
        },
        {
          label: '🔄 Replace Current Config',
          description: 'Replace current config with imported one (creates backup)',
          action: 'replace'
        },
        {
          label: '📝 Edit JSON',
          description: 'Edit current JSON configuration file',
          action: 'editJson'
        }
      ], {
        placeHolder: 'Choose sync action'
      });

      if (!choice) return;

      try {
        switch (choice.action) {
          case 'export':
            await vscode.commands.executeCommand('projectPilot.exportConfig');
            break;
          
          case 'exportDefault':
            const defaultExportPath = vscode.Uri.joinPath(
              vscode.Uri.file(require('os').homedir()), 
              'project-pilot-config.json'
            );
            await store.exportToFile(defaultExportPath);
            vscode.window.showInformationMessage(`Configuration exported to: ${defaultExportPath.fsPath}`);
            break;
          
          case 'import':
            await vscode.commands.executeCommand('projectPilot.importConfig');
            break;
          
          case 'replace':
            const uri = await vscode.window.showOpenDialog({ 
              canSelectFiles: true, 
              filters: { 'JSON Files': ['json'] },
              title: 'Select Configuration to Replace Current'
            });
            if (!uri) return;
            
            const confirm = await vscode.window.showWarningMessage(
              'This will completely replace your current configuration. A backup will be created. Continue?',
              { modal: true },
              'Yes, Replace'
            );
            
            if (confirm === 'Yes, Replace') {
              await store.createBackup();
              await store.importFromFile(uri[0]);
              outlineProvider.refresh();
              managerProvider.postState();
              vscode.window.showInformationMessage('Configuration replaced successfully');
            }
            break;
          
          case 'editJson':
            await vscode.commands.executeCommand('projectPilot.openConfigFile');
            break;
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Sync failed: ${error}`);
      }
    }),
    vscode.commands.registerCommand('projectPilot.addToFavorites', async (item?: any) => {
      // 从outline tree view获取项目
      if (item?.project?.id) {
        await store.toggleFavorite(item.project.id);
        vscode.window.showInformationMessage(`Added "${item.project.name}" to favorites`);
      }
    }),
    vscode.commands.registerCommand('projectPilot.removeFromFavorites', async (item?: any) => {
      // 从outline tree view获取项目
      if (item?.project?.id) {
        await store.toggleFavorite(item.project.id);
        vscode.window.showInformationMessage(`Removed "${item.project.name}" from favorites`);
      }
    })
  );

  function openProject(item: ProjectItem) {
    if (item.type === 'local') {
      vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(item.path), {
        forceNewWindow: true
      });
    } else if (item.type === 'workspace') {
      vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(item.path), {
        forceNewWindow: true
      });
    } else if (item.type === 'ssh') {
      openSshProject(item);
    } else if (item.type === 'ssh-workspace') {
      openSshWorkspace(item);
    }
  }

  function openSshProject(item: ProjectItem) {
    try {
      // SSH 项目通过本地存储的连接信息打开远程项目
      // 项目配置始终保存在本地，不需要在远程服务器上安装扩展
      let uri: vscode.Uri;
      
      if (item.path.startsWith('vscode-remote://')) {
        // Already a vscode-remote URI
        uri = vscode.Uri.parse(item.path);
      } else if (item.path.includes('@') && item.path.includes(':')) {
        // Format: user@hostname:/path - 标准SSH格式
        const [userHost, remotePath] = item.path.split(':');
        const encodedHost = encodeURIComponent(userHost);
        uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${encodedHost}${remotePath}`);
      } else {
        // Fallback - try to parse as is
        const encodedPath = encodeURIComponent(item.path);
        uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${encodedPath}`);
      }
      
      // 使用 VSCode 的 Remote-SSH 功能打开远程项目
      vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open SSH project "${item.name}": ${error}`);
      
      // Offer to edit the project
      vscode.window.showInformationMessage(
        'Would you like to edit the SSH connection string?',
        'Edit Project'
      ).then(choice => {
        if (choice === 'Edit Project') {
          vscode.commands.executeCommand('projectPilot.showManager');
        }
      });
    }
  }

  function openSshWorkspace(item: ProjectItem) {
    try {
      // SSH workspace 通过 Remote-SSH 打开远程 .code-workspace 文件
      let uri: vscode.Uri;
      
      if (item.path.startsWith('vscode-remote://')) {
        // Already a vscode-remote URI
        uri = vscode.Uri.parse(item.path);
      } else if (item.path.includes('@') && item.path.includes(':')) {
        // Format: user@hostname:/path/to/workspace.code-workspace - 标准SSH格式
        const [userHost, remotePath] = item.path.split(':');
        const encodedHost = encodeURIComponent(userHost);
        uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${encodedHost}${remotePath}`);
      } else {
        // Fallback - try to parse as is
        const encodedPath = encodeURIComponent(item.path);
        uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${encodedPath}`);
      }
      
      // 使用 VSCode 的 Remote-SSH 功能打开远程 workspace 文件
      vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open SSH workspace "${item.name}": ${error}`);
      
      // Offer to edit the project
      vscode.window.showInformationMessage(
        'Would you like to edit the SSH workspace path?',
        'Edit Project'
      ).then(choice => {
        if (choice === 'Edit Project') {
          vscode.commands.executeCommand('projectPilot.showManager');
        }
      });
    }
  }

  async function testSshConnection(project: ProjectItem) {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    statusBarItem.text = `$(sync~spin) Testing SSH connection to ${project.name}...`;
    statusBarItem.show();
    
    try {
      // Try to parse the SSH connection
      let uri: vscode.Uri;
      
      if (project.path.startsWith('vscode-remote://')) {
        uri = vscode.Uri.parse(project.path);
      } else if (project.path.includes('@') && project.path.includes(':')) {
        const [userHost, remotePath] = project.path.split(':');
        const encodedHost = encodeURIComponent(userHost);
        uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${encodedHost}${remotePath}`);
      } else {
        throw new Error('Invalid SSH connection string format');
      }
      
      // Try to get the remote authority
      const authority = uri.authority;
      if (!authority) {
        throw new Error('Could not extract remote authority from URI');
      }
      
      // Check if Remote-SSH extension is installed
      const remoteSSHExtension = vscode.extensions.getExtension('ms-vscode-remote.remote-ssh');
      if (!remoteSSHExtension) {
        statusBarItem.hide();
        vscode.window.showWarningMessage(
          'Remote-SSH extension is not installed. Please install it to use SSH projects.',
          'Install Extension'
        ).then(choice => {
          if (choice === 'Install Extension') {
            vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-ssh');
          }
        });
        return;
      }
      
      statusBarItem.text = `$(check) SSH connection test completed for ${project.name}`;
      setTimeout(() => statusBarItem.hide(), 3000);
      
      const choice = await vscode.window.showInformationMessage(
        `SSH connection string appears valid for "${project.name}". Would you like to test by opening the project?`,
        'Open Project', 'Cancel'
      );
      
      if (choice === 'Open Project') {
        openSshProject(project);
      }
      
    } catch (error) {
      statusBarItem.hide();
      const choice = await vscode.window.showErrorMessage(
        `SSH connection test failed for "${project.name}": ${error}`,
        'Edit Project', 'Cancel'
      );
      
      if (choice === 'Edit Project') {
        vscode.commands.executeCommand('projectPilot.showManager');
      }
    }
  }
}

async function detectProjectTags(projectPath: string): Promise<string[]> {
  const tags: string[] = [];
  
  try {
    const files = await fs.promises.readdir(projectPath);
    
    // Check for common files and directories
    const fileChecks = [
      { files: ['package.json'], tags: ['node', 'javascript'] },
      { files: ['requirements.txt', 'setup.py', 'pyproject.toml'], tags: ['python'] },
      { files: ['Cargo.toml'], tags: ['rust'] },
      { files: ['go.mod', 'go.sum'], tags: ['go'] },
      { files: ['pom.xml', 'build.gradle'], tags: ['java'] },
      { files: ['Gemfile'], tags: ['ruby'] },
      { files: ['composer.json'], tags: ['php'] },
      { files: ['pubspec.yaml'], tags: ['dart', 'flutter'] },
      { files: ['CMakeLists.txt'], tags: ['c++', 'cmake'] },
      { files: ['Makefile'], tags: ['c', 'make'] },
      { files: ['Dockerfile'], tags: ['docker'] },
      { files: ['.gitignore'], tags: ['git'] },
      { files: ['README.md', 'readme.md'], tags: ['documentation'] }
    ];
    
    for (const check of fileChecks) {
      if (check.files.some(file => files.includes(file))) {
        tags.push(...check.tags);
      }
    }
    
    // Check for specific directories
    const dirChecks = [
      { dirs: ['node_modules'], tags: ['node'] },
      { dirs: ['.git'], tags: ['git'] },
      { dirs: ['src', 'lib'], tags: ['source'] },
      { dirs: ['test', 'tests', '__tests__'], tags: ['testing'] },
      { dirs: ['docs', 'doc'], tags: ['documentation'] },
      { dirs: ['.vscode'], tags: ['vscode'] },
      { dirs: ['dist', 'build'], tags: ['build'] }
    ];
    
    for (const check of dirChecks) {
      if (check.dirs.some(dir => files.includes(dir))) {
        tags.push(...check.tags);
      }
    }
    
    // Check package.json for more specific info
    if (files.includes('package.json')) {
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
        
        if (packageJson.dependencies || packageJson.devDependencies) {
          const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
          
          if (deps.react || deps['@types/react']) tags.push('react');
          if (deps.vue || deps['@vue/cli']) tags.push('vue');
          if (deps.angular || deps['@angular/core']) tags.push('angular');
          if (deps.next || deps.nuxt) tags.push('ssr');
          if (deps.express || deps.koa || deps.fastify) tags.push('backend', 'api');
          if (deps.typescript || deps['@types/node']) tags.push('typescript');
          if (deps.webpack || deps.vite || deps.rollup) tags.push('bundler');
          if (deps.jest || deps.mocha || deps.cypress) tags.push('testing');
          if (deps.tailwindcss || deps.bootstrap) tags.push('css', 'ui');
          if (deps.electron) tags.push('electron', 'desktop');
        }
        
        if (packageJson.scripts) {
          if (packageJson.scripts.dev || packageJson.scripts.start) tags.push('webapp');
          if (packageJson.scripts.build) tags.push('build');
          if (packageJson.scripts.test) tags.push('testing');
        }
      } catch (error) {
        // Ignore package.json parsing errors
      }
    }
    
  } catch (error) {
    // Ignore directory reading errors
  }
  
  // Remove duplicates and return
  return [...new Set(tags)];
}

// Cross-platform utility functions
function normalizePath(filePath: string): string {
  return path.normalize(filePath);
}

function getProjectName(projectPath: string): string {
  return path.basename(projectPath);
}

function isValidPath(pathStr: string): boolean {
  try {
    path.parse(pathStr);
    return true;
  } catch {
    return false;
  }
}

let globalStore: ConfigStore;

export function deactivate() {
  console.log('Project Pilot: Extension deactivating...');
  if (globalStore) {
    globalStore.dispose();
  }
}

// 生成全屏视图的 HTML
function getFullscreenHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const dist = vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'assets', 'index.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'assets', 'index.css'));
  const nonce = getNonce();

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:; connect-src ${webview.cspSource};" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Project Pilot</title>
    <style>
      body { padding: 20px; }
    </style>
  </head>
  <body>
    <div id="root">
      <div style="padding: 20px; text-align: center; color: #666;">
        Loading Project Pilot...
      </div>
    </div>
    <script nonce="${nonce}">
      console.log('Project Pilot Fullscreen: HTML loaded');
      window.addEventListener('error', (e) => {
        console.error('Project Pilot Error:', e.error);
      });
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
  </html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// 处理 Webview 消息的通用函数
// 注意：Store 的方法会自动触发 onChangeCallback，从而更新所有视图（sidebar、fullscreen、outline）
async function handleWebviewMessage(
  msg: any, 
  webview: vscode.Webview, 
  store: ConfigStore
) {
  if (msg.type === 'requestState') {
    webview.postMessage({ type: 'state', payload: store.state });
  } else if (msg.type === 'refreshUI') {
    // 重新加载配置并刷新所有视图
    await store.reload();
    vscode.window.showInformationMessage('Project Pilot UI refreshed');
  } else if (msg.type === 'addLocal') {
    await vscode.commands.executeCommand('projectPilot.addLocalProject');
  } else if (msg.type === 'addOrUpdate') {
    // Store 的 upsertProject 会触发 onChangeCallback，自动更新所有视图
    await store.upsertProject(msg.payload);
  } else if (msg.type === 'delete') {
    // Store 的 deleteProject 会触发 onChangeCallback，自动更新所有视图
    await store.deleteProject(msg.payload.id);
  } else if (msg.type === 'open') {
    await vscode.commands.executeCommand('projectPilot.openProject', msg.payload);
  } else if (msg.type === 'import') {
    await vscode.commands.executeCommand('projectPilot.importConfig');
    // import 完成后 store 状态已更新，onChangeCallback 会自动触发
  } else if (msg.type === 'export') {
    await vscode.commands.executeCommand('projectPilot.exportConfig');
  } else if (msg.type === 'openConfig') {
    await vscode.commands.executeCommand('projectPilot.openConfigFile');
  } else if (msg.type === 'sync') {
    await vscode.commands.executeCommand('projectPilot.syncConfig');
  } else if (msg.type === 'updateUISettings') {
    // Store 的 updateUISettings 会触发 onChangeCallback，自动更新所有视图
    await store.updateUISettings(msg.payload);
  } else if (msg.type === 'recordProjectAccess') {
    // Store 的 recordProjectAccess 会触发 onChangeCallback，自动更新所有视图
    await store.recordProjectAccess(msg.payload.id);
  } else if (msg.type === 'toggleFavorite') {
    // Store 的 toggleFavorite 会触发 onChangeCallback，自动更新所有视图
    await store.toggleFavorite(msg.payload.id);
  } else if (msg.type === 'browseFolder') {
    const result = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Select Project Folder',
      defaultUri: msg.payload.currentPath ? vscode.Uri.file(msg.payload.currentPath) : undefined
    });
    if (result && result[0]) {
      webview.postMessage({ 
        type: 'pathSelected', 
        payload: { path: result[0].fsPath, inputType: 'folder' } 
      });
    }
  } else if (msg.type === 'browseWorkspace') {
    const result = await vscode.window.showOpenDialog({
      canSelectFolders: false,
      canSelectFiles: true,
      canSelectMany: false,
      title: 'Select Workspace File',
      filters: { 'Workspace Files': ['code-workspace'] },
      defaultUri: msg.payload.currentPath ? vscode.Uri.file(msg.payload.currentPath) : undefined
    });
    if (result && result[0]) {
      webview.postMessage({ 
        type: 'pathSelected', 
        payload: { path: result[0].fsPath, inputType: 'workspace' } 
      });
    }
  } else if (msg.type === 'browseSshFolder' || msg.type === 'browseSshWorkspace') {
    const remoteInfo = getRemoteInfo();
    
    if (!remoteInfo.isRemote) {
      webview.postMessage({ 
        type: 'sshBrowseResult', 
        payload: { 
          success: false, 
          message: 'Not connected to a remote SSH host. Please connect to an SSH remote first, or manually enter the path.',
          isRemote: false
        } 
      });
      return;
    }
    
    const isWorkspace = msg.type === 'browseSshWorkspace';
    const result = await vscode.window.showOpenDialog({
      canSelectFolders: !isWorkspace,
      canSelectFiles: isWorkspace,
      canSelectMany: false,
      title: isWorkspace ? 'Select Remote Workspace File' : 'Select Remote Folder',
      filters: isWorkspace ? { 'Workspace Files': ['code-workspace'] } : undefined
    });
    
    if (result && result[0]) {
      const remotePath = result[0].path;
      const sshPath = `${remoteInfo.sshHost}:${remotePath}`;
      
      webview.postMessage({ 
        type: 'pathSelected', 
        payload: { 
          path: sshPath, 
          inputType: isWorkspace ? 'ssh-workspace' : 'ssh',
          remotePath: remotePath,
          sshHost: remoteInfo.sshHost
        } 
      });
    }
  } else if (msg.type === 'checkRemoteStatus') {
    const remoteInfo = getRemoteInfo();
    webview.postMessage({ type: 'remoteStatus', payload: remoteInfo });
  } else if (msg.type === 'testConnection') {
    const result = await testSshConnectionFormat(msg.payload);
    webview.postMessage({ type: 'connectionTestResult', payload: result });
  }
}

function getRemoteInfo(): { isRemote: boolean; remoteName?: string; sshHost?: string } {
  const remoteName = vscode.env.remoteName;
  
  if (!remoteName) {
    return { isRemote: false };
  }
  
  if (remoteName === 'ssh-remote') {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const uri = workspaceFolder.uri;
      if (uri.scheme === 'vscode-remote' && uri.authority.startsWith('ssh-remote+')) {
        const sshHost = decodeURIComponent(uri.authority.replace('ssh-remote+', ''));
        return { isRemote: true, remoteName, sshHost };
      }
    }
    return { isRemote: true, remoteName };
  }
  
  return { isRemote: false, remoteName };
}

async function testSshConnectionFormat(payload: { path: string; name: string; type?: string }): Promise<{ success: boolean; message: string }> {
  if (!payload.path.trim()) {
    return { success: false, message: 'SSH path cannot be empty' };
  }

  const isSshWorkspace = payload.type === 'ssh-workspace' || payload.path.endsWith('.code-workspace');

  if (payload.path.startsWith('vscode-remote://')) {
    if (isSshWorkspace && !payload.path.endsWith('.code-workspace')) {
      return { success: false, message: 'SSH workspace path should end with .code-workspace' };
    }
    return { success: true, message: 'VSCode remote URI format is valid' };
  } else if (payload.path.includes('@') && payload.path.includes(':')) {
    const [userHost, remotePath] = payload.path.split(':');
    if (!userHost.includes('@')) {
      return { success: false, message: 'Invalid format: missing @ in user@hostname part' };
    }
    if (!remotePath || remotePath.trim() === '') {
      return { success: false, message: 'Invalid format: missing remote path after :' };
    }
    if (isSshWorkspace && !remotePath.endsWith('.code-workspace')) {
      return { success: false, message: 'SSH workspace path should end with .code-workspace' };
    }
    return { success: true, message: 'SSH connection format is valid' };
  } else {
    return { success: false, message: 'Invalid SSH format. Use: user@hostname:/path' };
  }
}
