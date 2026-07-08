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
  'modalStackModel.ts'
);

function loadTypeScriptModule(filePath) {
  if (!fs.existsSync(filePath)) {
    assert.fail(`Expected modal stack module to exist: ${filePath}`);
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
  assert.equal(output.diagnostics?.length ?? 0, 0);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output.outputText)(module, module.exports, require);
  return module.exports;
}

const model = loadTypeScriptModule(sourcePath);

let stack = model.emptyModalStack();
assert.deepEqual(stack, []);
assert.equal(model.getTopModal(stack), undefined);

stack = model.pushModal(stack, { id: 'project-editor', dismissible: true });
stack = model.pushModal(stack, { id: 'ssh-hosts', dismissible: true });
assert.equal(model.getTopModal(stack).id, 'ssh-hosts');
assert.equal(model.getModalLayer(stack, 'project-editor'), 0);
assert.equal(model.getModalLayer(stack, 'ssh-hosts'), 1);

stack = model.pushModal(stack, { id: 'project-editor', dismissible: false });
assert.deepEqual(stack.map(entry => entry.id), ['ssh-hosts', 'project-editor']);
assert.equal(model.getTopModal(stack).dismissible, false);

stack = model.removeModal(stack, 'ssh-hosts');
assert.deepEqual(stack.map(entry => entry.id), ['project-editor']);
assert.equal(model.getModalLayer(stack, 'missing'), -1);

stack = model.removeModal(stack, 'project-editor');
assert.equal(model.getTopModal(stack), undefined);

console.log('modalStackModel tests passed');
