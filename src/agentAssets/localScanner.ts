import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  MachineScanResult,
  RawScannedAsset,
  RootScanResult,
  ScanRoot
} from './types';
import { resolveLocalRoot } from './providerRegistry';
import { parseMcpConfig } from './mcpParser';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__']);
const MAX_DEPTH = 4;
const MAX_VISITED_DIRS = 2_000;
const MAX_SKILLS = 1_000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SETTINGS_BYTES = 2 * 1024 * 1024;
const MAX_MCP_BYTES = 512 * 1024;

interface ManifestMetadata {
  name?: string;
  description?: string;
  valid: boolean;
  message?: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseManifest(content: string): ManifestMetadata {
  if (!content.startsWith('---')) {
    return { valid: false, message: 'SKILL.md is missing YAML frontmatter.' };
  }
  const end = content.indexOf('\n---', 3);
  if (end < 0) {
    return { valid: false, message: 'SKILL.md frontmatter is not closed.' };
  }
  const frontmatter = content.slice(3, end);
  const name = frontmatter.match(/^name\s*:\s*(.+)$/mi)?.[1];
  const description = frontmatter.match(/^description\s*:\s*(.+)$/mi)?.[1];
  if (!name?.trim()) {
    return {
      description: description ? unquote(description) : undefined,
      valid: false,
      message: 'SKILL.md frontmatter is missing name.'
    };
  }
  if (!description?.trim()) {
    return {
      name: unquote(name),
      valid: false,
      message: 'SKILL.md frontmatter is missing description.'
    };
  }
  return {
    name: unquote(name),
    description: unquote(description),
    valid: true
  };
}

async function scanSkillDirectory(root: ScanRoot, rootPath: string): Promise<RawScannedAsset[]> {
  const assets: RawScannedAsset[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootPath, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0 && visited.size < MAX_VISITED_DIRS && assets.length < MAX_SKILLS) {
    const current = queue.shift()!;
    let canonical = current.dir;
    try {
      canonical = await fs.realpath(current.dir);
    } catch {
      // Keep the logical path so an unreadable directory can be skipped safely.
    }
    const canonicalKey = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    if (visited.has(canonicalKey)) continue;
    visited.add(canonicalKey);

    const manifestPath = path.join(current.dir, 'SKILL.md');
    try {
      const manifestStat = await fs.stat(manifestPath);
      if (manifestStat.isFile()) {
        const handle = await fs.open(manifestPath, 'r');
        let content = '';
        try {
          const length = Math.min(manifestStat.size, MAX_MANIFEST_BYTES);
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, 0);
          content = buffer.toString('utf8');
        } finally {
          await handle.close();
        }
        const metadata = parseManifest(content);
        const linkStat = await fs.lstat(current.dir);
        assets.push({
          rootId: root.id,
          kind: 'skill',
          name: metadata.name || path.basename(current.dir),
          ...(metadata.description ? { description: metadata.description } : {}),
          path: current.dir,
          realPath: canonical,
          modifiedAt: manifestStat.mtime.toISOString(),
          isSymlink: linkStat.isSymbolicLink(),
          status: metadata.valid ? 'ready' : 'invalid',
          ...(metadata.message ? { statusMessage: metadata.message } : {})
        });
        continue;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        // A manifest that exists but cannot be read is still useful inventory.
        try {
          await fs.lstat(manifestPath);
          assets.push({
            rootId: root.id,
            kind: 'skill',
            name: path.basename(current.dir),
            path: current.dir,
            realPath: canonical,
            status: 'unreadable',
            statusMessage: 'SKILL.md could not be read.'
          });
          continue;
        } catch {
          // There is no readable manifest at this directory.
        }
      }
    }

    if (current.depth >= MAX_DEPTH) continue;
    let entries;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
  }
  return assets;
}

async function scanSettings(root: ScanRoot, filePath: string): Promise<RawScannedAsset[]> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return [];
    let status: RawScannedAsset['status'] = 'ready';
    let statusMessage: string | undefined;
    if (filePath.toLowerCase().endsWith('.json')) {
      if (stat.size > MAX_SETTINGS_BYTES) {
        status = 'unreadable';
        statusMessage = 'Settings file is too large to validate safely.';
      } else {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          JSON.parse(content);
        } catch {
          status = 'invalid';
          statusMessage = 'JSON could not be parsed.';
        }
      }
    }
    return [{
      rootId: root.id,
      kind: root.kind,
      name: path.basename(filePath),
      path: filePath,
      realPath: await fs.realpath(filePath).catch(() => filePath),
      modifiedAt: stat.mtime.toISOString(),
      status,
      ...(statusMessage ? { statusMessage } : {})
    }];
  } catch {
    return [];
  }
}

async function scanMcpConfig(root: ScanRoot, filePath: string): Promise<RawScannedAsset[]> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return [];
    const realPath = await fs.realpath(filePath).catch(() => filePath);
    if (stat.size > MAX_MCP_BYTES) {
      return [{
        rootId: root.id,
        kind: 'mcp',
        name: path.basename(filePath),
        path: filePath,
        realPath,
        modifiedAt: stat.mtime.toISOString(),
        entryKey: '__config__',
        mcp: { transport: 'unknown' },
        status: 'unreadable',
        statusMessage: 'MCP configuration is too large to inspect safely.'
      }];
    }
    const content = await fs.readFile(filePath, 'utf8');
    return parseMcpConfig(root, filePath, content).map(asset => ({
      ...asset,
      realPath,
      modifiedAt: stat.mtime.toISOString()
    }));
  } catch {
    return [];
  }
}

export async function scanLocalMachine(
  roots: readonly ScanRoot[],
  onRootComplete: (root: ScanRoot, result: RootScanResult) => void,
  signal: AbortSignal
): Promise<MachineScanResult> {
  const assets: RawScannedAsset[] = [];
  const rootResults: RootScanResult[] = [];

  for (const root of roots) {
    if (signal.aborted) throw new Error('Scan cancelled');
    const rootPath = resolveLocalRoot(root);
    if (!rootPath) {
      const result: RootScanResult = { rootId: root.id, status: 'missing' };
      rootResults.push(result);
      onRootComplete(root, result);
      continue;
    }
    try {
      const found = root.kind === 'skill'
        ? await scanSkillDirectory(root, rootPath)
        : root.kind === 'mcp'
          ? await scanMcpConfig(root, rootPath)
          : await scanSettings(root, rootPath);
      assets.push(...found);
      const result: RootScanResult = {
        rootId: root.id,
        status: found.length > 0 ? 'complete' : 'missing'
      };
      rootResults.push(result);
      onRootComplete(root, result);
    } catch (error) {
      const result: RootScanResult = {
        rootId: root.id,
        status: 'error',
        message: error instanceof Error ? error.message : 'Scan failed.'
      };
      rootResults.push(result);
      onRootComplete(root, result);
    }
  }

  return { assets, roots: rootResults };
}
