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
- File and folder pickers may return either local `file` URIs or remote `vscode-remote://ssh-remote+...` URIs depending on the current VS Code window context.
- Picker results should be normalized into a canonical stored path before saving or echoing back into the webview so local, Linux SSH, and Windows SSH selections all behave consistently.
- SSH authorities should support both explicit `user@host:/path` inputs and config-backed `host:/path` aliases.
- Best-effort SSH enrichment should happen on the extension host: parse the path locally, expand config via `ssh -G`, then resolve `HostName` to an IP with DNS when possible.
- UI examples for SSH paths should stay in placeholders or helper text only; they must never be used as the actual project `path` state.
- When the extension is running inside a current SSH window, the extension host should prefer the active remote authority and current remote path over generic SSH examples.
