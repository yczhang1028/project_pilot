# Active Context

## Current focus

Fix SSH parsing for Windows remote hosts where a raw SSH path like `user@host:C:/repo` could be misparsed.

## Recent decision

- Replace repeated colon-based parsing with helper-driven parsing in `src/sshPath.ts`
- Preserve the full remote path after the first SSH separator colon
- Ensure URI construction adds a leading slash for Windows remote paths so the authority remains `user@host`
- Keep webview hostname extraction aligned with extension-host parsing behavior
