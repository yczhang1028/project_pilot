import * as vscode from 'vscode';
import { createDemoAgentInventory, createDemoProjectState } from './demoData';
import { materializeRuntimeProjects } from './sshProjectRuntime';
import type { ConfigStore } from './store';

export const DEMO_MODE_SETTING = 'demoMode';
export const DEMO_MODE_READ_ONLY_MESSAGE = 'Screenshot Demo Mode uses fictional read-only data. Disable it before changing or opening projects.';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function isDemoModeEnabled(): boolean {
  return vscode.workspace.getConfiguration('projectPilot').get(DEMO_MODE_SETTING, false);
}

export function getProjectPilotWebviewState(store: ConfigStore) {
  const configuration = vscode.workspace.getConfiguration('projectPilot');
  const autoOpenFullscreen = configuration.get('autoOpenFullscreen', true);
  const demoMode = configuration.get(DEMO_MODE_SETTING, false);

  if (!demoMode) {
    return {
      ...store.state,
      projects: materializeRuntimeProjects(store.state.projects, store.state.sshHosts),
      migrationWarnings: store.migrationWarnings,
      config: { autoOpenFullscreen, demoMode: false }
    };
  }

  const demoState = createDemoProjectState(store.state.uiSettings);
  return {
    ...demoState,
    projects: materializeRuntimeProjects(demoState.projects, demoState.sshHosts),
    migrationWarnings: [],
    config: { autoOpenFullscreen, demoMode: true }
  };
}

export async function handleDemoModeMessage(
  message: unknown,
  webview: vscode.Webview
): Promise<boolean> {
  if (!isDemoModeEnabled()) return false;

  const record = asRecord(message);
  const type = typeof record?.type === 'string' ? record.type : undefined;
  const payload = asRecord(record?.payload);
  if (!type || type === 'requestState' || type === 'openAgentAssetsEditor') return false;

  if (type === 'updateConfig' && payload?.demoMode === false) {
    return false;
  }

  if (type === 'requestAgentInventory') {
    await webview.postMessage({ type: 'agentInventorySnapshot', payload: createDemoAgentInventory() });
    return true;
  }

  if (type === 'startAgentScan') {
    const machineId = typeof payload?.machineId === 'string' ? payload.machineId : 'local';
    await webview.postMessage({
      type: 'agentScanProgress',
      payload: {
        scanId: `demo-${machineId}`,
        machineId,
        completed: 1,
        total: 1,
        stage: 'complete',
        currentLabel: 'Fictional demo inventory',
        message: 'Demo data refreshed without scanning a machine.'
      }
    });
    await webview.postMessage({ type: 'agentInventorySnapshot', payload: createDemoAgentInventory() });
    await webview.postMessage({
      type: 'agentAssetOperationResult',
      payload: { success: true, message: 'Demo inventory refreshed. No machine was scanned.' }
    });
    return true;
  }

  if (type === 'cancelAgentScan') return true;

  if (type === 'openAgentAsset' || type === 'launchAgentAsset') {
    await webview.postMessage({
      type: 'agentAssetOperationResult',
      payload: { success: false, message: DEMO_MODE_READ_ONLY_MESSAGE }
    });
    return true;
  }

  void vscode.window.showInformationMessage(DEMO_MODE_READ_ONLY_MESSAGE);
  return true;
}
