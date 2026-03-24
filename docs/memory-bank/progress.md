# Progress

## 2026-03-10

- Added memory bank documentation under `docs/memory-bank`
- Fixed SSH parsing so Windows remote paths like `user@host:C:/repo` do not leak the drive letter into the SSH authority
- Updated validation and UI help text to mention Windows remote path support
- Bumped release version to `1.0.2` for publishing
- Enhanced the manager UI with adaptive glass-style visuals and more responsive card layouts
- Upgraded outline with richer modes, favorites/recent sections, and direct project actions
- Fixed the edit modal so it renders as a real overlay instead of being clipped inside cards
- Bumped release version to `1.0.3` for publishing
- Added a sanitized demo `projects.demo.json` for screenshots without exposing personal or company project data
- Reorganized README and CHANGELOG around the new `2.0.0` release story
- Bumped the extension version to `2.0.0` for the first major modern glass UI release
- Moved detailed usage and development documentation out of README and into `docs/` to keep the marketplace page concise
- Fixed the Add/Edit modal black-screen regression caused by the new path analysis workflow
- Restored modal scrolling for smaller windows and constrained layouts
- Added inline path auto-detection guidance in the Add/Edit modal
- Bumped the extension version to `2.0.1` for publishing
- Normalized file-picker results so local paths, Linux SSH paths, and Windows SSH paths are stored in a consistent format
- Fixed Add/Edit path selection to auto-correct project type when a picker returns a remote SSH URI
- Added storage-side path normalization so manually entered SSH paths and `vscode-remote://` URIs do not persist as garbled or mismatched entries
- Added best-effort SSH target enrichment in the Add/Edit modal using `ssh -G` plus DNS lookup to surface user, host, hostname, port, and IP details
- Expanded SSH path handling to support config-backed alias inputs such as `host:/path` alongside explicit `user@host:/path`
- Added dedicated F5 debug launch entries for Remote SSH folders and remote `.code-workspace` files so SSH flows can be validated directly in an extension development host
- Removed SSH sample strings from new-project path state so examples no longer leak into parsing, browse dialogs, or saved configuration
- Added current SSH window context detection for authority, current remote path, username, host, IP, and port, and surfaced it in the Add/Edit modal
- Added save-time path validation so mismatched local/workspace/SSH path types are blocked before they can be persisted
- Fixed SSH remote Linux path prefills so they no longer produce `://path` style double-slash regressions
- Switched SSH project creation to prefer current SSH window context over generic example strings
- Bumped the extension version to `2.0.2` for publishing
