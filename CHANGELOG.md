# Change Log

All notable changes to the "Project Pilot" extension will be documented in this file.

## [0.0.1] - 2025-09-16

### Latest Updates

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
- 🔍 **Search & Filter**

  - Global search across names, descriptions, paths, and tags
  - Filter by project groups
  - Filter by project tags
  - Sort by name, type, or recent additions
- ⚙️ **Configuration Management**

  - Import/export configuration with validation
  - Automatic backup system with configurable retention (5 backups)
  - Configuration file monitoring with auto-reload
  - Direct JSON editing capability
  - Cross-machine synchronization support
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
- ⌨️ **Keyboard Shortcuts**

  - `Ctrl+P Ctrl+P` - Open Project Pilot Manager
  - `Ctrl+P Ctrl+L` - Add Local Project
  - `Ctrl+P Ctrl+C` - Add Current Folder as Project
- 🔧 **Developer Features**

  - Auto-detection of project types (React, Vue, Angular, etc.)
  - Smart tag suggestions based on package.json and project structure
  - Automatic workspace folder scanning
  - Configuration validation and error handling

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
      "icon": "data:image/png;base64,..."
    }
  ]
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
