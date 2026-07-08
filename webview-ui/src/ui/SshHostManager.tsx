import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModalSurface } from './ModalHost';
import type {
  ProjectItem,
  SshHost,
  SshHostDraft,
  SshHostOperation,
  SshHostOperationResult,
  SshHostTestResult
} from './model';
import {
  countHostReferences,
  formatSshHostAddress,
  getHostDraftFocusKey,
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
  onPostMessage: (message: { type: string; payload?: unknown; requestId?: string }) => void;
  onClose: () => void;
}

const emptyDraft = (): SshHostDraft => ({ name: '', hostname: '', username: '', port: '' });

let requestSequence = 0;

const createRequestId = (kind: 'probe' | 'mutation'): string => {
  requestSequence += 1;
  const uniquePart = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
  return `ssh-host-${kind}-${uniquePart}`;
};

interface PendingProbe {
  requestId: string;
  hostId: string;
  label: string;
}

interface PendingMutation {
  requestId: string;
  operation: SshHostOperation;
  hostId: string;
  targetHostId?: string;
}

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
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | undefined>();
  const [pendingProbe, setPendingProbe] = useState<PendingProbe | null>(null);
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const [probeFeedback, setProbeFeedback] = useState<{ result: SshHostTestResult; label: string } | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<SshHostOperationResult | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  const validationError = useMemo(
    () => draft ? validateSshHostDraft(draft, hosts, editingId) : null,
    [draft, editingId, hosts]
  );
  const migrationTargets = useMemo(
    () => migrationSourceId ? getMigrationTargets(hosts, migrationSourceId) : [],
    [hosts, migrationSourceId]
  );
  const draftFocusKey = getHostDraftFocusKey(draft, editingId);
  const cancelTransientOrClose = useCallback(() => {
    if (pendingMutation) {
      return;
    }
    if (deleteCandidateId) {
      setDeleteCandidateId(undefined);
      return;
    }
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
  }, [deleteCandidateId, draft, migrationSourceId, onClose, pendingMutation]);

  useEffect(() => {
    initialFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    if (draftFocusKey) {
      nameInputRef.current?.focus();
    }
  }, [draftFocusKey]);

  useEffect(() => {
    if (
      !operationResult
      || !pendingMutation
      || operationResult.requestId !== pendingMutation.requestId
      || operationResult.operation !== pendingMutation.operation
      || (operationResult.hostId !== undefined && operationResult.hostId !== pendingMutation.hostId)
      || (
        operationResult.targetHostId !== undefined
        && operationResult.targetHostId !== pendingMutation.targetHostId
      )
    ) {
      return;
    }

    setOperationFeedback(operationResult);
    setPendingMutation(null);
    if (operationResult.success) {
      if (operationResult.operation === 'add' || operationResult.operation === 'update') {
        setDraft(null);
        setEditingId(undefined);
      }
      if (operationResult.operation === 'migrate') {
        setMigrationSourceId(undefined);
        setMigrationTargetId('');
      }
    }
  }, [operationResult, pendingMutation]);

  useEffect(() => {
    if (
      !testResult
      || !pendingProbe
      || testResult.requestId !== pendingProbe.requestId
      || (testResult.hostId !== undefined && testResult.hostId !== pendingProbe.hostId)
    ) {
      return;
    }
    setProbeFeedback({ result: testResult, label: pendingProbe.label });
    setPendingProbe(null);
  }, [pendingProbe, testResult]);

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
    if (pendingMutation) {
      return;
    }
    setEditingId(undefined);
    setDraft(emptyDraft());
  };
  const beginEdit = (host: SshHost) => {
    if (pendingMutation) {
      return;
    }
    setEditingId(host.id);
    setDraft(draftFromHost(host));
  };
  const postMutation = (
    type: string,
    payload: unknown,
    operation: SshHostOperation,
    hostId: string,
    targetHostId?: string
  ) => {
    if (pendingMutation) {
      return;
    }
    const requestId = createRequestId('mutation');
    setOperationFeedback(null);
    setPendingMutation({ requestId, operation, hostId, targetHostId });
    onPostMessage({ type, payload, requestId });
  };
  const submitDraft = () => {
    if (!draft || validationError || pendingMutation) {
      return;
    }
    const id = editingId ?? globalThis.crypto?.randomUUID?.() ?? `ssh-host-${Date.now().toString(36)}`;
    const host = sshHostFromDraft(id, draft);
    postMutation(
      editingId ? 'updateSshHost' : 'addSshHost',
      host,
      editingId ? 'update' : 'add',
      host.id
    );
  };
  const testHost = (host: SshHost) => {
    if (pendingProbe) {
      return;
    }
    const requestId = createRequestId('probe');
    setProbeFeedback(null);
    setPendingProbe({ requestId, hostId: host.id, label: host.name });
    onPostMessage({ type: 'testSshHost', payload: host, requestId });
  };
  const testDraft = () => {
    if (!draft || validationError || pendingProbe) {
      return;
    }
    const host = sshHostFromDraft(editingId ?? 'ssh-host-probe', draft);
    const requestId = createRequestId('probe');
    setProbeFeedback(null);
    setPendingProbe({ requestId, hostId: host.id, label: host.name });
    onPostMessage({ type: 'testSshHost', payload: host, requestId });
  };

  return (
    <ModalSurface
      id="ssh-host-manager"
      labelId="ssh-host-manager-title"
      onRequestClose={cancelTransientOrClose}
      dismissible={!pendingMutation}
      maxWidth="1024px"
      className="ssh-host-modal"
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
              <button ref={initialFocusRef} className="soft-button px-3.5 py-2 rounded-xl text-sm" style={{ backgroundColor: theme.buttonBackground, color: theme.buttonForeground, opacity: pendingMutation ? 0.58 : 1 }} onClick={beginAdd} disabled={Boolean(pendingMutation)}>
                + Add Host
              </button>
              <button className="soft-button w-10 h-10 rounded-xl" style={secondaryButtonStyle} onClick={cancelTransientOrClose} title="Close SSH Host manager" aria-label="Close SSH Host manager">
                ×
              </button>
            </div>
          </header>

          <div className="modal-body p-5 sm:p-6 space-y-4" aria-busy={Boolean(pendingMutation || pendingProbe)} style={{ backgroundColor: panelBackground }}>
            {operationFeedback && (
              <div aria-live="polite" className="glass-card rounded-xl px-3.5 py-2.5 text-sm" style={{
                color: operationFeedback.success ? '#10b981' : '#ef4444',
                backgroundColor: alpha(operationFeedback.success ? '#10b981' : '#ef4444', 0.09),
                borderColor: alpha(operationFeedback.success ? '#10b981' : '#ef4444', 0.25)
              }}>
                {operationFeedback.success
                  ? `Host ${operationFeedback.operation} completed.`
                  : operationFeedback.message ?? `Host ${operationFeedback.operation} failed.`}
              </div>
            )}
            {probeFeedback && (
              <div aria-live="polite" className="glass-card rounded-xl px-3.5 py-2.5 text-sm" style={{
                color: probeFeedback.result.success ? '#10b981' : '#ef4444',
                backgroundColor: alpha(probeFeedback.result.success ? '#10b981' : '#ef4444', 0.09),
                borderColor: alpha(probeFeedback.result.success ? '#10b981' : '#ef4444', 0.25)
              }}>
                <span className="font-medium">{probeFeedback.label}: </span>{probeFeedback.result.message}
                {probeFeedback.result.resolution?.ip ? <span> · IP {probeFeedback.result.resolution.ip}</span> : null}
                {probeFeedback.result.resolution?.resolvedHostname && probeFeedback.result.resolution.resolvedHostname !== probeFeedback.result.resolution.host
                  ? <span> · {probeFeedback.result.resolution.resolvedHostname}</span>
                  : null}
              </div>
            )}
            {(pendingMutation || pendingProbe) && (
              <div aria-live="polite" className="text-xs" style={{ color: alpha(theme.foreground, 0.68) }}>
                {pendingMutation ? `Host ${pendingMutation.operation} in progress…` : `Testing ${pendingProbe?.label}…`}
              </div>
            )}

            {draft && (
              <div className="glass-card rounded-2xl p-4 sm:p-5" style={{ backgroundColor: cardBackground, borderColor }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h3 className="font-semibold" style={{ color: theme.foreground }}>{editingId ? 'Edit Host' : 'Add Host'}</h3>
                  <button className="text-sm" style={{ color: alpha(theme.foreground, 0.68) }} onClick={() => { setDraft(null); setEditingId(undefined); }} disabled={Boolean(pendingMutation)}>Cancel</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-sm" style={{ color: theme.foreground }}>
                    <span className="block mb-1">Name</span>
                    <input ref={nameInputRef} className="soft-input w-full px-3 py-2.5 border rounded-xl" style={inputStyle} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Build server" disabled={Boolean(pendingMutation)} />
                  </label>
                  <label className="text-sm" style={{ color: theme.foreground }}>
                    <span className="block mb-1">Hostname / IP</span>
                    <input className="soft-input w-full px-3 py-2.5 border rounded-xl" style={inputStyle} value={draft.hostname} onChange={event => setDraft({ ...draft, hostname: event.target.value })} placeholder="host.example.com" disabled={Boolean(pendingMutation)} />
                  </label>
                  <label className="text-sm" style={{ color: theme.foreground }}>
                    <span className="block mb-1">Username <span style={{ color: alpha(theme.foreground, 0.55) }}>(optional)</span></span>
                    <input className="soft-input w-full px-3 py-2.5 border rounded-xl" style={inputStyle} value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} placeholder="dev" disabled={Boolean(pendingMutation)} />
                  </label>
                  <label className="text-sm" style={{ color: theme.foreground }}>
                    <span className="block mb-1">Port <span style={{ color: alpha(theme.foreground, 0.55) }}>(optional)</span></span>
                    <input inputMode="numeric" className="soft-input w-full px-3 py-2.5 border rounded-xl" style={inputStyle} value={draft.port} onChange={event => setDraft({ ...draft, port: event.target.value })} placeholder="22" disabled={Boolean(pendingMutation)} />
                  </label>
                </div>
                {validationError && <p className="text-xs mt-3" style={{ color: '#f59e0b' }}>{validationError}</p>}
                <div className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
                  <button className="soft-button px-4 py-2.5 rounded-xl text-sm" style={secondaryButtonStyle} onClick={testDraft} disabled={Boolean(validationError || pendingProbe || pendingMutation)}>{pendingProbe ? 'Testing…' : 'Test connection'}</button>
                  <button className="soft-button px-4 py-2.5 rounded-xl text-sm" style={{ backgroundColor: theme.buttonBackground, color: theme.buttonForeground, opacity: validationError || pendingMutation ? 0.58 : 1 }} onClick={submitDraft} disabled={Boolean(validationError || pendingMutation)}>
                    {pendingMutation && (pendingMutation.operation === 'add' || pendingMutation.operation === 'update') ? 'Saving…' : editingId ? 'Save Host' : 'Create Host'}
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
                    <select className="soft-input flex-1 px-3 py-2.5 border rounded-xl text-sm" style={inputStyle} value={migrationTargetId} onChange={event => setMigrationTargetId(event.target.value)} disabled={Boolean(pendingMutation)}>
                      <option value="">Select destination Host</option>
                      {migrationTargets.map(host => <option key={host.id} value={host.id}>{host.name} · {formatSshHostAddress(host)}</option>)}
                    </select>
                    <button className="soft-button px-4 py-2.5 rounded-xl text-sm" style={{ backgroundColor: theme.buttonBackground, color: theme.buttonForeground, opacity: migrationTargetId && !pendingMutation ? 1 : 0.58 }} disabled={!migrationTargetId || Boolean(pendingMutation)} onClick={() => postMutation(
                      'migrateSshHostProjects',
                      { sourceId: migrationSourceId, targetId: migrationTargetId },
                      'migrate',
                      migrationSourceId,
                      migrationTargetId
                    )}>
                      {pendingMutation?.operation === 'migrate' ? 'Migrating…' : 'Migrate projects'}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: '#f59e0b' }}>Add another Host before migrating projects.</p>
                )}
              </div>
            )}

            {hosts.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed" style={{ borderColor, color: alpha(theme.foreground, 0.7) }}>
                <svg className="w-8 h-8 mx-auto mb-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
                  <rect x="2.5" y="3" width="15" height="11" rx="2" strokeWidth="1.5" />
                  <path d="m6 7 2 2-2 2m4.5 0h3M7 17h6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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
                        <button className="soft-button px-3 py-2 rounded-xl text-xs" style={secondaryButtonStyle} onClick={() => beginEdit(host)} disabled={Boolean(pendingMutation)}>Edit</button>
                        <button className="soft-button px-3 py-2 rounded-xl text-xs" style={secondaryButtonStyle} onClick={() => testHost(host)} disabled={Boolean(pendingProbe || pendingMutation)}>
                          {pendingProbe?.hostId === host.id ? 'Testing…' : 'Test'}
                        </button>
                        {references > 0 && (
                          <button className="soft-button px-3 py-2 rounded-xl text-xs" style={secondaryButtonStyle} onClick={() => { setMigrationSourceId(host.id); setMigrationTargetId(''); }} disabled={Boolean(pendingMutation)}>Migrate</button>
                        )}
                        <button
                          className="soft-button px-3 py-2 rounded-xl text-xs ml-auto"
                          style={{ ...secondaryButtonStyle, color: references ? alpha(theme.foreground, 0.45) : '#ef4444', cursor: references ? 'not-allowed' : 'pointer' }}
                          disabled={references > 0 || Boolean(pendingMutation)}
                          title={references ? 'Migrate or unlink referenced projects before deleting this Host' : 'Delete Host'}
                          onClick={() => !references && setDeleteCandidateId(host.id)}
                        >
                          Delete
                        </button>
                      </div>
                      {deleteCandidateId === host.id && (
                        <div className="mt-3 rounded-xl border p-3" style={{ borderColor: alpha('#ef4444', 0.38), backgroundColor: alpha('#ef4444', 0.08) }}>
                          <p className="text-sm" style={{ color: theme.foreground }}>Delete <strong>{host.name}</strong>? This cannot be undone.</p>
                          <div className="flex flex-wrap gap-2 mt-3">
                            <button className="soft-button px-3 py-2 rounded-lg text-xs" style={secondaryButtonStyle} onClick={() => setDeleteCandidateId(undefined)}>Cancel</button>
                            <button
                              className="soft-button px-3 py-2 rounded-lg text-xs"
                              style={{ backgroundColor: '#dc2626', color: '#fff' }}
                              onClick={() => {
                                setDeleteCandidateId(undefined);
                                postMutation('deleteSshHost', { id: host.id }, 'delete', host.id);
                              }}
                            >
                              Delete Host
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
    </ModalSurface>
  );
}
