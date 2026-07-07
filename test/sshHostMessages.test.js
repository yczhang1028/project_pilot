const assert = require('assert');
const { handleSshHostMessage } = require('../out/sshHostMessages');

const host = {
  id: 'host-1',
  name: 'Build host',
  hostname: 'build.example.com',
  username: 'builder',
  port: 2222
};

function createFakeStore(throwFor = {}) {
  const calls = {
    add: [],
    update: [],
    delete: [],
    migrate: []
  };

  const maybeThrow = operation => {
    if (Object.prototype.hasOwnProperty.call(throwFor, operation)) {
      throw throwFor[operation];
    }
  };

  return {
    calls,
    store: {
      async addSshHost(input) {
        calls.add.push(input);
        maybeThrow('add');
      },
      async updateSshHost(input) {
        calls.update.push(input);
        maybeThrow('update');
      },
      async deleteSshHost(id) {
        calls.delete.push(id);
        maybeThrow('delete');
      },
      async migrateSshHostProjects(sourceId, targetId, projectIds) {
        calls.migrate.push([sourceId, targetId, projectIds]);
        maybeThrow('migrate');
      }
    }
  };
}

function mutationCallCount(calls) {
  return Object.values(calls).reduce((total, operationCalls) => total + operationCalls.length, 0);
}

async function testMutationRouting() {
  const cases = [
    {
      message: { type: 'addSshHost', payload: host },
      operation: 'add',
      expectedCalls: [host]
    },
    {
      message: { type: 'updateSshHost', payload: host },
      operation: 'update',
      expectedCalls: [host]
    },
    {
      message: { type: 'deleteSshHost', payload: { id: 'host-1' } },
      operation: 'delete',
      expectedCalls: ['host-1']
    },
    {
      message: {
        type: 'migrateSshHostProjects',
        payload: { sourceId: 'host-1', targetId: 'host-2' }
      },
      operation: 'migrate',
      expectedCalls: [['host-1', 'host-2', undefined]]
    }
  ];

  for (const testCase of cases) {
    const fake = createFakeStore();
    let probeCalls = 0;
    const result = await handleSshHostMessage(testCase.message, fake.store, async () => {
      probeCalls += 1;
      throw new Error('probe should not run for mutations');
    });

    assert.deepStrictEqual(result, {
      type: 'sshHostOperationResult',
      payload: { success: true, operation: testCase.operation }
    });
    assert.deepStrictEqual(fake.calls[testCase.operation], testCase.expectedCalls);
    if (testCase.operation === 'add' || testCase.operation === 'update') {
      assert.notStrictEqual(
        fake.calls[testCase.operation][0],
        host,
        'passes a sanitized Host copy to the store'
      );
    }
    assert.strictEqual(mutationCallCount(fake.calls), 1, 'routes a mutation exactly once');
    assert.strictEqual(probeCalls, 0, 'does not probe while routing mutations');
  }
}

async function testSelectedMigrationRouting() {
  const fake = createFakeStore();
  const projectIds = ['project-1', 'project-2'];
  const result = await handleSshHostMessage({
    type: 'migrateSshHostProjects',
    payload: { sourceId: 'host-1', targetId: 'host-2', projectIds }
  }, fake.store);

  assert.deepStrictEqual(result, {
    type: 'sshHostOperationResult',
    payload: { success: true, operation: 'migrate' }
  });
  assert.deepStrictEqual(fake.calls.migrate, [['host-1', 'host-2', projectIds]]);
  assert.notStrictEqual(
    fake.calls.migrate[0][2],
    projectIds,
    'passes a fresh dense project ID array to the store'
  );
  assert.strictEqual(mutationCallCount(fake.calls), 1);
}

async function testProbeRouting() {
  const fake = createFakeStore();
  const probeResult = {
    success: true,
    code: 'ok',
    message: 'Connected.'
  };
  const probeCalls = [];
  const result = await handleSshHostMessage(
    { type: 'testSshHost', payload: host },
    fake.store,
    async input => {
      probeCalls.push(input);
      return probeResult;
    }
  );

  assert.deepStrictEqual(result, {
    type: 'sshHostTestResult',
    payload: probeResult
  });
  assert.deepStrictEqual(probeCalls, [host]);
  assert.notStrictEqual(probeCalls[0], host, 'passes a sanitized Host copy to the probe');
  assert.strictEqual(mutationCallCount(fake.calls), 0);
}

async function testCorrelatedRouting() {
  const cases = [
    {
      message: { type: 'addSshHost', requestId: 'request-add', payload: host },
      operation: 'add',
      hostId: 'host-1'
    },
    {
      message: { type: 'updateSshHost', requestId: 'request-update', payload: host },
      operation: 'update',
      hostId: 'host-1'
    },
    {
      message: { type: 'deleteSshHost', requestId: 'request-delete', payload: { id: 'host-1' } },
      operation: 'delete',
      hostId: 'host-1'
    },
    {
      message: {
        type: 'migrateSshHostProjects',
        requestId: 'request-migrate',
        payload: { sourceId: 'host-1', targetId: 'host-2' }
      },
      operation: 'migrate',
      hostId: 'host-1',
      targetHostId: 'host-2'
    }
  ];

  for (const testCase of cases) {
    const fake = createFakeStore();
    const result = await handleSshHostMessage(testCase.message, fake.store);
    assert.deepStrictEqual(result, {
      type: 'sshHostOperationResult',
      payload: {
        success: true,
        operation: testCase.operation,
        requestId: testCase.message.requestId,
        hostId: testCase.hostId,
        ...(testCase.targetHostId ? { targetHostId: testCase.targetHostId } : {})
      }
    });
    assert.strictEqual(mutationCallCount(fake.calls), 1);
  }

  const fake = createFakeStore();
  const probeResult = { success: true, code: 'ok', message: 'Connected.' };
  const result = await handleSshHostMessage({
    type: 'testSshHost',
    requestId: 'request-probe',
    payload: host
  }, fake.store, async () => probeResult);
  assert.deepStrictEqual(result, {
    type: 'sshHostTestResult',
    payload: {
      ...probeResult,
      requestId: 'request-probe',
      hostId: 'host-1'
    }
  });
}

async function testUnsafeRequestIdsFailSafely() {
  const messages = [
    { type: 'addSshHost', requestId: 42, payload: host },
    { type: 'addSshHost', requestId: '', payload: host },
    Object.defineProperty({ type: 'addSshHost', payload: host }, 'requestId', {
      get() {
        throw new Error('requestId unavailable');
      }
    })
  ];

  const inheritedDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'requestId');
  Object.defineProperty(Object.prototype, 'requestId', {
    configurable: true,
    value: 'inherited-request'
  });
  messages.push({ type: 'addSshHost', payload: host });

  try {
    for (const message of messages) {
      const fake = createFakeStore();
      const result = await handleSshHostMessage(message, fake.store);
      assert.deepStrictEqual(result, {
        type: 'sshHostOperationResult',
        payload: {
          success: false,
          operation: 'add',
          message: 'Invalid requestId for addSshHost'
        }
      });
      assert.strictEqual(mutationCallCount(fake.calls), 0, 'unsafe request IDs do not mutate');
    }
  } finally {
    if (inheritedDescriptor) {
      Object.defineProperty(Object.prototype, 'requestId', inheritedDescriptor);
    } else {
      delete Object.prototype.requestId;
    }
  }

  const fake = createFakeStore();
  let probeCalls = 0;
  const probeResult = await handleSshHostMessage({
    type: 'testSshHost',
    requestId: 99,
    payload: host
  }, fake.store, async () => {
    probeCalls += 1;
    return { success: true, code: 'ok', message: 'Connected.' };
  });
  assert.deepStrictEqual(probeResult, {
    type: 'sshHostTestResult',
    payload: {
      success: false,
      code: 'remote-command',
      message: 'Invalid requestId for testSshHost'
    }
  });
  assert.strictEqual(probeCalls, 0);
}

async function testInheritedEnvelopeFieldsAreIgnored() {
  const fake = createFakeStore();
  let probeCalls = 0;
  const message = Object.create({ type: 'addSshHost', payload: host });
  const result = await handleSshHostMessage(message, fake.store, async () => {
    probeCalls += 1;
    return { success: true, code: 'ok', message: 'Connected.' };
  });

  assert.strictEqual(result, undefined);
  assert.strictEqual(mutationCallCount(fake.calls), 0, 'inherited envelope fields do not mutate');
  assert.strictEqual(probeCalls, 0, 'inherited envelope fields do not probe');
}

async function testInheritedHostPayloadFieldsFailSafely() {
  const cases = [
    {
      type: 'addSshHost',
      expected: {
        type: 'sshHostOperationResult',
        payload: { success: false, operation: 'add', message: 'Invalid payload for addSshHost' }
      }
    },
    {
      type: 'updateSshHost',
      expected: {
        type: 'sshHostOperationResult',
        payload: { success: false, operation: 'update', message: 'Invalid payload for updateSshHost' }
      }
    },
    {
      type: 'testSshHost',
      expected: {
        type: 'sshHostTestResult',
        payload: { success: false, code: 'remote-command', message: 'Invalid payload for testSshHost' }
      }
    }
  ];

  for (const testCase of cases) {
    const fake = createFakeStore();
    let probeCalls = 0;
    const inheritedHost = Object.create(host);
    const result = await handleSshHostMessage(
      { type: testCase.type, payload: inheritedHost },
      fake.store,
      async () => {
        probeCalls += 1;
        return { success: true, code: 'ok', message: 'Connected.' };
      }
    );

    assert.deepStrictEqual(result, testCase.expected);
    assert.strictEqual(mutationCallCount(fake.calls), 0, `${testCase.type} does not mutate`);
    assert.strictEqual(probeCalls, 0, `${testCase.type} does not probe`);
  }
}

async function testInheritedIdentifierPayloadFieldsFailSafely() {
  const cases = [
    {
      message: { type: 'deleteSshHost', payload: Object.create({ id: 'host-1' }) },
      expected: {
        type: 'sshHostOperationResult',
        payload: { success: false, operation: 'delete', message: 'Invalid payload for deleteSshHost' }
      }
    },
    {
      message: {
        type: 'migrateSshHostProjects',
        payload: Object.create({ sourceId: 'host-1', targetId: 'host-2', projectIds: ['project-1'] })
      },
      expected: {
        type: 'sshHostOperationResult',
        payload: { success: false, operation: 'migrate', message: 'Invalid payload for migrateSshHostProjects' }
      }
    }
  ];

  for (const testCase of cases) {
    const fake = createFakeStore();
    let probeCalls = 0;
    const result = await handleSshHostMessage(testCase.message, fake.store, async () => {
      probeCalls += 1;
      return { success: true, code: 'ok', message: 'Connected.' };
    });

    assert.deepStrictEqual(result, testCase.expected);
    assert.strictEqual(mutationCallCount(fake.calls), 0, 'inherited payload fields do not mutate');
    assert.strictEqual(probeCalls, 0, 'inherited payload fields do not probe');
  }
}

async function testNullPrototypeOwnFieldsAreAccepted() {
  const fake = createFakeStore();
  const payload = Object.assign(Object.create(null), host);
  const message = Object.assign(Object.create(null), {
    type: 'addSshHost',
    payload
  });
  const result = await handleSshHostMessage(message, fake.store);

  assert.deepStrictEqual(result, {
    type: 'sshHostOperationResult',
    payload: { success: true, operation: 'add' }
  });
  assert.strictEqual(fake.calls.add.length, 1);
  assert.deepStrictEqual(fake.calls.add[0], host);
  assert.notStrictEqual(fake.calls.add[0], payload);
  assert.strictEqual(mutationCallCount(fake.calls), 1);
}

async function testUnknownAndInvalidEnvelopesAreIgnored() {
  const invalidEnvelopes = [undefined, null, 'addSshHost', 42, [], {}, { type: 42 }];
  const fake = createFakeStore();
  let probeCalls = 0;
  const probe = async () => {
    probeCalls += 1;
    return { success: true, code: 'ok', message: 'Connected.' };
  };

  for (const message of invalidEnvelopes) {
    assert.strictEqual(await handleSshHostMessage(message, fake.store, probe), undefined);
  }
  assert.strictEqual(
    await handleSshHostMessage({ type: 'unrelatedMessage', payload: host }, fake.store, probe),
    undefined
  );
  assert.strictEqual(mutationCallCount(fake.calls), 0);
  assert.strictEqual(probeCalls, 0);
}

async function testUnreadableEnvelopesAreIgnored() {
  const fake = createFakeStore();
  let probeCalls = 0;
  const probe = async () => {
    probeCalls += 1;
    return { success: true, code: 'ok', message: 'Connected.' };
  };
  const messages = [
    new Proxy({ type: 'addSshHost', payload: host }, {
      getPrototypeOf() {
        throw new Error('prototype unavailable');
      }
    }),
    new Proxy({ type: 'addSshHost', payload: host }, {
      getOwnPropertyDescriptor() {
        throw new Error('descriptor unavailable');
      }
    })
  ];

  for (const message of messages) {
    assert.strictEqual(await handleSshHostMessage(message, fake.store, probe), undefined);
  }
  assert.strictEqual(mutationCallCount(fake.calls), 0, 'unreadable envelopes do not mutate');
  assert.strictEqual(probeCalls, 0, 'unreadable envelopes do not probe');
}

async function testUnreadableRecognizedPayloadsFailSafely() {
  const cases = [
    {
      message: {
        type: 'deleteSshHost',
        payload: Object.defineProperty({}, 'id', {
          get() {
            throw new Error('id unavailable');
          }
        })
      },
      expected: {
        type: 'sshHostOperationResult',
        payload: { success: false, operation: 'delete', message: 'Invalid payload for deleteSshHost' }
      }
    },
    {
      message: {
        type: 'addSshHost',
        payload: Object.defineProperty({ ...host }, 'hostname', {
          get() {
            throw new Error('hostname unavailable');
          }
        })
      },
      expected: {
        type: 'sshHostOperationResult',
        payload: { success: false, operation: 'add', message: 'Invalid payload for addSshHost' }
      }
    },
    {
      message: {
        type: 'updateSshHost',
        payload: new Proxy({ ...host }, {
          getOwnPropertyDescriptor() {
            throw new Error('payload descriptor unavailable');
          }
        })
      },
      expected: {
        type: 'sshHostOperationResult',
        payload: { success: false, operation: 'update', message: 'Invalid payload for updateSshHost' }
      }
    }
  ];

  for (const testCase of cases) {
    const fake = createFakeStore();
    let probeCalls = 0;
    const result = await handleSshHostMessage(testCase.message, fake.store, async () => {
      probeCalls += 1;
      return { success: true, code: 'ok', message: 'Connected.' };
    });

    assert.deepStrictEqual(result, testCase.expected);
    assert.strictEqual(mutationCallCount(fake.calls), 0, 'unreadable payload does not mutate');
    assert.strictEqual(probeCalls, 0, 'unreadable payload does not probe');
  }
}

async function testSanitizedCopiesAvoidUnsafePropertyReads() {
  const fake = createFakeStore();
  const guardedHost = new Proxy({ ...host }, {
    get() {
      throw new Error('host values must come from descriptors');
    }
  });
  const guardedMessage = new Proxy({ type: 'addSshHost', payload: guardedHost }, {
    get() {
      throw new Error('envelope values must come from descriptors');
    }
  });

  const result = await handleSshHostMessage(guardedMessage, fake.store);

  assert.deepStrictEqual(result, {
    type: 'sshHostOperationResult',
    payload: { success: true, operation: 'add' }
  });
  assert.deepStrictEqual(fake.calls.add, [host]);
  assert.notStrictEqual(fake.calls.add[0], guardedHost, 'passes a sanitized Host copy to the store');

  const guardedProjectIds = new Proxy(['project-1', 'project-2'], {
    get() {
      throw new Error('project IDs must come from descriptors');
    }
  });
  const migrationResult = await handleSshHostMessage({
    type: 'migrateSshHostProjects',
    payload: {
      sourceId: 'host-1',
      targetId: 'host-2',
      projectIds: guardedProjectIds
    }
  }, fake.store);

  assert.deepStrictEqual(migrationResult, {
    type: 'sshHostOperationResult',
    payload: { success: true, operation: 'migrate' }
  });
  assert.deepStrictEqual(fake.calls.migrate, [[
    'host-1',
    'host-2',
    ['project-1', 'project-2']
  ]]);
  assert.notStrictEqual(fake.calls.migrate[0][2], guardedProjectIds);
}

async function testSparseAndInheritedProjectIdsFailSafely() {
  const sparseProjectIds = new Array(2);
  sparseProjectIds[0] = 'project-1';

  const inheritedProjectIds = new Array(1);
  const inheritedIndex = Object.create(Array.prototype);
  inheritedIndex[0] = 'project-1';
  Object.setPrototypeOf(inheritedProjectIds, inheritedIndex);

  for (const projectIds of [sparseProjectIds, inheritedProjectIds]) {
    const fake = createFakeStore();
    const result = await handleSshHostMessage({
      type: 'migrateSshHostProjects',
      payload: { sourceId: 'host-1', targetId: 'host-2', projectIds }
    }, fake.store);

    assert.deepStrictEqual(result, {
      type: 'sshHostOperationResult',
      payload: {
        success: false,
        operation: 'migrate',
        message: 'Invalid payload for migrateSshHostProjects'
      }
    });
    assert.strictEqual(mutationCallCount(fake.calls), 0, 'invalid project IDs do not mutate');
  }
}

async function testInvalidRecognizedPayloadsFailSafely() {
  const cases = [
    {
      message: { type: 'addSshHost', payload: null },
      resultType: 'sshHostOperationResult',
      payload: { success: false, operation: 'add', message: 'Invalid payload for addSshHost' }
    },
    {
      message: { type: 'updateSshHost', payload: { id: 'host-1', name: 'Missing hostname' } },
      resultType: 'sshHostOperationResult',
      payload: { success: false, operation: 'update', message: 'Invalid payload for updateSshHost' }
    },
    {
      message: { type: 'deleteSshHost', payload: { id: 17 } },
      resultType: 'sshHostOperationResult',
      payload: { success: false, operation: 'delete', message: 'Invalid payload for deleteSshHost' }
    },
    {
      message: {
        type: 'migrateSshHostProjects',
        payload: { sourceId: 'host-1', targetId: 'host-2', projectIds: ['project-1', 2] }
      },
      resultType: 'sshHostOperationResult',
      payload: { success: false, operation: 'migrate', message: 'Invalid payload for migrateSshHostProjects' }
    },
    {
      message: { type: 'testSshHost', payload: { ...host, port: '2222' } },
      resultType: 'sshHostTestResult',
      payload: { success: false, code: 'remote-command', message: 'Invalid payload for testSshHost' }
    }
  ];

  for (const testCase of cases) {
    const fake = createFakeStore();
    let probeCalls = 0;
    const result = await handleSshHostMessage(testCase.message, fake.store, async () => {
      probeCalls += 1;
      return { success: true, code: 'ok', message: 'Connected.' };
    });

    assert.deepStrictEqual(result, {
      type: testCase.resultType,
      payload: testCase.payload
    });
    assert.strictEqual(mutationCallCount(fake.calls), 0, 'invalid payload does not mutate');
    assert.strictEqual(probeCalls, 0, 'invalid payload does not probe');
  }
}

async function testMutationErrorsFailSafely() {
  const errorFake = createFakeStore({ add: new Error('duplicate Host') });
  const errorResult = await handleSshHostMessage(
    { type: 'addSshHost', payload: host },
    errorFake.store
  );
  assert.deepStrictEqual(errorResult, {
    type: 'sshHostOperationResult',
    payload: { success: false, operation: 'add', message: 'duplicate Host' }
  });
  assert.strictEqual(mutationCallCount(errorFake.calls), 1);

  const nonErrorFake = createFakeStore({ delete: 'delete rejected' });
  const nonErrorResult = await handleSshHostMessage(
    { type: 'deleteSshHost', payload: { id: 'host-1' } },
    nonErrorFake.store
  );
  assert.deepStrictEqual(nonErrorResult, {
    type: 'sshHostOperationResult',
    payload: { success: false, operation: 'delete', message: 'delete rejected' }
  });
  assert.strictEqual(mutationCallCount(nonErrorFake.calls), 1);

  const unstringifiable = {
    [Symbol.toPrimitive]() {
      throw new Error('cannot coerce');
    },
    toString() {
      throw new Error('cannot stringify');
    }
  };
  const unstringifiableFake = createFakeStore({ update: unstringifiable });
  const unstringifiableResult = await handleSshHostMessage(
    { type: 'updateSshHost', payload: host },
    unstringifiableFake.store
  );
  assert.deepStrictEqual(unstringifiableResult, {
    type: 'sshHostOperationResult',
    payload: { success: false, operation: 'update', message: 'Unknown error' }
  });
  assert.strictEqual(mutationCallCount(unstringifiableFake.calls), 1);

  const correlatedFake = createFakeStore({ update: new Error('update rejected') });
  const correlatedResult = await handleSshHostMessage(
    { type: 'updateSshHost', requestId: 'request-update-error', payload: host },
    correlatedFake.store
  );
  assert.deepStrictEqual(correlatedResult, {
    type: 'sshHostOperationResult',
    payload: {
      success: false,
      operation: 'update',
      message: 'update rejected',
      requestId: 'request-update-error',
      hostId: 'host-1'
    }
  });
}

async function testProbeErrorsFailSafely() {
  const fake = createFakeStore();
  let probeCalls = 0;
  const result = await handleSshHostMessage(
    { type: 'testSshHost', payload: host },
    fake.store,
    async () => {
      probeCalls += 1;
      throw new Error('ssh executable failed');
    }
  );

  assert.deepStrictEqual(result, {
    type: 'sshHostTestResult',
    payload: {
      success: false,
      code: 'remote-command',
      message: 'ssh executable failed'
    }
  });
  assert.strictEqual(probeCalls, 1);
  assert.strictEqual(mutationCallCount(fake.calls), 0);

  const correlatedResult = await handleSshHostMessage(
    { type: 'testSshHost', requestId: 'request-probe-error', payload: host },
    fake.store,
    async () => {
      throw new Error('correlated probe failed');
    }
  );
  assert.deepStrictEqual(correlatedResult, {
    type: 'sshHostTestResult',
    payload: {
      success: false,
      code: 'remote-command',
      message: 'correlated probe failed',
      requestId: 'request-probe-error',
      hostId: 'host-1'
    }
  });
}

async function run() {
  await testMutationRouting();
  await testSelectedMigrationRouting();
  await testProbeRouting();
  await testCorrelatedRouting();
  await testUnsafeRequestIdsFailSafely();
  await testInheritedEnvelopeFieldsAreIgnored();
  await testInheritedHostPayloadFieldsFailSafely();
  await testInheritedIdentifierPayloadFieldsFailSafely();
  await testNullPrototypeOwnFieldsAreAccepted();
  await testUnknownAndInvalidEnvelopesAreIgnored();
  await testUnreadableEnvelopesAreIgnored();
  await testUnreadableRecognizedPayloadsFailSafely();
  await testSanitizedCopiesAvoidUnsafePropertyReads();
  await testSparseAndInheritedProjectIdsFailSafely();
  await testInvalidRecognizedPayloadsFailSafely();
  await testMutationErrorsFailSafely();
  await testProbeErrorsFailSafely();
  console.log('sshHostMessages tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
