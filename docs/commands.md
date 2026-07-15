# Commands

## Primary Commands

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
| `Project Pilot: Test SSH Connection` | Resolve the selected SSH project through its Host and run a real non-interactive probe | - |
| `Project Pilot: Scan Workspace Folders` | Add projects from the open workspace | - |

`Project Pilot: Cycle Outline Mode` cycles through `By Group`, `By Host`,
`By Type`, and `Flat`. In `By Host`, stored Hosts are first-class tree nodes;
Favorites and Recent remain flat.

`Agent Assets` and `SSH Hosts` are toolbar surfaces rather than extra Command
Palette entries. Selecting Agent Assets from either Manager opens the inventory
in a fullscreen editor; scan, cancel, open, launch, and SSH recovery actions are
then routed through that editor.

## Contextual Commands

These commands still exist, but they are mainly intended for context menus, tree interactions, or internal flows rather than everyday command palette use.

- `Project Pilot: Add to Favorites`
- `Project Pilot: Remove from Favorites`
- `Project Pilot: Copy Project Path`
- `Project Pilot: Copy Project Name`
- `Project Pilot: Delete Project`
- `Project Pilot: Move Project to Group`
- `Project Pilot: Rename Group`
- `Project Pilot: Refresh Outline`
- `Project Pilot: Open Configuration File`
- `Project Pilot: Show Configuration Path`
- `Project Pilot: Create Backup`
- `Project Pilot: Restore Backup`

## Native OUTLINE Host Commands

These commands appear on Host nodes in the native OUTLINE context menu. Their
names match the extension manifest.

| Command | Command ID | Behavior |
|---------|------------|----------|
| `Project Pilot: Edit SSH Host` | `projectPilot.editSshHostFromOutline` | Edit the selected Host's name, hostname or IP, optional username, and optional port |
| `Project Pilot: Test SSH Host` | `projectPilot.testSshHostFromOutline` | Resolve OpenSSH configuration and run a bounded non-interactive connection probe |
| `Project Pilot: Migrate Projects to Another Host` | `projectPilot.migrateSshHostProjects` | Move linked projects to another Host while preserving their remote paths |
| `Project Pilot: Delete SSH Host` | `projectPilot.deleteSshHostFromOutline` | Delete the selected Host only when no projects reference it |

Connection tests use the resolved Host rather than validating only the stored
path format. Probe results distinguish missing OpenSSH, invalid Hosts, DNS
failures, timeouts, host-key failures, authentication failures, and remote
command failures. A password-only Host can fail the non-interactive
authentication stage even when interactive Remote-SSH access is possible.
