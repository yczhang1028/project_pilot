import React, { useEffect, useMemo, useRef, useState } from 'react';

type ProjectType = 'local' | 'workspace' | 'ssh';
type ProjectItem = { 
  id?: string; 
  name: string; 
  path: string; 
  description?: string; 
  icon?: string; 
  color?: string; 
  tags?: string[]; 
  group?: string; 
  type: ProjectType;
  isFavorite?: boolean;
  clickCount?: number;
  lastAccessed?: string;
};
type UISettings = {
  compactMode?: boolean;
  viewMode?: 'grid' | 'list';
  selectedGroup?: string;
};
type State = { 
  projects: ProjectItem[];
  uiSettings?: UISettings;
};

declare const acquireVsCodeApi: any;
const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : { postMessage: console.log };

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

type ViewMode = 'grid' | 'list';
type SortBy = 'name' | 'type' | 'recent';

export default function App() {
  const [state, setState] = useState<State>({ projects: [] });
  const [q, setQ] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showByGroup, setShowByGroup] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [newProjectType, setNewProjectType] = useState<ProjectType | null>(null);
  const [theme, setTheme] = useState(getVSCodeTheme());

  useEffect(() => {
    console.log('Project Pilot: Setting up message listener');
    const listener = (e: MessageEvent) => {
      console.log('Project Pilot: Received message', e.data);
      if (e.data?.type === 'state') {
        console.log('Project Pilot: Setting state', e.data.payload);
        const newState = e.data.payload as State;
        setState(newState);
        
        // 同步UI设置到本地状态
        if (newState.uiSettings) {
          if (newState.uiSettings.compactMode !== undefined) {
            setCompactMode(newState.uiSettings.compactMode);
          }
          if (newState.uiSettings.viewMode !== undefined) {
            setViewMode(newState.uiSettings.viewMode);
          }
          if (newState.uiSettings.selectedGroup !== undefined) {
            setSelectedGroup(newState.uiSettings.selectedGroup);
          }
        }
      } else if (e.data?.type === 'connectionTestResult') {
        // 处理连接测试结果
        window.dispatchEvent(new CustomEvent('connectionTestResult', { detail: e.data.payload }));
      } else if (e.data?.type === 'pathSelected') {
        // 处理路径选择结果
        window.dispatchEvent(new CustomEvent('pathSelected', { detail: e.data.payload }));
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
        case 'recent': return (b.id || '').localeCompare(a.id || '');
        default: return 0;
      }
    });
    
    return result;
  }, [state.projects, q, showFavoritesOnly, selectedTag, selectedGroup, sortBy]);

  const groupedProjects = useMemo(() => {
    const groups: { [key: string]: ProjectItem[] } = {};
    
    filtered.forEach(project => {
      const groupName = project.group || 'Ungrouped';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(project);
    });
    
    return groups;
  }, [filtered]);

  const addNewProject = (type: ProjectType) => {
    setNewProjectType(type);
    setShowAddForm(false);
  };

  const createNewProject = (projectData: ProjectItem) => {
    const newProject: ProjectItem = {
      ...projectData,
      id: Math.random().toString(36).slice(2, 10),
      type: newProjectType || 'local',
      color: projectData.color || (newProjectType === 'local' ? '#3b82f6' : newProjectType === 'workspace' ? '#10b981' : '#f59e0b'),
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

  return (
    <div 
      className="p-4 space-y-4 min-h-screen"
      style={{ 
        backgroundColor: theme.background,
        color: theme.foreground 
      }}
    >
      {/* Header */}
      <div 
        className="rounded-lg shadow-sm p-4"
        style={{ 
          backgroundColor: theme.primaryBackground,
          borderColor: theme.border 
        }}
      >
        <h1 className="text-xl font-bold mb-4" style={{ color: theme.foreground }}>Project Pilot</h1>
        
        {/* Search and Filters */}
        <div className="space-y-3">
      <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input 
                className="w-full pl-8 pr-3 py-2 rounded-md border focus:ring-2 focus:border-transparent" 
                style={{
                  backgroundColor: theme.inputBackground,
                  color: theme.inputForeground,
                  borderColor: theme.inputBorder,
                  '--tw-ring-color': theme.focusBorder
                } as React.CSSProperties}
                placeholder="Search by name, description, path, or tags..." 
                value={q} 
                onChange={e => setQ(e.target.value)} 
              />
              <svg className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button 
              className="px-3 py-2 rounded-md transition-colors"
              style={{
                backgroundColor: theme.buttonBackground,
                color: theme.buttonForeground
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.opacity = '0.9';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
              onClick={() => setShowAddForm(!showAddForm)}
            >
              + Add
            </button>
          </div>
          
          <div className="flex gap-2 items-center flex-wrap">
            <select 
              className="px-2 py-1 rounded border text-sm"
              style={{
                backgroundColor: theme.inputBackground,
                color: theme.inputForeground,
                borderColor: theme.inputBorder
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
              className="px-2 py-1 rounded border text-sm"
              style={{
                backgroundColor: theme.inputBackground,
                color: theme.inputForeground,
                borderColor: theme.inputBorder
              }}
              value={sortBy} 
              onChange={e => setSortBy(e.target.value as SortBy)}
            >
              <option value="name" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Sort by Name</option>
              <option value="type" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Sort by Type</option>
              <option value="recent" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Sort by Recent</option>
            </select>
            
            <select 
              className="px-2 py-1 rounded border text-sm"
              style={{
                backgroundColor: theme.inputBackground,
                color: theme.inputForeground,
                borderColor: theme.inputBorder
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
            
            <div className="flex rounded border overflow-hidden text-xs" style={{ borderColor: theme.inputBorder }}>
              <button 
                className="px-2 py-1"
                style={{
                  backgroundColor: viewMode === 'grid' ? theme.listActiveSelectionBackground : theme.inputBackground,
                  color: viewMode === 'grid' ? theme.buttonForeground : theme.inputForeground
                }}
                onClick={() => {
                  setViewMode('grid');
                  updateUISettings({ viewMode: 'grid' });
                }}
              >
                Grid
              </button>
              <button 
                className="px-2 py-1"
                style={{
                  backgroundColor: viewMode === 'list' ? theme.listActiveSelectionBackground : theme.inputBackground,
                  color: viewMode === 'list' ? theme.buttonForeground : theme.inputForeground
                }}
                onClick={() => {
                  setViewMode('list');
                  updateUISettings({ viewMode: 'list' });
                }}
              >
                List
              </button>
            </div>
            
            <button 
              className="px-2 py-1 text-xs rounded border"
              style={{
                backgroundColor: showByGroup ? theme.listActiveSelectionBackground : theme.inputBackground,
                color: showByGroup ? theme.buttonForeground : theme.inputForeground,
                borderColor: theme.inputBorder
              }}
              onClick={() => setShowByGroup(!showByGroup)}
              title="Toggle group view"
            >
              {showByGroup ? '📁' : '📋'}
            </button>
            
            <button 
              className="px-2 py-1 text-xs rounded border"
              style={{
                backgroundColor: showFavoritesOnly ? theme.listActiveSelectionBackground : theme.inputBackground,
                color: showFavoritesOnly ? theme.buttonForeground : theme.inputForeground,
                borderColor: theme.inputBorder
              }}
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              title="Show favorites only"
            >
              {showFavoritesOnly ? '⭐' : '☆'}
            </button>
            
            <button 
              className="px-2 py-1 text-xs rounded border"
              style={{
                backgroundColor: compactMode ? theme.listActiveSelectionBackground : theme.inputBackground,
                color: compactMode ? theme.buttonForeground : theme.inputForeground,
                borderColor: theme.inputBorder
              }}
              onClick={() => {
                const newCompactMode = !compactMode;
                setCompactMode(newCompactMode);
                updateUISettings({ compactMode: newCompactMode });
              }}
              title="Toggle compact mode"
            >
              {compactMode ? '📦' : '📏'}
            </button>
          </div>
        </div>
        
        {/* Add Form */}
        {showAddForm && (
          <div 
            className="mt-4 p-4 rounded-lg border"
            style={{ 
              backgroundColor: theme.secondaryBackground,
              borderColor: theme.border 
            }}
          >
            <h3 className="font-medium mb-2" style={{ color: theme.foreground }}>Add New Project</h3>
            <div className="flex gap-2">
              <button 
                className="px-3 py-2 rounded border transition-colors"
                style={{
                  backgroundColor: theme.inputBackground,
                  color: '#3b82f6',
                  borderColor: '#3b82f6'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#eff6ff'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = theme.inputBackground}
                onClick={() => addNewProject('local')}
              >
                📁 Local Folder
              </button>
              <button 
                className="px-3 py-2 rounded border transition-colors"
                style={{
                  backgroundColor: theme.inputBackground,
                  color: '#10b981',
                  borderColor: '#10b981'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f0fdf4'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = theme.inputBackground}
                onClick={() => addNewProject('workspace')}
              >
                🗂️ Workspace File
              </button>
              <button 
                className="px-3 py-2 rounded border transition-colors"
                style={{
                  backgroundColor: theme.inputBackground,
                  color: '#f59e0b',
                  borderColor: '#f59e0b'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fffbeb'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = theme.inputBackground}
                onClick={() => addNewProject('ssh')}
              >
                🌐 SSH Remote
              </button>
            </div>
          </div>
        )}
        
        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 mt-4">
          <button 
            className="px-3 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-sm"
            onClick={() => vscode.postMessage({ type: 'import' })}
          >
            📥 Import Config
          </button>
          <button 
            className="px-3 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors text-sm"
            onClick={() => vscode.postMessage({ type: 'export' })}
          >
            📤 Export Config
          </button>
          <button 
            className="px-3 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-colors text-sm"
            onClick={() => vscode.postMessage({ type: 'openConfig' })}
            title="Open the raw JSON configuration file for editing"
          >
            📝 Edit JSON
          </button>
          <button 
            className="px-3 py-2 rounded-md bg-cyan-600 text-white hover:bg-cyan-700 transition-colors text-sm"
            onClick={() => vscode.postMessage({ type: 'sync' })}
            title="Sync configuration across machines"
          >
            🔄 Sync
          </button>
        </div>
      </div>
      
      {/* Projects Display */}
      <div 
        className="rounded-lg shadow-sm p-4"
        style={{ 
          backgroundColor: theme.primaryBackground,
          borderColor: theme.border 
        }}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-medium" style={{ color: theme.foreground }}>
            {showFavoritesOnly ? `Favorites (${filtered.length})` : `Projects (${filtered.length})`}
            {!showFavoritesOnly && state.projects.filter(p => p.isFavorite).length > 0 && (
              <span className="ml-2 text-xs" style={{ color: theme.foreground, opacity: 0.6 }}>
                • {state.projects.filter(p => p.isFavorite).length} favorited
              </span>
            )}
          </h2>
        </div>
        
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
          <div className="space-y-6">
            {Object.entries(groupedProjects).map(([groupName, projects]) => (
              <div key={groupName}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-lg font-semibold" style={{ color: theme.foreground }}>
                    {groupName}
                  </h3>
                  <span className="text-sm px-2 py-1 rounded-full" style={{ 
                    backgroundColor: theme.listHoverBackground, 
                    color: theme.foreground,
                    opacity: 0.8 
                  }}>
                    {projects.length}
                  </span>
      </div>
                <div className={viewMode === 'grid' 
                  ? compactMode 
                    ? "grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-2" 
                    : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                  : compactMode 
                    ? "space-y-1" 
                    : "space-y-2"
                }>
                  {projects.map(p => (
                    <Card 
                      key={p.id ?? p.path} 
                      p={p} 
                      viewMode={viewMode}
                      compactMode={compactMode}
                      theme={theme}
                      allGroups={allGroups}
                      onChange={(np) => vscode.postMessage({ type: 'addOrUpdate', payload: np })} 
                      onDelete={() => vscode.postMessage({ type: 'delete', payload: { id: p.id } })}
                      onOpen={() => {
                        recordProjectAccess(p.id!);
                        vscode.postMessage({ type: 'open', payload: p });
                      }}
                      onToggleFavorite={toggleProjectFavorite}
                    />
        ))}
      </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={viewMode === 'grid' 
            ? compactMode 
              ? "grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-2" 
              : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
            : compactMode 
              ? "space-y-1" 
              : "space-y-2"
          }>
        {filtered.map(p => (
              <Card 
                key={p.id ?? p.path} 
                p={p} 
                viewMode={viewMode}
                compactMode={compactMode}
                theme={theme}
                allGroups={allGroups}
                onChange={(np) => vscode.postMessage({ type: 'addOrUpdate', payload: np })} 
                onDelete={() => vscode.postMessage({ type: 'delete', payload: { id: p.id } })}
                onOpen={() => {
                  recordProjectAccess(p.id!);
                  vscode.postMessage({ type: 'open', payload: p });
                }}
                onToggleFavorite={toggleProjectFavorite}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* New Project Modal */}
      {newProjectType && (
        <EditModal 
          project={{
            id: '',
            name: `New ${newProjectType.charAt(0).toUpperCase() + newProjectType.slice(1)} Project`,
            path: newProjectType === 'ssh' ? 'user@hostname:/path/to/project' : '',
            description: newProjectType === 'local' ? 'Local project folder' : 
                        newProjectType === 'workspace' ? 'VSCode workspace configuration' : 
                        'Remote project via SSH',
            type: newProjectType,
            color: newProjectType === 'local' ? '#3b82f6' : newProjectType === 'workspace' ? '#10b981' : '#f59e0b',
            tags: newProjectType === 'ssh' ? ['ssh', 'remote'] : [],
            group: selectedGroup || undefined,
            icon: ''
          }}
          theme={theme}
          allGroups={allGroups}
          onSave={createNewProject}
          onCancel={() => setNewProjectType(null)}
        />
      )}
    </div>
  );
}

function Card({ p, viewMode, compactMode, theme, allGroups, onChange, onDelete, onOpen, onToggleFavorite }: { 
  p: ProjectItem; 
  viewMode: ViewMode;
  compactMode: boolean;
  theme: any;
  allGroups: string[];
  onChange: (p: ProjectItem) => void; 
  onDelete: () => void;
  onOpen: () => void;
  onToggleFavorite: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const typeIcons = {
    local: '📁',
    workspace: '🗂️',
    ssh: '🌐'
  };

  const typeColors = {
    local: 'bg-blue-100 text-blue-700',
    workspace: 'bg-green-100 text-green-700',
    ssh: 'bg-yellow-100 text-yellow-700'
  };

  if (viewMode === 'list') {
    return (
      <div 
        className={`flex items-center gap-4 ${compactMode ? "p-2" : "p-3"} rounded-lg border-l-4 border-r border-t border-b hover:shadow-md transition-shadow group`}
        style={{ 
          backgroundColor: theme.secondaryBackground, 
          borderLeftColor: p.color,
          borderRightColor: theme.border,
          borderTopColor: theme.border,
          borderBottomColor: theme.border
        }}
      >
        <div 
          className={`${compactMode ? "w-8 h-8 text-lg" : "w-12 h-12 text-2xl"} rounded-lg flex items-center justify-center border-2 cursor-pointer hover:opacity-80 transition-opacity`}
          style={{ 
            borderColor: p.color,
            backgroundColor: theme.secondaryBackground,
            color: p.color
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
            <h3 className={`${compactMode ? "text-sm font-medium" : "font-medium"} truncate`} style={{ color: theme.foreground }} title={p.description || p.name}>
              {p.name}
            </h3>
            <span className={`${compactMode ? "px-1 py-0.5 text-xs" : "px-2 py-1 text-xs"} rounded-full font-medium ${typeColors[p.type]}`}>
              {p.type}
            </span>
          </div>
          {p.description && (
            <p className={`${compactMode ? "text-xs" : "text-sm"} truncate mt-1`} style={{ color: theme.foreground, opacity: 0.8 }} title={p.description}>
              {p.description}
            </p>
          )}
          <p className={`${compactMode ? "text-xs" : "text-xs"} truncate mt-1`} style={{ color: theme.foreground, opacity: 0.6 }} title={p.path}>{p.path}</p>
          {p.tags && p.tags.length > 0 && (
            <div className={`flex gap-1 ${compactMode ? "mt-1" : "mt-2"}`}>
              {p.tags.slice(0, compactMode ? 2 : 3).map(tag => (
                <span key={tag} className={`${compactMode ? "px-1 py-0.5 text-xs rounded" : "px-2 py-1 text-xs rounded-full"} bg-gray-100 text-gray-600`}>
                  {tag}
                </span>
              ))}
              {p.tags.length > (compactMode ? 2 : 3) && (
                <span className={`${compactMode ? "px-1 py-0.5 text-xs rounded" : "px-2 py-1 text-xs rounded-full"} bg-gray-100 text-gray-600`}>
                  +{p.tags.length - (compactMode ? 2 : 3)}
                </span>
              )}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className={`p-2 rounded-lg transition-colors ${p.isFavorite ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-500 hover:text-yellow-600'} hover:bg-yellow-50`}
            onClick={() => onToggleFavorite(p.id!)}
            title={p.isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <svg className="w-4 h-4" fill={p.isFavorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
          <button
            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            onClick={onOpen}
            title="Open Project"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
          <button
            className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
            onClick={() => setIsEditing(true)}
            title="Edit Project"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
      className="rounded-lg border-2 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group"
      style={{ 
        backgroundColor: theme.secondaryBackground,
        borderColor: p.color
      }}
    >
      <div 
        className={`${compactMode ? 'h-20' : 'h-32'} flex items-center justify-center relative cursor-pointer`}
        style={{ 
          backgroundColor: p.icon ? 'transparent' : theme.primaryBackground,
          backgroundImage: p.icon ? `url(${p.icon})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
        onClick={onOpen}
      >
        {!p.icon && (
          <div className="text-center" style={{ color: p.color }}>
            <div className={`${compactMode ? "text-2xl mb-1" : "text-4xl mb-2"}`}>{typeIcons[p.type]}</div>
            <div className={`${compactMode ? "text-xs" : "text-sm"} opacity-80 capitalize font-medium`}>{p.type}</div>
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
      
      <div className={compactMode ? "p-2" : "p-4"}>
        <div className={`flex items-start justify-between ${compactMode ? "mb-1" : "mb-2"}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: p.color }}
              ></div>
              <h3 className={`${compactMode ? "text-sm" : "font-medium"} truncate`} style={{ color: theme.foreground }} title={p.description || p.name}>
                {p.name}
              </h3>
            </div>
            {p.description && (
              <p className={`${compactMode ? "text-xs" : "text-sm"} truncate mt-1`} style={{ color: theme.foreground, opacity: 0.8 }} title={p.description}>
                {p.description}
              </p>
            )}
            <p className={`${compactMode ? "text-xs" : "text-xs"} truncate mt-1`} style={{ color: theme.foreground, opacity: 0.6 }} title={p.path}>{p.path}</p>
          </div>
          <span className={`ml-2 ${compactMode ? "px-1 py-0.5 text-xs" : "px-2 py-1 text-xs"} rounded-full font-medium ${typeColors[p.type]}`}>
            {p.type}
          </span>
        </div>
        
        {p.tags && p.tags.length > 0 && (
          <div className={`flex flex-wrap gap-1 ${compactMode ? "mb-1" : "mb-3"}`}>
            {p.tags.slice(0, compactMode ? 2 : 3).map(tag => (
              <span key={tag} className={`${compactMode ? "px-1 py-0.5 text-xs rounded" : "px-2 py-1 text-xs rounded-full"} bg-gray-100 text-gray-600`}>
                {tag}
              </span>
            ))}
            {p.tags.length > (compactMode ? 2 : 3) && (
              <span className={`${compactMode ? "px-1 py-0.5 text-xs rounded" : "px-2 py-1 text-xs rounded-full"} bg-gray-100 text-gray-600`}>
                +{p.tags.length - (compactMode ? 2 : 3)}
              </span>
            )}
          </div>
        )}
        
        <div className="flex items-center justify-between">
          <button
            className={`flex-1 ${compactMode ? "py-1 px-2 text-xs" : "py-2 px-3 text-sm"} rounded-lg transition-colors font-medium`}
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
              className={`${compactMode ? "p-1" : "p-2"} rounded-lg transition-colors`}
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
              <svg className={compactMode ? "w-3 h-3" : "w-4 h-4"} fill={p.isFavorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
            <button
              className={`${compactMode ? "p-1" : "p-2"} rounded-lg transition-colors`}
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
              <svg className={compactMode ? "w-3 h-3" : "w-4 h-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              className={`${compactMode ? "p-1" : "p-2"} rounded-lg transition-colors`}
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
              <svg className={compactMode ? "w-3 h-3" : "w-4 h-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            backgroundColor: theme.primaryBackground,
            borderColor: theme.border 
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

function EditModal({ project, theme, allGroups, onSave, onCancel }: {
  project: ProjectItem;
  theme: any;
  allGroups: string[];
  onSave: (project: ProjectItem) => void;
  onCancel: () => void;
}) {
  const isNewProject = !project.id;
  const [editedProject, setEditedProject] = useState<ProjectItem>({ ...project });
  const [tagsInput, setTagsInput] = useState((project.tags ?? []).join(', '));
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<'success' | 'error' | null>(null);
  const [testMessage, setTestMessage] = useState<string>('');
  const [isCreatingNewGroup, setIsCreatingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 监听连接测试结果
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
      const { path, inputType } = event.detail;
      if (path) {
        setEditedProject({ ...editedProject, path });
        // 如果是文件夹，可以自动设置项目名称
        if (inputType === 'folder' && !editedProject.name.trim()) {
          const folderName = path.split(/[/\\]/).pop() || 'New Project';
          setEditedProject(prev => ({ ...prev, path, name: folderName }));
        }
      }
    };

    window.addEventListener('connectionTestResult', handleTestResult);
    window.addEventListener('pathSelected', handlePathSelected);
    return () => {
      window.removeEventListener('connectionTestResult', handleTestResult);
      window.removeEventListener('pathSelected', handlePathSelected);
    };
  }, [editedProject]);

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
    try {
      if (sshPath.startsWith('vscode-remote://ssh-remote+')) {
        // 从 vscode-remote URI 中提取
        const encoded = sshPath.replace('vscode-remote://ssh-remote+', '').split('/')[0];
        const decoded = decodeURIComponent(encoded);
        return decoded.split('@')[1] || null;
      } else if (sshPath.includes('@') && sshPath.includes(':')) {
        // 从 user@hostname:/path 格式中提取
        const userHost = sshPath.split(':')[0];
        return userHost.split('@')[1] || null;
      }
      return null;
    } catch {
      return null;
    }
  };

  const autoAddHostTag = () => {
    if (editedProject.type === 'ssh' && editedProject.path.trim()) {
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
    if (editedProject.type !== 'ssh' || !editedProject.path.trim()) {
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
      payload: { 
        path: editedProject.path,
        name: editedProject.name 
      } 
    });
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" 
      onMouseDown={(e) => {
        // 只有直接点击背景时才关闭，不包括拖拽事件
        if (e.target === e.currentTarget && !isDragging) {
          onCancel();
        }
      }}
      onMouseMove={() => setIsDragging(true)}
      onMouseUp={() => setIsDragging(false)}
    >
      <div 
        className="rounded-lg p-6 w-full max-w-md mx-4 border"
        style={{ 
          backgroundColor: theme.primaryBackground,
          borderColor: theme.border 
        }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium mb-4" style={{ color: theme.foreground }}>
          {isNewProject ? `Add ${project.type} Project` : 'Edit Project'}
        </h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Project Name</label>
            <input 
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:border-transparent"
              style={{
                backgroundColor: theme.inputBackground,
                color: theme.inputForeground,
                borderColor: theme.inputBorder,
                '--tw-ring-color': theme.focusBorder
              } as React.CSSProperties}
              value={editedProject.name}
              onChange={e => setEditedProject({ ...editedProject, name: e.target.value })}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Description</label>
            <textarea 
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:border-transparent resize-none"
              style={{
                backgroundColor: theme.inputBackground,
                color: theme.inputForeground,
                borderColor: theme.inputBorder,
                '--tw-ring-color': theme.focusBorder
              } as React.CSSProperties}
              rows={2}
              placeholder="Brief description of this project..."
              value={editedProject.description || ''}
              onChange={e => setEditedProject({ ...editedProject, description: e.target.value })}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Path</label>
            <div className="flex gap-2">
              <input 
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:border-transparent"
                style={{
                  backgroundColor: theme.inputBackground,
                  color: theme.inputForeground,
                  borderColor: theme.inputBorder,
                  '--tw-ring-color': theme.focusBorder
                } as React.CSSProperties}
                placeholder={editedProject.type === 'ssh' ? 'user@hostname:/path' : editedProject.type === 'workspace' ? 'Select .code-workspace file' : 'Select project folder'}
                value={editedProject.path}
                onChange={e => setEditedProject({ ...editedProject, path: e.target.value })}
              />
              {editedProject.type === 'local' && (
                <button
                  className="px-3 py-2 border rounded-lg transition-colors text-sm"
                  style={{
                    backgroundColor: theme.inputBackground,
                    color: theme.inputForeground,
                    borderColor: theme.inputBorder
                  }}
                  onClick={() => vscode.postMessage({ type: 'browseFolder', payload: { currentPath: editedProject.path } })}
                  title="Browse for folder"
                >
                  📁 Browse
                </button>
              )}
              {editedProject.type === 'workspace' && (
                <button
                  className="px-3 py-2 border rounded-lg transition-colors text-sm"
                  style={{
                    backgroundColor: theme.inputBackground,
                    color: theme.inputForeground,
                    borderColor: theme.inputBorder
                  }}
                  onClick={() => vscode.postMessage({ type: 'browseWorkspace', payload: { currentPath: editedProject.path } })}
                  title="Browse for workspace file"
                >
                  🗂️ Browse
                </button>
              )}
              {editedProject.type === 'ssh' && (
                <div className="flex gap-1">
                  <button
                    className="px-3 py-2 border rounded-lg transition-colors text-sm"
                    style={{
                      backgroundColor: theme.inputBackground,
                      color: isTestingConnection ? '#f59e0b' : connectionTestResult === 'success' ? '#10b981' : connectionTestResult === 'error' ? '#ef4444' : theme.inputForeground,
                      borderColor: isTestingConnection ? '#f59e0b' : connectionTestResult === 'success' ? '#10b981' : connectionTestResult === 'error' ? '#ef4444' : theme.inputBorder
                    }}
                    onClick={testSshConnection}
                    disabled={isTestingConnection || !editedProject.path.trim()}
                    title="Test SSH connection"
                  >
                    {isTestingConnection ? '⏳' : connectionTestResult === 'success' ? '✅' : connectionTestResult === 'error' ? '❌' : '🔗'}
                    {isTestingConnection ? ' Testing...' : ' Test'}
                  </button>
                  {isNewProject && (
                    <button
                      className="px-2 py-2 border rounded-lg transition-colors text-sm"
                      style={{
                        backgroundColor: theme.inputBackground,
                        color: theme.inputForeground,
                        borderColor: theme.inputBorder
                      }}
                      onClick={() => vscode.postMessage({ type: 'browseSSH' })}
                      title="Browse SSH connections"
                    >
                      📂
                    </button>
                  )}
                </div>
              )}
            </div>
            {editedProject.type === 'ssh' && (
              <div className="text-xs mt-1" style={{ color: theme.foreground, opacity: 0.6 }}>
                Format: user@hostname:/path or vscode-remote://ssh-remote+hostname/path
              </div>
            )}
            {connectionTestResult && (
              <div className={`text-xs mt-1`} style={{ 
                color: connectionTestResult === 'success' ? '#10b981' : '#ef4444'
              }}>
                {connectionTestResult === 'success' ? '✅' : '❌'} {testMessage || (connectionTestResult === 'success' ? 'Connection format appears valid' : 'Connection test failed')}
              </div>
            )}
        </div>
          
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Type</label>
            <select 
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:border-transparent"
              style={{
                backgroundColor: theme.inputBackground,
                color: theme.inputForeground,
                borderColor: theme.inputBorder,
                '--tw-ring-color': theme.focusBorder
              } as React.CSSProperties}
              value={editedProject.type}
              onChange={e => setEditedProject({ ...editedProject, type: e.target.value as ProjectType })}
            >
              <option value="local" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Local Folder</option>
              <option value="workspace" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>Workspace File</option>
              <option value="ssh" style={{ backgroundColor: theme.inputBackground, color: theme.inputForeground }}>SSH Remote</option>
        </select>
      </div>
          
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Group</label>
            {isCreatingNewGroup ? (
              <div className="flex gap-2">
                <input 
                  className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:border-transparent"
                  style={{
                    backgroundColor: theme.inputBackground,
                    color: theme.inputForeground,
                    borderColor: theme.inputBorder,
                    '--tw-ring-color': theme.focusBorder
                  } as React.CSSProperties}
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
                  className="px-3 py-2 border rounded-lg transition-colors text-sm"
                  style={{
                    backgroundColor: theme.buttonBackground,
                    color: theme.buttonForeground,
                    borderColor: theme.buttonBackground
                  }}
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                >
                  ✓
                </button>
                <button
                  className="px-3 py-2 border rounded-lg transition-colors text-sm"
                  style={{
                    backgroundColor: theme.inputBackground,
                    color: theme.inputForeground,
                    borderColor: theme.inputBorder
                  }}
                  onClick={handleCancelCreateGroup}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select 
                  className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:border-transparent"
                  style={{
                    backgroundColor: theme.inputBackground,
                    color: theme.inputForeground,
                    borderColor: theme.inputBorder,
                    '--tw-ring-color': theme.focusBorder
                  } as React.CSSProperties}
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
                  className="px-3 py-2 border rounded-lg transition-colors text-sm"
                  style={{
                    backgroundColor: theme.inputBackground,
                    color: theme.inputForeground,
                    borderColor: theme.inputBorder
                  }}
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
            <div className="flex gap-2">
              <input 
                type="text"
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:border-transparent"
                style={{
                  backgroundColor: theme.inputBackground,
                  color: theme.inputForeground,
                  borderColor: theme.inputBorder,
                  '--tw-ring-color': theme.focusBorder
                } as React.CSSProperties}
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
              {editedProject.type === 'ssh' && (
                <button
                  className="px-3 py-2 border rounded-lg transition-colors text-sm"
                  style={{
                    backgroundColor: theme.inputBackground,
                    color: theme.inputForeground,
                    borderColor: theme.inputBorder
                  }}
                  onClick={autoAddHostTag}
                  title="Auto-add hostname as tag"
                >
                  🏷️ Host
                </button>
              )}
            </div>
            <div className="text-xs mt-1" style={{ color: theme.foreground, opacity: 0.6 }}>
              Separate tags with commas. {editedProject.type === 'ssh' ? 'SSH projects can auto-add hostname as tag.' : 'Example: react, frontend, typescript'}
            </div>
          </div>
          
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1" style={{ color: theme.foreground }}>Color</label>
              <div className="flex gap-2">
                <input 
                  type="color" 
                  className="flex-1 h-10 border rounded-lg"
                  style={{ borderColor: theme.inputBorder }}
                  value={editedProject.color ?? '#999999'}
                  onChange={e => setEditedProject({ ...editedProject, color: e.target.value })}
                />
                <button 
                  className="px-3 h-10 border rounded-lg transition-colors text-sm"
                  style={{
                    backgroundColor: theme.inputBackground,
                    color: theme.inputForeground,
                    borderColor: theme.inputBorder
                  }}
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
                className="w-full h-10 border rounded-lg transition-colors"
                style={{
                  backgroundColor: theme.inputBackground,
                  color: theme.inputForeground,
                  borderColor: theme.inputBorder
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = theme.listHoverBackground}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = theme.inputBackground}
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
        
        <div className="flex gap-3 mt-6">
          <button
            className="flex-1 px-4 py-2 rounded-lg transition-colors"
            style={{
              backgroundColor: theme.buttonBackground,
              color: theme.buttonForeground
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            onClick={() => {
              // 保存时处理tags
              const finalProject = {
                ...editedProject,
                tags: tagsInput.split(',').map(s => s.trim()).filter(Boolean)
              };
              onSave(finalProject);
            }}
          >
            {isNewProject ? 'Create Project' : 'Save Changes'}
          </button>
          <button
            className="flex-1 px-4 py-2 border rounded-lg transition-colors"
            style={{
              backgroundColor: theme.inputBackground,
              color: theme.inputForeground,
              borderColor: theme.inputBorder
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = theme.listHoverBackground}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = theme.inputBackground}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
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
