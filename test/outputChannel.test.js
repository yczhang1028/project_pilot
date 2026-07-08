const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'src', 'outputChannel.ts');
if (!fs.existsSync(sourcePath)) {
  assert.fail(`Expected output channel module to exist: ${sourcePath}`);
}

const source = fs.readFileSync(sourcePath, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
  reportDiagnostics: true
});
assert.equal(output.diagnostics?.length ?? 0, 0);

const lines = [];
let createCount = 0;
const channel = {
  appendLine(line) { lines.push(line); },
  dispose() {}
};
const vscode = {
  window: {
    createOutputChannel(name) {
      createCount += 1;
      assert.equal(name, 'Project Pilot');
      return channel;
    }
  }
};
const loadedModule = { exports: {} };
new Function('module', 'exports', 'require', output.outputText)(
  loadedModule,
  loadedModule.exports,
  request => request === 'vscode' ? vscode : require(request)
);
const logger = loadedModule.exports;
const context = { subscriptions: [] };

assert.equal(logger.initializeProjectPilotOutput(context), channel);
assert.equal(logger.initializeProjectPilotOutput(context), channel);
assert.equal(createCount, 1);
assert.deepEqual(context.subscriptions, [channel]);

const now = new Date('2026-07-08T08:00:00.000Z');
logger.writeProjectPilotOutput('INFO', 'Extension activated', now);
assert.equal(lines[0], '[2026-07-08T08:00:00.000Z] [INFO] Extension activated');

logger.logSshHostResult({
  type: 'sshHostTestResult',
  payload: { success: false, code: 'auth', hostId: 'spark3', message: 'authentication failed' }
}, now);
assert.match(lines[1], /\[WARN\] SSH Host test \[spark3\] \(auth\): authentication failed$/);

logger.logSshHostResult({
  type: 'sshHostOperationResult',
  payload: { success: true, operation: 'update', hostId: 'spark3' }
}, now);
assert.match(lines[2], /\[INFO\] SSH Host update \[spark3\] completed$/);

logger.logSshConnectionResult('Spark3 project', { success: false, message: 'authentication failed' }, now);
assert.match(lines[3], /\[WARN\] SSH connection test \[Spark3 project\]: authentication failed$/);

console.log('outputChannel tests passed');
