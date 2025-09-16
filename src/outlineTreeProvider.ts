import * as vscode from 'vscode';
import { ConfigStore, ProjectItem } from './store';

export class OutlineTreeProvider implements vscode.TreeDataProvider<ProjectItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ProjectItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: ConfigStore) {}

  refresh(element?: ProjectItem): void {
    this._onDidChangeTreeData.fire(element);
  }

  getTreeItem(element: ProjectItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    
    // 显示分组和路径信息
    const groupInfo = element.group ? `[${element.group}] ` : '';
    item.description = `${groupInfo}${element.path}`;
    
    // 丰富的tooltip信息
    let tooltip = `${element.name}`;
    if (element.description) tooltip += `\n${element.description}`;
    if (element.group) tooltip += `\n\nGroup: ${element.group}`;
    tooltip += `\nPath: ${element.path}`;
    tooltip += `\nType: ${element.type}`;
    if (element.tags && element.tags.length > 0) {
      tooltip += `\nTags: ${element.tags.join(', ')}`;
    }
    item.tooltip = tooltip;
    
    // 根据类型设置图标
    const typeIcons = {
      local: 'folder',
      workspace: 'file-code',
      ssh: 'remote'
    };
    
    item.iconPath = element.icon 
      ? vscode.Uri.parse(element.icon)  // 如果有自定义图标
      : new vscode.ThemeIcon(typeIcons[element.type], new vscode.ThemeColor(element.color || 'charts.blue'));
    
    item.command = { command: 'projectPilot.openProject', title: 'Open', arguments: [element] };
    contextValue(item, element);
    return item;
  }

  getChildren(): vscode.ProviderResult<ProjectItem[]> {
    return this.store.state.projects;
  }

  async pickProject(): Promise<ProjectItem | undefined> {
    const items = this.store.state.projects.map((p) => ({ label: p.name, description: p.path, detail: p.type, value: p }));
    const pick = await vscode.window.showQuickPick(items as any, { placeHolder: 'Select a project to open' }) as unknown as { value: ProjectItem } | undefined;
    return pick?.value;
  }
}

function contextValue(item: vscode.TreeItem, p: ProjectItem) {
  item.contextValue = `type:${p.type}`;
}
