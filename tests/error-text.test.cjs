const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('no screen shows a raw error: every error display goes through ErrorText', () => {
  const dir = path.join(__dirname, '..', 'src', 'components');
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.tsx') && name !== 'ErrorText.tsx')) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of source.matchAll(/>\{((?:[a-zA-Z]*[eE]rror|entry\.stderr|entry\.error|error\.message))\}</g)) offenders.push(`${file}: {${match[1]}}`);
    for (const match of source.matchAll(/\}: \{error\.message\}|(?<!\$)\{error\.component\}/g)) offenders.push(`${file}: ${match[0]}`);
  }
  assert.deepEqual(offenders, []);
});

test('the original error text stays one click away', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ErrorText.tsx'), 'utf8');
  assert.match(source, /\{open \? 'Hide details' : 'Details'\}/);
  assert.match(source, /\{technical\}/);
});
