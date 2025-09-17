import * as vscode from 'vscode';
import { ConfigStore, ProjectItem } from './store';

interface OutlineNode {
  type: 'group' | 'project';
  label: string;
  project?: ProjectItem;
  groupName?: string;
}

export class OutlineTreeProvider implements vscode.TreeDataProvider<OutlineNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OutlineNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private isGroupedView = true; // 默认使用分组视图

  constructor(private readonly store: ConfigStore) {}

  refresh(element?: OutlineNode): void {
    this._onDidChangeTreeData.fire(element);
  }

  toggleView(): void {
    this.isGroupedView = !this.isGroupedView;
    this.refresh();
  }

  getTreeItem(element: OutlineNode): vscode.TreeItem {
    if (element.type === 'group') {
      // 分组节点
      const item = new vscode.TreeItem(
        element.label, 
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = new vscode.ThemeIcon('folder');
      item.tooltip = `Group: ${element.groupName}\nProjects: ${element.label.match(/\((\d+)\)/)?.[1] || '0'}`;
      item.contextValue = 'group';
      return item;
    }

    // 项目节点
    const project = element.project!;
    const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.None);
    
    // 在分组视图中只显示路径，在平铺视图中显示分组和路径
    if (this.isGroupedView) {
      item.description = project.path;
    } else {
      const groupInfo = project.group ? `[${project.group}] ` : '';
      item.description = `${groupInfo}${project.path}`;
    }
    
    // 丰富的tooltip信息
    let tooltip = `${project.name}`;
    if (project.isFavorite) tooltip += ` ⭐`;
    if (project.description) tooltip += `\n${project.description}`;
    if (project.group) tooltip += `\n\nGroup: ${project.group}`;
    tooltip += `\nPath: ${project.path}`;
    tooltip += `\nType: ${project.type}`;
    if (project.tags && project.tags.length > 0) {
      tooltip += `\nTags: ${project.tags.join(', ')}`;
    }
    if (project.isFavorite) tooltip += `\n⭐ Favorited`;
    if (project.clickCount) tooltip += `\nAccessed: ${project.clickCount} times`;
    item.tooltip = tooltip;
    
    // 根据类型设置图标
    const typeIcons = {
      local: 'folder',
      workspace: 'file-code',
      ssh: 'remote'
    };
    
    // 为收藏项目设置特殊图标
    if (project.isFavorite) {
      item.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
    } else if (project.icon) {
      item.iconPath = vscode.Uri.parse(project.icon);  // 如果有自定义图标
    } else {
      item.iconPath = new vscode.ThemeIcon(typeIcons[project.type], new vscode.ThemeColor(project.color || 'charts.blue'));
    }
    
    item.command = { command: 'projectPilot.openProject', title: 'Open', arguments: [project] };
    contextValue(item, project);
    return item;
  }

  getChildren(element?: OutlineNode): vscode.ProviderResult<OutlineNode[]> {
    if (!this.isGroupedView) {
      // 平铺视图：直接返回所有项目
      return this.store.state.projects.map(project => ({
        type: 'project' as const,
        label: project.name,
        project
      }));
    }

    if (!element) {
      // 分组视图：返回分组节点
      const groups = new Set<string>();
      this.store.state.projects.forEach(project => {
        const group = project.group || 'Ungrouped';
        groups.add(group);
      });
      
      return Array.from(groups).sort().map(groupName => {
        const projectCount = this.store.state.projects.filter(p => 
          (p.group || 'Ungrouped') === groupName
        ).length;
        
        return {
          type: 'group' as const,
          label: `${groupName} (${projectCount})`,
          groupName
        };
      });
    }

    if (element.type === 'group') {
      // 返回指定分组的项目
      return this.store.state.projects
        .filter(project => (project.group || 'Ungrouped') === element.groupName)
        .map(project => ({
          type: 'project' as const,
          label: project.name,
          project
        }));
    }

    // 项目节点没有子节点
    return [];
  }

  async pickProject(): Promise<ProjectItem | undefined> {
    const items = this.store.state.projects.map((p) => ({ label: p.name, description: p.path, detail: p.type, value: p }));
    const pick = await vscode.window.showQuickPick(items as any, { placeHolder: 'Select a project to open' }) as unknown as { value: ProjectItem } | undefined;
    return pick?.value;
  }
}

function contextValue(item: vscode.TreeItem, p: ProjectItem) {
  const contexts = [`type:${p.type}`];
  if (p.isFavorite) {
    contexts.push('favorited');
  } else {
    contexts.push('not-favorited');
  }
  item.contextValue = contexts.join(',');
}
