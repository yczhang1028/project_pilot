# Change Log

All notable changes to the "Project Pilot" extension will be documented in this file.

## [0.1.3] - 2025-09-16

- Update Icon

## [0.1.2] - 2025-09-16

### Latest Updates

- ⭐ **Favorites System**: Complete independent favorites feature with filtering and visual indicators
- 📊 **Usage Analytics**: Click tracking and last accessed timestamps for all projects
- 🎨 **Enhanced Compact Mode**: Improved compact styling with smaller fonts and refined spacing
- 💾 **UI Settings Persistence**: All UI preferences (compact mode, view mode, selected group) now persist across sessions
- 🗂️ **Smart Group Creation**: Improved new group creation with keyboard shortcuts and duplicate handling
- 📁 **System Integration**: Native folder/workspace file browser for easy path selection
- 🌟 **Outline Favorites**: Full favorites support in outline view with star icons and context menus
- 🪟 **New Window Support**: Open Project Pilot in a dedicated new window without any folder

## [0.0.1] - 2025-09-16

### Previous Updates

- 🎨 **Compact Mode**: Added compact view option for smaller cards and tighter spacing
- 🌳 **Outline View Toggle**: Tree view and flat list toggle in Outline panel
- 🖱️ **Clickable Icons**: List view icons now clickable for direct project opening
- 🔧 **Import Fixes**: Improved configuration import with automatic Base64 icon handling
- 🎯 **Default Grouped View**: Projects now display in grouped mode by default

### Added

- 🎯 **Core Project Management**

  - Local folder project support
  - VSCode workspace file (.code-workspace) support
  - SSH remote project support with connection testing
  - Modern React-based user interface with dual view modes
- 🎨 **User Interface**

  - Grid view with customizable project cards
  - List view with detailed project information
  - Outline tree view with grouped/flat display options
  - Full VSCode theme integration (dark/light theme support)
  - Responsive design that adapts to panel size
- 📁 **Project Organization**

  - Custom project groups for better organization
  - Smart tag system with auto-detection based on project content
  - Project descriptions with hover tooltips
  - Custom color coding for visual identification
  - Custom icon upload with Base64 conversion
  - **NEW**: Independent favorites system with star filtering
  - **NEW**: Usage analytics with click counts and last accessed times
- 🔍 **Search & Filter**

  - Global search across names, descriptions, paths, and tags
  - Filter by project groups
  - Filter by project tags
  - Sort by name, type, or recent additions
  - **NEW**: Favorites-only filter with star toggle button
- ⚙️ **Configuration Management**

  - Import/export configuration with validation
  - Automatic backup system with configurable retention (5 backups)
  - Configuration file monitoring with auto-reload
  - Direct JSON editing capability
  - Cross-machine synchronization support
  - **NEW**: UI settings persistence (compact mode, view mode, selected group)
  - **NEW**: Backward compatibility with old configuration files
- 🌐 **SSH Features**

  - SSH connection string validation and testing
  - Support for standard SSH format (user@hostname:/path)
  - Support for VSCode Remote URI format
  - Automatic hostname extraction for tagging
  - Integration with VSCode Remote-SSH extension
- 🎨 **Customization**

  - Random color generator with 20 preset colors
  - Color picker with quick selection palette
  - Custom icon upload (PNG, JPG, SVG support)
  - Project-specific color borders and indicators
  - Compact mode for smaller cards and tighter spacing
  - **NEW**: Enhanced compact mode with refined typography and spacing
  - **NEW**: Smart border radius adjustment for compact tags
- ⌨️ **Keyboard Shortcuts**

  - `Ctrl+P Ctrl+P` - Open Project Pilot Manager
  - `Ctrl+P Ctrl+L` - Add Local Project
  - `Ctrl+P Ctrl+C` - Add Current Folder as Project
  - **NEW**: `Enter` - Confirm new group creation in edit modal
  - **NEW**: `Escape` - Cancel new group creation in edit modal
- 🔧 **Developer Features**

  - Auto-detection of project types (React, Vue, Angular, etc.)
  - Smart tag suggestions based on package.json and project structure
  - Automatic workspace folder scanning
  - Configuration validation and error handling
  - **NEW**: Native folder browser integration for local projects
  - **NEW**: Native workspace file browser for workspace projects
  - **NEW**: Automatic project name suggestion from folder names

### Technical Details

- Built with TypeScript and React
- Uses Tailwind CSS for styling
- Vite for fast development and building
- VSCode Extension API integration
- Cross-platform support (Windows, macOS, Linux)

### Configuration Schema

```json
{
  "projects": [
    {
      "id": "unique-id",
      "name": "Project Name", 
      "description": "Project description",
      "path": "/path/to/project",
      "type": "local|workspace|ssh",
      "color": "#3b82f6",
      "tags": ["tag1", "tag2"],
      "group": "Group Name",
      "icon": "data:image/png;base64,...",
      "isFavorite": true,
      "clickCount": 5,
      "lastAccessed": "2025-09-16T10:30:00.000Z"
    }
  ],
  "uiSettings": {
    "compactMode": false,
    "viewMode": "grid",
    "selectedGroup": ""
  }
}
```

### Known Issues

- Large Base64 icons may cause import issues (automatically cleaned during import)
- SSH connection testing requires Remote-SSH extension

### Credits

- Developed by Yichi Zhang
- Icons and UI inspired by modern design principles
- Built for the VSCode community

---

**Full Changelog**: https://github.com/yczhang1028/project_pilot/commits/main
