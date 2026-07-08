import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SshHostManager from './SshHostManager';
import { ModalSurface } from './ModalHost';
import { FavoriteProjectsRail, ProjectLayout } from './ProjectLayouts';
import {
  fromStoredViewMode,
  layoutOptions,
  normalizeCollapsedGroups,
  toStoredViewMode,
  toggleCollapsedGroup,
  type ManagerLayout
} from './managerLayout';
import type {
  ProjectItem,
  ProjectType,
  SshHost,
  SshHostOperationResult,
  SshHostTestResult,
  State,
  UISettings
} from './model';
import {
  createManagedSshConversionDraft,
  extractRemotePathForManagedProject,
  formatSshHostAddress,
  getMigrationWarningSignature,
  normalizeUiState,
  updateManagedProjectFields,
  validateManagedProjectFields
} from './sshHostManagerModel';

declare const acquireVsCodeApi: any;
const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : { postMessage: console.log };

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const getStringProperty = (source: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const decodeHexString = (value: string): string | null => {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    return null;
  }

  let decoded = '';
  for (let index = 0; index < value.length; index += 2) {
    decoded += String.fromCharCode(Number.parseInt(value.slice(index, index + 2), 16));
  }
  return decoded;
};

const parseAuthorityObject = (value: string): Record<string, unknown> | null => {
  const decoded = safeDecode(value).trim();
  const hexDecoded = decodeHexString(decoded);
  const candidates = hexDecoded ? [decoded, hexDecoded.trim()] : [decoded];

  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not a JSON authority payload.
    }
  }

  return null;
};

const normalizeRemoteSshAuthority = (authority: string): string => {
  const decoded = safeDecode(authority).trim();
  const parsed = parseAuthorityObject(decoded);

  if (!parsed) {
    return decoded;
  }

  const hostName = getStringProperty(parsed, ['hostName', 'hostname', 'host']);
  if (!hostName) {
    return decoded;
  }

  const username = getStringProperty(parsed, ['user', 'username']);
  return username ? `${username}@${hostName}` : hostName;
};

const normalizeSshUserHost = (userHost: string): string => {
  const atIndex = userHost.lastIndexOf('@');
  if (atIndex <= 0) {
    return normalizeRemoteSshAuthority(userHost);
  }

  const username = userHost.slice(0, atIndex);
  const hostAuthority = normalizeRemoteSshAuthority(userHost.slice(atIndex + 1));
  const host = hostAuthority.split('@').pop() || hostAuthority;
  return `${username}@${host}`;
};

const parseRawSshPath = (input: string): { userHost: string; username?: string; hostname: string; remotePath: string } | null => {
  const trimmed = input.trim();
  const separatorIndex = trimmed.indexOf(':');

  if (separatorIndex <= 0) {
    return null;
  }

  const userHost = normalizeSshUserHost(trimmed.slice(0, separatorIndex).trim());
  const remotePath = trimmed.slice(separatorIndex + 1).trim();

  if (!userHost || !remotePath) {
    return null;
  }

  if (userHost.includes('/') || userHost.includes('\\')) {
    return null;
  }

  if (/^[a-zA-Z]$/.test(userHost)) {
    return null;
  }

  const atIndex = userHost.lastIndexOf('@');
  const username = atIndex > 0 ? userHost.slice(0, atIndex) : undefined;
  const hostname = atIndex > 0 ? userHost.slice(atIndex + 1) : userHost;

  if (!hostname) {
    return null;
  }

  return { userHost, username, hostname, remotePath };
};

const extractHostnameFromSshPath = (input: string): string | null => {
  try {
    if (input.startsWith('vscode-remote://ssh-remote+')) {
      const encoded = input.replace('vscode-remote://ssh-remote+', '').split('/')[0];
      const normalized = normalizeSshUserHost(encoded);
      return normalized.split('@')[1] || normalized;
    }

    return parseRawSshPath(input)?.hostname || null;
  } catch {
    return null;
  }
};

type PathAnalysis = {
  suggestedType: ProjectType | null;
  suggestedName?: string;
  summary: string;
  detail?: string;
  severity: 'info' | 'warning' | 'success';
};

type SshResolution = {
  success: boolean;
  requestedPath: string;
  normalizedPath: string;
  authority?: string;
  host?: string;
  username?: string;
  resolvedUsername?: string;
  resolvedHostname?: string;
  ip?: string;
  port?: string;
  canonicalPath?: string;
  isWindowsRemotePath: boolean;
  message: string;
  warnings: string[];
  requestId?: number;
};

type CurrentRemoteStatus = {
  isRemote: boolean;
  sshHost?: string;
  currentPath?: string;
  currentType?: 'ssh' | 'ssh-workspace';
  username?: string;
  host?: string;
  ip?: string;
  port?: string;
  message?: string;
};

const isSshProjectType = (type: ProjectType | null | undefined): type is 'ssh' | 'ssh-workspace' =>
  type === 'ssh' || type === 'ssh-workspace';

const getSuggestedNameFromPath = (input: string): string => {
  const trimmed = input.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('vscode-remote://ssh-remote+')) {
    const pathPart = safeDecode(trimmed.replace(/^vscode-remote:\/\/ssh-remote\+[^/]+/, ''));
    const normalizedPath = pathPart.replace(/^\/([a-zA-Z]:[\\/])/, '$1').replace(/\\/g, '/');
    const segments = normalizedPath.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    return lastSegment.replace(/\.code-workspace$/i, '');
  }

  const sshPath = parseRawSshPath(trimmed);
  if (sshPath) {
    const segments = sshPath.remotePath.replace(/\\/g, '/').split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    return lastSegment.replace(/\.code-workspace$/i, '');
  }

  const normalized = trimmed.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1] || normalized;
  return lastSegment.replace(/\.code-workspace$/i, '');
};

const analyzeProjectPath = (input: string, currentType: ProjectType): PathAnalysis | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const sshPath = parseRawSshPath(trimmed);
  const isWorkspace = /\.code-workspace$/i.test(trimmed);
  const looksLikeLocalPath =
    trimmed.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~/') ||
    trimmed.includes('\\');

  if (trimmed.startsWith('vscode-remote://ssh-remote+')) {
    const suggestedType: ProjectType = isWorkspace ? 'ssh-workspace' : 'ssh';
    return {
      suggestedType,
      suggestedName: getSuggestedNameFromPath(trimmed),
      severity: suggestedType === currentType ? 'success' : 'info',
      summary: suggestedType === 'ssh-workspace' ? 'Detected VS Code remote SSH workspace path.' : 'Detected VS Code remote SSH project path.',
      detail: suggestedType === currentType ? 'Current project type already matches the detected path format.' : `Current type is ${currentType}.`
    };
  }

  if (sshPath) {
    const suggestedType: ProjectType = /\.code-workspace$/i.test(sshPath.remotePath) ? 'ssh-workspace' : 'ssh';
    const isWindowsRemotePath = /^[a-zA-Z]:[\\/]/.test(sshPath.remotePath);

    return {
      suggestedType,
      suggestedName: getSuggestedNameFromPath(trimmed),
      severity: suggestedType === currentType ? 'success' : 'info',
      summary: suggestedType === 'ssh-workspace'
        ? 'Detected SSH workspace path.'
        : 'Detected SSH project path.',
      detail: isWindowsRemotePath
        ? `Windows remote path detected on host ${sshPath.hostname}.`
        : `Remote host detected: ${sshPath.hostname}.`
    };
  }

  if (isWorkspace) {
    return {
      suggestedType: 'workspace',
      suggestedName: getSuggestedNameFromPath(trimmed),
      severity: currentType === 'workspace' ? 'success' : 'info',
      summary: 'Detected local workspace file.',
      detail: currentType === 'workspace' ? 'Current project type already matches the detected path format.' : `Current type is ${currentType}.`
    };
  }

  if (looksLikeLocalPath) {
    return {
      suggestedType: 'local',
      suggestedName: getSuggestedNameFromPath(trimmed),
      severity: currentType === 'local' ? 'success' : 'info',
      summary: 'Detected local folder path.',
      detail: currentType === 'local' ? 'Current project type already matches the detected path format.' : `Current type is ${currentType}.`
    };
  }

  if (trimmed.includes('@') && !trimmed.startsWith('vscode-remote://')) {
    return {
      suggestedType: null,
      suggestedName: getSuggestedNameFromPath(trimmed),
      severity: 'warning',
      summary: 'This looks like an incomplete SSH path.',
      detail: 'Use formats like user@hostname:/path, hostname:/path, user@hostname:C:/path, or hostname:C:/path.'
    };
  }

  return {
    suggestedType: null,
    suggestedName: getSuggestedNameFromPath(trimmed),
    severity: 'warning',
    summary: 'Path format could not be identified yet.',
    detail: 'You can continue typing, paste a full path, or use the browse actions.'
  };
};

const getProjectTypeLabel = (type: ProjectType): string => {
  const labels: Record<ProjectType, string> = {
    local: 'Local Folder',
    workspace: 'Workspace File',
    ssh: 'SSH Remote',
    'ssh-workspace': 'SSH Workspace'
  };

  return labels[type];
};

const detectProjectTypeFromInput = (input: string): ProjectType | null => {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('vscode-remote://ssh-remote+')) {
    return /\.code-workspace$/i.test(trimmed) ? 'ssh-workspace' : 'ssh';
  }

  const sshPath = parseRawSshPath(trimmed);
  if (sshPath) {
    return /\.code-workspace$/i.test(sshPath.remotePath) ? 'ssh-workspace' : 'ssh';
  }

  return /\.code-workspace$/i.test(trimmed) ? 'workspace' : 'local';
};

const getExpectedPathExample = (type: ProjectType, remoteStatus?: CurrentRemoteStatus | null): string => {
  const authority = remoteStatus?.sshHost || 'user@host';

  switch (type) {
    case 'ssh':
      return `${authority}:/path/to/project`;
    case 'ssh-workspace':
      return `${authority}:/path/to/project.code-workspace`;
    case 'workspace':
      return '/path/to/project.code-workspace';
    default:
      return '/path/to/project';
  }
};

const getProjectValidationError = (
  project: Pick<ProjectItem, 'name' | 'path' | 'type'>,
  remoteStatus?: CurrentRemoteStatus | null
): string | null => {
  const name = project.name.trim();
  const projectPath = project.path.trim();

  if (!name) {
    return 'Project name cannot be empty.';
  }

  if (!projectPath) {
    return 'Path cannot be empty.';
  }

  const detectedType = detectProjectTypeFromInput(projectPath);
  if (detectedType && detectedType !== project.type) {
    return `This path looks like ${getProjectTypeLabel(detectedType)}. Switch the type or change the path.`;
  }

  if (project.type === 'workspace' && !/\.code-workspace$/i.test(projectPath)) {
    return 'Workspace path should end with .code-workspace.';
  }

  if (isSshProjectType(project.type)) {
    if (!projectPath.startsWith('vscode-remote://ssh-remote+') && !parseRawSshPath(projectPath)) {
      return `Enter a valid SSH path like ${getExpectedPathExample(project.type, remoteStatus)}.`;
    }

    if (project.type === 'ssh-workspace') {
      const remotePath = parseRawSshPath(projectPath)?.remotePath || projectPath;
      if (!/\.code-workspace$/i.test(remotePath)) {
        return 'SSH workspace path should end with .code-workspace.';
      }
    }
  }

  return null;
};

// 调试信息
console.log('Project Pilot React App: Starting...');
console.log('VSCode API available:', typeof acquireVsCodeApi !== 'undefined');

// VSCode主题色支持
const getVSCodeTheme = () => {
  const body = document.body;
  const computedStyle = getComputedStyle(body);
  
  return {
    // 获取VSCode CSS变量
    background: computedStyle.getPropertyValue('--vscode-editor-background') || '#ffffff',
    foreground: computedStyle.getPropertyValue('--vscode-editor-foreground') || '#000000',
    primaryBackground: computedStyle.getPropertyValue('--vscode-sideBar-background') || '#f3f3f3',
    secondaryBackground: computedStyle.getPropertyValue('--vscode-input-background') || '#ffffff',
    border: computedStyle.getPropertyValue('--vscode-panel-border') || '#e1e4e8',
    buttonBackground: computedStyle.getPropertyValue('--vscode-button-background') || '#0078d4',
    buttonForeground: computedStyle.getPropertyValue('--vscode-button-foreground') || '#ffffff',
    inputBackground: computedStyle.getPropertyValue('--vscode-input-background') || '#ffffff',
    inputForeground: computedStyle.getPropertyValue('--vscode-input-foreground') || '#000000',
    inputBorder: computedStyle.getPropertyValue('--vscode-input-border') || '#cccccc',
    focusBorder: computedStyle.getPropertyValue('--vscode-focusBorder') || '#0078d4',
    listHoverBackground: computedStyle.getPropertyValue('--vscode-list-hoverBackground') || '#f0f0f0',
    listActiveSelectionBackground: computedStyle.getPropertyValue('--vscode-list-activeSelectionBackground') || '#0078d4',
  };
};

const toAlpha = (color: string, alpha: number): string => {
  const value = color.trim();

  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(ch => ch + ch).join('');
    }
    if (hex.length === 6) {
      const int = Number.parseInt(hex, 16);
      const r = (int >> 16) & 255;
      const g = (int >> 8) & 255;
      const b = int & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }

  const rgbMatch = value.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const [r = '255', g = '255', b = '255'] = rgbMatch[1].split(',').map(part => part.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return value;
};

type SortBy = 'name' | 'type' | 'recent' | 'frequency';

export default function App() {
  const [state, setState] = useState<State>(() => normalizeUiState(undefined));
  const [q, setQ] = useState('');
  const [layout, setLayout] = useState<ManagerLayout>('command');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showByGroup, setShowByGroup] = useState(true);
  const [groupMode, setGroupMode] = useState<'custom' | 'target'>('custom'); // 分组模式：自定义分组 或 按Target分组
  const [autoOpenFullscreen, setAutoOpenFullscreen] = useState(true);
  const [newProjectType, setNewProjectType] = useState<ProjectType | null>(null);
  const [theme, setTheme] = useState(getVSCodeTheme());
  const [showControls, setShowControls] = useState(false);
  const [showSshHostManager, setShowSshHostManager] = useState(false);
  const [sshHostOperationResult, setSshHostOperationResult] = useState<SshHostOperationResult | null>(null);
  const [sshHostTestResult, setSshHostTestResult] = useState<SshHostTestResult | null>(null);
  const [warningProject, setWarningProject] = useState<ProjectItem | null>(null);
  const [dismissedMigrationWarningSignature, setDismissedMigrationWarningSignature] = useState<string | null>(null);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1440);
  const migrationWarningSignature = useMemo(
    () => getMigrationWarningSignature(state.migrationWarnings),
    [state.migrationWarnings]
  );

  useEffect(() => {
    if (!migrationWarningSignature) {
      setDismissedMigrationWarningSignature(null);
    }
  }, [migrationWarningSignature]);

  useEffect(() => {
    console.log('Project Pilot: Setting up message listener');
    const listener = (e: MessageEvent) => {
      console.log('Project Pilot: Received message', e.data);
      if (e.data?.type === 'state') {
        console.log('Project Pilot: Setting state', e.data.payload);
        const newState = normalizeUiState(e.data.payload as Partial<State> | undefined);
        setState(newState);
        
        // 同步UI设置到本地状态
        if (newState.uiSettings) {
          if (newState.uiSettings.viewMode !== undefined) {
            setLayout(fromStoredViewMode(newState.uiSettings.viewMode));
          }
          if (newState.uiSettings.selectedGroup !== undefined) {
            setSelectedGroup(newState.uiSettings.selectedGroup);
          }
          setCollapsedGroups(normalizeCollapsedGroups(newState.uiSettings.collapsedGroups));
        }
        
        if (newState.config?.autoOpenFullscreen !== undefined) {
          setAutoOpenFullscreen(newState.config.autoOpenFullscreen);
        }
      } else if (e.data?.type === 'connectionTestResult') {
        // 处理连接测试结果
        window.dispatchEvent(new CustomEvent('connectionTestResult', { detail: e.data.payload }));
      } else if (e.data?.type === 'pathSelected') {
        // 处理路径选择结果
        window.dispatchEvent(new CustomEvent('pathSelected', { detail: e.data.payload }));
      } else if (e.data?.type === 'sshBrowseResult') {
        // 处理 SSH 浏览结果
        window.dispatchEvent(new CustomEvent('sshBrowseResult', { detail: e.data.payload }));
      } else if (e.data?.type === 'remoteStatus') {
        // 处理远程状态
        window.dispatchEvent(new CustomEvent('remoteStatus', { detail: e.data.payload }));
      } else if (e.data?.type === 'sshTargetResolved') {
        window.dispatchEvent(new CustomEvent('sshTargetResolved', { detail: e.data.payload }));
      } else if (e.data?.type === 'sshHostOperationResult') {
        setSshHostOperationResult(e.data.payload as SshHostOperationResult);
      } else if (e.data?.type === 'sshHostTestResult') {
        setSshHostTestResult(e.data.payload as SshHostTestResult);
      }
    };
    window.addEventListener('message', listener);
    
    // 请求初始状态
    console.log('Project Pilot: Requesting initial state');
    vscode.postMessage({ type: 'requestState' });
    
    return () => window.removeEventListener('message', listener);
  }, []);

  // 监听主题变化
  useEffect(() => {
    const updateTheme = () => {
      setTheme(getVSCodeTheme());
    };

    // 监听VSCode主题变化事件
    const observer = new MutationObserver(() => {
      updateTheme();
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-vscode-theme-kind']
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);



  const allTags = useMemo(() => {
    const tags = new Set<string>();
    state.projects.forEach(p => p.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [state.projects]);

  const allGroups = useMemo(() => {
    const groups = new Set<string>();
    state.projects.forEach(p => {
      if (p.group) groups.add(p.group);
    });
    return Array.from(groups).sort();
  }, [state.projects]);

  const filtered = useMemo(() => {
    let result = state.projects;
    
    // Filter by search term
    const term = q.trim().toLowerCase();
    if (term) {
      result = result.filter(p => [p.name, p.path, p.description, ...(p.tags ?? [])].some(x => (x ?? '').toLowerCase().includes(term)));
    }
    
    // Filter by favorites
    if (showFavoritesOnly) {
      result = result.filter(p => p.isFavorite);
    }
    
    // Filter by tag
    if (selectedTag) {
      result = result.filter(p => p.tags?.includes(selectedTag));
    }
    
    // Filter by group
    if (selectedGroup) {
      result = result.filter(p => p.group === selectedGroup);
    }
    
    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'type': return a.type.localeCompare(b.type);
        case 'recent': 
          // 按最后访问时间排序（最近的在前）
          const aTime = a.lastAccessed ? new Date(a.lastAccessed).getTime() : 0;
          const bTime = b.lastAccessed ? new Date(b.lastAccessed).getTime() : 0;
          return bTime - aTime;
        case 'frequency':
          // 按使用频次排序（高频在前）
          return (b.clickCount || 0) - (a.clickCount || 0);
        default: return 0;
      }
    });
    
    return result;
  }, [state.projects, q, showFavoritesOnly, selectedTag, selectedGroup, sortBy]);

  // 从 SSH 路径中提取 target 信息
  const getProjectTarget = (project: ProjectItem): string => {
    if (project.type === 'local' || project.type === 'workspace') {
      return '💻 Local';
    }
    
    // SSH 或 SSH-Workspace
    const path = project.path;
    const hostname = extractHostnameFromSshPath(path);
    if (hostname) {
      return `🖥️ ${hostname}`;
    }
    return '🌐 Remote';
  };

  const groupedProjects = useMemo(() => {
    const groups: { [key: string]: ProjectItem[] } = {};
    
    filtered.forEach(project => {
      let groupName: string;
      
      if (groupMode === 'target') {
        // 按 Target 分组
        groupName = getProjectTarget(project);
      } else {
        // 按自定义分组
        groupName = project.group || 'Ungrouped';
      }
      
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(project);
    });
    
    // 判断是否是 IP 地址
    const isIpAddress = (str: string): boolean => {
      // 移除前缀 emoji
      const cleaned = str.replace(/^[💻🖥️🌐]\s*/, '');
      // 检查是否是 IP 格式 (xxx.xxx.xxx.xxx)
      return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleaned);
    };

    // 排序分组：Local 优先，然后 hostname（非IP）优先，最后是 IP 地址
    const sortedGroups: { [key: string]: ProjectItem[] } = {};
    const keys = Object.keys(groups).sort((a, b) => {
      // Local 最优先
      if (a.includes('Local')) return -1;
      if (b.includes('Local')) return 1;
      
      // 非 IP（hostname）优先于 IP
      const aIsIp = isIpAddress(a);
      const bIsIp = isIpAddress(b);
      if (!aIsIp && bIsIp) return -1;  // hostname 排前面
      if (aIsIp && !bIsIp) return 1;   // IP 排后面
      
      // 同类型按字母排序
      return a.localeCompare(b);
    });
    keys.forEach(key => {
      sortedGroups[key] = groups[key];
    });
    
    return sortedGroups;
  }, [filtered, groupMode]);

  const addNewProject = (type: ProjectType) => {
    setNewProjectType(type);
    setShowAddForm(false);
  };

  const createNewProject = (projectData: ProjectItem) => {
    const getDefaultColor = (type: ProjectType | null) => {
      switch (type) {
        case 'local': return '#3b82f6';
        case 'workspace': return '#10b981';
        case 'ssh': return '#f59e0b';
        case 'ssh-workspace': return '#8b5cf6';
        default: return '#3b82f6';
      }
    };
    const newProject: ProjectItem = {
      ...projectData,
      id: Math.random().toString(36).slice(2, 10),
      type: newProjectType || 'local',
      color: projectData.color || getDefaultColor(newProjectType),
      group: projectData.group || selectedGroup || undefined
    };
    vscode.postMessage({ type: 'addOrUpdate', payload: newProject });
    setNewProjectType(null);
  };

  // 更新UI设置到后端
  const updateUISettings = (settings: Partial<UISettings>) => {
    vscode.postMessage({ type: 'updateUISettings', payload: settings });
  };

  // 记录项目访问
  const recordProjectAccess = (id: string) => {
    vscode.postMessage({ type: 'recordProjectAccess', payload: { id } });
  };

  // 切换收藏状态
  const toggleProjectFavorite = (id: string) => {
    vscode.postMessage({ type: 'toggleFavorite', payload: { id } });
  };

  const openSshHostManager = () => {
    setSshHostOperationResult(null);
    setSshHostTestResult(null);
    setShowSshHostManager(true);
  };
  const closeSshHostManager = () => {
    setShowSshHostManager(false);
    setSshHostOperationResult(null);
    setSshHostTestResult(null);
  };
  const toggleProjectGroup = (groupName: string) => {
    setCollapsedGroups(current => {
      const next = toggleCollapsedGroup(current, groupName);
      updateUISettings({ collapsedGroups: next });
      return next;
    });
  };

  const headerStacked = windowWidth < 920;
  const actionStacked = windowWidth < 560;
  const primaryGlow = toAlpha(theme.focusBorder, 0.32);
  const subtleGlow = toAlpha(theme.focusBorder, 0.2);
  const cardGlassBackground = toAlpha(theme.secondaryBackground, 0.72);
  const panelBackground = toAlpha(theme.primaryBackground, 0.72);
  const secondaryPanelBackground = toAlpha(theme.secondaryBackground, 0.62);

  return (
    <div 
      className="glass-shell p-3 sm:p-4 space-y-4 min-h-screen"
      style={{ 
        ['--panel-bg' as string]: panelBackground,
        ['--card-bg' as string]: cardGlassBackground,
        ['--panel-border' as string]: toAlpha(theme.border, 0.52),
        ['--button-bg' as string]: toAlpha(theme.inputBackground, 0.56),
        ['--button-border' as string]: toAlpha(theme.inputBorder, 0.6),
        ['--input-bg' as string]: toAlpha(theme.inputBackground, 0.48),
        ['--input-border' as string]: toAlpha(theme.inputBorder, 0.62),
        backgroundColor: theme.background,
        color: theme.foreground 
      }}
    >
      {/* Header */}
      <div 
        className="manager-commandbar liquid-panel rounded-2xl p-3 sm:p-4"
        data-expanded={showControls || showAddForm}
        style={{ 
          backgroundColor: panelBackground,
          borderColor: toAlpha(theme.border, 0.52),
          ['--glow-color' as string]: subtleGlow
        }}
      >
        <div className="relative z-10 flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="manager-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">
                <rect x="2.5" y="3" width="15" height="11" rx="2" strokeWidth="1.5" />
                <path d="m6 7 2 2-2 2m4.5 0h3M7 17h6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="text-lg font-semibold tracking-tight truncate" style={{ color: theme.foreground }}>Project Pilot</h1>
          </div>
          <span className="text-xs tabular-nums" style={{ color: toAlpha(theme.foreground, 0.58) }}>
            {filtered.length}/{state.projects.length}
          </span>
        </div>
        
        {/* Search Bar */}
        <div className={`manager-actions relative z-10 flex ${actionStacked ? 'flex-col' : 'gap-2 items-center'} mb-3`}>
          <div className="manager-search relative flex-1">
            <input 
              className="soft-input w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border focus:ring-2 focus:border-transparent transition-all" 
              style={{
                backgroundColor: secondaryPanelBackground,
                color: theme.inputForeground,
                borderColor: toAlpha(theme.inputBorder, 0.62),
                '--tw-ring-color': theme.focusBorder
              } as React.CSSProperties}
              placeholder="Search by name, description, path, or tags..." 
              value={q} 
              onChange={e => setQ(e.target.value)} 
            />
            <svg className="absolute left-3 top-3 h-4 w-4" style={{ color: toAlpha(theme.inputForeground, 0.56) }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {q && (
              <button
                className="absolute right-3 top-3 h-4 w-4 rounded-full flex items-center justify-center transition-colors"
                style={{ color: theme.inputForeground, opacity: 0.6, backgroundColor: 'transparent' }}
                onClick={() => setQ('')}
                title="Clear search"
                onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                onMouseOut={(e) => e.currentTarget.style.opacity = '0.6'}
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button 
            className={`soft-button ${actionStacked ? 'w-full justify-center' : ''} px-4 py-2.5 text-sm rounded-xl transition-all inline-flex items-center gap-2`}
            style={{
              backgroundColor: theme.buttonBackground,
              color: theme.buttonForeground,
              ['--button-bg' as string]: theme.buttonBackground,
              ['--button-border' as string]: toAlpha(theme.buttonBackground, 0.58),
              boxShadow: `0 10px 28px ${primaryGlow}`
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.opacity = '0.9';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <span className="text-base leading-none">+</span>
            <span>{showAddForm ? 'Close' : 'Add Project'}</span>
          </button>
          <button
            className={`soft-button ${actionStacked ? 'w-full justify-center' : ''} px-4 py-2.5 text-sm rounded-xl transition-all inline-flex items-center gap-2`}
            style={{
              backgroundColor: secondaryPanelBackground,
              color: theme.inputForeground,
              borderColor: toAlpha(theme.inputBorder, 0.62)
            }}
            onClick={openSshHostManager}
            title="Manage reusable SSH Hosts"
          >
            <svg className="ssh-host-button__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
              <rect x="2.5" y="3" width="15" height="11" rx="2" strokeWidth="1.5" />
              <path d="m6 7 2 2-2 2m4.5 0h3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 17h6" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>SSH Hosts</span>
            <span className="stat-chip px-2 py-0.5 rounded-full text-[11px]" style={{ color: theme.foreground }}>
              {state.sshHosts.length}
            </span>
          </button>
          <button 
            className={`soft-button ${actionStacked ? 'w-full justify-center' : ''} px-4 py-2.5 text-sm rounded-xl transition-all inline-flex items-center gap-2`}
            style={{
              backgroundColor: secondaryPanelBackground,
              color: theme.inputForeground,
              borderColor: toAlpha(theme.inputBorder, 0.62)
            }}
            onClick={() => setShowControls(!showControls)}
            title="Show filters and view options"
          >
            <span>Options</span>
            <svg className={`w-4 h-4 transition-transform ${showControls ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div className="layout-switcher" role="group" aria-label="Manager layout">
            {layoutOptions.map(option => (
              <button
                key={option.id}
                className="layout-switcher__button"
                data-active={layout === option.id}
                aria-pressed={layout === option.id}
                title={`${option.label} layout`}
                onClick={() => {
                  setLayout(option.id);
                  updateUISettings({ viewMode: toStoredViewMode(option.id) });
                }}
              >
                <span aria-hidden="true">{option.id === 'command' ? '▦' : option.id === 'explorer' ? '☷' : '▤'}</span>
                <span className="layout-switcher__label">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Collapsible Controls */}
        {showControls && (
          <div 
            className="glass-panel mb-3 p-4 rounded-2xl border"
            style={{ 
              backgroundColor: secondaryPanelBackground,
              borderColor: toAlpha(theme.border, 0.48),
              ['--glow-color' as string]: subtleGlow
            }}
          >
            <div className="space-y-3">
              {/* Filters Row */}
              <div className="control-cluster">
                <select 
                  className="soft-input px-3 py-2 rounded-xl text-sm min-w-[140px]"
                  style={{
                    backgroundColor: secondaryPanelBackground,
                    color: theme.inputForeground,
                    borderColor: toAlpha(theme.inputBorder, 0.62)
                  }}
                  value={selectedTag} 
                  onChange={e => setSelectedTag(e.target.value)}
                >
                  <option value="" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>All Tags</option>
                  {allTags.map(tag => (
                    <option key={tag} value={tag} style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>{tag}</option>
                  ))}
                </select>
                
                <select 
                  className="soft-input px-3 py-2 rounded-xl text-sm min-w-[150px]"
                  style={{
                    backgroundColor: secondaryPanelBackground,
                    color: theme.inputForeground,
                    borderColor: toAlpha(theme.inputBorder, 0.62)
                  }}
                  value={sortBy} 
                  onChange={e => setSortBy(e.target.value as SortBy)}
                >
                  <option value="name" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Sort by Name</option>
                  <option value="type" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Sort by Type</option>
                  <option value="recent" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Sort by Recent</option>
                  <option value="frequency" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Sort by Usage</option>
                </select>
                
                <select 
                  className="soft-input px-3 py-2 rounded-xl text-sm min-w-[150px]"
                  style={{
                    backgroundColor: secondaryPanelBackground,
                    color: theme.inputForeground,
                    borderColor: toAlpha(theme.inputBorder, 0.62)
                  }}
                  value={selectedGroup} 
                  onChange={e => {
                    const newGroup = e.target.value;
                    setSelectedGroup(newGroup);
                    updateUISettings({ selectedGroup: newGroup });
                  }}
                >
                  <option value="" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>All Groups</option>
                  {allGroups.map(group => (
                    <option key={group} value={group} style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>{group}</option>
                  ))}
                </select>
              </div>

              {/* Divider */}
              <div className="border-t" style={{ borderColor: toAlpha(theme.border, 0.42) }}></div>

              {/* View Options and Configure */}
              <div className={`flex gap-3 ${headerStacked ? 'flex-col' : 'items-start justify-between'}`}>
                <div className="control-cluster">
                  <button 
                    className="soft-button px-3 py-2 text-xs rounded-xl transition-all"
                    style={{
                      backgroundColor: showByGroup ? theme.listActiveSelectionBackground : theme.inputBackground,
                      color: showByGroup ? theme.buttonForeground : theme.inputForeground,
                      borderColor: theme.inputBorder
                    }}
                    onClick={() => setShowByGroup(!showByGroup)}
                    title="Toggle grouping"
                  >
                    {showByGroup ? '📁 Grouped' : '📋 Flat'}
                  </button>
                  
                  {showByGroup && (
                    <button 
                      className="soft-button px-3 py-2 text-xs rounded-xl transition-all"
                      style={{
                        backgroundColor: groupMode === 'target' ? theme.listActiveSelectionBackground : theme.inputBackground,
                        color: groupMode === 'target' ? theme.buttonForeground : theme.inputForeground,
                        borderColor: theme.inputBorder
                      }}
                      onClick={() => setGroupMode(groupMode === 'custom' ? 'target' : 'custom')}
                      title="Toggle group mode: Custom groups or by Target (Local/SSH hosts)"
                    >
                      {groupMode === 'target' ? '🎯 By Target' : '📂 By Group'}
                    </button>
                  )}
                  
                  <button 
                    className="soft-button px-3 py-2 text-xs rounded-xl transition-all"
                    style={{
                      backgroundColor: showFavoritesOnly ? theme.listActiveSelectionBackground : theme.inputBackground,
                      color: showFavoritesOnly ? theme.buttonForeground : theme.inputForeground,
                      borderColor: theme.inputBorder
                    }}
                    onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                    title="Show favorites only"
                  >
                    {showFavoritesOnly ? '⭐ Favorites' : '☆ All'}
                  </button>
                  
                </div>

                {/* Auto Open + Refresh & Settings Buttons */}
                <div className="control-cluster">
                  <button 
                    className="soft-button px-3 py-2.5 rounded-xl transition-all text-sm flex items-center gap-2"
                    style={{
                      backgroundColor: autoOpenFullscreen ? theme.listActiveSelectionBackground : theme.inputBackground,
                      color: autoOpenFullscreen ? theme.buttonForeground : theme.inputForeground,
                      borderColor: theme.inputBorder,
                      border: '1px solid'
                    }}
                    onClick={() => {
                      const nextValue = !autoOpenFullscreen;
                      setAutoOpenFullscreen(nextValue);
                      vscode.postMessage({ type: 'updateConfig', payload: { autoOpenFullscreen: nextValue } });
                    }}
                    title="Toggle auto-open fullscreen view on startup"
                  >
                    {autoOpenFullscreen ? '🟢 Auto Open' : '⚪ Auto Open'}
                  </button>

                  <button 
                    className="soft-button px-3 py-2.5 rounded-xl transition-all text-sm flex items-center gap-2"
                    style={{
                      backgroundColor: secondaryPanelBackground,
                      color: theme.inputForeground,
                      borderColor: theme.inputBorder,
                      border: '1px solid'
                    }}
                    onClick={() => vscode.postMessage({ type: 'refreshUI' })}
                    title="Reload configuration and refresh UI"
                  >
                    🔄 Refresh
                  </button>
                  
                  <button 
                    className="soft-button px-3 py-2.5 rounded-xl transition-all text-sm flex items-center gap-2"
                    style={{
                      backgroundColor: theme.buttonBackground,
                      color: theme.buttonForeground,
                      ['--button-bg' as string]: theme.buttonBackground,
                      ['--button-border' as string]: toAlpha(theme.buttonBackground, 0.58),
                      boxShadow: `0 8px 22px ${subtleGlow}`
                    }}
                    onClick={() => vscode.postMessage({ type: 'sync' })}
                    title="Configuration options"
                  >
                    ⚙️ Settings
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Add Form */}
        {showAddForm && (
          <div 
            className="glass-panel mt-4 p-4 rounded-2xl border"
            style={{ 
              backgroundColor: secondaryPanelBackground,
              borderColor: toAlpha(theme.border, 0.48)
            }}
          >
            <h3 className="font-medium mb-2" style={{ color: theme.foreground }}>Add New Project</h3>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <button 
                className="soft-button px-3 py-3 rounded-xl transition-all text-left"
                style={{
                  backgroundColor: toAlpha(theme.inputBackground, 0.58),
                  color: '#3b82f6',
                  borderColor: toAlpha('#3b82f6', 0.68)
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#eff6ff'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = theme.inputBackground}
                onClick={() => addNewProject('local')}
              >
                📂 Local Folder
              </button>
              <button 
                className="soft-button px-3 py-3 rounded-xl transition-all text-left"
                style={{
                  backgroundColor: toAlpha(theme.inputBackground, 0.58),
                  color: '#10b981',
                  borderColor: toAlpha('#10b981', 0.68)
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f0fdf4'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = theme.inputBackground}
                onClick={() => addNewProject('workspace')}
              >
                📦 Workspace File
              </button>
              <button 
                className="soft-button px-3 py-3 rounded-xl transition-all text-left"
                style={{
                  backgroundColor: toAlpha(theme.inputBackground, 0.58),
                  color: '#f59e0b',
                  borderColor: toAlpha('#f59e0b', 0.68)
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fffbeb'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = theme.inputBackground}
                onClick={() => addNewProject('ssh')}
              >
                🖥️ SSH Remote
              </button>
              <button 
                className="soft-button px-3 py-3 rounded-xl transition-all text-left"
                style={{
                  backgroundColor: toAlpha(theme.inputBackground, 0.58),
                  color: '#8b5cf6',
                  borderColor: toAlpha('#8b5cf6', 0.68)
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f5f3ff'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = theme.inputBackground}
                onClick={() => addNewProject('ssh-workspace')}
              >
                📡 SSH Workspace
              </button>
            </div>
          </div>
        )}
      </div>

      {migrationWarningSignature && dismissedMigrationWarningSignature !== migrationWarningSignature && (
        <div
          className="glass-panel rounded-2xl border p-3 sm:p-4"
          style={{
            backgroundColor: toAlpha('#f59e0b', 0.08),
            borderColor: toAlpha('#f59e0b', 0.3),
            color: theme.foreground
          }}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold">Some SSH projects still use legacy paths</p>
              <p className="text-xs mt-1" style={{ color: toAlpha(theme.foreground, 0.7) }}>
                Review these projects and assign a reusable SSH Host when ready.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="stat-chip px-2.5 py-1 rounded-full text-xs" style={{ color: '#f59e0b' }}>
                {state.migrationWarnings.length} warning{state.migrationWarnings.length === 1 ? '' : 's'}
              </span>
              <button
                className="soft-button w-8 h-8 rounded-xl inline-flex items-center justify-center"
                style={{
                  backgroundColor: secondaryPanelBackground,
                  color: theme.inputForeground,
                  borderColor: toAlpha('#f59e0b', 0.3)
                }}
                onClick={() => setDismissedMigrationWarningSignature(migrationWarningSignature)}
                title="Dismiss migration warnings for this session"
                aria-label="Dismiss migration warnings"
              >
                ×
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {state.migrationWarnings.map((warning, index) => {
              const project = warning.projectId
                ? state.projects.find(candidate => candidate.id === warning.projectId)
                : state.projects.find(candidate => candidate.name === warning.projectName);
              return (
                <button
                  key={`${warning.projectId ?? warning.projectName}-${index}`}
                  className="soft-button px-3 py-2 rounded-xl text-xs text-left"
                  style={{
                    backgroundColor: secondaryPanelBackground,
                    color: project ? theme.inputForeground : toAlpha(theme.foreground, 0.55),
                    borderColor: toAlpha('#f59e0b', 0.34),
                    cursor: project ? 'pointer' : 'default'
                  }}
                  disabled={!project}
                  onClick={() => project && setWarningProject(project)}
                  title={warning.message}
                >
                  {project ? 'Review' : 'Missing'} · {warning.projectName}
                </button>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Projects Display */}
      <div 
        className="projects-shell p-1 sm:p-2"
        style={{ 
          backgroundColor: panelBackground,
          borderColor: toAlpha(theme.border, 0.52),
          ['--glow-color' as string]: subtleGlow
        }}
      >
        <div className={`flex ${headerStacked ? 'flex-col items-start gap-2' : 'justify-between items-center'} mb-4`}>
          <h2 className="text-sm font-medium" style={{ color: theme.foreground }}>
            {showFavoritesOnly ? `Favorites (${filtered.length})` : `Projects (${filtered.length})`}
            {!showFavoritesOnly && state.projects.filter(p => p.isFavorite).length > 0 && (
              <span className="ml-2 text-xs" style={{ color: theme.foreground, opacity: 0.6 }}>
                • {state.projects.filter(p => p.isFavorite).length} favorited
              </span>
            )}
          </h2>
          <span className="text-xs" style={{ color: toAlpha(theme.foreground, 0.58) }}>
            {layoutOptions.find(option => option.id === layout)?.label}
          </span>
        </div>

        {layout === 'gallery' && !showFavoritesOnly && (
          <FavoriteProjectsRail
            projects={state.projects}
            onOpen={project => {
              recordProjectAccess(project.id!);
              vscode.postMessage({ type: 'open', payload: project });
            }}
          />
        )}
        
        {state.projects.length === 0 ? (
          <div className="text-center py-12" style={{ color: theme.foreground, opacity: 0.7 }}>
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-lg font-medium mb-2">Welcome to Project Pilot!</p>
            <p className="text-sm mb-4">Add your first project to get started</p>
            <div className="space-y-2">
              <button 
                className="block mx-auto px-4 py-2 rounded-lg transition-colors"
                style={{
                  backgroundColor: theme.buttonBackground,
                  color: theme.buttonForeground
                }}
                onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                onClick={() => vscode.postMessage({ type: 'addLocal' })}
              >
                Add Local Project
              </button>
              <p className="text-xs" style={{ color: theme.foreground, opacity: 0.6 }}>
                Or use Command Palette: Ctrl+Shift+P → "Project Pilot: Add Local Folder"
              </p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12" style={{ color: theme.foreground, opacity: 0.7 }}>
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p>No projects match your search</p>
            <p className="text-sm mt-1">Try adjusting your search or filters</p>
          </div>
        ) : showByGroup ? (
          <div className="space-y-3">
            {Object.entries(groupedProjects).map(([groupName, projects]) => {
              const isCollapsed = collapsedGroups.includes(groupName);
              return (
                <section key={groupName} className="project-group" data-collapsed={isCollapsed}>
                  <button
                    className="project-group__header"
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleProjectGroup(groupName)}
                  >
                    <svg className="project-group__chevron" data-collapsed={isCollapsed} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
                      <path d="m6 8 4 4 4-4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <h3 className="text-base font-semibold" style={{ color: theme.foreground }}>
                      {groupName}
                    </h3>
                    <span className="stat-chip text-sm px-2.5 py-1 rounded-full" style={{
                      backgroundColor: toAlpha(theme.listHoverBackground, 0.6),
                      color: theme.foreground
                    }}>
                      {projects.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <ProjectLayout layout={layout}>
                      {projects.map(p => (
                        <Card
                          key={p.id ?? p.path}
                          p={p}
                          layout={layout}
                          theme={theme}
                          allGroups={allGroups}
                          sshHosts={state.sshHosts}
                          onManageSshHosts={openSshHostManager}
                          onChange={(np) => vscode.postMessage({ type: 'addOrUpdate', payload: np })}
                          onDelete={() => vscode.postMessage({ type: 'delete', payload: { id: p.id } })}
                          onOpen={() => {
                            recordProjectAccess(p.id!);
                            vscode.postMessage({ type: 'open', payload: p });
                          }}
                          onToggleFavorite={toggleProjectFavorite}
                        />
                      ))}
                    </ProjectLayout>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <ProjectLayout layout={layout}>
        {filtered.map(p => (
              <Card 
                key={p.id ?? p.path} 
                p={p} 
                layout={layout}
                theme={theme}
                allGroups={allGroups}
                sshHosts={state.sshHosts}
                onManageSshHosts={openSshHostManager}
                onChange={(np) => vscode.postMessage({ type: 'addOrUpdate', payload: np })} 
                onDelete={() => vscode.postMessage({ type: 'delete', payload: { id: p.id } })}
                onOpen={() => {
                  recordProjectAccess(p.id!);
                  vscode.postMessage({ type: 'open', payload: p });
                }}
                onToggleFavorite={toggleProjectFavorite}
              />
            ))}
          </ProjectLayout>
        )}
      </div>

      {/* New Project Modal */}
      {newProjectType && (
        <EditModal 
          project={{
            id: '',
            name: newProjectType === 'ssh-workspace' 
              ? 'New SSH Workspace'
              : `New ${newProjectType.charAt(0).toUpperCase() + newProjectType.slice(1)} Project`,
            path: '',
            description: newProjectType === 'local' ? 'Local project folder' : 
                        newProjectType === 'workspace' ? 'VSCode workspace configuration' : 
                        newProjectType === 'ssh-workspace' ? 'Remote workspace file via SSH' :
                        'Remote project via SSH',
            type: newProjectType,
            color: newProjectType === 'local' ? '#3b82f6' : 
                   newProjectType === 'workspace' ? '#10b981' : 
                   newProjectType === 'ssh-workspace' ? '#8b5cf6' :
                   '#f59e0b',
            tags: (newProjectType === 'ssh' || newProjectType === 'ssh-workspace') ? ['ssh', 'remote'] : [],
            group: selectedGroup || undefined,
            icon: ''
          }}
          theme={theme}
          allGroups={allGroups}
          sshHosts={state.sshHosts}
          onManageSshHosts={openSshHostManager}
          onSave={createNewProject}
          onCancel={() => setNewProjectType(null)}
        />
      )}
      {warningProject && (
        <EditModal
          project={warningProject}
          theme={theme}
          allGroups={allGroups}
          sshHosts={state.sshHosts}
          onManageSshHosts={openSshHostManager}
          onSave={updatedProject => {
            vscode.postMessage({ type: 'addOrUpdate', payload: updatedProject });
            setWarningProject(null);
          }}
          onCancel={() => setWarningProject(null)}
        />
      )}
      {showSshHostManager && (
        <SshHostManager
          hosts={state.sshHosts}
          projects={state.projects}
          theme={theme}
          operationResult={sshHostOperationResult}
          testResult={sshHostTestResult}
          onPostMessage={message => {
            if (message.type === 'testSshHost') {
              setSshHostTestResult(null);
            } else {
              setSshHostOperationResult(null);
            }
            vscode.postMessage(message);
          }}
          onClose={closeSshHostManager}
        />
      )}
    </div>
  );
}

function Card({ p, layout, theme, allGroups, sshHosts, onManageSshHosts, onChange, onDelete, onOpen, onToggleFavorite }: {
  p: ProjectItem; 
  layout: ManagerLayout;
  theme: any;
  allGroups: string[];
  sshHosts: SshHost[];
  onManageSshHosts: () => void;
  onChange: (p: ProjectItem) => void; 
  onDelete: () => void;
  onOpen: () => void;
  onToggleFavorite: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const typeIcons: Record<string, string> = {
    local: '📂',
    workspace: '📦',
    ssh: '🖥️',
    'ssh-workspace': '📡'
  };

  const typeColors: Record<string, string> = {
    local: 'bg-blue-100 text-blue-700',
    workspace: 'bg-green-100 text-green-700',
    ssh: 'bg-yellow-100 text-yellow-700',
    'ssh-workspace': 'bg-purple-100 text-purple-700'
  };

  if (layout === 'command') {
    return (
      <article
        className="project-tile project-tile--command group"
        style={{ ['--project-accent' as string]: p.color || theme.focusBorder }}
        title={`${p.description ? p.description + '\n' : ''}Path: ${p.path}${p.tags?.length ? '\nTags: ' + p.tags.join(', ') : ''}`}
      >
        <button
          className="project-tile__main"
          onClick={onOpen}
          title={`Open ${p.name}`}
        >
          <span className="project-icon" style={{ color: p.color || theme.focusBorder }}>
            {p.icon
              ? <img src={p.icon} className="w-full h-full object-cover rounded-lg" alt={p.name} />
              : typeIcons[p.type]}
          </span>
          <span className="min-w-0 text-left">
            <strong className="project-name" style={{ color: theme.foreground }}>{p.name}</strong>
            <span className="project-path" style={{ color: toAlpha(theme.foreground, 0.58) }}>{p.path}</span>
          </span>
        </button>
        <div className="project-actions" aria-label={`${p.name} actions`}>
          <button
            className="project-action"
            style={{ color: p.isFavorite ? '#fbbf24' : theme.foreground }}
            onClick={() => onToggleFavorite(p.id!)}
            title={p.isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <svg className="w-4 h-4" fill={p.isFavorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
          <button
            className="project-action"
            style={{ color: theme.foreground }}
            onClick={() => setIsEditing(true)}
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button className="project-action" style={{ color: theme.foreground }} onClick={onDelete} title="Delete">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {isEditing && (
          <EditModal 
            project={p}
            theme={theme}
            allGroups={allGroups ? allGroups : []}
            sshHosts={sshHosts}
            onManageSshHosts={onManageSshHosts}
            onSave={(updatedProject) => {
              onChange(updatedProject);
              setIsEditing(false);
            }}
            onCancel={() => setIsEditing(false)}
          />
        )}
      </article>
    );
  }

  if (layout === 'explorer') {
    return (
      <div 
        className="project-tile project-tile--explorer flex items-center gap-3 group"
        style={{ 
          backgroundColor: toAlpha(theme.secondaryBackground, 0.72), 
          borderColor: toAlpha(theme.border, 0.42),
          boxShadow: `0 10px 24px ${toAlpha(p.color || theme.focusBorder, 0.08)}`,
          ['--glow-color' as string]: toAlpha(p.color || theme.focusBorder, 0.16)
        }}
      >
        <div 
          className="project-icon cursor-pointer"
          style={{ 
            borderColor: p.color,
            backgroundColor: toAlpha(theme.primaryBackground, 0.66),
            color: p.color,
            boxShadow: `0 0 22px ${toAlpha(p.color || theme.focusBorder, 0.14)}`
          }}
          onClick={onOpen}
          title="Click to open project"
        >
          {p.icon ? (
            <img src={p.icon} className="w-full h-full object-cover rounded-lg" alt="" />
          ) : (
            <span>{typeIcons[p.type]}</span>
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: p.color }}
            ></div>
            <h3 className="project-name" style={{ color: theme.foreground }} title={p.description || p.name}>
              {p.name}
            </h3>
            <span className={`project-type ${typeColors[p.type]}`}>
              {p.type}
            </span>
          </div>
          {p.description && (
            <p className="text-xs truncate mt-0.5 explorer-description" style={{ color: theme.foreground, opacity: 0.74 }} title={p.description}>
              {p.description}
            </p>
          )}
          <p className="project-path explorer-path" style={{ color: theme.foreground, opacity: 0.58 }} title={p.path}>{p.path}</p>
          {p.tags && p.tags.length > 0 && (
            <div className="explorer-tags flex gap-1 mt-1">
              {p.tags.slice(0, 2).map(tag => (
                <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600">
                  {tag}
                </span>
              ))}
              {p.tags.length > 2 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600">
                  +{p.tags.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
        
        <div className="project-actions flex items-center gap-1">
          <button
            className={`soft-button p-2 rounded-xl transition-colors ${p.isFavorite ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-500 hover:text-yellow-600'}`}
            onClick={() => onToggleFavorite(p.id!)}
            title={p.isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <svg className="w-4 h-4" fill={p.isFavorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
          <button
            className="soft-button p-2 text-gray-500 hover:text-blue-600 rounded-xl transition-colors"
            onClick={onOpen}
            title="Open Project"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
          <button
            className="soft-button p-2 text-gray-500 hover:text-green-600 rounded-xl transition-colors"
            onClick={() => setIsEditing(true)}
            title="Edit Project"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            className="soft-button p-2 text-gray-500 hover:text-red-600 rounded-xl transition-colors"
            onClick={onDelete}
            title="Delete Project"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
        
        {isEditing && (
          <EditModal 
            project={p}
            theme={theme}
            allGroups={allGroups ? allGroups : []}
            sshHosts={sshHosts}
            onManageSshHosts={onManageSshHosts}
            onSave={(updatedProject) => {
              onChange(updatedProject);
              setIsEditing(false);
            }}
            onCancel={() => setIsEditing(false)}
          />
        )}
      </div>
    );
  }

  // Grid view
  return (
    <div 
      className="project-tile project-tile--gallery group"
      style={{ 
        backgroundColor: toAlpha(theme.secondaryBackground, 0.72),
        borderColor: toAlpha(p.color || theme.border, 0.46),
        boxShadow: `0 14px 32px ${toAlpha(p.color || theme.focusBorder, 0.08)}`,
        ['--glow-color' as string]: toAlpha(p.color || theme.focusBorder, 0.18)
      }}
    >
      <div 
        className="gallery-visual flex items-center justify-center relative cursor-pointer flex-shrink-0"
        style={{ 
          backgroundColor: p.icon ? 'transparent' : toAlpha(theme.primaryBackground, 0.72),
          backgroundImage: p.icon ? `url(${p.icon})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
        onClick={onOpen}
      >
        {!p.icon && (
          <div className="text-center" style={{ color: p.color }}>
            <div className="text-2xl mb-1">{typeIcons[p.type]}</div>
            <div className="text-[10px] opacity-70 capitalize font-medium tracking-wide">{p.type}</div>
          </div>
        )}
        
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 rounded-full transition-colors"
            style={{ 
              backgroundColor: theme.primaryBackground,
              color: theme.foreground,
              opacity: 0.8
            }}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            title="Expand Details"
            onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '0.8'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
      
      <div className="p-3 flex flex-col flex-1 min-w-0">
        <div className="flex items-start justify-between mb-1">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: p.color }}
              ></div>
              <h3 className="project-name" style={{ color: theme.foreground }} title={p.description || p.name}>
                {p.name}
              </h3>
            </div>
            {p.description && (
              <p className="gallery-description truncate mt-0.5" style={{ color: theme.foreground, opacity: 0.74 }} title={p.description}>
                {p.description}
              </p>
            )}
            <p className="project-path" style={{ color: theme.foreground, opacity: 0.58 }} title={p.path}>{p.path}</p>
          </div>
          <span className={`project-type ml-2 flex-shrink-0 ${typeColors[p.type]}`}>
            {p.type}
          </span>
        </div>
        
        {/* Tags 区域 - 固定高度保持对齐 */}
        <div className="gallery-tags flex flex-wrap gap-1 mb-2 min-h-[18px]">
            {p.tags && p.tags.slice(0, 2).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600">
                {tag}
              </span>
            ))}
            {p.tags && p.tags.length > 2 && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600">
                +{p.tags.length - 2}
              </span>
            )}
          </div>
        
        {/* 按钮区域 - 始终在底部 */}
        <div className="flex items-center justify-between mt-auto">
          <button
            className="flex-1 py-1.5 px-2 text-xs rounded-lg transition-colors font-medium"
            style={{
              backgroundColor: theme.buttonBackground,
              color: theme.buttonForeground
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            onClick={onOpen}
          >
            Open
          </button>
          <div className="flex gap-1 ml-2">
            <button
              className="project-action"
              style={{ 
                color: p.isFavorite ? '#eab308' : theme.foreground,
                opacity: p.isFavorite ? 1 : 0.6
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#fef3c7';
                e.currentTarget.style.color = '#eab308';
                e.currentTarget.style.opacity = '1';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = p.isFavorite ? '#eab308' : theme.foreground;
                e.currentTarget.style.opacity = p.isFavorite ? '1' : '0.6';
              }}
              onClick={() => onToggleFavorite(p.id!)}
              title={p.isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <svg className="w-4 h-4" fill={p.isFavorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
            <button
              className="project-action"
              style={{ 
                color: theme.foreground,
                opacity: 0.6
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = theme.listHoverBackground;
                e.currentTarget.style.opacity = '1';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.opacity = '0.6';
              }}
              onClick={() => setIsEditing(true)}
              title="Edit"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              className="project-action"
              style={{ 
                color: theme.foreground,
                opacity: 0.6
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#fef2f2';
                e.currentTarget.style.color = '#ef4444';
                e.currentTarget.style.opacity = '1';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = theme.foreground;
                e.currentTarget.style.opacity = '0.6';
              }}
              onClick={onDelete}
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      {isExpanded && (
        <div 
          className="px-4 pb-4 border-t"
          style={{ 
            backgroundColor: toAlpha(theme.primaryBackground, 0.8),
            borderColor: toAlpha(theme.border, 0.42) 
          }}
        >
          <div className="pt-3 space-y-2 text-sm" style={{ color: theme.foreground }}>
            {p.description && (
              <div><span className="font-medium">Description:</span> {p.description}</div>
            )}
            <div><span className="font-medium">Path:</span> {p.path}</div>
            <div><span className="font-medium">Type:</span> {p.type}</div>
            {p.group && (
              <div><span className="font-medium">Group:</span> {p.group}</div>
            )}
            {p.tags && p.tags.length > 0 && (
              <div><span className="font-medium">Tags:</span> {p.tags.join(', ')}</div>
            )}
          </div>
        </div>
      )}
      
      {isEditing && (
        <EditModal 
          project={p} 
          theme={theme}
          allGroups={allGroups}
          sshHosts={sshHosts}
          onManageSshHosts={onManageSshHosts}
          onSave={(updatedProject) => {
            onChange(updatedProject);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      )}
    </div>
  );
}

function EditModal({ project, theme, allGroups, sshHosts, onManageSshHosts, onSave, onCancel }: {
  project: ProjectItem;
  theme: any;
  allGroups: string[];
  sshHosts: SshHost[];
  onManageSshHosts: () => void;
  onSave: (project: ProjectItem) => void;
  onCancel: () => void;
}) {
  const isNewProject = !project.id;
  const [editedProject, setEditedProject] = useState<ProjectItem>({ ...project });
  const [hasManuallyEditedName, setHasManuallyEditedName] = useState(false);
  const [tagsInput, setTagsInput] = useState((project.tags ?? []).join(', '));
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<'success' | 'error' | null>(null);
  const [testMessage, setTestMessage] = useState<string>('');
  const [isCreatingNewGroup, setIsCreatingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [remoteStatus, setRemoteStatus] = useState<CurrentRemoteStatus | null>(null);
  const [sshResolution, setSshResolution] = useState<SshResolution | null>(null);
  const [isResolvingSsh, setIsResolvingSsh] = useState(false);
  const [isConvertingLegacySsh, setIsConvertingLegacySsh] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sshResolveRequestRef = useRef(0);
  const legacyConversionSnapshotRef = useRef<ProjectItem | null>(null);
  const usesManagedSshFields = isSshProjectType(editedProject.type) && (
    isNewProject
    || isConvertingLegacySsh
    || !isSshProjectType(project.type)
    || project.sshHostId !== undefined
    || project.remotePath !== undefined
  );
  const applyManagedSshFields = useCallback((sshHostId: string, remotePath: string) => {
    setEditedProject(prev => updateManagedProjectFields(prev, sshHostId, remotePath, sshHosts));
  }, [sshHosts]);
  const beginLegacySshConversion = useCallback(() => {
    legacyConversionSnapshotRef.current = { ...editedProject };
    setEditedProject(createManagedSshConversionDraft(editedProject));
    setIsConvertingLegacySsh(true);
  }, [editedProject]);
  const cancelLegacySshConversion = useCallback(() => {
    if (legacyConversionSnapshotRef.current) {
      setEditedProject(legacyConversionSnapshotRef.current);
    }
    legacyConversionSnapshotRef.current = null;
    setIsConvertingLegacySsh(false);
  }, []);
  const pathAnalysis = useMemo(
    () => analyzeProjectPath(editedProject.path, editedProject.type),
    [editedProject.path, editedProject.type]
  );
  const expectedPathExample = useMemo(
    () => getExpectedPathExample(editedProject.type, remoteStatus),
    [editedProject.type, remoteStatus]
  );
  const saveValidationError = useMemo(
    () => {
      if (!editedProject.name.trim()) {
        return 'Project name cannot be empty.';
      }
      if (usesManagedSshFields) {
        return validateManagedProjectFields(
          editedProject.type,
          editedProject.sshHostId,
          editedProject.remotePath,
          sshHosts
        );
      }
      return getProjectValidationError(editedProject, remoteStatus);
    },
    [editedProject, remoteStatus, sshHosts, usesManagedSshFields]
  );
  const applyPathValue = useCallback((nextPath: string) => {
    const analysis = analyzeProjectPath(nextPath, editedProject.type);
    setEditedProject(prev => {
      const nextProject = { ...prev, path: nextPath };
      if (!hasManuallyEditedName && analysis?.suggestedName) {
        nextProject.name = analysis.suggestedName;
      }
      return nextProject;
    });
  }, [editedProject.type, hasManuallyEditedName]);
  const applySelectedPath = useCallback((nextPath: string, detectedType?: ProjectType, suggestedName?: string) => {
    setEditedProject(prev => {
      const nextType = detectedType || prev.type;
      const analysis = analyzeProjectPath(nextPath, nextType);
      const managedRemotePath = usesManagedSshFields && isSshProjectType(nextType)
        ? extractRemotePathForManagedProject(nextPath)
        : null;
      const nextProject = managedRemotePath
        ? updateManagedProjectFields(
          { ...prev, type: nextType },
          prev.sshHostId ?? '',
          managedRemotePath,
          sshHosts
        )
        : { ...prev, path: nextPath, type: nextType };
      const nextName = suggestedName || analysis?.suggestedName;

      if (!hasManuallyEditedName && nextName) {
        nextProject.name = nextName;
      }

      return nextProject;
    });
  }, [hasManuallyEditedName, sshHosts, usesManagedSshFields]);
  const applyCanonicalSshPath = useCallback((nextPath: string) => {
    const managedRemotePath = usesManagedSshFields
      ? extractRemotePathForManagedProject(nextPath)
      : null;
    if (managedRemotePath) {
      applyManagedSshFields(editedProject.sshHostId ?? '', managedRemotePath);
      return;
    }
    setEditedProject(prev => ({ ...prev, path: nextPath }));
  }, [applyManagedSshFields, editedProject.sshHostId, usesManagedSshFields]);
  const applySuggestedProjectType = useCallback(() => {
    if (!pathAnalysis?.suggestedType || pathAnalysis.suggestedType === editedProject.type) {
      return;
    }
    setEditedProject(prev => ({ ...prev, type: pathAnalysis.suggestedType! }));
  }, [editedProject.type, pathAnalysis]);

  // 检查远程状态
  useEffect(() => {
    if (editedProject.type === 'ssh' || editedProject.type === 'ssh-workspace') {
      vscode.postMessage({ type: 'checkRemoteStatus' });
    }
  }, [editedProject.type]);

  useEffect(() => {
    if (
      !isNewProject ||
      !isSshProjectType(editedProject.type) ||
      editedProject.path.trim() ||
      !remoteStatus?.isRemote ||
      !remoteStatus.currentPath ||
      remoteStatus.currentType !== editedProject.type
    ) {
      return;
    }

    applySelectedPath(remoteStatus.currentPath, remoteStatus.currentType, getSuggestedNameFromPath(remoteStatus.currentPath));
  }, [
    applySelectedPath,
    editedProject.path,
    editedProject.type,
    isNewProject,
    remoteStatus
  ]);

  useEffect(() => {
    const trimmedPath = editedProject.path.trim();
    const detectedType = pathAnalysis?.suggestedType || editedProject.type;
    const canResolveManaged = usesManagedSshFields
      && !!editedProject.sshHostId
      && !!editedProject.remotePath?.trim();
    const canResolve = canResolveManaged || (
      !!trimmedPath &&
      isSshProjectType(detectedType) &&
      (trimmedPath.startsWith('vscode-remote://ssh-remote+') || !!parseRawSshPath(trimmedPath))
    );

    if (!canResolve) {
      setIsResolvingSsh(false);
      setSshResolution(null);
      return;
    }

    const requestId = sshResolveRequestRef.current + 1;
    sshResolveRequestRef.current = requestId;
    setIsResolvingSsh(true);

    const timer = window.setTimeout(() => {
      vscode.postMessage({
        type: 'resolveSshTarget',
        payload: {
          path: trimmedPath,
          project: { ...editedProject },
          requestId
        }
      });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    editedProject.path,
    editedProject.remotePath,
    editedProject.sshHostId,
    editedProject.type,
    pathAnalysis?.suggestedType,
    usesManagedSshFields
  ]);

  // 监听连接测试结果和远程状态
  useEffect(() => {
    const handleTestResult = (event: any) => {
      const result = event.detail;
      setIsTestingConnection(false);
      setConnectionTestResult(result.success ? 'success' : 'error');
      setTestMessage(result.message);
      setTimeout(() => {
        setConnectionTestResult(null);
        setTestMessage('');
      }, 5000);
    };

    const handlePathSelected = (event: any) => {
      const { path, inputType, projectType, suggestedName, sshHost } = event.detail as {
        path?: string;
        inputType?: string;
        projectType?: ProjectType;
        suggestedName?: string;
        sshHost?: string;
      };
      if (path) {
        const detectedType =
          projectType ||
          (inputType === 'folder'
            ? 'local'
            : inputType === 'workspace'
              ? 'workspace'
              : inputType === 'ssh' || inputType === 'ssh-workspace'
                ? inputType
                : undefined);

        applySelectedPath(path, detectedType, suggestedName);

        if (sshHost && (detectedType === 'ssh' || detectedType === 'ssh-workspace')) {
          const hostname = sshHost.split('@')[1] || sshHost;
          const currentTags = tagsInput.split(',').map(s => s.trim()).filter(Boolean);
          if (!currentTags.includes(hostname)) {
            setTagsInput([...currentTags, hostname].join(', '));
          }
        }
      }
    };

    const handleSshBrowseResult = (event: any) => {
      const result = event.detail;
      if (!result.success) {
        setTestMessage(result.message);
        setConnectionTestResult('error');
        setTimeout(() => {
          setConnectionTestResult(null);
          setTestMessage('');
        }, 5000);
      }
    };

    const handleRemoteStatus = (event: any) => {
      setRemoteStatus(event.detail as CurrentRemoteStatus);
    };

    const handleSshTargetResolved = (event: any) => {
      const result = event.detail as SshResolution;
      if (typeof result.requestId === 'number' && result.requestId !== sshResolveRequestRef.current) {
        return;
      }

      setIsResolvingSsh(false);
      setSshResolution(result.success ? result : null);

      if (
        !usesManagedSshFields &&
        result.success &&
        result.canonicalPath &&
        result.canonicalPath !== result.requestedPath &&
        !result.requestedPath.includes('@')
      ) {
        setEditedProject(prev => {
          if (prev.path !== result.requestedPath || prev.path.includes('@')) {
            return prev;
          }
          return { ...prev, path: result.canonicalPath! };
        });
      }
    };

    window.addEventListener('connectionTestResult', handleTestResult);
    window.addEventListener('pathSelected', handlePathSelected);
    window.addEventListener('sshBrowseResult', handleSshBrowseResult);
    window.addEventListener('remoteStatus', handleRemoteStatus);
    window.addEventListener('sshTargetResolved', handleSshTargetResolved);
    return () => {
      window.removeEventListener('connectionTestResult', handleTestResult);
      window.removeEventListener('pathSelected', handlePathSelected);
      window.removeEventListener('sshBrowseResult', handleSshBrowseResult);
      window.removeEventListener('remoteStatus', handleRemoteStatus);
      window.removeEventListener('sshTargetResolved', handleSshTargetResolved);
    };
  }, [applySelectedPath, tagsInput, usesManagedSshFields]);

  // 预设的漂亮颜色
  const presetColors = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
    '#14b8a6', '#f43f5e', '#8b5a2b', '#059669', '#7c3aed',
    '#dc2626', '#0891b2', '#65a30d', '#ea580c', '#7c2d12'
  ];

  const getRandomColor = () => {
    return presetColors[Math.floor(Math.random() * presetColors.length)];
  };

  const extractHostFromSshPath = (sshPath: string): string | null => {
    return extractHostnameFromSshPath(sshPath);
  };

  const autoAddHostTag = () => {
    if ((editedProject.type === 'ssh' || editedProject.type === 'ssh-workspace') && editedProject.path.trim()) {
      const hostname = extractHostFromSshPath(editedProject.path);
      if (hostname) {
        const currentTags = tagsInput.split(',').map(s => s.trim()).filter(Boolean);
        if (!currentTags.includes(hostname)) {
          const newTags = [...currentTags, hostname].join(', ');
          setTagsInput(newTags);
        }
      }
    }
  };

  const modalPanelBackground = toAlpha(theme.primaryBackground, 0.82);
  const modalCardBackground = toAlpha(theme.secondaryBackground, 0.68);
  const modalInputStyle = {
    backgroundColor: modalCardBackground,
    color: theme.inputForeground,
    borderColor: toAlpha(theme.inputBorder, 0.64),
    '--tw-ring-color': theme.focusBorder,
    ['--input-bg' as string]: modalCardBackground,
    ['--input-border' as string]: toAlpha(theme.inputBorder, 0.64)
  } as React.CSSProperties;
  const modalSecondaryButtonStyle = {
    backgroundColor: modalCardBackground,
    color: theme.inputForeground,
    borderColor: toAlpha(theme.inputBorder, 0.62),
    ['--button-bg' as string]: modalCardBackground,
    ['--button-border' as string]: toAlpha(theme.inputBorder, 0.62)
  } as React.CSSProperties;
  const modalPrimaryButtonStyle = {
    backgroundColor: theme.buttonBackground,
    color: theme.buttonForeground,
    borderColor: toAlpha(theme.buttonBackground, 0.58),
    ['--button-bg' as string]: theme.buttonBackground,
    ['--button-border' as string]: toAlpha(theme.buttonBackground, 0.58),
    boxShadow: `0 10px 28px ${toAlpha(theme.focusBorder, 0.24)}`
  } as React.CSSProperties;

  const handleCreateGroup = () => {
    const trimmedName = newGroupName.trim();
    if (trimmedName) {
      // 检查是否已存在相同分组
      if (allGroups.includes(trimmedName)) {
        // 如果已存在，直接选择该分组
        setEditedProject(prev => ({ ...prev, group: trimmedName }));
      } else {
        // 创建新分组
        setEditedProject(prev => ({ ...prev, group: trimmedName }));
      }
      setIsCreatingNewGroup(false);
      setNewGroupName('');
    }
  };

  const handleCancelCreateGroup = () => {
    setIsCreatingNewGroup(false);
    setNewGroupName('');
  };

  const testSshConnection = async () => {
    if (editedProject.type !== 'ssh' && editedProject.type !== 'ssh-workspace') {
      return;
    }

    setIsTestingConnection(true);
    setConnectionTestResult(null);
    setTestMessage('');

    // 自动添加hostname作为tag
    autoAddHostTag();

    // 发送测试连接请求到后端
    vscode.postMessage({ 
      type: 'testConnection', 
      payload: { ...editedProject }
    });
  };

  return (
    <ModalSurface
      id={`project-editor-${project.id || project.type}`}
      labelId="project-editor-title"
      onRequestClose={onCancel}
      maxWidth="760px"
      className="project-editor-modal"
    >
      <div className="modal-body" style={{ backgroundColor: modalPanelBackground }}>
        <div className="relative p-5 sm:p-6">
        <div className="mb-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 id="project-editor-title" className="text-xl font-semibold text-left tracking-tight" style={{ color: theme.foreground }}>
                {isNewProject ? `Add ${project.type} Project` : 'Edit Project'}
              </h3>
              <p className="mt-1 text-sm" style={{ color: toAlpha(theme.foreground, 0.72) }}>
                Configure project metadata, paths, groups, tags, and visual identity.
              </p>
            </div>
            <button
              className="soft-button w-10 h-10 rounded-2xl inline-flex items-center justify-center transition-all"
              style={modalSecondaryButtonStyle}
              onClick={onCancel}
              title="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-4" style={{ backgroundColor: modalCardBackground }}>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Project Name</label>
            <input 
              className="soft-input w-full px-3 py-2.5 border rounded-xl focus:ring-2 focus:border-transparent"
              style={modalInputStyle}
              value={editedProject.name}
              onChange={e => {
                setHasManuallyEditedName(true);
                setEditedProject({ ...editedProject, name: e.target.value });
              }}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Description</label>
            <textarea 
              className="soft-input w-full px-3 py-2.5 border rounded-xl focus:ring-2 focus:border-transparent resize-none"
              style={modalInputStyle}
              rows={2}
              placeholder="Brief description of this project..."
              value={editedProject.description || ''}
              onChange={e => setEditedProject({ ...editedProject, description: e.target.value })}
            />
          </div>
          
          <div>
            {usesManagedSshFields && (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>SSH Host</label>
                <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                  <select
                    className="soft-input flex-1 min-w-0 px-3 py-2.5 border rounded-xl focus:ring-2 focus:border-transparent"
                    style={modalInputStyle}
                    value={editedProject.sshHostId ?? ''}
                    onChange={event => applyManagedSshFields(event.target.value, editedProject.remotePath ?? '')}
                  >
                    <option value="" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Select an SSH Host</option>
                    {sshHosts.map(host => (
                      <option key={host.id} value={host.id} style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>
                        {host.name} · {formatSshHostAddress(host)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm whitespace-nowrap"
                    style={modalSecondaryButtonStyle}
                    onClick={onManageSshHosts}
                    title="Create or edit reusable SSH Hosts"
                  >
                    + New Host
                  </button>
                  {isConvertingLegacySsh && (
                    <button
                      className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm whitespace-nowrap"
                      style={modalSecondaryButtonStyle}
                      onClick={cancelLegacySshConversion}
                      title="Return to the original full SSH path"
                    >
                      Use legacy path
                    </button>
                  )}
                </div>
                {sshHosts.length === 0 && (
                  <p className="text-xs mt-1.5" style={{ color: '#f59e0b' }}>Create an SSH Host before saving this project.</p>
                )}
              </div>
            )}
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>{usesManagedSshFields ? 'Remote Path' : 'Path'}</label>
            <div className="flex gap-2 flex-wrap sm:flex-nowrap">
              <input 
                className="soft-input flex-1 min-w-0 px-3 py-2.5 border rounded-xl focus:ring-2 focus:border-transparent"
                style={modalInputStyle}
                placeholder={
                  usesManagedSshFields
                    ? editedProject.type === 'ssh-workspace' ? '/path/to/project.code-workspace' : '/path/to/project'
                    : editedProject.type === 'workspace'
                    ? 'Select .code-workspace file'
                    : editedProject.type === 'local'
                      ? 'Select project folder'
                      : remoteStatus?.currentPath && remoteStatus.currentType === editedProject.type
                        ? remoteStatus.currentPath
                        : expectedPathExample
                }
                value={usesManagedSshFields ? editedProject.remotePath ?? '' : editedProject.path}
                onChange={e => usesManagedSshFields
                  ? applyManagedSshFields(editedProject.sshHostId ?? '', e.target.value)
                  : applyPathValue(e.target.value)}
              />
              {editedProject.type === 'local' && (
                <button
                  className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm"
                  style={modalSecondaryButtonStyle}
                  onClick={() => vscode.postMessage({ type: 'browseFolder', payload: { currentPath: editedProject.path } })}
                  title="Browse for folder"
                >
                  📁 Browse
                </button>
              )}
              {editedProject.type === 'workspace' && (
                <button
                  className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm"
                  style={modalSecondaryButtonStyle}
                  onClick={() => vscode.postMessage({ type: 'browseWorkspace', payload: { currentPath: editedProject.path } })}
                  title="Browse for workspace file"
                >
                  🗂️ Browse
                </button>
              )}
              {(editedProject.type === 'ssh' || editedProject.type === 'ssh-workspace') && (
                <div className="flex gap-2">
                  <button
                    className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm"
                    style={{
                      backgroundColor: modalCardBackground,
                      color: isTestingConnection ? '#f59e0b' : connectionTestResult === 'success' ? '#10b981' : connectionTestResult === 'error' ? '#ef4444' : theme.inputForeground,
                      borderColor: isTestingConnection ? '#f59e0b' : connectionTestResult === 'success' ? '#10b981' : connectionTestResult === 'error' ? '#ef4444' : toAlpha(theme.inputBorder, 0.62),
                      ['--button-bg' as string]: modalCardBackground,
                      ['--button-border' as string]: isTestingConnection ? '#f59e0b' : connectionTestResult === 'success' ? '#10b981' : connectionTestResult === 'error' ? '#ef4444' : toAlpha(theme.inputBorder, 0.62)
                    }}
                    onClick={testSshConnection}
                    disabled={isTestingConnection || (usesManagedSshFields
                      ? !editedProject.sshHostId || !editedProject.remotePath?.trim()
                      : !editedProject.path.trim())}
                    title="Test SSH connection"
                  >
                    {isTestingConnection ? '⏳' : connectionTestResult === 'success' ? '✅' : connectionTestResult === 'error' ? '❌' : '🔗'}
                    {isTestingConnection ? ' Testing...' : ' Test'}
                  </button>
                  <button
                    className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm"
                    style={{
                      backgroundColor: modalCardBackground,
                      color: remoteStatus?.isRemote ? '#10b981' : theme.inputForeground,
                      borderColor: remoteStatus?.isRemote ? '#10b981' : toAlpha(theme.inputBorder, 0.62),
                      ['--button-bg' as string]: modalCardBackground,
                      ['--button-border' as string]: remoteStatus?.isRemote ? '#10b981' : toAlpha(theme.inputBorder, 0.62),
                      opacity: remoteStatus?.isRemote ? 1 : 0.6
                    }}
                    onClick={() => {
                      if (remoteStatus?.isRemote) {
                        vscode.postMessage({ 
                          type: editedProject.type === 'ssh-workspace' ? 'browseSshWorkspace' : 'browseSshFolder',
                          payload: { currentPath: editedProject.path, project: { ...editedProject } }
                        });
                      } else {
                        setTestMessage('Connect to an SSH remote first to browse remote files');
                        setConnectionTestResult('error');
                        setTimeout(() => {
                          setConnectionTestResult(null);
                          setTestMessage('');
                        }, 3000);
                      }
                    }}
                    title={remoteStatus?.isRemote 
                      ? `Browse remote ${editedProject.type === 'ssh-workspace' ? 'workspace files' : 'folders'} (connected to ${remoteStatus.sshHost || 'remote'})` 
                      : 'Connect to an SSH remote first to browse files'}
                  >
                    {remoteStatus?.isRemote ? '📂' : '🔌'}
                  </button>
                </div>
              )}
            </div>
            {isSshProjectType(editedProject.type) && !usesManagedSshFields && (
              <div
                className="glass-card rounded-xl px-3 py-2.5 text-xs mt-2 flex items-center justify-between gap-3 flex-wrap"
                style={{
                  backgroundColor: toAlpha(theme.focusBorder, 0.08),
                  borderColor: toAlpha(theme.focusBorder, 0.2),
                  color: theme.foreground
                }}
              >
                <span style={{ color: toAlpha(theme.foreground, 0.72) }}>
                  Link this legacy project to a reusable Host while keeping its current path until the new fields are complete.
                </span>
                <button
                  className="soft-button px-3 py-1.5 rounded-xl text-xs whitespace-nowrap"
                  style={modalSecondaryButtonStyle}
                  onClick={beginLegacySshConversion}
                >
                  Use reusable Host
                </button>
              </div>
            )}
            {pathAnalysis && (
              <div
                className="glass-card rounded-xl px-3 py-2 text-xs mt-2 flex items-start justify-between gap-3"
                style={{
                  backgroundColor:
                    pathAnalysis.severity === 'success'
                      ? toAlpha('#10b981', 0.08)
                      : pathAnalysis.severity === 'warning'
                        ? toAlpha('#f59e0b', 0.08)
                        : toAlpha(theme.focusBorder, 0.08),
                  borderColor:
                    pathAnalysis.severity === 'success'
                      ? toAlpha('#10b981', 0.2)
                      : pathAnalysis.severity === 'warning'
                        ? toAlpha('#f59e0b', 0.2)
                        : toAlpha(theme.focusBorder, 0.2),
                  color:
                    pathAnalysis.severity === 'success'
                      ? '#10b981'
                      : pathAnalysis.severity === 'warning'
                        ? '#f59e0b'
                        : theme.foreground
                }}
              >
                <div className="leading-5">
                  <div className="font-medium">
                    {pathAnalysis.severity === 'success' ? 'Detected:' : pathAnalysis.severity === 'warning' ? 'Reminder:' : 'Suggestion:'} {pathAnalysis.summary}
                  </div>
                  {pathAnalysis.detail && (
                    <div style={{ color: toAlpha(theme.foreground, 0.72) }}>{pathAnalysis.detail}</div>
                  )}
                </div>
                {pathAnalysis.suggestedType && pathAnalysis.suggestedType !== editedProject.type && (
                  <button
                    className="soft-button px-3 py-1.5 rounded-xl text-xs whitespace-nowrap"
                    style={modalSecondaryButtonStyle}
                    onClick={applySuggestedProjectType}
                  >
                    Use {getProjectTypeLabel(pathAnalysis.suggestedType)}
                  </button>
                )}
              </div>
            )}
            {(editedProject.type === 'ssh' || editedProject.type === 'ssh-workspace') && remoteStatus?.isRemote && (
              <div
                className="glass-card rounded-xl px-3 py-2 text-xs mt-2 flex items-start justify-between gap-3"
                style={{
                  backgroundColor: toAlpha('#10b981', 0.08),
                  borderColor: toAlpha('#10b981', 0.2),
                  color: theme.foreground
                }}
              >
                <div className="leading-5">
                  <div className="font-medium">
                    Current SSH window: {remoteStatus.sshHost || remoteStatus.host || 'remote'}
                    {remoteStatus.ip ? ` · IP ${remoteStatus.ip}` : ''}
                    {remoteStatus.port ? ` · Port ${remoteStatus.port}` : ''}
                  </div>
                  {remoteStatus.currentPath && (
                    <div style={{ color: toAlpha(theme.foreground, 0.76) }}>
                      Current path: {remoteStatus.currentPath}
                    </div>
                  )}
                </div>
                {remoteStatus.currentPath && remoteStatus.currentType === editedProject.type && remoteStatus.currentPath !== editedProject.path && (
                  <button
                    className="soft-button px-3 py-1.5 rounded-xl text-xs whitespace-nowrap"
                    style={modalSecondaryButtonStyle}
                    onClick={() => applySelectedPath(remoteStatus.currentPath!, remoteStatus.currentType, getSuggestedNameFromPath(remoteStatus.currentPath!))}
                  >
                    Use current SSH path
                  </button>
                )}
              </div>
            )}
            {(isResolvingSsh || sshResolution) && isSshProjectType(pathAnalysis?.suggestedType || editedProject.type) && (
              <div
                className="glass-card rounded-xl px-3 py-2 text-xs mt-2"
                style={{
                  backgroundColor: toAlpha(theme.focusBorder, 0.08),
                  borderColor: toAlpha(theme.focusBorder, 0.2),
                  color: theme.foreground
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="leading-5">
                    <div className="font-medium">
                      {isResolvingSsh ? 'Resolving SSH target...' : sshResolution?.message || 'SSH target details ready.'}
                    </div>
                    {!isResolvingSsh && sshResolution && (
                      <div style={{ color: toAlpha(theme.foreground, 0.76) }}>
                        {sshResolution.resolvedUsername && <span>User: {sshResolution.resolvedUsername} · </span>}
                        {sshResolution.host && <span>Host: {sshResolution.host}</span>}
                        {sshResolution.resolvedHostname && sshResolution.resolvedHostname !== sshResolution.host && (
                          <span> · HostName: {sshResolution.resolvedHostname}</span>
                        )}
                        {sshResolution.ip && <span> · IP: {sshResolution.ip}</span>}
                        {sshResolution.port && <span> · Port: {sshResolution.port}</span>}
                      </div>
                    )}
                    {!isResolvingSsh && sshResolution?.warnings.map((warning, index) => (
                      <div key={index} style={{ color: '#f59e0b' }}>
                        {warning}
                      </div>
                    ))}
                  </div>
                  {!isResolvingSsh && sshResolution?.canonicalPath && sshResolution.canonicalPath !== editedProject.path && (
                    <button
                      className="soft-button px-3 py-1.5 rounded-xl text-xs whitespace-nowrap"
                      style={modalSecondaryButtonStyle}
                      onClick={() => applyCanonicalSshPath(sshResolution.canonicalPath!)}
                    >
                      Use canonical path
                    </button>
                  )}
                </div>
              </div>
            )}
            {(editedProject.type === 'ssh' || editedProject.type === 'ssh-workspace') && (
              <div className="text-xs mt-2 leading-5" style={{ color: theme.foreground, opacity: 0.7 }}>
                Expected SSH path: {expectedPathExample}
                {remoteStatus?.isRemote && (
                  <span style={{ color: '#10b981' }}> • Connected to {remoteStatus.sshHost || 'remote'} - click 📂 to browse</span>
                )}
                {!remoteStatus?.isRemote && (
                  <span> • Connect to SSH remote first to use file browser</span>
                )}
              </div>
            )}
            {connectionTestResult && (
              <div className="glass-card rounded-xl px-3 py-2 text-xs mt-2" style={{ 
                color: connectionTestResult === 'success' ? '#10b981' : '#ef4444',
                backgroundColor: toAlpha(connectionTestResult === 'success' ? '#10b981' : '#ef4444', 0.08),
                borderColor: toAlpha(connectionTestResult === 'success' ? '#10b981' : '#ef4444', 0.2)
              }}>
                {connectionTestResult === 'success' ? '✅' : '❌'} {testMessage || (connectionTestResult === 'success' ? 'Connection format appears valid' : 'Connection test failed')}
              </div>
            )}
        </div>
          
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Type</label>
            <select 
              className="soft-input w-full px-3 py-2.5 border rounded-xl focus:ring-2 focus:border-transparent"
              style={modalInputStyle}
              value={editedProject.type}
              onChange={e => {
                const nextType = e.target.value as ProjectType;
                if (!isSshProjectType(nextType)) {
                  legacyConversionSnapshotRef.current = null;
                  setIsConvertingLegacySsh(false);
                }
                setEditedProject(prev => {
                  if (!isSshProjectType(nextType)) {
                    const { sshHostId: _sshHostId, remotePath: _remotePath, ...localProject } = prev;
                    return { ...localProject, type: nextType };
                  }
                  if (!isSshProjectType(prev.type)) {
                    return { ...prev, type: nextType, path: '', sshHostId: undefined, remotePath: '' };
                  }
                  return { ...prev, type: nextType };
                });
              }}
            >
              <option value="local" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Local Folder</option>
              <option value="workspace" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Workspace File</option>
              <option value="ssh" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>SSH Remote</option>
              <option value="ssh-workspace" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>SSH Workspace</option>
        </select>
      </div>
          
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Group</label>
            {isCreatingNewGroup ? (
              <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                <input 
                  className="soft-input flex-1 px-3 py-2.5 border rounded-xl focus:ring-2 focus:border-transparent"
                  style={modalInputStyle}
                  placeholder="Enter new group name"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreateGroup();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelCreateGroup();
                    }
                  }}
                  autoFocus
                />
                <button
                  className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm"
                  style={modalPrimaryButtonStyle}
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                >
                  ✓
                </button>
                <button
                  className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm"
                  style={modalSecondaryButtonStyle}
                  onClick={handleCancelCreateGroup}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                <select 
                  className="soft-input flex-1 px-3 py-2.5 border rounded-xl focus:ring-2 focus:border-transparent"
                  style={modalInputStyle}
                  value={editedProject.group || ''}
                  onChange={e => setEditedProject({ ...editedProject, group: e.target.value || undefined })}
                >
                  <option value="" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>No Group</option>
                  {/* 显示当前项目的分组（如果是新创建的） */}
                  {editedProject.group && !allGroups.includes(editedProject.group) && (
                    <option key={editedProject.group} value={editedProject.group} style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>
                      {editedProject.group} (new)
                    </option>
                  )}
                  {allGroups.map(group => (
                    <option key={group} value={group} style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>
                      {group}
                    </option>
                  ))}
                </select>
                <button
                  className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm"
                  style={modalSecondaryButtonStyle}
                  onClick={() => setIsCreatingNewGroup(true)}
                  title="Create new group"
                >
                  + New
                </button>
              </div>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Tags (comma separated)</label>
            <div className="flex gap-2 flex-wrap sm:flex-nowrap">
              <input 
                type="text"
                className="soft-input flex-1 px-3 py-2.5 border rounded-xl focus:ring-2 focus:border-transparent"
                style={modalInputStyle}
                placeholder="react, frontend, web"
                value={tagsInput}
                onChange={e => {
                  console.log('Tags input changed:', e.target.value);
                  setTagsInput(e.target.value);
                }}
                onInput={e => {
                  // 额外的输入处理
                  const target = e.target as HTMLInputElement;
                  console.log('Input event:', target.value);
                  setTagsInput(target.value);
                }}
                autoComplete="off"
                spellCheck={false}
              />
              {(editedProject.type === 'ssh' || editedProject.type === 'ssh-workspace') && (
                <button
                  className="soft-button px-3 py-2.5 border rounded-xl transition-colors text-sm"
                  style={modalSecondaryButtonStyle}
                  onClick={autoAddHostTag}
                  title="Auto-add hostname as tag"
                >
                  🏷️ Host
                </button>
              )}
            </div>
            <div className="text-xs mt-1" style={{ color: theme.foreground, opacity: 0.6 }}>
              Separate tags with commas. {(editedProject.type === 'ssh' || editedProject.type === 'ssh-workspace') ? 'SSH projects can auto-add hostname as tag.' : 'Example: react, frontend, typescript'}
            </div>
          </div>
          
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Color</label>
              <div className="flex gap-2">
                <input 
                  type="color" 
                  className="soft-input flex-1 h-11 border rounded-xl p-1"
                  style={modalInputStyle}
                  value={editedProject.color ?? '#999999'}
                  onChange={e => setEditedProject({ ...editedProject, color: e.target.value })}
                />
                <button 
                  className="soft-button px-3 h-11 border rounded-xl transition-colors text-sm"
                  style={modalSecondaryButtonStyle}
                  onClick={() => setEditedProject({ ...editedProject, color: getRandomColor() })}
                  title="Random color"
                >
                  🎲
                </button>
              </div>
              
              {/* 预设颜色快速选择 */}
              <div className="flex flex-wrap gap-1 mt-2">
                {presetColors.slice(0, 10).map(color => (
                  <button
                    key={color}
                    className="w-6 h-6 rounded border-2 transition-transform hover:scale-110"
                    style={{ 
                      backgroundColor: color,
                      borderColor: editedProject.color === color ? theme.focusBorder : 'transparent'
                    }}
                    onClick={() => setEditedProject({ ...editedProject, color })}
                    title={color}
                  />
                ))}
              </div>
      </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Icon</label>
              <button 
                className="soft-button w-full h-11 border rounded-xl transition-colors"
                style={modalSecondaryButtonStyle}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = theme.listHoverBackground}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = modalCardBackground}
                onClick={() => fileRef.current?.click()}
              >
                {editedProject.icon ? 'Change Icon' : 'Upload Icon'}
              </button>
              <input 
                type="file" 
                accept="image/*" 
                ref={fileRef} 
                className="hidden" 
                onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const b64 = await fileToBase64(f);
                  setEditedProject({ ...editedProject, icon: b64 });
                }} 
              />
            </div>
          </div>
        </div>
        
        {saveValidationError && (
          <div
            className="glass-card rounded-xl px-3 py-2 text-xs mt-6"
            style={{
              color: '#f59e0b',
              backgroundColor: toAlpha('#f59e0b', 0.08),
              borderColor: toAlpha('#f59e0b', 0.2)
            }}
          >
            {saveValidationError}
          </div>
        )}
        <div className="flex gap-3 mt-6 flex-col-reverse sm:flex-row">
          <button
            className="soft-button flex-1 px-4 py-3 rounded-2xl transition-colors font-medium"
            style={{
              ...modalPrimaryButtonStyle,
              opacity: saveValidationError ? 0.6 : 1,
              cursor: saveValidationError ? 'not-allowed' : 'pointer'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            onClick={() => {
              if (saveValidationError) {
                return;
              }
              // 保存时处理tags
              const finalProject = {
                ...editedProject,
                tags: tagsInput.split(',').map(s => s.trim()).filter(Boolean)
              };
              onSave(finalProject);
            }}
            disabled={!!saveValidationError}
          >
            {isNewProject ? 'Create Project' : 'Save Changes'}
          </button>
          <button
            className="soft-button flex-1 px-4 py-3 border rounded-2xl transition-colors"
            style={modalSecondaryButtonStyle}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = theme.listHoverBackground}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = modalCardBackground}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
        </div>
      </div>
    </ModalSurface>
  );
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
