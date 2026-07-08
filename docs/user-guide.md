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

- `Command`: compact horizontal tiles for fast project switching; this is the default for new configurations
- `Explorer`: dense aligned rows for quickly scanning large collections
- `Gallery`: richer project cards with a Favorites rail

Use the three-way switch in the Manager command bar to change layouts. The
selection is shared by sidebar and fullscreen Managers and persists across
reloads. Existing `mini`, `list`, and `grid` configuration values map to
Command, Explorer, and Gallery respectively. Layouts now own their responsive
density, so there is no separate Compact toggle.

When projects are grouped, click any group header or chevron to collapse or
expand it. Collapsed groups persist across layout switches and VS Code reloads.

### Main interactions

- Search by name, description, path, or tags
- Group projects visually
- Edit name, description, colors, icons, and tags
- Open projects directly from cards
- Keep the selected layout while it adapts automatically to narrow sidebars or fullscreen
- Open `SSH Hosts` from the toolbar to manage reusable SSH connections

Project Editor and SSH Hosts can be opened as nested dialogs. Escape closes or
cancels only the topmost dialog state, focus returns to the control that opened
it, and the dialog body remains scrollable at narrow widths or high zoom.

### SSH Hosts

The Manager stores SSH connection details separately from projects so multiple
projects can use the same Host.

1. Open `SSH Hosts` from the Manager toolbar.
2. Add a display name and hostname or IP address. Username and port are optional;
   leave them empty to use OpenSSH configuration and defaults.
3. Add or edit an SSH project, select the Host, and enter only its remote folder
   or `.code-workspace` path.

Editing a Host's hostname, IP address, username, or port immediately changes the
resolved address used to open, browse, copy, display, and test every linked
project. The remote paths on those projects do not change.

The Host panel also shows each Host's linked-project count. Deleting a referenced
Host requires confirmation that lists the affected projects, then atomically
deletes the Host and those linked projects. Use Migrate first when the projects
should be preserved on another Host; migration keeps each project's remote path.

Host addresses omit a port when none is explicitly configured. For example,
`dev@build-box` means OpenSSH configuration or the SSH default decides the
port; `dev@build-box:2222` means Project Pilot explicitly passes port 2222.

Connection tests use a bounded, non-interactive OpenSSH probe with
`BatchMode=yes`. Password-only Hosts therefore report an authentication failure
even when an interactive password login would work. Configure a key or SSH
agent to make this probe succeed. Test results and Host operations are also
written to the dedicated `Project Pilot` channel in VS Code's Output panel.

## Outline

Outline is the lightweight high-frequency navigation view.

### Modes

- `By Group`
- `By Host`
- `By Type`
- `Flat`

`By Host` shows every stored Host, including Hosts with no linked projects. It
also includes `Local` and `Unmanaged SSH` buckets where applicable. Favorites
and Recent remain flat for quick access.

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
- On Host nodes: edit the Host, test it, migrate its projects, or delete it with
  an impact summary and confirmation

## SSH Support

Supported formats:

- `user@hostname:/path/to/project`
- `user@hostname:C:/path/to/project`
- `vscode-remote://ssh-remote+hostname/path`

Notes:

- All project data is stored locally even for SSH projects
- Remote-SSH must be installed for remote opening workflows
- New SSH projects use a reusable Host plus a remote path. The full formats
  above remain supported for legacy projects and compatibility snapshots.
- Use `Project Pilot: Test SSH Connection` before opening if needed. Connection
  testing resolves the effective OpenSSH configuration and then runs a bounded,
  non-interactive probe; it does not treat path syntax alone as a successful
  connection.
- The probe never requests or stores credentials. Password-only Hosts normally
  report an authentication failure because the probe uses OpenSSH batch mode;
  this does not by itself mean that an interactive Remote-SSH login is
  impossible.

### Legacy SSH projects

When a configuration is opened, Project Pilot automatically converts safely
parseable legacy SSH paths to managed projects. Projects with the same normalized
username, hostname, and port reuse one Host. This migration is idempotent and
does not perform DNS lookup or merge a configured alias with an IP address.

If a path cannot be parsed safely, the project remains unchanged and editable.
The Manager shows a non-blocking migration warning with a `Review` action. In
the project editor, choose `Use reusable Host`, select a Host, verify the remote
path, and save to convert it manually. The original legacy path remains intact
until the managed fields are complete.

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

### Startup performance diagnostics

Open VS Code's Output panel and select `Project Pilot` to inspect local startup
timings. The channel separates Extension activation milestones from the first
ready render of the sidebar and fullscreen Managers. These measurements stay on
the local machine and are not transmitted as telemetry.

For a useful comparison, collect at least two cold launches and two warm
launches with `projectPilot.autoOpenFullscreen` enabled, then repeat with it
disabled. Compare the individual `activation`, `sidebar`, and `fullscreen`
phases instead of relying on a single total duration.

Exports use schema version 2 and include `sshHosts`, each managed project's
`sshHostId` and `remotePath`, and a regenerated full `path` compatibility
snapshot. Imports remain compatible with schema version 2, the earlier
`{ projects: [...] }` object format, bare project arrays, and supported legacy
folder structures. Legacy imports pass through the same safe migration and
deduplication process.
