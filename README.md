# Project Pilot

Launch local folders, workspace files, and SSH projects from one modern command deck.

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/yczhang1028.project-pilot?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=yczhang1028.project-pilot)
[![Open VSX Registry](https://img.shields.io/open-vsx/v/yczhang1028/project-pilot?label=Open%20VSX%20Registry&logo=eclipse-ide)](https://open-vsx.org/extension/yczhang1028/project-pilot)

![Project Pilot Main Interface](media/demo/demo_manager.png)

## Why Project Pilot

- `📁` One place for `local`, `.code-workspace`, `ssh`, and `ssh-workspace` targets
- `🧩` Adaptive `Grid`, `List`, and `Mini` layouts for sidebars and fullscreen
- `🌲` A stronger `Outline` with `By Group`, `By Target`, `By Type`, and `Flat`
- `💾` Portable local JSON config with import, export, backup, and restore
- `✨` A refined 2.0 glass-style UI with cleaner controls and unified modals

## New In 2.0

- `💎` Modern glass-inspired interface refresh
- `📐` Better adaptive layouts for sidebars and fullscreen
- `⭐` Favorites and recent sections in Outline
- `🛠️` Richer Outline context actions
- `🧹` Cleaner command palette with less noise
- `🪟` Proper overlay Add/Edit modals

### `🆕` Latest In 2.0.2

- Current SSH window context can prefill remote authority and path details
- Safer SSH path validation prevents mismatched paths from being saved
- Fixed remote Linux path normalization while keeping Windows SSH paths compatible
- Added easier F5 Remote SSH debug flows for development

![Project Pilot Overview](media/demo/demo.png)

## Screenshots

### `🗂️` Grid
![Grid View](media/demo/demo_grid.png)

### `📋` List
![List View](media/demo/demo_list.png)

### `🔹` Mini
![Mini View](media/demo/demo_mini.png)

### `✍️` Add / Edit
![Add Project](media/demo/demo_add.png)

### `🌲` Outline
![Outline View](media/demo/demo_outline.png)

## Quick Start

1. Install the extension from the marketplace or Open VSX.
2. Open the Command Palette.
3. Run `Project Pilot: Show Manager`.
4. Add your first project with `+ Add` or `Project Pilot: Add Local Folder`.

## Documentation

- `📘` [User Guide](docs/user-guide.md)
- `⌨️` [Commands](docs/commands.md)
- `🧪` [Development](docs/development.md)

## Main Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `Project Pilot: Show Manager` | Open the main manager | `Ctrl+P Ctrl+P` |
| `Project Pilot: Open Fullscreen View` | Open the fullscreen manager | `Ctrl+P Ctrl+F` |
| `Project Pilot: Add Local Folder` | Add a local folder | `Ctrl+P Ctrl+L` |
| `Project Pilot: Add Current Folder` | Add the currently open folder | `Ctrl+P Ctrl+C` |
| `Project Pilot: Add Workspace File` | Add a `.code-workspace` file | - |
| `Project Pilot: Add SSH Remote` | Add an SSH project | - |
| `Project Pilot: Add SSH Workspace` | Add a remote workspace file | - |
| `Project Pilot: Cycle Outline Mode` | Cycle Outline browsing modes | - |
| `Project Pilot: Sync Configuration` | Import, export, replace, or edit config | - |
| `Project Pilot: Test SSH Connection` | Validate SSH project paths | - |

Detailed usage, SSH formats, configuration behavior, and development notes now live under `docs/`.

## License

MIT License - see `LICENSE`.