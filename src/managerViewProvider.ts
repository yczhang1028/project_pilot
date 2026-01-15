import * as vscode from 'vscode';
import { ConfigStore } from './store';

export class ManagerViewProvider implements vscode.WebviewViewProvider {
  private currentView?: vscode.WebviewView;
  constructor(private readonly context: vscode.ExtensionContext, private readonly store: ConfigStore) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview-ui', 'dist')]
    };
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      console.log('Project Pilot: Received message from webview', msg);
      
      if (msg.type === 'requestState') {
        console.log('Project Pilot: Sending state to webview');
        this.postState(webviewView);
      } else if (msg.type === 'addLocal') {
        await vscode.commands.executeCommand('projectPilot.addLocalProject');
      } else if (msg.type === 'addOrUpdate') {
        await this.store.upsertProject(msg.payload);
        this.postState(webviewView);
      } else if (msg.type === 'delete') {
        await this.store.deleteProject(msg.payload.id);
        this.postState(webviewView);
      } else if (msg.type === 'open') {
        await vscode.commands.executeCommand('projectPilot.openProject', msg.payload);
      } else if (msg.type === 'import') {
        await vscode.commands.executeCommand('projectPilot.importConfig');
        this.postState(webviewView);
      } else if (msg.type === 'export') {
        await vscode.commands.executeCommand('projectPilot.exportConfig');
      } else if (msg.type === 'openConfig') {
        await vscode.commands.executeCommand('projectPilot.openConfigFile');
      } else if (msg.type === 'sync') {
        await vscode.commands.executeCommand('projectPilot.syncConfig');
      } else if (msg.type === 'testConnection') {
        // 测试SSH连接
        const result = await this.testSshConnection(msg.payload);
        webviewView.webview.postMessage({ type: 'connectionTestResult', payload: result });
      } else if (msg.type === 'updateUISettings') {
        await this.store.updateUISettings(msg.payload);
        this.postState(webviewView);
      } else if (msg.type === 'updateConfig') {
        const config = vscode.workspace.getConfiguration('projectPilot');
        if (typeof msg.payload?.autoOpenFullscreen === 'boolean') {
          await config.update('autoOpenFullscreen', msg.payload.autoOpenFullscreen, vscode.ConfigurationTarget.Global);
          await vscode.commands.executeCommand('projectPilot.refreshAllViews');
        }
      } else if (msg.type === 'refreshUI') {
        await this.store.reload();
        vscode.window.showInformationMessage('Project Pilot UI refreshed');
      } else if (msg.type === 'recordProjectAccess') {
        await this.store.recordProjectAccess(msg.payload.id);
        this.postState(webviewView);
      } else if (msg.type === 'toggleFavorite') {
        await this.store.toggleFavorite(msg.payload.id);
        this.postState(webviewView);
      } else if (msg.type === 'browseFolder') {
        const result = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          title: 'Select Project Folder',
          defaultUri: msg.payload.currentPath ? vscode.Uri.file(msg.payload.currentPath) : undefined
        });
        if (result && result[0]) {
          webviewView.webview.postMessage({ 
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
          filters: {
            'Workspace Files': ['code-workspace']
          },
          defaultUri: msg.payload.currentPath ? vscode.Uri.file(msg.payload.currentPath) : undefined
        });
        if (result && result[0]) {
          webviewView.webview.postMessage({ 
            type: 'pathSelected', 
            payload: { path: result[0].fsPath, inputType: 'workspace' } 
          });
        }
      } else if (msg.type === 'browseSshFolder' || msg.type === 'browseSshWorkspace') {
        // 检测是否在远程环境中
        const remoteInfo = this.getRemoteInfo();
        
        if (!remoteInfo.isRemote) {
          // 不在远程环境，提示用户
          webviewView.webview.postMessage({ 
            type: 'sshBrowseResult', 
            payload: { 
              success: false, 
              message: 'Not connected to a remote SSH host. Please connect to an SSH remote first, or manually enter the path.',
              isRemote: false
            } 
          });
          return;
        }
        
        // 在远程环境中，打开文件/文件夹选择器
        const isWorkspace = msg.type === 'browseSshWorkspace';
        const result = await vscode.window.showOpenDialog({
          canSelectFolders: !isWorkspace,
          canSelectFiles: isWorkspace,
          canSelectMany: false,
          title: isWorkspace ? 'Select Remote Workspace File' : 'Select Remote Folder',
          filters: isWorkspace ? { 'Workspace Files': ['code-workspace'] } : undefined
        });
        
        if (result && result[0]) {
          // 拼接完整的 SSH 路径
          const remotePath = result[0].path;
          const sshPath = `${remoteInfo.sshHost}:${remotePath}`;
          
          webviewView.webview.postMessage({ 
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
        // 检查当前是否在远程环境
        const remoteInfo = this.getRemoteInfo();
        webviewView.webview.postMessage({ 
          type: 'remoteStatus', 
          payload: remoteInfo
        });
      }
    });
    this.currentView = webviewView;
    webviewView.onDidDispose(() => {
      if (this.currentView === webviewView) this.currentView = undefined;
    });
    webviewView.webview.html = this.getHtml(webviewView.webview);
    this.postState(webviewView);
  }

  postState(view?: vscode.WebviewView) {
    const autoOpenFullscreen = vscode.workspace.getConfiguration('projectPilot').get('autoOpenFullscreen', true);
    const message = { 
      type: 'state', 
      payload: { 
        ...this.store.state, 
        config: { autoOpenFullscreen } 
      } 
    } as const;
    console.log('Project Pilot: Posting state to webview', message);
    (view ?? this.currentView)?.webview.postMessage(message);
  }

  private getRemoteInfo(): { isRemote: boolean; remoteName?: string; sshHost?: string } {
    // 检测是否在远程环境中
    const remoteName = vscode.env.remoteName;
    
    if (!remoteName) {
      return { isRemote: false };
    }
    
    // 检查是否是 SSH 远程
    if (remoteName === 'ssh-remote') {
      // 尝试从工作区获取 SSH 主机信息
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        const uri = workspaceFolder.uri;
        // SSH URI 格式: vscode-remote://ssh-remote+user@hostname/path
        if (uri.scheme === 'vscode-remote' && uri.authority.startsWith('ssh-remote+')) {
          const sshHost = decodeURIComponent(uri.authority.replace('ssh-remote+', ''));
          return { isRemote: true, remoteName, sshHost };
        }
      }
      return { isRemote: true, remoteName };
    }
    
    return { isRemote: false, remoteName };
  }

  private async testSshConnection(payload: { path: string; name: string; type?: string }): Promise<{ success: boolean; message: string }> {
    try {
      // 基本格式验证
      if (!payload.path.trim()) {
        return { success: false, message: 'SSH path cannot be empty' };
      }

      const isSshWorkspace = payload.type === 'ssh-workspace' || payload.path.endsWith('.code-workspace');

      // 检查SSH格式
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
    } catch (error) {
      return { success: false, message: `Connection test failed: ${error}` };
    }
  }

  private getHtml(webview: vscode.Webview) {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'webview-ui', 'dist');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'assets', 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'assets', 'index.css'));
    const nonce = getNonce();
    
    // 调试信息
    console.log('Project Pilot: Loading webview resources');
    console.log('Script URI:', scriptUri.toString());
    console.log('Style URI:', styleUri.toString());
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:; connect-src ${webview.cspSource};" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link href="${styleUri}" rel="stylesheet" />
      <title>Project Pilot</title>
    </head>
    <body>
      <div id="root">
        <div style="padding: 20px; text-align: center; color: #666;">
          Loading Project Pilot...
        </div>
      </div>
      <script nonce="${nonce}">
        console.log('Project Pilot: HTML loaded');
        window.addEventListener('error', (e) => {
          console.error('Project Pilot Error:', e.error);
        });
      </script>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
