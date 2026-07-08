const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(
  __dirname,
  '..',
  'webview-ui',
  'src',
  'ui',
  'performanceReady.ts'
);

if (!fs.existsSync(sourcePath)) {
  assert.fail(`Expected Webview performance module to exist: ${sourcePath}`);
}

const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  },
  fileName: sourcePath,
  reportDiagnostics: true
});
assert.equal(
  (output.diagnostics ?? []).length,
  0,
  (output.diagnostics ?? []).map(diagnostic => (
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  )).join('\n')
);

const loadedModule = { exports: {} };
new Function('module', 'exports', 'require', output.outputText)(
  loadedModule,
  loadedModule.exports,
  require
);
const model = loadedModule.exports;

const frames = [];
const posted = [];
const notifier = model.createUiReadyNotifier(
  message => posted.push(message),
  callback => {
    frames.push(callback);
    return frames.length;
  }
);

assert.equal(notifier.notifyAfterRender(), true);
assert.equal(notifier.notifyAfterRender(), false);
assert.equal(frames.length, 1);
frames.shift()(0);
assert.equal(frames.length, 1);
frames.shift()(16);
assert.deepEqual(posted, [{ type: 'uiReady' }]);
assert.equal(notifier.notifyAfterRender(), false);

console.log('performanceReady tests passed');
