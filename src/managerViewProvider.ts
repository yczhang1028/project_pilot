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
    const message = { type: 'state', payload: this.store.state } as const;
    console.log('Project Pilot: Posting state to webview', message);
    (view ?? this.currentView)?.webview.postMessage(message);
  }

  private async testSshConnection(payload: { path: string; name: string }): Promise<{ success: boolean; message: string }> {
    try {
      // 基本格式验证
      if (!payload.path.trim()) {
        return { success: false, message: 'SSH path cannot be empty' };
      }

      // 检查SSH格式
      if (payload.path.startsWith('vscode-remote://')) {
        return { success: true, message: 'VSCode remote URI format is valid' };
      } else if (payload.path.includes('@') && payload.path.includes(':')) {
        const [userHost, remotePath] = payload.path.split(':');
        if (!userHost.includes('@')) {
          return { success: false, message: 'Invalid format: missing @ in user@hostname part' };
        }
        if (!remotePath || remotePath.trim() === '') {
          return { success: false, message: 'Invalid format: missing remote path after :' };
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
