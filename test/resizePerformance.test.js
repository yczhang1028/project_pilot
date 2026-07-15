const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'webview-ui', 'src', 'ui', 'App.tsx'),
  'utf8'
);
const stylesSource = fs.readFileSync(
  path.join(__dirname, '..', 'webview-ui', 'src', 'styles.css'),
  'utf8'
);

assert.doesNotMatch(
  appSource,
  /addEventListener\(['"]resize['"]/,
  'Manager resizing must not trigger a full React render for every width change'
);
assert.match(
  stylesSource,
  /\.project-group\s*\{[\s\S]*?content-visibility:\s*auto;/,
  'Off-screen project groups should be skipped by the browser during resize layout'
);
assert.match(
  stylesSource,
  /@media\s*\(max-width:\s*920px\)/,
  'Responsive header behavior should stay in CSS'
);
assert.match(
  stylesSource,
  /\.agent-assets__asset\s*\{[\s\S]*?content-visibility:\s*auto;/,
  'Off-screen Agent Asset cards should not be laid out and painted while resizing'
);
assert.match(
  stylesSource,
  /\.agent-assets-viewport\s*\{[\s\S]*?backdrop-filter:\s*none;/,
  'The fullscreen Agent Assets surface should not blur the entire Manager during resizing'
);
assert.match(
  stylesSource,
  /html\[data-agent-assets-open=['"]true['"]\]\s+#root\s*\{[\s\S]*?content-visibility:\s*hidden;/,
  'The covered Manager should not be laid out or painted behind Agent Assets'
);

console.log('resize performance tests passed');
