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

## Local Development

1. Install dependencies.
2. Run `npm run build`.
3. Launch the extension from Run and Debug with `Run Extension`.
4. For SSH validation, use `Run Extension (Remote SSH Folder)` or `Run Extension (Remote SSH Workspace)` and provide:
   - SSH authority such as `my-host` or `user@my-host`
   - A remote Linux path like `/repo/app` or a remote Windows path like `C:/repo/app`

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
