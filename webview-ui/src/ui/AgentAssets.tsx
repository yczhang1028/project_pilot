import React, { useEffect, useMemo, useRef, useState } from 'react';
import AgentAssetsIcon from './AgentAssetsIcon';
import { ModalSurface } from './ModalHost';
import type {
  AgentAsset,
  AgentAssetOperationResult,
  AgentAssetScope,
  AgentInventorySnapshot,
  AgentMachineStatus,
  AgentProviderId,
  AgentScanProgress
} from './model';

type Theme = Record<string, string>;

interface AgentAssetsProps {
  inventory?: AgentInventorySnapshot;
  progress?: AgentScanProgress | null;
  operationResult?: AgentAssetOperationResult | null;
  demoMode?: boolean;
  theme: Theme;
  onPostMessage: (message: { type: string; payload?: unknown }) => void;
  onManageSshHost: (hostId: string) => void;
  onPrepareSshRecovery: (hostId: string, action: 'key-login' | 'known-host') => void;
  onClose: () => void;
}

type ProviderFilter = 'all' | AgentProviderId;
type ScopeFilter = 'all' | AgentAssetScope;
type AssetTab = 'skill' | 'mcp' | 'settings';

const providerOptions: Array<{ id: ProviderFilter; label: string }> = [
  { id: 'all', label: 'All providers' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' }
];

const statusLabel: Record<AgentMachineStatus, string> = {
  never: 'Not scanned',
  fresh: 'Up to date',
  stale: 'Cached',
  scanning: 'Scanning',
  error: 'Needs attention'
};

function timeLabel(value?: string): string {
  if (!value) return 'Never scanned';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

function assetSearchText(asset: AgentAsset): string {
  return [
    asset.name,
    asset.description,
    asset.path,
    asset.statusMessage,
    asset.mcp?.transport,
    asset.mcp?.command,
    asset.mcp?.url,
    ...(asset.mcp?.args ?? []),
    ...(asset.mcp?.envKeys ?? []),
    ...(asset.mcp?.headerKeys ?? []),
    asset.mcp?.authEnvKey,
    ...asset.bindings.flatMap(binding => [binding.providerLabel, binding.projectName, binding.scope])
  ].filter(Boolean).join(' ').toLowerCase();
}

function statusTone(status: AgentMachineStatus | AgentAsset['status']): string {
  if (status === 'fresh' || status === 'ready') return 'positive';
  if (status === 'scanning') return 'active';
  if (status === 'stale' || status === 'never') return 'muted';
  return 'warning';
}

export default function AgentAssets({
  inventory,
  progress,
  operationResult,
  demoMode = false,
  theme,
  onPostMessage,
  onManageSshHost,
  onPrepareSshRecovery,
  onClose
}: AgentAssetsProps) {
  const [machineId, setMachineId] = useState('local');
  const [provider, setProvider] = useState<ProviderFilter>('all');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [assetTab, setAssetTab] = useState<AssetTab>('skill');
  const [query, setQuery] = useState('');
  const autoScanRequested = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.agentAssetsOpen = 'true';
    return () => {
      delete document.documentElement.dataset.agentAssetsOpen;
    };
  }, []);

  useEffect(() => {
    onPostMessage({ type: 'requestAgentInventory' });
    // The VS Code bridge is stable for the lifetime of this webview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!inventory?.machines.some(machine => machine.id === machineId)) {
      setMachineId(inventory?.machines[0]?.id ?? 'local');
    }
  }, [inventory?.machines, machineId]);

  const machine = inventory?.machines.find(candidate => candidate.id === machineId);
  const summary = inventory?.summaries.find(candidate => candidate.machineId === machineId);
  const activeProgress = progress?.machineId === machineId ? progress : undefined;
  const isScanning = summary?.status === 'scanning'
    || activeProgress?.stage === 'connecting'
    || activeProgress?.stage === 'scanning'
    || activeProgress?.stage === 'saving';

  useEffect(() => {
    if (
      machineId === 'local'
      && (summary?.status === 'never' || summary?.status === 'stale')
      && !autoScanRequested.current
    ) {
      autoScanRequested.current = true;
      onPostMessage({ type: 'startAgentScan', payload: { machineId: 'local' } });
    }
  }, [machineId, onPostMessage, summary?.status]);

  const machineAssets = useMemo(
    () => (inventory?.assets ?? []).filter(asset => asset.machineId === machineId),
    [inventory?.assets, machineId]
  );

  const filteredAssets = useMemo(() => {
    const term = query.trim().toLowerCase();
    return machineAssets.filter(asset => {
      if (asset.kind !== assetTab) return false;
      const matchingBindings = asset.bindings.filter(binding =>
        (provider === 'all' || binding.providerId === provider)
        && (scope === 'all' || binding.scope === scope)
      );
      return matchingBindings.length > 0 && (!term || assetSearchText(asset).includes(term));
    }).sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'skill' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [assetTab, machineAssets, provider, query, scope]);

  const issueCount = machineAssets.filter(asset => asset.status !== 'ready').length + (summary?.errors.length ?? 0);
  const isRecoverableHostError = machine?.kind === 'ssh'
    && summary?.status === 'error'
    && Boolean(machine.hostId);
  const progressPercent = activeProgress?.total
    ? Math.min(100, Math.round((activeProgress.completed / activeProgress.total) * 100))
    : isScanning ? 8 : 0;
  const panelStyle = {
    ['--agent-panel' as string]: theme.primaryBackground,
    ['--agent-card' as string]: theme.secondaryBackground,
    ['--agent-border' as string]: theme.border,
    ['--agent-foreground' as string]: theme.foreground,
    ['--agent-focus' as string]: theme.focusBorder,
    ['--agent-button' as string]: theme.buttonBackground,
    ['--agent-button-foreground' as string]: theme.buttonForeground
  } as React.CSSProperties;

  const startScan = () => onPostMessage({ type: 'startAgentScan', payload: { machineId } });
  const cancelScan = () => onPostMessage({ type: 'cancelAgentScan', payload: { machineId } });

  return (
    <ModalSurface
      id="agent-assets"
      labelId="agent-assets-title"
      onRequestClose={onClose}
      maxWidth="1440px"
      className="agent-assets-modal"
      overlayClassName="agent-assets-viewport"
    >
      <div className="agent-assets" style={panelStyle}>
        <header className="agent-assets__header">
          <div className="agent-assets__title-block">
            <span className="agent-assets__mark"><AgentAssetsIcon /></span>
            <div>
              <div className="agent-assets__eyebrow">
                Environment inventory
                {demoMode && <span className="demo-mode-badge">Demo data</span>}
              </div>
              <h2 id="agent-assets-title">Agent Assets</h2>
              <p>Skills, MCP configurations, and settings visible to Codex, Claude Code, and Cursor.</p>
            </div>
          </div>
          <div className="agent-assets__header-actions">
            {isScanning ? (
              <button className="agent-assets__button agent-assets__button--secondary" onClick={cancelScan}>Cancel</button>
            ) : (
              <button className="agent-assets__button agent-assets__button--primary" onClick={startScan} disabled={!machine}>
                {summary?.scannedAt ? 'Refresh machine' : 'Scan machine'}
              </button>
            )}
            <button className="agent-assets__icon-button" onClick={onClose} aria-label="Close Agent Assets">×</button>
          </div>
        </header>

        <div className="agent-assets__body">
          <aside className="agent-assets__sidebar" aria-label="Machines">
            <div className="agent-assets__section-label">Machines</div>
            <div className="agent-assets__machine-list">
              {(inventory?.machines ?? []).map(candidate => {
                const candidateSummary = inventory?.summaries.find(item => item.machineId === candidate.id);
                return (
                  <button
                    key={candidate.id}
                    className="agent-assets__machine"
                    data-active={candidate.id === machineId}
                    onClick={() => setMachineId(candidate.id)}
                  >
                    <span className="agent-assets__machine-icon" aria-hidden="true">
                      {candidate.kind === 'local' ? '●' : '⌁'}
                    </span>
                    <span className="agent-assets__machine-copy">
                      <strong>{candidate.label}</strong>
                      <small>
                        {candidate.kind === 'local' ? 'Local machine' : 'SSH Host'}
                        {candidate.isCurrent ? ' · Current window' : ''}
                      </small>
                    </span>
                    <span
                      className="agent-assets__status-dot"
                      data-tone={statusTone(candidateSummary?.status ?? 'never')}
                      title={statusLabel[candidateSummary?.status ?? 'never']}
                    />
                  </button>
                );
              })}
            </div>
            <div className="agent-assets__read-only">
              <span aria-hidden="true">◇</span>
              <div><strong>Read-only inventory</strong><br />No files are moved or synchronized.</div>
            </div>
          </aside>

          <main className="agent-assets__main">
            <section className="agent-assets__machine-header">
              <div>
                <div className="agent-assets__eyebrow">{machine?.kind === 'ssh' ? 'Remote environment' : 'Local environment'}</div>
                <h3>{machine?.label ?? 'Loading machines…'}</h3>
                <p>
                  {machine?.isCurrent ? 'Current window' : 'Different window'} ·{' '}
                  {summary?.status === 'error'
                    ? `Last attempt ${timeLabel(summary.attemptedAt)}`
                    : `${statusLabel[summary?.status ?? 'never']} · ${timeLabel(summary?.scannedAt)}`}
                </p>
              </div>
              <span className="agent-assets__status" data-tone={statusTone(summary?.status ?? 'never')}>
                {statusLabel[summary?.status ?? 'never']}
              </span>
            </section>

            {isScanning && (
              <section className="agent-assets__progress" aria-live="polite">
                <div className="agent-assets__progress-copy">
                  <span>{activeProgress?.stage === 'connecting' ? 'Connecting' : activeProgress?.stage === 'saving' ? 'Saving snapshot' : 'Scanning known roots'}</span>
                  <strong>{activeProgress?.completed ?? 0}/{activeProgress?.total ?? '…'}</strong>
                </div>
                <div className="agent-assets__progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
                <small>{activeProgress?.currentLabel ?? 'Preparing scan plan…'}</small>
              </section>
            )}

            {operationResult && (
              <div className="agent-assets__feedback" data-success={operationResult.success}>
                {operationResult.message}
              </div>
            )}

            {isRecoverableHostError && machine?.hostId && (
              <section className="agent-assets__recovery" data-kind={summary?.errorKind ?? 'scan'}>
                <div className="agent-assets__recovery-copy">
                  <strong>
                    {summary?.errorKind === 'host-key'
                      ? 'The saved host key no longer matches'
                      : summary?.errorKind === 'authentication'
                        ? 'SSH key authentication is required'
                        : summary?.errorKind === 'runtime'
                          ? 'The remote scanner could not start'
                          : 'Project Pilot could not connect to this Host'}
                  </strong>
                  <p>{summary?.errors[0] ?? 'Check the SSH Host connection and try again.'}</p>
                </div>
                <div className="agent-assets__recovery-actions">
                  <button onClick={startScan}>Retry scan</button>
                  {summary?.errorKind === 'authentication' && (
                    <button onClick={() => onPrepareSshRecovery(machine.hostId!, 'key-login')}>Set up key login</button>
                  )}
                  {summary?.errorKind === 'host-key' && (
                    <button onClick={() => onPrepareSshRecovery(machine.hostId!, 'known-host')}>Repair known_hosts</button>
                  )}
                  <button className="agent-assets__recovery-primary" onClick={() => onManageSshHost(machine.hostId!)}>
                    Manage SSH Host
                  </button>
                </div>
              </section>
            )}

            {(summary?.errors.length ?? 0) > 0 && !isRecoverableHostError && (
              <details className="agent-assets__errors">
                <summary>{summary!.errors.length} scan issue{summary!.errors.length === 1 ? '' : 's'}</summary>
                <ul>{summary!.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>
              </details>
            )}

            <section className="agent-assets__metrics">
              {([
                ['skill', 'Skills', summary?.skillCount ?? 0],
                ['mcp', 'MCP', summary?.mcpCount ?? machineAssets.filter(asset => asset.kind === 'mcp').length],
                ['settings', 'Settings', summary?.settingsCount ?? 0]
              ] as const).map(([id, label, count]) => (
                <button key={id} type="button" data-active={assetTab === id} onClick={() => setAssetTab(id)}>
                  <span>{label}</span><strong>{count}</strong>
                </button>
              ))}
              <div className="agent-assets__issues"><span>Issues</span><strong>{issueCount}</strong></div>
            </section>

            <section className="agent-assets__filters">
              <div className="agent-assets__provider-tabs" role="group" aria-label="Filter by provider">
                {providerOptions.map(option => (
                  <button key={option.id} data-active={provider === option.id} onClick={() => setProvider(option.id)}>
                    {option.label}
                  </button>
                ))}
              </div>
              <select value={scope} onChange={event => setScope(event.target.value as ScopeFilter)} aria-label="Filter by scope">
                <option value="all">All scopes</option>
                <option value="global">Global</option>
                <option value="project">Project</option>
              </select>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter assets…" aria-label="Filter assets" />
            </section>

            <section className="agent-assets__list" aria-label="Agent assets">
              {filteredAssets.length === 0 ? (
                <div className="agent-assets__empty">
                  <span aria-hidden="true">◎</span>
                  <strong>{summary?.status === 'never' ? 'Scan this machine to build its inventory' : `No matching ${assetTab === 'skill' ? 'skills' : assetTab === 'mcp' ? 'MCP configurations' : 'settings'}`}</strong>
                  <p>{summary?.status === 'never' ? 'Only known Agent directories and managed project roots will be inspected.' : 'Try another provider, scope, or search term.'}</p>
                </div>
              ) : filteredAssets.map(asset => {
                const visibleBindings = asset.bindings.filter(binding =>
                  (provider === 'all' || binding.providerId === provider)
                  && (scope === 'all' || binding.scope === scope)
                );
                const launchBinding = visibleBindings[0];
                const canLaunch = asset.kind === 'skill'
                  && machine?.isCurrent
                  && Boolean(launchBinding);
                return (
                  <article key={asset.id} className="agent-assets__asset" data-status={asset.status}>
                    <div className="agent-assets__asset-icon" data-kind={asset.kind} aria-hidden="true">
                      {asset.kind === 'skill' ? 'S' : asset.kind === 'mcp' ? 'M' : '⚙'}
                    </div>
                    <div className="agent-assets__asset-content">
                      <div className="agent-assets__asset-title">
                        <strong>{asset.name}</strong>
                        <span className="agent-assets__kind">{asset.kind === 'mcp' ? 'MCP server' : asset.kind}</span>
                        {asset.bindings.length > 1 && <span className="agent-assets__shared">Shared · {asset.bindings.length}</span>}
                        {asset.isSymlink && <span className="agent-assets__shared">Linked</span>}
                        {asset.status !== 'ready' && <span className="agent-assets__problem">{asset.status}</span>}
                      </div>
                      {asset.description && <p>{asset.description}</p>}
                      {asset.statusMessage && <p className="agent-assets__problem-copy">{asset.statusMessage}</p>}
                      {asset.kind === 'mcp' && asset.mcp && (
                        <div className="agent-assets__mcp-details">
                          <span className="agent-assets__mcp-pill">{asset.mcp.transport.toUpperCase()}</span>
                          {(asset.mcp.enabled !== undefined || asset.status === 'ready') && (
                            <span className="agent-assets__mcp-pill" data-disabled={asset.mcp.enabled === false}>
                              {asset.mcp.enabled === false ? 'Disabled' : asset.mcp.enabled === true ? 'Enabled' : 'Default on'}
                            </span>
                          )}
                          {asset.mcp.command && (
                            <span className="agent-assets__mcp-endpoint">
                              <strong>Command</strong>
                              <code>{[asset.mcp.command, ...(asset.mcp.args ?? [])].join(' ')}{asset.mcp.argsTruncated ? ' …' : ''}</code>
                            </span>
                          )}
                          {asset.mcp.url && (
                            <span className="agent-assets__mcp-endpoint">
                              <strong>URL</strong><code>{asset.mcp.url}</code>
                            </span>
                          )}
                          {(asset.mcp.envKeys?.length ?? 0) > 0 && (
                            <span className="agent-assets__mcp-meta">Env: {asset.mcp.envKeys!.join(', ')}</span>
                          )}
                          {(asset.mcp.headerKeys?.length ?? 0) > 0 && (
                            <span className="agent-assets__mcp-meta">Headers: {asset.mcp.headerKeys!.join(', ')}</span>
                          )}
                          {asset.mcp.authEnvKey && (
                            <span className="agent-assets__mcp-meta">Auth env: {asset.mcp.authEnvKey}</span>
                          )}
                        </div>
                      )}
                      <div className="agent-assets__bindings">
                        {visibleBindings.map(binding => (
                          <span key={binding.key}>
                            {binding.providerLabel} · {binding.projectName ?? binding.scope}
                          </span>
                        ))}
                      </div>
                      <code title={asset.path}>{asset.path}</code>
                    </div>
                    <div className="agent-assets__asset-actions">
                      <button onClick={() => onPostMessage({ type: 'openAgentAsset', payload: { assetId: asset.id } })}>
                        {asset.kind === 'skill' ? 'Open SKILL.md' : asset.kind === 'mcp' ? 'Open config' : 'Open settings'}
                      </button>
                      {canLaunch && launchBinding && (
                        <button
                          className="agent-assets__launch"
                          onClick={() => onPostMessage({
                            type: 'launchAgentAsset',
                            payload: { assetId: asset.id, bindingKey: launchBinding.key }
                          })}
                        >
                          Launch {launchBinding.providerLabel}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          </main>
        </div>
      </div>
    </ModalSurface>
  );
}
