import * as vscode from 'vscode';
import { extractHostnameFromSshPath } from './sshPath';
import { ConfigStore, ProjectItem } from './store';

export type OutlineMode = 'group' | 'target' | 'type' | 'flat';

interface OutlineNode {
  id: string;
  type: 'section' | 'group' | 'project';
  label: string;
  project?: ProjectItem;
  groupName?: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  iconColor?: string;
  children?: OutlineNode[];
  sectionKind?: 'favorites' | 'recent' | 'mode-root';
}

const OUTLINE_EXPANSION_KEY = 'projectPilot.outlineExpansionState';
const OUTLINE_MODE_ORDER: OutlineMode[] = ['group', 'target', 'type', 'flat'];

export class OutlineTreeProvider implements vscode.TreeDataProvider<OutlineNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OutlineNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private outlineMode: OutlineMode;
  private expandedState: Record<string, boolean>;

  constructor(
    private readonly store: ConfigStore,
    private readonly workspaceState: vscode.Memento,
    initialMode: OutlineMode = 'group'
  ) {
    this.outlineMode = initialMode;
    this.expandedState = this.workspaceState.get<Record<string, boolean>>(OUTLINE_EXPANSION_KEY, {});
  }

  refresh(element?: OutlineNode): void {
    this._onDidChangeTreeData.fire(element);
  }

  getMode(): OutlineMode {
    return this.outlineMode;
  }

  getModeLabel(): string {
    const labels: Record<OutlineMode, string> = {
      group: 'By Group',
      target: 'By Target',
      type: 'By Type',
      flat: 'Flat'
    };
    return labels[this.outlineMode];
  }

  setMode(mode: OutlineMode): void {
    this.outlineMode = mode;
    this.refresh();
  }

  cycleMode(): OutlineMode {
    const currentIndex = OUTLINE_MODE_ORDER.indexOf(this.outlineMode);
    const nextMode = OUTLINE_MODE_ORDER[(currentIndex + 1) % OUTLINE_MODE_ORDER.length];
    this.setMode(nextMode);
    return nextMode;
  }

  async setExpandedState(element: OutlineNode, expanded: boolean): Promise<void> {
    if (element.type === 'project') {
      return;
    }

    this.expandedState[element.id] = expanded;
    await this.workspaceState.update(OUTLINE_EXPANSION_KEY, this.expandedState);
  }

  getTreeItem(element: OutlineNode): vscode.TreeItem {
    if (element.type === 'project') {
      return this.getProjectTreeItem(element);
    }

    const item = new vscode.TreeItem(
      element.label,
      this.getCollapsibleState(element.id, true)
    );
    item.id = element.id;
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = new vscode.ThemeIcon(
      element.icon || (element.type === 'section' ? 'library' : 'folder'),
      element.iconColor ? new vscode.ThemeColor(element.iconColor) : undefined
    );
    item.contextValue = element.type === 'section'
      ? `outline-section,section:${element.sectionKind}`
      : `outline-group,mode:${this.outlineMode}`;
    return item;
  }

  getChildren(element?: OutlineNode): vscode.ProviderResult<OutlineNode[]> {
    if (!element) {
      return this.getRootNodes();
    }

    return element.children ?? [];
  }

  async pickProject(): Promise<ProjectItem | undefined> {
    const items = this.sortProjects([...this.store.state.projects]).map((project) => ({
      label: project.name,
      description: this.getProjectDescription(project),
      detail: this.getQuickPickDetail(project),
      value: project
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a project to open'
    }) as { value: ProjectItem } | undefined;
    return pick?.value;
  }

  private getRootNodes(): OutlineNode[] {
    if (this.outlineMode === 'flat') {
      return this.sortProjects([...this.store.state.projects]).map(project =>
        this.buildProjectNode(project, 'flat')
      );
    }

    const nodes: OutlineNode[] = [];
    const favoriteProjects = this.sortProjects(this.store.state.projects.filter(project => project.isFavorite));
    const recentProjects = this.store.state.projects
      .filter(project => !!project.lastAccessed)
      .sort((a, b) => new Date(b.lastAccessed || 0).getTime() - new Date(a.lastAccessed || 0).getTime())
      .slice(0, 8);

    if (favoriteProjects.length > 0) {
      nodes.push({
        id: 'section:favorites',
        type: 'section',
        label: `Favorites (${favoriteProjects.length})`,
        description: 'Pinned projects',
        tooltip: 'Quick access to your favorite projects',
        icon: 'star-full',
        iconColor: 'charts.yellow',
        sectionKind: 'favorites',
        children: favoriteProjects.map(project => this.buildProjectNode(project, 'favorites'))
      });
    }

    if (recentProjects.length > 0) {
      nodes.push({
        id: 'section:recent',
        type: 'section',
        label: `Recent (${recentProjects.length})`,
        description: 'Recently opened',
        tooltip: 'Projects ordered by last accessed time',
        icon: 'history',
        iconColor: 'charts.blue',
        sectionKind: 'recent',
        children: recentProjects.map(project => this.buildProjectNode(project, 'recent'))
      });
    }

    nodes.push({
      id: `section:mode:${this.outlineMode}`,
      type: 'section',
      label: this.getModeRootLabel(),
      description: this.getModeLabel(),
      tooltip: `Browsing all projects in ${this.getModeLabel()} mode`,
      icon: this.getModeRootIcon(),
      iconColor: 'charts.blue',
      sectionKind: 'mode-root',
      children: this.getModeNodes()
    });

    return nodes;
  }

  private getModeNodes(): OutlineNode[] {
    switch (this.outlineMode) {
      case 'group':
        return this.buildGroupedNodes(project => project.group || 'Ungrouped');
      case 'target':
        return this.buildGroupedNodes(project => this.getProjectTarget(project));
      case 'type':
        return this.buildGroupedNodes(project => this.getProjectTypeLabel(project.type));
      case 'flat':
        return this.sortProjects([...this.store.state.projects]).map(project => this.buildProjectNode(project, 'flat'));
    }
  }

  private buildGroupedNodes(getGroupName: (project: ProjectItem) => string): OutlineNode[] {
    const groups = new Map<string, ProjectItem[]>();

    for (const project of this.store.state.projects) {
      const groupName = getGroupName(project);
      const existing = groups.get(groupName) || [];
      existing.push(project);
      groups.set(groupName, existing);
    }

    return Array.from(groups.entries())
      .sort(([left], [right]) => this.sortGroupNames(left, right))
      .map(([groupName, projects]) => ({
        id: `group:${this.outlineMode}:${groupName}`,
        type: 'group',
        label: `${groupName} (${projects.length})`,
        groupName,
        description: this.getGroupDescription(groupName, projects),
        tooltip: `Group: ${groupName}\nProjects: ${projects.length}`,
        icon: this.getGroupIcon(groupName),
        iconColor: this.getGroupIconColor(groupName),
        children: this.sortProjects(projects).map(project =>
          this.buildProjectNode(project, `${this.outlineMode}:${groupName}`)
        )
      }));
  }

  private buildProjectNode(project: ProjectItem, parentKey: string): OutlineNode {
    return {
      id: `project:${parentKey}:${project.id ?? project.path}`,
      type: 'project',
      label: project.name,
      project
    };
  }

  private getProjectTreeItem(element: OutlineNode): vscode.TreeItem {
    const project = element.project!;
    const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.description = this.getProjectDescription(project);
    item.tooltip = this.getProjectTooltip(project);
    item.iconPath = this.getProjectIcon(project);
    item.command = { command: 'projectPilot.openProject', title: 'Open', arguments: [project] };
    item.contextValue = this.getProjectContextValue(project);
    return item;
  }

  private getProjectDescription(project: ProjectItem): string {
    const shortPath = shortenPath(project.path);

    switch (this.outlineMode) {
      case 'group':
        return shortPath;
      case 'target':
        return `${this.getProjectTypeLabel(project.type)} • ${shortPath}`;
      case 'type':
        return `${project.group || 'Ungrouped'} • ${shortPath}`;
      case 'flat':
        return `${project.group || 'Ungrouped'} • ${shortPath}`;
    }
  }

  private getQuickPickDetail(project: ProjectItem): string {
    const detailParts = [this.getProjectTypeLabel(project.type), project.path];
    if (project.group) {
      detailParts.unshift(project.group);
    }
    return detailParts.join(' • ');
  }

  private getProjectTooltip(project: ProjectItem): string {
    const lines = [project.name];
    if (project.isFavorite) lines[0] += ' ⭐';
    if (project.description) lines.push(project.description);
    lines.push('');
    if (project.group) lines.push(`Group: ${project.group}`);
    lines.push(`Path: ${project.path}`);
    lines.push(`Type: ${project.type}`);
    if (project.tags && project.tags.length > 0) {
      lines.push(`Tags: ${project.tags.join(', ')}`);
    }
    if (project.clickCount) {
      lines.push(`Accessed: ${project.clickCount} times`);
    }
    if (project.lastAccessed) {
      lines.push(`Last opened: ${new Date(project.lastAccessed).toLocaleString()}`);
    }
    return lines.join('\n');
  }

  private getProjectIcon(project: ProjectItem): vscode.ThemeIcon | vscode.Uri {
    const typeConfig: Record<string, { icon: string; color: string }> = {
      local: { icon: 'folder-opened', color: 'charts.blue' },
      workspace: { icon: 'root-folder', color: 'charts.green' },
      ssh: { icon: 'vm', color: 'charts.orange' },
      'ssh-workspace': { icon: 'vm-connect', color: 'charts.purple' }
    };

    const config = typeConfig[project.type] || typeConfig.local;
    if (project.isFavorite) {
      return new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
    }
    if (project.icon) {
      return vscode.Uri.parse(project.icon);
    }
    return new vscode.ThemeIcon(config.icon, new vscode.ThemeColor(config.color));
  }

  private getProjectContextValue(project: ProjectItem): string {
    const contexts = ['outline-project', `type:${project.type}`];
    contexts.push(project.isFavorite ? 'favorited' : 'not-favorited');
    if (project.type === 'ssh' || project.type === 'ssh-workspace') {
      contexts.push('ssh-project');
    }
    if (project.group) {
      contexts.push('grouped-project');
    }
    return contexts.join(',');
  }

  private getProjectTarget(project: ProjectItem): string {
    if (project.type === 'local') {
      return 'Local Folders';
    }
    if (project.type === 'workspace') {
      return 'Workspace Files';
    }

    const host = extractHostnameFromSshPath(project.path);
    return host ? `SSH • ${host}` : 'SSH • Remote';
  }

  private getProjectTypeLabel(type: ProjectItem['type']): string {
    const labels: Record<ProjectItem['type'], string> = {
      local: 'Local Folder',
      workspace: 'Workspace File',
      ssh: 'SSH Remote',
      'ssh-workspace': 'SSH Workspace'
    };
    return labels[type];
  }

  private getModeRootLabel(): string {
    const labels: Record<Exclude<OutlineMode, 'flat'>, string> = {
      group: 'All Projects',
      target: 'Targets',
      type: 'Project Types'
    };
    return labels[this.outlineMode as Exclude<OutlineMode, 'flat'>] || 'All Projects';
  }

  private getModeRootIcon(): string {
    const icons: Record<Exclude<OutlineMode, 'flat'>, string> = {
      group: 'folder-library',
      target: 'radio-tower',
      type: 'symbol-class'
    };
    return icons[this.outlineMode as Exclude<OutlineMode, 'flat'>] || 'folder-library';
  }

  private getGroupDescription(groupName: string, projects: ProjectItem[]): string {
    if (this.outlineMode === 'target') {
      return `${projects.length} project${projects.length === 1 ? '' : 's'} on ${groupName}`;
    }
    if (this.outlineMode === 'type') {
      return `${projects.length} ${groupName.toLowerCase()}`;
    }
    return `${projects.length} project${projects.length === 1 ? '' : 's'}`;
  }

  private getGroupIcon(groupName: string): string {
    if (this.outlineMode === 'target' && groupName.startsWith('SSH')) {
      return 'vm';
    }
    if (this.outlineMode === 'type') {
      if (groupName.includes('Workspace')) return 'root-folder';
      if (groupName.includes('SSH')) return 'vm';
    }
    return 'folder';
  }

  private getGroupIconColor(groupName: string): string | undefined {
    if (this.outlineMode === 'target' && groupName.startsWith('SSH')) {
      return 'charts.orange';
    }
    if (groupName.includes('Workspace')) {
      return 'charts.green';
    }
    if (groupName.includes('SSH')) {
      return 'charts.orange';
    }
    return 'charts.blue';
  }

  private getCollapsibleState(id: string, defaultExpanded: boolean): vscode.TreeItemCollapsibleState {
    const expanded = this.expandedState[id];
    if (expanded === undefined) {
      return defaultExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    }
    return expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  }

  private sortProjects(projects: ProjectItem[]): ProjectItem[] {
    return [...projects].sort((left, right) => {
      const favoriteDelta = Number(!!right.isFavorite) - Number(!!left.isFavorite);
      if (favoriteDelta !== 0) {
        return favoriteDelta;
      }

      const recentDelta = new Date(right.lastAccessed || 0).getTime() - new Date(left.lastAccessed || 0).getTime();
      if (recentDelta !== 0) {
        return recentDelta;
      }

      return left.name.localeCompare(right.name);
    });
  }

  private sortGroupNames(left: string, right: string): number {
    if (left === 'Ungrouped') return 1;
    if (right === 'Ungrouped') return -1;

    const leftIsSshIp = left.startsWith('SSH • ') && isIpAddress(left.replace('SSH • ', ''));
    const rightIsSshIp = right.startsWith('SSH • ') && isIpAddress(right.replace('SSH • ', ''));
    if (leftIsSshIp !== rightIsSshIp) {
      return leftIsSshIp ? 1 : -1;
    }

    return left.localeCompare(right);
  }
}

function shortenPath(input: string): string {
  if (input.startsWith('vscode-remote://ssh-remote+')) {
    const host = extractHostnameFromSshPath(input);
    const pathPart = input.replace(/^vscode-remote:\/\/ssh-remote\+[^/]+/, '');
    return host ? `${host}:${tailSegments(pathPart)}` : tailSegments(pathPart);
  }

  if (input.includes('@') && input.includes(':')) {
    const host = extractHostnameFromSshPath(input);
    const remotePath = input.slice(input.indexOf(':') + 1);
    return host ? `${host}:${tailSegments(remotePath)}` : tailSegments(remotePath);
  }

  return tailSegments(input);
}

function tailSegments(input: string): string {
  const normalized = input.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 2) {
    return normalized;
  }
  return segments.slice(-2).join('/');
}

function isIpAddress(value: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
}
