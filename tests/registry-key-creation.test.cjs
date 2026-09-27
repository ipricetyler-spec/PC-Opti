const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// New-Item -Force on a registry key that already exists replaces it, taking every other value
// in it along, which undo cannot put back. Every script Dialed ships may create a key only
// where it is known to be missing.
function sources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.cjs') ? [full] : [];
  });
}

test('no script creates a registry key with New-Item -Force unless the key is missing', () => {
  const unguarded = [];
  for (const file of sources(path.join(__dirname, '..', 'src', 'main'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/New-Item -Path (\$\w+)[^;|}]*-Force/g)) {
      const variable = match[1];
      const before = text.slice(Math.max(0, match.index - 160), match.index);
      const guarded = before.includes(`if (-not (Test-Path -LiteralPath ${variable})) {`)
        || before.includes(`if (Test-Path -LiteralPath ${variable}) { throw`);
      if (!guarded) unguarded.push(`${path.relative(path.join(__dirname, '..'), file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(unguarded, []);
});
