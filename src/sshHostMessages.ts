import type { ConfigStore } from './store';
import type { SshHost } from './sshHosts';
import { testSshHostConnection, type SshProbeResult } from './sshResolve';

type HostStore = Pick<
  ConfigStore,
  'addSshHost' | 'updateSshHost' | 'deleteSshHost' | 'migrateSshHostProjects'
>;

type HostOperation = 'add' | 'update' | 'delete' | 'migrate';

type OwnDataProperty =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: unknown };

const invalidProperty: OwnDataProperty = { kind: 'invalid' };

function asPlainRecord(value: unknown): object | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  try {
    if (Array.isArray(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value : undefined;
  } catch {
    return undefined;
  }
}

function readOwnDataProperty(record: object, key: PropertyKey): OwnDataProperty {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
      return { kind: 'missing' };
    }
    if (!('value' in descriptor)) {
      return invalidProperty;
    }
    return { kind: 'value', value: descriptor.value };
  } catch {
    return invalidProperty;
  }
}

export function getOwnMessageType(value: unknown): string | undefined {
  const record = asPlainRecord(value);
  if (!record) {
    return undefined;
  }

  const type = readOwnDataProperty(record, 'type');
  return type.kind === 'value' && typeof type.value === 'string'
    ? type.value
    : undefined;
}

function sanitizeSshHost(value: unknown): SshHost | undefined {
  const record = asPlainRecord(value);
  if (!record) {
    return undefined;
  }

  const id = readOwnDataProperty(record, 'id');
  const name = readOwnDataProperty(record, 'name');
  const hostname = readOwnDataProperty(record, 'hostname');
  const username = readOwnDataProperty(record, 'username');
  const port = readOwnDataProperty(record, 'port');
  if (
    id.kind !== 'value'
    || typeof id.value !== 'string'
    || name.kind !== 'value'
    || typeof name.value !== 'string'
    || hostname.kind !== 'value'
    || typeof hostname.value !== 'string'
    || username.kind === 'invalid'
    || port.kind === 'invalid'
  ) {
    return undefined;
  }

  const sanitized: SshHost = {
    id: id.value,
    name: name.value,
    hostname: hostname.value
  };
  if (username.kind === 'value') {
    if (typeof username.value !== 'string') {
      return undefined;
    }
    sanitized.username = username.value;
  }
  if (port.kind === 'value') {
    if (
      port.value !== undefined
      && (
        typeof port.value !== 'number'
        || !Number.isInteger(port.value)
        || port.value < 1
        || port.value > 65535
      )
    ) {
      return undefined;
    }
    sanitized.port = port.value;
  }
  return sanitized;
}

function sanitizeIdPayload(value: unknown): { id: string } | undefined {
  const record = asPlainRecord(value);
  if (!record) {
    return undefined;
  }

  const id = readOwnDataProperty(record, 'id');
  return id.kind === 'value' && typeof id.value === 'string'
    ? { id: id.value }
    : undefined;
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  try {
    if (!Array.isArray(value)) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const length = readOwnDataProperty(value, 'length');
  if (
    length.kind !== 'value'
    || typeof length.value !== 'number'
    || !Number.isInteger(length.value)
    || length.value < 0
  ) {
    return undefined;
  }

  const sanitized: string[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const item = readOwnDataProperty(value, String(index));
    if (item.kind !== 'value' || typeof item.value !== 'string') {
      return undefined;
    }
    sanitized.push(item.value);
  }
  return sanitized;
}

function sanitizeMigrationPayload(value: unknown): {
  sourceId: string;
  targetId: string;
  projectIds?: string[];
} | undefined {
  const record = asPlainRecord(value);
  if (!record) {
    return undefined;
  }

  const sourceId = readOwnDataProperty(record, 'sourceId');
  const targetId = readOwnDataProperty(record, 'targetId');
  const projectIds = readOwnDataProperty(record, 'projectIds');
  if (
    sourceId.kind !== 'value'
    || typeof sourceId.value !== 'string'
    || targetId.kind !== 'value'
    || typeof targetId.value !== 'string'
    || projectIds.kind === 'invalid'
  ) {
    return undefined;
  }

  if (projectIds.kind === 'missing') {
    return { sourceId: sourceId.value, targetId: targetId.value };
  }

  const sanitizedProjectIds = sanitizeStringArray(projectIds.value);
  return sanitizedProjectIds
    ? {
      sourceId: sourceId.value,
      targetId: targetId.value,
      projectIds: sanitizedProjectIds
    }
    : undefined;
}

function errorToMessage(error: unknown): string {
  try {
    if (error instanceof Error) {
      const message = error.message;
      if (typeof message === 'string') {
        return message;
      }
    }
  } catch {
    // Fall through to the generic coercion below.
  }

  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
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
    return operationFailure(operation, errorToMessage(error));
  }
}

export async function handleSshHostMessage(
  msg: unknown,
  store: HostStore,
  probe: (host: SshHost) => Promise<SshProbeResult> = testSshHostConnection
): Promise<{ type: string; payload: unknown } | undefined> {
  const type = getOwnMessageType(msg);
  if (type === undefined) {
    return undefined;
  }

  switch (type) {
    case 'addSshHost': {
      const payloadProperty = readOwnDataProperty(msg as object, 'payload');
      const payload = payloadProperty.kind === 'value'
        ? sanitizeSshHost(payloadProperty.value)
        : undefined;
      if (!payload) {
        return operationFailure('add', 'Invalid payload for addSshHost');
      }
      return runMutation('add', () => store.addSshHost(payload));
    }

    case 'updateSshHost': {
      const payloadProperty = readOwnDataProperty(msg as object, 'payload');
      const payload = payloadProperty.kind === 'value'
        ? sanitizeSshHost(payloadProperty.value)
        : undefined;
      if (!payload) {
        return operationFailure('update', 'Invalid payload for updateSshHost');
      }
      return runMutation('update', () => store.updateSshHost(payload));
    }

    case 'deleteSshHost': {
      const payloadProperty = readOwnDataProperty(msg as object, 'payload');
      const payload = payloadProperty.kind === 'value'
        ? sanitizeIdPayload(payloadProperty.value)
        : undefined;
      if (!payload) {
        return operationFailure('delete', 'Invalid payload for deleteSshHost');
      }
      return runMutation('delete', () => store.deleteSshHost(payload.id));
    }

    case 'migrateSshHostProjects': {
      const payloadProperty = readOwnDataProperty(msg as object, 'payload');
      const payload = payloadProperty.kind === 'value'
        ? sanitizeMigrationPayload(payloadProperty.value)
        : undefined;
      if (!payload) {
        return operationFailure('migrate', 'Invalid payload for migrateSshHostProjects');
      }
      return runMutation('migrate', () => store.migrateSshHostProjects(
        payload.sourceId,
        payload.targetId,
        payload.projectIds
      ));
    }

    case 'testSshHost': {
      const payloadProperty = readOwnDataProperty(msg as object, 'payload');
      const payload = payloadProperty.kind === 'value'
        ? sanitizeSshHost(payloadProperty.value)
        : undefined;
      if (!payload) {
        return {
          type: 'sshHostTestResult',
          payload: {
            success: false,
            code: 'remote-command',
            message: 'Invalid payload for testSshHost'
          }
        };
      }
      try {
        return { type: 'sshHostTestResult', payload: await probe(payload) };
      } catch (error: unknown) {
        return {
          type: 'sshHostTestResult',
          payload: {
            success: false,
            code: 'remote-command',
            message: errorToMessage(error)
          }
        };
      }
    }

    default:
      return undefined;
  }
}
