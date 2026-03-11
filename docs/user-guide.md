# User Guide

## Getting Started

1. Install Project Pilot from the VS Code Marketplace or Open VSX.
2. Open the Command Palette.
3. Run `Project Pilot: Show Manager`.
4. Add your first project with `+ Add` or one of the add commands.

## Project Types

- `local`: local folders on your machine
- `workspace`: `.code-workspace` files
- `ssh`: remote folders via SSH
- `ssh-workspace`: remote `.code-workspace` files via SSH

## Manager

### Views

- `Grid`: visual card layout with richer metadata
- `List`: denser layout for quick scanning
- `Mini`: compact icon-first layout for large collections

### Main interactions

- Search by name, description, path, or tags
- Group projects visually
- Edit name, description, colors, icons, and tags
- Open projects directly from cards
- Use responsive layout density in narrow sidebars or fullscreen

## Outline

Outline is the lightweight high-frequency navigation view.

### Modes

- `By Group`
- `By Target`
- `By Type`
- `Flat`

### Sections

- Favorites
- Recent
- Main project tree based on the active mode

### Context actions

- Open project
- Copy project path
- Copy project name
- Move project to group
- Favorite / unfavorite
- Delete project
- Test SSH connection for SSH entries

## SSH Support

Supported formats:

- `user@hostname:/path/to/project`
- `user@hostname:C:/path/to/project`
- `vscode-remote://ssh-remote+hostname/path`

Notes:

- All project data is stored locally even for SSH projects
- Remote-SSH must be installed for remote opening workflows
- Use `Project Pilot: Test SSH Connection` before opening if needed

## Configuration

Project data is stored locally in the editor global storage area.

Typical location:

- Windows: `%APPDATA%/Code/User/globalStorage/project-pilot/data/projects.json`
- macOS: `~/Library/Application Support/Code/User/globalStorage/project-pilot/data/projects.json`
- Linux: `~/.config/Code/User/globalStorage/project-pilot/data/projects.json`

### Configuration workflows

- Import configuration
- Export configuration
- Create backup
- Restore backup
- Open configuration JSON directly

Use `Project Pilot: Sync Configuration` as the main entry for these workflows.
