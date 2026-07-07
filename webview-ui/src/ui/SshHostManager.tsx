import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ProjectItem,
  SshHost,
  SshHostDraft,
  SshHostOperationResult,
  SshHostTestResult
} from './model';
import {
  countHostReferences,
  formatSshHostAddress,
  getMigrationTargets,
  sshHostFromDraft,
  validateSshHostDraft
} from './sshHostManagerModel';

type Theme = Record<string, string>;

interface SshHostManagerProps {
  hosts: readonly SshHost[];
  projects: readonly ProjectItem[];
  theme: Theme;
  operationResult?: SshHostOperationResult | null;
  testResult?: SshHostTestResult | null;
  onPostMessage: (message: { type: string; payload?: unknown }) => void;
  onClose: () => void;
}

const emptyDraft = (): SshHostDraft => ({ name: '', hostname: '', username: '', port: '' });

const draftFromHost = (host: SshHost): SshHostDraft => ({
  name: host.name,
  hostname: host.hostname,
  username: host.username ?? '',
  port: host.port === undefined ? '' : String(host.port)
});

const alpha = (color: string, opacity: number): string => {
  const value = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    const r = Number.parseInt(value.slice(1, 3), 16);
    const g = Number.parseInt(value.slice(3, 5), 16);
    const b = Number.parseInt(value.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return value;
};

export default function SshHostManager({
  hosts,
  projects,
  theme,
  operationResult,
  testResult,
  onPostMessage,
  onClose
}: SshHostManagerProps) {
  const [draft, setDraft] = useState<SshHostDraft | null>(null);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [migrationSourceId, setMigrationSourceId] = useState<string | undefined>();
  const [migrationTargetId, setMigrationTargetId] = useState('');
  const [testingLabel, setTestingLabel] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const validationError = useMemo(
    () => draft ? validateSshHostDraft(draft, hosts, editingId) : null,
    [draft, editingId, hosts]
  );
  const migrationTargets = useMemo(
    () => migrationSourceId ? getMigrationTargets(hosts, migrationSourceId) : [],
    [hosts, migrationSourceId]
  );
  const cancelTransientOrClose = useCallback(() => {
    if (draft) {
      setDraft(null);
      setEditingId(undefined);
      return;
    }
    if (migrationSourceId) {
      setMigrationSourceId(undefined);
      setMigrationTargetId('');
      return;
    }
    onClose();
  }, [draft, migrationSourceId, onClose]);

  useEffect(() => {
    if (draft) {
      nameInputRef.current?.focus();
    }
  }, [draft, editingId]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cancelTransientOrClose();
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [cancelTransientOrClose]);

  useEffect(() => {
    if (operationResult?.success) {
      if (operationResult.operation === 'add' || operationResult.operation === 'update') {
        setDraft(null);
        setEditingId(undefined);
      }
      if (operationResult.operation === 'migrate') {
        setMigrationSourceId(undefined);
        setMigrationTargetId('');
      }
    }
  }, [operationResult]);

  const panelBackground = alpha(theme.primaryBackground, 0.96);
  const cardBackground = alpha(theme.secondaryBackground, 0.78);
  const borderColor = alpha(theme.border, 0.58);
  const inputStyle: React.CSSProperties = {
    backgroundColor: cardBackground,
    color: theme.inputForeground,
    borderColor: alpha(theme.inputBorder, 0.7)
  };
  const secondaryButtonStyle: React.CSSProperties = {
    backgroundColor: cardBackground,
    color: theme.inputForeground,
    borderColor: alpha(theme.inputBorder, 0.68)
  };

  const beginAdd = () => {
    setEditingId(undefined);
    setDraft(emptyDraft());
  };
  const beginEdit = (host: SshHost) => {
    setEditingId(host.id);
    setDraft(draftFromHost(host));
  };
  const submitDraft = () => {
    if (!draft || validationError) {
      return;
    }
    const id = editingId ?? globalThis.crypto?.randomUUID?.() ?? `ssh-host-${Date.now().toString(36)}`;
    const host = sshHostFromDraft(id, draft);
    onPostMessage({ type: editingId ? 'updateSshHost' : 'addSshHost', payload: host });
  };
  const testHost = (host: SshHost) => {
    setTestingLabel(host.name);
    onPostMessage({ type: 'testSshHost', payload: host });
  };
  const testDraft = () => {
    if (!draft || validationError) {
      return;
    }
    const host = sshHostFromDraft(editingId ?? 'ssh-host-probe', draft);
    setTestingLabel(host.name);
    onPostMessage({ type: 'testSshHost', payload: host });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] overflow-y-auto p-3 sm:p-5"
      style={{
        background: 'radial-gradient(circle at top, rgba(59,130,246,0.16), transparent 35%), rgba(3, 7, 18, 0.66)',
        backdropFilter: 'blur(18px)'
      }}
      onMouseDown={event => {
        if (event.target === event.currentTarget && !draft && !migrationSourceId) {
          onClose();
        }
      }}
    >
      <div className="min-h-full flex items-start justify-center py-3 sm:py-8">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="ssh-host-manager-title"
          className="glass-panel glow-border rounded-3xl border w-full max-w-4xl overflow-hidden"
          style={{ backgroundColor: panelBackground, borderColor }}
          onMouseDown={event => event.stopPropagation()}
        >
          <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 p-5 sm:p-6 border-b" style={{ borderColor }}>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 id="ssh-host-manager-title" className="text-xl font-semibold" style={{ color: theme.foreground }}>SSH Hosts</h2>
                <span className="stat-chip px-2.5 py-1 rounded-full text-xs" style={{ color: theme.foreground }}>
                  {hosts.length} configured
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-5" style={{ color: alpha(theme.foreground, 0.72) }}>
                Reuse connection details across projects. Updating a Host updates every linked project.
              </p>
            </div>
            <div className="flex gap-2">
              <button className="soft-button px-3.5 py-2 rounded-xl text-sm" style={{ backgroundColor: theme.buttonBackground, color: theme.buttonForeground }} onClick={beginAdd}>
                + Add Host
              </button>
              <button className="soft-button w-10 h-10 rounded-xl" style={secondaryButtonStyle} onClick={cancelTransientOrClose} title="Close SSH Host manager" aria-label="Close SSH Host manager">
                ×
              </button>
            </div>
          </header>

          <div className="p-5 sm:p-6 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
            {operationResult && (
              <div className="glass-card rounded-xl px-3.5 py-2.5 text-sm" style={{
                color: operationResult.success ? '#10b981' : '#ef4444',
                backgroundColor: alpha(operationResult.success ? '#10b981' : '#ef4444', 0.09),
                borderColor: alpha(operationResult.success ? '#10b981' : '#ef4444', 0.25)
              }}>
                {operationResult.success
                  ? `Host ${operationResult.operation} completed.`
                  : operationResult.message ?? `Host ${operationResult.operation} failed.`}
              </div>
            )}
            {testResult && (
              <div className="glass-card rounded-xl px-3.5 py-2.5 text-sm" style={{
                color: testResult.success ? '#10b981' : '#ef4444',
                backgroundColor: alpha(testResult.success ? '#10b981' : '#ef4444', 0.09),
                borderColor: alpha(testResult.success ? '#10b981' : '#ef4444', 0.25)
              }}>
                <span className="font-medium">{testingLabel ? `${testingLabel}: ` : ''}</span>{testResult.message}
                {testResult.resolution?.ip ? <span> · IP {testResult.resolution.ip}</span> : null}
                {testResult.resolution?.resolvedHostname && testResult.resolution.resolvedHostname !== testResult.resolution.host
                  ? <span> · {testResult.resolution.resolvedHostname}</span>
                  : null}
              </div>
            )}

            {draft && (
              <div className="glass-card rounded-2xl p-4 sm:p-5" style={{ backgroundColor: cardBackground, borderColor }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h3 className="font-semibold" style={{ color: theme.foreground }}>{editingId ? 'Edit Host' : 'Add Host'}</h3>
                  <button className="text-sm" style={{ color: alpha(theme.foreground, 0.68) }} onClick={() => { setDraft(null); setEditingId(undefined); }}>Cancel</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-sm" style={{ color: theme.foreground }}>
                    <span className="block mb-1">Name</span>
                    <input ref={nameInputRef} className="soft-input w-full px-3 py-2.5 border rounded-xl" style={inputStyle} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Build server" />
                  </label>
                  <label className="text-sm" style={{ color: theme.foreground }}>
                    <span className="block mb-1">Hostname / IP</span>
                    <input className="soft-input w-full px-3 py-2.5 border rounded-xl" style={inputStyle} value={draft.hostname} onChange={event => setDraft({ ...draft, hostname: event.target.value })} placeholder="host.example.com" />
                  </label>
                  <label className="text-sm" style={{ color: theme.foreground }}>
                    <span className="block mb-1">Username <span style={{ color: alpha(theme.foreground, 0.55) }}>(optional)</span></span>
                    <input className="soft-input w-full px-3 py-2.5 border rounded-xl" style={inputStyle} value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} placeholder="dev" />
                  </label>
                  <label className="text-sm" style={{ color: theme.foreground }}>
                    <span className="block mb-1">Port <span style={{ color: alpha(theme.foreground, 0.55) }}>(optional)</span></span>
                    <input inputMode="numeric" className="soft-input w-full px-3 py-2.5 border rounded-xl" style={inputStyle} value={draft.port} onChange={event => setDraft({ ...draft, port: event.target.value })} placeholder="22" />
                  </label>
                </div>
                {validationError && <p className="text-xs mt-3" style={{ color: '#f59e0b' }}>{validationError}</p>}
                <div className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
                  <button className="soft-button px-4 py-2.5 rounded-xl text-sm" style={secondaryButtonStyle} onClick={testDraft} disabled={!!validationError}>Test connection</button>
                  <button className="soft-button px-4 py-2.5 rounded-xl text-sm" style={{ backgroundColor: theme.buttonBackground, color: theme.buttonForeground, opacity: validationError ? 0.58 : 1 }} onClick={submitDraft} disabled={!!validationError}>
                    {editingId ? 'Save Host' : 'Create Host'}
                  </button>
                </div>
              </div>
            )}

            {migrationSourceId && (
              <div className="glass-card rounded-2xl p-4" style={{ backgroundColor: cardBackground, borderColor }}>
                <h3 className="font-semibold text-sm" style={{ color: theme.foreground }}>Migrate linked projects</h3>
                <p className="text-xs mt-1 mb-3" style={{ color: alpha(theme.foreground, 0.68) }}>
                  Move all projects linked to {hosts.find(host => host.id === migrationSourceId)?.name ?? 'this Host'}.
                </p>
                {migrationTargets.length ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select className="soft-input flex-1 px-3 py-2.5 border rounded-xl text-sm" style={inputStyle} value={migrationTargetId} onChange={event => setMigrationTargetId(event.target.value)}>
                      <option value="">Select destination Host</option>
                      {migrationTargets.map(host => <option key={host.id} value={host.id}>{host.name} · {formatSshHostAddress(host)}</option>)}
                    </select>
                    <button className="soft-button px-4 py-2.5 rounded-xl text-sm" style={{ backgroundColor: theme.buttonBackground, color: theme.buttonForeground, opacity: migrationTargetId ? 1 : 0.58 }} disabled={!migrationTargetId} onClick={() => onPostMessage({ type: 'migrateSshHostProjects', payload: { sourceId: migrationSourceId, targetId: migrationTargetId } })}>
                      Migrate projects
                    </button>
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: '#f59e0b' }}>Add another Host before migrating projects.</p>
                )}
              </div>
            )}

            {hosts.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed" style={{ borderColor, color: alpha(theme.foreground, 0.7) }}>
                <div className="text-3xl mb-3">⌁</div>
                <p className="font-medium" style={{ color: theme.foreground }}>No SSH Hosts yet</p>
                <p className="text-sm mt-1">Add one connection, then reuse it for any SSH project.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {hosts.map(host => {
                  const references = countHostReferences(projects, host.id);
                  return (
                    <article key={host.id} className="glass-card rounded-2xl p-4" style={{ backgroundColor: cardBackground, borderColor }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold truncate" style={{ color: theme.foreground }}>{host.name}</h3>
                          <p className="mt-1 text-sm font-mono break-all" style={{ color: alpha(theme.foreground, 0.74) }}>{formatSshHostAddress(host)}</p>
                        </div>
                        <span className="stat-chip shrink-0 px-2.5 py-1 rounded-full text-xs" style={{ color: theme.foreground }}>
                          {references} {references === 1 ? 'project' : 'projects'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <button className="soft-button px-3 py-2 rounded-xl text-xs" style={secondaryButtonStyle} onClick={() => beginEdit(host)}>Edit</button>
                        <button className="soft-button px-3 py-2 rounded-xl text-xs" style={secondaryButtonStyle} onClick={() => testHost(host)}>Test</button>
                        {references > 0 && (
                          <button className="soft-button px-3 py-2 rounded-xl text-xs" style={secondaryButtonStyle} onClick={() => { setMigrationSourceId(host.id); setMigrationTargetId(''); }}>Migrate</button>
                        )}
                        <button
                          className="soft-button px-3 py-2 rounded-xl text-xs ml-auto"
                          style={{ ...secondaryButtonStyle, color: references ? alpha(theme.foreground, 0.45) : '#ef4444', cursor: references ? 'not-allowed' : 'pointer' }}
                          disabled={references > 0}
                          title={references ? 'Migrate or unlink referenced projects before deleting this Host' : 'Delete Host'}
                          onClick={() => {
                            if (!references && window.confirm(`Delete SSH Host "${host.name}"?`)) {
                              onPostMessage({ type: 'deleteSshHost', payload: { id: host.id } });
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}
