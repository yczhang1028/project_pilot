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
  'managerLayout.ts'
);

function loadTypeScriptModule(filePath) {
  if (!fs.existsSync(filePath)) {
    assert.fail(`Expected manager layout module to exist: ${filePath}`);
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: filePath,
    reportDiagnostics: true
  });
  const diagnostics = output.diagnostics ?? [];
  assert.equal(
    diagnostics.length,
    0,
    diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n')
  );

  const module = { exports: {} };
  new Function('module', 'exports', 'require', output.outputText)(module, module.exports, require);
  return module.exports;
}

const model = loadTypeScriptModule(sourcePath);

assert.equal(model.fromStoredViewMode('mini'), 'command');
assert.equal(model.fromStoredViewMode('list'), 'explorer');
assert.equal(model.fromStoredViewMode('grid'), 'gallery');
assert.equal(model.toStoredViewMode('command'), 'mini');
assert.equal(model.toStoredViewMode('explorer'), 'list');
assert.equal(model.toStoredViewMode('gallery'), 'grid');
assert.equal(model.normalizeManagerLayout('unknown'), 'command');
assert.equal(model.normalizeManagerLayout(undefined), 'command');
assert.equal(model.normalizeManagerLayout('explorer'), 'explorer');
assert.deepEqual(
  model.layoutOptions.map(option => [option.id, option.stored]),
  [['command', 'mini'], ['explorer', 'list'], ['gallery', 'grid']]
);

console.log('managerLayout tests passed');
