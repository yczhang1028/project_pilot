# Active Context

## Current focus

Fix project path normalization when users add or edit entries through file pickers, especially when local dialogs return remote SSH URIs or when Windows-style remote paths need canonical handling.

## Recent decision

- Normalize `showOpenDialog()` results before storing or reflecting them back into the webview
- Convert remote `vscode-remote://ssh-remote+...` selections into canonical raw SSH paths such as `user@host:/path` or `user@host:C:/path`
- Auto-correct the saved project type based on the actual path format so local, workspace, SSH, and SSH workspace entries cannot drift out of sync
- Keep path suggestion logic aligned between webview detection and extension-host normalization
- Allow SSH alias-style inputs without an explicit username, such as `host:/path`, so the extension can work with SSH config backed hosts
- Resolve SSH details on the extension host by combining raw path parsing, `ssh -G` config expansion, and DNS lookup for a best-effort IP
- Use current SSH window context as the primary source for prefill and helper UI instead of injecting generic SSH example strings into editable path state
