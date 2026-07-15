import { spawn } from 'child_process';
import * as fs from 'fs';
import type { SshHost } from '../sshHosts';
import { hostConnectionKey } from '../sshHosts';
import type {
  AgentAssetStatus,
  MachineScanResult,
  RawScannedAsset,
  RootScanResult,
  ScanRoot
} from './types';
import { parseMcpConfig } from './mcpParser';

const WINDOWS_SSH_PATH = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 128 * 1024;
const REMOTE_TIMEOUT_MS = 45_000;

type RemoteRuntime = 'python3' | 'python' | 'powershell';
const runtimeCache = new Map<string, RemoteRuntime>();

class RemoteCommandError extends Error {
  constructor(
    message: string,
    readonly code: number | string | null,
    readonly stderr: string
  ) {
    super(message);
  }
}

function sshCandidates(): string[] {
  const candidates = ['ssh'];
  if (process.platform === 'win32' && fs.existsSync(WINDOWS_SSH_PATH)) {
    candidates.push(WINDOWS_SSH_PATH);
  }
  return [...new Set(candidates)];
}

function sshArgs(host: SshHost, remoteCommand: string): string[] {
  const target = host.username?.trim()
    ? `${host.username.trim()}@${host.hostname.trim()}`
    : host.hostname.trim();
  const args = [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5'
  ];
  if (host.port !== undefined) args.push('-p', String(host.port));
  args.push('--', target, remoteCommand);
  return args;
}

async function runSshCommand(
  host: SshHost,
  remoteCommand: string,
  stdin: string | undefined,
  signal: AbortSignal,
  onLine: (line: string) => void
): Promise<void> {
  let lastError: unknown;
  for (const candidate of sshCandidates()) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(candidate, sshArgs(host, remoteCommand), {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdoutBuffer = '';
        let stdoutBytes = 0;
        let stderr = '';
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, REMOTE_TIMEOUT_MS);
        const abort = () => child.kill();
        signal.addEventListener('abort', abort, { once: true });

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          stdoutBytes += Buffer.byteLength(chunk);
          if (stdoutBytes > MAX_STDOUT_BYTES) {
            child.kill();
            return;
          }
          stdoutBuffer += chunk;
          let newline = stdoutBuffer.indexOf('\n');
          while (newline >= 0) {
            const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '');
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            if (line.trim()) onLine(line);
            newline = stdoutBuffer.indexOf('\n');
          }
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          if (stderr.length < MAX_STDERR_BYTES) stderr += chunk;
        });
        child.on('error', error => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          reject(error);
        });
        child.on('close', code => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          if (stdoutBuffer.trim()) onLine(stdoutBuffer.replace(/\r$/, ''));
          if (signal.aborted) {
            reject(new RemoteCommandError('Scan cancelled', 'ABORTED', stderr));
          } else if (timedOut) {
            reject(new RemoteCommandError('SSH scan timed out.', 'ETIMEDOUT', stderr));
          } else if (stdoutBytes > MAX_STDOUT_BYTES) {
            reject(new RemoteCommandError('SSH scan returned too much data.', 'EOVERFLOW', stderr));
          } else if (code !== 0) {
            reject(new RemoteCommandError(
              stderr.trim() || `Remote scanner exited with code ${String(code)}.`,
              code,
              stderr
            ));
          } else {
            resolve();
          }
        });
        if (stdin !== undefined) child.stdin.end(stdin);
        else child.stdin.end();
      });
      return;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw lastError ?? new Error('OpenSSH was not found.');
}

function encodedPayload(roots: readonly ScanRoot[]): string {
  return Buffer.from(JSON.stringify(roots), 'utf8').toString('base64');
}

function pythonScannerScript(roots: readonly ScanRoot[]): string {
  const payload = encodedPayload(roots);
  return String.raw`import os, sys, json, base64, re, stat, datetime
ROOTS = json.loads(base64.b64decode('${payload}').decode('utf-8'))
SKIP = {'.git', 'node_modules', 'dist', 'build', '__pycache__'}
MAX_DEPTH = 4
MAX_DIRS = 2000
MAX_SKILLS = 1000
MAX_SETTINGS_BYTES = 2 * 1024 * 1024
MAX_MCP_BYTES = 512 * 1024

def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=True, separators=(',', ':')) + '\n')
    sys.stdout.flush()

def resolve_root(root):
    if root['base'] == 'absolute':
        return os.path.normpath(root['path'])
    if root['base'] == 'appData':
        base = os.environ.get('APPDATA')
        return os.path.join(base, root['path']) if base else None
    return os.path.join(os.path.expanduser('~'), root['path'])

def iso_time(timestamp):
    return datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).isoformat().replace('+00:00', 'Z')

def parse_manifest(content):
    if not content.startswith('---'):
        return None, None, 'SKILL.md is missing YAML frontmatter.'
    end = content.find('\n---', 3)
    if end < 0:
        return None, None, 'SKILL.md frontmatter is not closed.'
    frontmatter = content[3:end]
    name_match = re.search(r'^name\s*:\s*(.+)$', frontmatter, re.I | re.M)
    description_match = re.search(r'^description\s*:\s*(.+)$', frontmatter, re.I | re.M)
    def clean(value):
        if not value: return None
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'": value = value[1:-1].strip()
        return value
    name = clean(name_match.group(1)) if name_match else None
    description = clean(description_match.group(1)) if description_match else None
    if not name: return name, description, 'SKILL.md frontmatter is missing name.'
    if not description: return name, description, 'SKILL.md frontmatter is missing description.'
    return name, description, None

def emit_skill(root, directory, manifest, canonical):
    try:
        with open(manifest, 'r', encoding='utf-8-sig', errors='replace') as handle:
            content = handle.read(65536)
        name, description, problem = parse_manifest(content)
        manifest_stat = os.stat(manifest)
        asset = {
            'type': 'asset', 'rootId': root['id'], 'kind': 'skill',
            'name': name or os.path.basename(directory), 'path': directory,
            'realPath': canonical, 'modifiedAt': iso_time(manifest_stat.st_mtime),
            'isSymlink': os.path.islink(directory),
            'status': 'invalid' if problem else 'ready'
        }
        if description: asset['description'] = description
        if problem: asset['statusMessage'] = problem
        emit(asset)
    except Exception as error:
        emit({
            'type': 'asset', 'rootId': root['id'], 'kind': 'skill',
            'name': os.path.basename(directory), 'path': directory,
            'realPath': canonical, 'status': 'unreadable',
            'statusMessage': str(error)[:300]
        })

def scan_skill_root(root, root_path):
    if not root_path or not os.path.lexists(root_path):
        emit({'type':'rootDone','rootId':root['id'],'status':'missing'})
        return
    queue = [(root_path, 0)]
    visited = set()
    found = 0
    while queue and len(visited) < MAX_DIRS and found < MAX_SKILLS:
        directory, depth = queue.pop(0)
        try:
            canonical = os.path.realpath(directory)
            key = os.path.normcase(canonical)
            if key in visited: continue
            visited.add(key)
            manifest = os.path.join(directory, 'SKILL.md')
            if os.path.isfile(manifest):
                emit_skill(root, directory, manifest, canonical)
                found += 1
                continue
            if depth >= MAX_DEPTH: continue
            with os.scandir(directory) as entries:
                for entry in entries:
                    if entry.name in SKIP: continue
                    try:
                        if entry.is_dir(follow_symlinks=True):
                            queue.append((entry.path, depth + 1))
                    except OSError:
                        pass
        except OSError:
            continue
    emit({'type':'rootDone','rootId':root['id'],'status':'complete' if found else 'missing'})

def scan_settings(root, file_path):
    if not file_path or not os.path.isfile(file_path):
        emit({'type':'rootDone','rootId':root['id'],'status':'missing'})
        return
    file_stat = os.stat(file_path)
    if root['kind'] == 'mcp':
        if file_stat.st_size > MAX_MCP_BYTES:
            emit({
                'type':'asset','rootId':root['id'],'kind':'mcp',
                'name':os.path.basename(file_path),'path':file_path,
                'realPath':os.path.realpath(file_path),'modifiedAt':iso_time(file_stat.st_mtime),
                'entryKey':'__config__','mcp':{'transport':'unknown'},'status':'unreadable',
                'statusMessage':'MCP configuration is too large to inspect safely.'
            })
        else:
            with open(file_path, 'rb') as handle: encoded = base64.b64encode(handle.read()).decode('ascii')
            emit({
                'type':'mcpConfig','rootId':root['id'],'path':file_path,
                'realPath':os.path.realpath(file_path),'modifiedAt':iso_time(file_stat.st_mtime),
                'contentBase64':encoded
            })
        emit({'type':'rootDone','rootId':root['id'],'status':'complete'})
        return
    status = 'ready'
    message = None
    if file_path.lower().endswith('.json'):
        if os.path.getsize(file_path) > MAX_SETTINGS_BYTES:
            status = 'unreadable'; message = 'Settings file is too large to validate safely.'
        else:
            try:
                with open(file_path, 'r', encoding='utf-8-sig') as handle: json.load(handle)
            except Exception:
                status = 'invalid'; message = 'JSON could not be parsed.'
    asset = {
        'type':'asset','rootId':root['id'],'kind':root['kind'],
        'name':os.path.basename(file_path),'path':file_path,
        'realPath':os.path.realpath(file_path),'modifiedAt':iso_time(file_stat.st_mtime),
        'status':status
    }
    if message: asset['statusMessage'] = message
    emit(asset)
    emit({'type':'rootDone','rootId':root['id'],'status':'complete'})

for root in ROOTS:
    try:
        resolved = resolve_root(root)
        scan_skill_root(root, resolved) if root['kind'] == 'skill' else scan_settings(root, resolved)
    except Exception as error:
        emit({'type':'rootDone','rootId':root['id'],'status':'error','message':str(error)[:300]})
`;
}

function powershellScannerScript(roots: readonly ScanRoot[]): string {
  const payload = encodedPayload(roots);
  return String.raw`$ErrorActionPreference = 'Stop'
$roots = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$skip = @('.git','node_modules','dist','build','__pycache__')
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 8; [Console]::Out.Flush() }
function Resolve-Root($root) {
  if ($root.base -eq 'absolute') { return [IO.Path]::GetFullPath($root.path) }
  if ($root.base -eq 'appData') { if (-not $env:APPDATA) { return $null }; return Join-Path $env:APPDATA $root.path }
  return Join-Path $HOME $root.path
}
function Read-Limited($file) {
  $stream = [IO.File]::OpenRead($file); try { $buffer = New-Object byte[] 65536; $count = $stream.Read($buffer,0,$buffer.Length); return [Text.Encoding]::UTF8.GetString($buffer,0,$count) } finally { $stream.Dispose() }
}
foreach ($root in $roots) {
  try {
    $target = Resolve-Root $root
    if ($root.kind -ne 'skill') {
      if (-not $target -or -not (Test-Path -LiteralPath $target -PathType Leaf)) { Emit @{type='rootDone';rootId=$root.id;status='missing'}; continue }
      $item = Get-Item -LiteralPath $target -Force
      if ($root.kind -eq 'mcp') {
        if ($item.Length -gt 524288) {
          Emit @{type='asset';rootId=$root.id;kind='mcp';name=$item.Name;path=$item.FullName;realPath=$item.FullName;modifiedAt=$item.LastWriteTimeUtc.ToString('o');entryKey='__config__';mcp=@{transport='unknown'};status='unreadable';statusMessage='MCP configuration is too large to inspect safely.'}
        } else {
          $bytes = [IO.File]::ReadAllBytes($target)
          Emit @{type='mcpConfig';rootId=$root.id;path=$item.FullName;realPath=$item.FullName;modifiedAt=$item.LastWriteTimeUtc.ToString('o');contentBase64=[Convert]::ToBase64String($bytes)}
        }
        Emit @{type='rootDone';rootId=$root.id;status='complete'}; continue
      }
      $status = 'ready'; $message = $null
      if ($target.ToLowerInvariant().EndsWith('.json')) {
        if ($item.Length -gt 2097152) { $status='unreadable'; $message='Settings file is too large to validate safely.' }
        else { try { [IO.File]::ReadAllText($target) | ConvertFrom-Json | Out-Null } catch { $status='invalid'; $message='JSON could not be parsed.' } }
      }
      $asset = @{type='asset';rootId=$root.id;kind=$root.kind;name=$item.Name;path=$item.FullName;realPath=$item.FullName;modifiedAt=$item.LastWriteTimeUtc.ToString('o');status=$status}
      if ($message) { $asset.statusMessage = $message }; Emit $asset; Emit @{type='rootDone';rootId=$root.id;status='complete'}; continue
    }
    if (-not $target -or -not (Test-Path -LiteralPath $target -PathType Container)) { Emit @{type='rootDone';rootId=$root.id;status='missing'}; continue }
    $queue = [Collections.Generic.Queue[object]]::new(); $queue.Enqueue(@($target,0)); $visited = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase); $found = 0
    while ($queue.Count -gt 0 -and $visited.Count -lt 2000 -and $found -lt 1000) {
      $entry = $queue.Dequeue(); $directory = [string]$entry[0]; $depth = [int]$entry[1]
      try { $canonical = (Resolve-Path -LiteralPath $directory).Path } catch { $canonical = $directory }
      if (-not $visited.Add($canonical)) { continue }
      $manifest = Join-Path $directory 'SKILL.md'
      if (Test-Path -LiteralPath $manifest -PathType Leaf) {
        $item = Get-Item -LiteralPath $manifest -Force; $content = Read-Limited $manifest
        $nameMatch = [regex]::Match($content,'(?im)^name\s*:\s*(.+)$'); $descMatch = [regex]::Match($content,'(?im)^description\s*:\s*(.+)$')
        $name = if ($nameMatch.Success) { $nameMatch.Groups[1].Value.Trim().Trim('"').Trim("'") } else { Split-Path $directory -Leaf }
        $problem = if (-not $content.StartsWith('---')) { 'SKILL.md is missing YAML frontmatter.' } elseif (-not $nameMatch.Success) { 'SKILL.md frontmatter is missing name.' } elseif (-not $descMatch.Success) { 'SKILL.md frontmatter is missing description.' } else { $null }
        $asset = @{type='asset';rootId=$root.id;kind='skill';name=$name;path=$directory;realPath=$canonical;modifiedAt=$item.LastWriteTimeUtc.ToString('o');isSymlink=((Get-Item -LiteralPath $directory -Force).LinkType -ne $null);status=$(if($problem){'invalid'}else{'ready'})}
        if ($descMatch.Success) { $asset.description = $descMatch.Groups[1].Value.Trim().Trim('"').Trim("'") }; if ($problem) { $asset.statusMessage = $problem }; Emit $asset; $found++; continue
      }
      if ($depth -ge 4) { continue }
      Get-ChildItem -LiteralPath $directory -Force -Directory -ErrorAction SilentlyContinue | Where-Object { $skip -notcontains $_.Name } | ForEach-Object { $queue.Enqueue(@($_.FullName,$depth+1)) }
    }
    Emit @{type='rootDone';rootId=$root.id;status=$(if($found){'complete'}else{'missing'})}
  } catch { Emit @{type='rootDone';rootId=$root.id;status='error';message=$_.Exception.Message.Substring(0,[Math]::Min(300,$_.Exception.Message.Length))} }
}
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatus(value: unknown): AgentAssetStatus | undefined {
  return value === 'ready' || value === 'invalid' || value === 'broken-link' || value === 'unreadable'
    ? value
    : undefined;
}

function stringArray(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return undefined;
  return value.slice(0, limit).map(item => item.slice(0, 320));
}

function parseMcpDetails(value: unknown): RawScannedAsset['mcp'] | undefined {
  if (!isRecord(value)) return undefined;
  const transport = value.transport;
  if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse' && transport !== 'unknown') {
    return undefined;
  }
  const args = stringArray(value.args, 12);
  const envKeys = stringArray(value.envKeys, 30);
  const headerKeys = stringArray(value.headerKeys, 30);
  return {
    transport,
    ...(typeof value.command === 'string' ? { command: value.command.slice(0, 320) } : {}),
    ...(args ? { args } : {}),
    ...(typeof value.argsTruncated === 'boolean' ? { argsTruncated: value.argsTruncated } : {}),
    ...(typeof value.url === 'string' ? { url: value.url.slice(0, 320) } : {}),
    ...(envKeys ? { envKeys } : {}),
    ...(headerKeys ? { headerKeys } : {}),
    ...(typeof value.authEnvKey === 'string' ? { authEnvKey: value.authEnvKey.slice(0, 320) } : {}),
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {})
  };
}

function parseAssetEvent(value: unknown, rootIds: ReadonlySet<string>): RawScannedAsset | undefined {
  if (!isRecord(value) || value.type !== 'asset') return undefined;
  const status = parseStatus(value.status);
  if (
    typeof value.rootId !== 'string' || !rootIds.has(value.rootId)
    || (value.kind !== 'skill' && value.kind !== 'mcp' && value.kind !== 'settings')
    || typeof value.name !== 'string'
    || typeof value.path !== 'string'
    || !status
  ) return undefined;
  const mcp = parseMcpDetails(value.mcp);
  return {
    rootId: value.rootId,
    kind: value.kind,
    name: value.name.slice(0, 300),
    path: value.path,
    status,
    ...(typeof value.description === 'string' ? { description: value.description.slice(0, 1_000) } : {}),
    ...(typeof value.realPath === 'string' ? { realPath: value.realPath } : {}),
    ...(typeof value.modifiedAt === 'string' ? { modifiedAt: value.modifiedAt } : {}),
    ...(typeof value.isSymlink === 'boolean' ? { isSymlink: value.isSymlink } : {}),
    ...(typeof value.statusMessage === 'string' ? { statusMessage: value.statusMessage.slice(0, 500) } : {}),
    ...(typeof value.entryKey === 'string' ? { entryKey: value.entryKey.slice(0, 300) } : {}),
    ...(mcp ? { mcp } : {})
  };
}

function parseMcpConfigEvent(
  value: unknown,
  roots: ReadonlyMap<string, ScanRoot>
): RawScannedAsset[] | undefined {
  if (
    !isRecord(value) || value.type !== 'mcpConfig'
    || typeof value.rootId !== 'string'
    || typeof value.path !== 'string'
    || typeof value.contentBase64 !== 'string'
    || value.contentBase64.length > 800_000
  ) return undefined;
  const root = roots.get(value.rootId);
  if (!root || root.kind !== 'mcp') return undefined;
  const content = Buffer.from(value.contentBase64, 'base64').toString('utf8');
  return parseMcpConfig(root, value.path, content).map(asset => ({
    ...asset,
    ...(typeof value.realPath === 'string' ? { realPath: value.realPath } : {}),
    ...(typeof value.modifiedAt === 'string' ? { modifiedAt: value.modifiedAt } : {})
  }));
}

function parseRootEvent(value: unknown, rootIds: ReadonlySet<string>): RootScanResult | undefined {
  if (
    !isRecord(value) || value.type !== 'rootDone'
    || typeof value.rootId !== 'string' || !rootIds.has(value.rootId)
    || (value.status !== 'complete' && value.status !== 'missing' && value.status !== 'error')
  ) return undefined;
  return {
    rootId: value.rootId,
    status: value.status,
    ...(typeof value.message === 'string' ? { message: value.message.slice(0, 500) } : {})
  };
}

function commandNotFound(error: unknown): boolean {
  if (!(error instanceof RemoteCommandError)) return false;
  return error.code === 127
    || /command not found|not recognized as an internal|no such file or directory|python was not found/i
      .test(`${error.message}\n${error.stderr}`);
}

export async function scanRemoteMachine(
  host: SshHost,
  roots: readonly ScanRoot[],
  onRootComplete: (root: ScanRoot, result: RootScanResult) => void,
  signal: AbortSignal
): Promise<MachineScanResult> {
  const rootMap = new Map(roots.map(root => [root.id, root]));
  const rootIds = new Set(rootMap.keys());
  const connectionKey = hostConnectionKey(host);
  const cached = runtimeCache.get(connectionKey);
  const runtimes: RemoteRuntime[] = cached
    ? [cached, ...(['python3', 'python', 'powershell'] as RemoteRuntime[]).filter(item => item !== cached)]
    : ['python3', 'python', 'powershell'];
  let lastError: unknown;

  for (const runtime of runtimes) {
    const assets: RawScannedAsset[] = [];
    const rootResults: RootScanResult[] = [];
    try {
      const onLine = (line: string) => {
        let parsed: unknown;
        try { parsed = JSON.parse(line); } catch { return; }
        const mcpAssets = parseMcpConfigEvent(parsed, rootMap);
        if (mcpAssets) {
          assets.push(...mcpAssets);
          return;
        }
        const asset = parseAssetEvent(parsed, rootIds);
        if (asset) {
          assets.push(asset);
          return;
        }
        const result = parseRootEvent(parsed, rootIds);
        if (result && !rootResults.some(existing => existing.rootId === result.rootId)) {
          rootResults.push(result);
          const root = rootMap.get(result.rootId);
          if (root) onRootComplete(root, result);
        }
      };
      if (runtime === 'powershell') {
        const script = powershellScannerScript(roots);
        await runSshCommand(
          host,
          'powershell -NoProfile -NonInteractive -Command -',
          script,
          signal,
          onLine
        );
      } else {
        await runSshCommand(host, `${runtime} -`, pythonScannerScript(roots), signal, onLine);
      }
      runtimeCache.set(connectionKey, runtime);
      for (const root of roots) {
        if (!rootResults.some(result => result.rootId === root.id)) {
          const result: RootScanResult = {
            rootId: root.id,
            status: 'error',
            message: 'Remote scanner did not report this root.'
          };
          rootResults.push(result);
          onRootComplete(root, result);
        }
      }
      return { assets, roots: rootResults };
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw error;
      if (!commandNotFound(error)) throw error;
    }
  }
  throw lastError ?? new Error('No supported remote scanner runtime was found.');
}
