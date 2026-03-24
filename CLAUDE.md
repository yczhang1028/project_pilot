# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Pilot is a VS Code extension (publisher: yczhang1028) that provides a command deck for managing and launching local folders, workspace files (.code-workspace), SSH projects, and SSH workspaces. Requires VS Code ^1.90.0, activates on `onStartupFinished`.

## Build & Development Commands

```bash
# Build everything (extension + webview) — required before debugging
npm run build

# Build extension only (TypeScript → ./out)
npm run build:ext

# Build webview only (installs deps + Vite build → webview-ui/dist)
npm run build:webview

# Watch extension source
npm run watch

# Webview dev server
cd webview-ui && npm run dev

# Package extension
npx @vscode/vsce package
```

**Important:** Always run `npm run build` (not just `build:ext`) to ensure webview assets are included. The webview is compiled separately via Vite and bundled into `webview-ui/dist/`.

There are no automated tests. Manual testing is done via the VS Code Extension Host debugger (F5 with the "Run Extension" launch config).

## Architecture

**Two-process model:**

1. **Extension Host** (`src/`) — TypeScript compiled to CommonJS (`out/`). Manages VS Code commands, views, state persistence, and file/SSH operations.
2. **Webview Frontend** (`webview-ui/`) — React 18 + Vite + TailwindCSS. Renders the sidebar manager panel and fullscreen view.

All extension↔webview communication is **async message passing** (postMessage/onDidReceiveMessage). No direct method calls between the two.

### Key Source Files

- `src/extension.ts` — Main activation, command registration (~40 commands), view lifecycle, state synchronization
- `src/managerViewProvider.ts` — WebviewViewProvider for the sidebar panel, routes messages between webview and extension
- `src/outlineTreeProvider.ts` — Tree view provider with 4 display modes (group/target/type/flat), plus favorites and recent sections
- `src/store.ts` — ConfigStore class persisting projects to `projects.json` in VS Code global storage (always local, even on SSH remote)
- `src/projectPath.ts` — Path normalization and project type detection (local/workspace/ssh/ssh-workspace)
- `src/sshPath.ts` — SSH path parsing (`user@host:/path`, `vscode-remote://` URIs), name suggestion
- `src/sshResolve.ts` — SSH config expansion via `ssh -G`, hostname DNS lookup, IP resolution
- `src/remoteContext.ts` — Detects whether extension is running on an SSH remote
- `webview-ui/src/ui/App.tsx` — Single large React component with all UI logic, state, modals, and project CRUD

### Data Flow

Projects are stored as JSON in VS Code's globalStorage directory. The `ConfigStore` notifies the extension of changes, which pushes full state to the webview via `state` messages. The webview sends action messages (e.g., `addOrUpdate`, `delete`, `open`) back to the extension for processing.

### SSH Path Handling

SSH path logic is split across three files for clarity:
- `sshPath.ts` — Parsing and normalization (three input formats: `user@host:/path`, `host:/path`, `vscode-remote://...`)
- `projectPath.ts` — Type inference and detection
- `sshResolve.ts` — External resolution (runs `ssh -G`, DNS lookup)

## Debug Configurations

Three launch configs in `.vscode/launch.json`:
1. **Run Extension** — Standard local dev
2. **Run Extension (Remote SSH Folder)** — Debug with SSH remote folder
3. **Run Extension (Remote SSH Workspace)** — Debug with remote .code-workspace file

All require the `npm: build` pre-launch task.

## Extension Settings

Settings are prefixed with `projectPilot.`: `defaultView` (grid/list/mini), `autoBackup`, `maxBackups`, `showTypeIcons`, `autoDetectTags`, `autoOpenFullscreen`.
