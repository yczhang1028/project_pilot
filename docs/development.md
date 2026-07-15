# Development

## Project Structure

```text
project-pilot/
├── src/                    # Extension source code
├── webview-ui/             # React frontend
├── media/                  # Icons and demo assets
├── docs/                   # User docs and memory bank
└── package.json            # Extension manifest
```

## Build Commands

```bash
npm run build
npm run build:ext
npm run build:webview
npm run watch
```

Always run `npm run build`, not only `npm run build:ext`, before launching the
Extension Host so the Manager webview assets are current.

## Automated Validation

Run the focused SSH Host suite, webview type check, complete build, and diff
whitespace check from the repository root:

```bash
npm run test:sshPath
npm run test:projectPath
npm run test:sshResolve
npm run test:sshHosts
npm run test:sshProjectRuntime
npm run test:store
npm run test:sshHostMessages
npm run test:outline
npm run test:sshHostManagerModel
npm run test:resizePerformance
npm run test:mcpParser
npm run test:agentAssetsMessages
npm run test:agentAssetsOpen
npx tsc -p webview-ui/tsconfig.json --noEmit
npm run build
git diff --check
```

The 4.0 Agent Assets checks cover server-level MCP parsing and redaction,
webview message routing, local/current/other-machine Open behavior, and resize
performance invariants. `test:resizePerformance` specifically prevents a
per-pixel React resize listener from returning and verifies browser rendering
containment for long project and Agent Asset lists.

## Local Development

1. Install dependencies.
2. Run `npm run build`.
3. Launch the extension from Run and Debug with `Run Extension`.
4. For SSH validation, use `Run Extension (Remote SSH Folder)` or `Run Extension (Remote SSH Workspace)` and provide:
   - SSH authority such as `my-host` or `user@my-host`
   - A remote Linux path like `/repo/app` or a remote Windows path like `C:/repo/app`

### SSH Host Extension Host checklist

This checklist requires an interactive `Run Extension` session; automated tests
and a successful build do not replace it.

1. Launch `Run Extension` after `npm run build`.
2. Import a legacy config with two projects on one Host and one malformed SSH path.
3. Confirm one Host is created, two projects link to it, and the malformed project remains editable.
4. Switch OUTLINE to `By Host`; confirm used, unused, `Local`, and `Unmanaged SSH` buckets.
5. Change the Host IP; open both linked projects and verify the new authority.
6. Test success, auth failure, timeout, and missing-SSH messages.
7. Migrate projects, verify delete protection, then delete the empty source Host.
8. Export and re-import; confirm Host IDs, remote paths, and compatibility paths survive.

Record every item as pass or fail together with the VS Code and Remote-SSH
versions. For the 2026-07-07 command-line validation, VS Code was `1.127.0`
(x64) and Remote-SSH was `0.124.0`. The Extension Host was not launched or
exercised, so all eight interactive checklist items remain **not run**; this is
not a claim that the UI workflow passed.

## Webview Development

```bash
cd webview-ui
npm install
npm run dev
```

When webview work is finished, rebuild packaged assets from the repository root:

```bash
npm run build:webview
```

## Notes

- The extension host is implemented in TypeScript under `src`
- The manager UI is implemented in React under `webview-ui`
- Project data is stored locally in the editor global storage area
- Demo assets and screenshot-safe sample data live under `media/demo`
- `npm run build:webview` runs `npm install` in `webview-ui`
