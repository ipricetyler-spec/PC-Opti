const childProcess = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5178;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const checks = [
  'check-game-profiles-ui.cjs',
  'check-input-devices-ui.cjs',
  'check-bios-ui.cjs',
  'check-workspace-states-ui.cjs',
  'check-theme-contrast.cjs',
];

function waitForPreview(deadline = Date.now() + 15_000) {
  return new Promise((resolve, reject) => {
    const request = http.get(ORIGIN, (response) => {
      response.resume();
      if (response.statusCode === 200) resolve();
      else if (Date.now() >= deadline) reject(new Error(`Fixture preview returned HTTP ${response.statusCode}.`));
      else setTimeout(() => waitForPreview(deadline).then(resolve, reject), 100);
    });
    request.setTimeout(1000, () => request.destroy());
    request.on('error', (error) => {
      if (Date.now() >= deadline) reject(new Error(`Fixture preview did not start: ${error.message}`));
      else setTimeout(() => waitForPreview(deadline).then(resolve, reject), 100);
    });
  });
}

async function main() {
  const preview = childProcess.spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let previewOutput = '';
  preview.stdout.on('data', (chunk) => { previewOutput = `${previewOutput}${chunk}`.slice(-8000); });
  preview.stderr.on('data', (chunk) => { previewOutput = `${previewOutput}${chunk}`.slice(-8000); });
  try {
    await waitForPreview();
    for (const fileName of checks) {
      const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, fileName)], {
        cwd: ROOT,
        windowsHide: true,
        stdio: 'inherit',
        env: { ...process.env, DIALED_UI_URL: ORIGIN },
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${fileName} exited with code ${result.status}.`);
    }
  } finally {
    preview.kill();
  }
  console.log('All isolated browser fixture checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
