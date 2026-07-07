import type { ConfigStore } from './store';
import type { SshHost } from './sshHosts';
import { testSshHostConnection, type SshProbeResult } from './sshResolve';

type HostStore = Pick<
  ConfigStore,
  'addSshHost' | 'updateSshHost' | 'deleteSshHost' | 'migrateSshHostProjects'
>;

type HostOperation = 'add' | 'update' | 'delete' | 'migrate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSshHost(value: unknown): value is SshHost {
  if (!isRecord(value)) {
    return false;
  }

  const port = value.port;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.hostname === 'string'
    && (value.username === undefined || typeof value.username === 'string')
    && (
      port === undefined
      || (typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535)
    );
}

function isIdPayload(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === 'string';
}

function isMigrationPayload(value: unknown): value is {
  sourceId: string;
  targetId: string;
  projectIds?: string[];
} {
  return isRecord(value)
    && typeof value.sourceId === 'string'
    && typeof value.targetId === 'string'
    && (
      value.projectIds === undefined
      || (Array.isArray(value.projectIds) && value.projectIds.every(id => typeof id === 'string'))
    );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function operationFailure(operation: HostOperation, message: string) {
  return {
    type: 'sshHostOperationResult',
    payload: { success: false, operation, message }
  };
}

async function runMutation(
  operation: HostOperation,
  mutation: () => Promise<void>
): Promise<{ type: string; payload: unknown }> {
  try {
    await mutation();
    return {
      type: 'sshHostOperationResult',
      payload: { success: true, operation }
    };
  } catch (error: unknown) {
    return operationFailure(operation, errorMessage(error));
  }
}

export async function handleSshHostMessage(
  msg: unknown,
  store: HostStore,
  probe: (host: SshHost) => Promise<SshProbeResult> = testSshHostConnection
): Promise<{ type: string; payload: unknown } | undefined> {
  if (!isRecord(msg) || typeof msg.type !== 'string') {
    return undefined;
  }

  switch (msg.type) {
    case 'addSshHost': {
      if (!isSshHost(msg.payload)) {
        return operationFailure('add', 'Invalid payload for addSshHost');
      }
      const payload = msg.payload;
      return runMutation('add', () => store.addSshHost(payload));
    }

    case 'updateSshHost': {
      if (!isSshHost(msg.payload)) {
        return operationFailure('update', 'Invalid payload for updateSshHost');
      }
      const payload = msg.payload;
      return runMutation('update', () => store.updateSshHost(payload));
    }

    case 'deleteSshHost': {
      if (!isIdPayload(msg.payload)) {
        return operationFailure('delete', 'Invalid payload for deleteSshHost');
      }
      const payload = msg.payload;
      return runMutation('delete', () => store.deleteSshHost(payload.id));
    }

    case 'migrateSshHostProjects': {
      if (!isMigrationPayload(msg.payload)) {
        return operationFailure('migrate', 'Invalid payload for migrateSshHostProjects');
      }
      const payload = msg.payload;
      return runMutation('migrate', () => store.migrateSshHostProjects(
        payload.sourceId,
        payload.targetId,
        payload.projectIds
      ));
    }

    case 'testSshHost': {
      if (!isSshHost(msg.payload)) {
        return {
          type: 'sshHostTestResult',
          payload: {
            success: false,
            code: 'remote-command',
            message: 'Invalid payload for testSshHost'
          }
        };
      }
      const payload = msg.payload;
      try {
        return { type: 'sshHostTestResult', payload: await probe(payload) };
      } catch (error: unknown) {
        return {
          type: 'sshHostTestResult',
          payload: {
            success: false,
            code: 'remote-command',
            message: errorMessage(error)
          }
        };
      }
    }

    default:
      return undefined;
  }
}
