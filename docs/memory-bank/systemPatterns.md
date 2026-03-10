# System Patterns

## Extension architecture

- `src/extension.ts` registers commands and handles project open flows.
- `src/managerViewProvider.ts` bridges the webview UI and extension host.
- `webview-ui/src/ui/App.tsx` renders the React management experience.
- `src/store.ts` persists project data in local VS Code global storage.

## SSH handling

- SSH projects can be stored as raw SSH strings like `user@host:/path` or as `vscode-remote://` URIs.
- Remote project configuration is always stored locally.
- SSH parsing should avoid naive `split(':')` because Windows remote paths may contain drive letters such as `C:/`.
- Shared SSH parsing logic for the extension host lives in `src/sshPath.ts`.
