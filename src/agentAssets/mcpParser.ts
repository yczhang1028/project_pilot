import * as path from 'path';
import type { McpServerDetails, RawScannedAsset, ScanRoot } from './types';

const MAX_ARGS = 12;
const MAX_KEYS = 30;
const MAX_TEXT = 320;
const SENSITIVE_FLAG = /(?:^|[-_])(token|secret|password|passwd|api[-_]?key|authorization|auth)(?:$|[-_])/i;
const SENSITIVE_VALUE = /^(?:sk|ghp|github_pat|xox[baprs])[-_][a-z0-9_-]{8,}$/i;

type McpTransport = McpServerDetails['transport'];

interface ParsedServer {
  name: string;
  details: McpServerDetails;
  status: RawScannedAsset['status'];
  statusMessage?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function limitedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, MAX_TEXT)
    : undefined;
}

function safeKeys(value: unknown): string[] | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).filter(Boolean).sort().slice(0, MAX_KEYS);
  return keys.length ? keys : undefined;
}

function sanitizeUrl(value: unknown): string | undefined {
  const text = limitedString(value);
  if (!text) return undefined;
  try {
    const parsed = new URL(text);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().slice(0, MAX_TEXT);
  } catch {
    return text.split(/[?#]/, 1)[0].slice(0, MAX_TEXT);
  }
}

function sanitizeArgs(value: unknown): Pick<McpServerDetails, 'args' | 'argsTruncated'> {
  if (!Array.isArray(value)) return {};
  const source = value.filter(item => typeof item === 'string') as string[];
  let redactNext = false;
  const args = source.slice(0, MAX_ARGS).map(raw => {
    const item = raw.slice(0, MAX_TEXT);
    if (redactNext || SENSITIVE_VALUE.test(item) || /^bearer\s+/i.test(item)) {
      redactNext = false;
      return '<redacted>';
    }
    const equals = item.indexOf('=');
    if (equals > 0 && SENSITIVE_FLAG.test(item.slice(0, equals))) {
      return `${item.slice(0, equals)}=<redacted>`;
    }
    redactNext = item.startsWith('-') && SENSITIVE_FLAG.test(item);
    return item;
  });
  return {
    ...(args.length ? { args } : {}),
    ...(source.length > MAX_ARGS ? { argsTruncated: true } : {})
  };
}

function normalizeTransport(type: unknown, command?: string, url?: string): McpTransport {
  const value = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (value === 'stdio') return 'stdio';
  if (value === 'sse') return 'sse';
  if (value === 'http' || value === 'streamable-http' || value === 'streamable_http') return 'http';
  if (command) return 'stdio';
  if (url) return /\/sse\/?$/i.test(url) ? 'sse' : 'http';
  return 'unknown';
}

function parsedServer(name: string, config: unknown): ParsedServer {
  if (!isRecord(config)) {
    return {
      name,
      details: { transport: 'unknown' },
      status: 'invalid',
      statusMessage: 'MCP server configuration must be an object.'
    };
  }
  const command = limitedString(config.command);
  const url = sanitizeUrl(config.url);
  const enabled = typeof config.disabled === 'boolean'
    ? !config.disabled
    : typeof config.enabled === 'boolean' ? config.enabled : undefined;
  const authEnvKey = limitedString(config.bearer_token_env_var ?? config.bearerTokenEnvVar);
  const details: McpServerDetails = {
    transport: normalizeTransport(config.type ?? config.transport, command, url),
    ...(command ? { command } : {}),
    ...sanitizeArgs(config.args),
    ...(url ? { url } : {}),
    ...(safeKeys(config.env) ? { envKeys: safeKeys(config.env) } : {}),
    ...(safeKeys(config.headers ?? config.http_headers) ? { headerKeys: safeKeys(config.headers ?? config.http_headers) } : {}),
    ...(authEnvKey ? { authEnvKey } : {}),
    ...(enabled !== undefined ? { enabled } : {})
  };
  const validEndpoint = Boolean(command || url);
  return {
    name,
    details,
    status: validEndpoint ? 'ready' : 'invalid',
    ...(!validEndpoint ? { statusMessage: 'MCP server has neither a command nor a URL.' } : {})
  };
}

function parseJsonServers(content: string): ParsedServer[] {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) throw new Error('MCP JSON must contain an object.');
  const servers = parsed.mcpServers;
  if (servers === undefined) return [];
  if (!isRecord(servers)) throw new Error('mcpServers must contain an object.');
  return Object.entries(servers).map(([name, config]) => parsedServer(name, config));
}

function unquoteToml(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed) as string; } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function splitTomlPath(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
    } else if (character === '.') {
      parts.push(unquoteToml(current));
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(unquoteToml(current));
  return parts.map(part => part.trim()).filter(Boolean);
}

function bracketBalance(value: string): number {
  let balance = 0;
  let quote = '';
  let escaped = false;
  for (const character of value) {
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && character === '\\') { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[') balance += 1;
    else if (character === ']') balance -= 1;
  }
  return balance;
}

function parseTomlArray(value: string): string[] {
  const items: string[] = [];
  const matcher = /"(?:\\.|[^"\\])*"|'[^']*'/g;
  for (const match of value.matchAll(matcher)) items.push(unquoteToml(match[0]));
  return items;
}

function inlineTomlKeys(value: string): string[] {
  return [...value.matchAll(/(?:^|[,\s{])([A-Za-z0-9_.-]+)\s*=/g)]
    .map(match => match[1])
    .filter(Boolean)
    .slice(0, MAX_KEYS);
}

function parseTomlServers(content: string): ParsedServer[] {
  const configs = new Map<string, Record<string, unknown>>();
  const lines = content.split(/\r?\n/);
  let currentName: string | undefined;
  let subsection = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (section) {
      const parts = splitTomlPath(section[1]);
      if (parts[0] === 'mcp_servers' && parts[1]) {
        currentName = parts[1];
        subsection = parts.slice(2).join('.');
        if (!configs.has(currentName)) configs.set(currentName, {});
      } else {
        currentName = undefined;
        subsection = '';
      }
      continue;
    }
    if (!currentName) continue;
    const property = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!property) continue;
    const key = property[1];
    let value = property[2].replace(/\s+#.*$/, '').trim();
    while (bracketBalance(value) > 0 && index + 1 < lines.length) {
      index += 1;
      value += `\n${lines[index]}`;
    }
    const config = configs.get(currentName)!;
    if (subsection === 'env') {
      const keys = new Set([...(config.envKeys as string[] | undefined ?? []), key]);
      config.envKeys = [...keys].slice(0, MAX_KEYS);
      continue;
    }
    if (subsection === 'http_headers' || subsection === 'headers') {
      const keys = new Set([...(config.headerKeys as string[] | undefined ?? []), key]);
      config.headerKeys = [...keys].slice(0, MAX_KEYS);
      continue;
    }
    if (key === 'command' || key === 'url' || key === 'type' || key === 'transport' || key === 'bearer_token_env_var') {
      config[key] = unquoteToml(value);
    } else if (key === 'args') {
      config.args = parseTomlArray(value);
    } else if (key === 'enabled' || key === 'disabled') {
      config[key] = value === 'true' ? true : value === 'false' ? false : undefined;
    } else if (key === 'env') {
      config.envKeys = inlineTomlKeys(value);
    } else if (key === 'http_headers' || key === 'headers') {
      config.headerKeys = inlineTomlKeys(value);
    }
  }

  return [...configs.entries()].map(([name, config]) => parsedServer(name, {
    ...config,
    env: Object.fromEntries(((config.envKeys as string[] | undefined) ?? []).map(key => [key, true])),
    headers: Object.fromEntries(((config.headerKeys as string[] | undefined) ?? []).map(key => [key, true]))
  }));
}

function invalidConfigAsset(root: ScanRoot, filePath: string, message: string): RawScannedAsset {
  return {
    rootId: root.id,
    kind: 'mcp',
    name: path.basename(filePath),
    path: filePath,
    entryKey: '__config__',
    mcp: { transport: 'unknown' },
    status: 'invalid',
    statusMessage: message.slice(0, 500)
  };
}

export function parseMcpConfig(root: ScanRoot, filePath: string, content: string): RawScannedAsset[] {
  let servers: ParsedServer[];
  try {
    servers = filePath.toLowerCase().endsWith('.toml')
      ? parseTomlServers(content)
      : parseJsonServers(content.replace(/^\uFEFF/, ''));
  } catch (error) {
    return [invalidConfigAsset(
      root,
      filePath,
      error instanceof Error ? error.message : 'MCP configuration could not be parsed.'
    )];
  }
  return servers.map(server => ({
    rootId: root.id,
    kind: 'mcp',
    name: server.name.slice(0, 300),
    path: filePath,
    entryKey: server.name,
    mcp: server.details,
    status: server.status,
    ...(server.statusMessage ? { statusMessage: server.statusMessage } : {})
  }));
}
