const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every test temp folder is made here and deleted when the test file's process ends.
// Folders left behind pile up in %TEMP%, and Dialed's own scan walks %TEMP% to size
// temporary files, so leftovers from test runs made scans slower.
const created = [];

function tempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(directory);
  return directory;
}

process.on('exit', () => {
  for (const directory of created) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* a file still in use is left for Windows to clear */ }
  }
});

module.exports = { tempDir };
