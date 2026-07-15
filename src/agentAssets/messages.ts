import * as vscode from 'vscode';
import { AgentAssetsService, type AgentAssetsEvent } from './inventoryService';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

const AGENT_ASSET_MESSAGE_TYPES = new Set([
  'requestAgentInventory',
  'startAgentScan',
  'cancelAgentScan',
  'openAgentAsset',
  'launchAgentAsset'
]);

export async function handleAgentAssetsMessage(
  message: unknown,
  webview: vscode.Webview,
  service: AgentAssetsService
): Promise<boolean> {
  const record = asRecord(message);
  const type = stringField(record, 'type');
  if (!type || !AGENT_ASSET_MESSAGE_TYPES.has(type)) {
    return false;
  }
  await service.init();
  const payload = asRecord(record?.payload);
  const sink = (event: AgentAssetsEvent) => webview.postMessage(event);

  if (type === 'requestAgentInventory') {
    await webview.postMessage({ type: 'agentInventorySnapshot', payload: service.getSnapshot() });
    return true;
  }
  if (type === 'startAgentScan') {
    const machineId = stringField(payload, 'machineId');
    if (!machineId) return true;
    await service.scan(machineId, sink);
    return true;
  }
  if (type === 'cancelAgentScan') {
    const machineId = stringField(payload, 'machineId');
    if (machineId) service.cancel(machineId);
    return true;
  }
  if (type === 'openAgentAsset') {
    const assetId = stringField(payload, 'assetId');
    if (!assetId) return true;
    try {
      const result = await service.openAsset(assetId);
      await sink({ type: 'agentAssetOperationResult', payload: { success: true, message: result } });
    } catch (error) {
      await sink({
        type: 'agentAssetOperationResult',
        payload: { success: false, message: error instanceof Error ? error.message : 'Could not open the asset.' }
      });
    }
    return true;
  }
  if (type === 'launchAgentAsset') {
    const assetId = stringField(payload, 'assetId');
    const bindingKey = stringField(payload, 'bindingKey');
    if (!assetId || !bindingKey) return true;
    try {
      const result = await service.launch(assetId, bindingKey);
      await sink({ type: 'agentAssetOperationResult', payload: { success: true, message: result } });
    } catch (error) {
      await sink({
        type: 'agentAssetOperationResult',
        payload: { success: false, message: error instanceof Error ? error.message : 'Could not launch the Agent.' }
      });
    }
    return true;
  }
  return false;
}
