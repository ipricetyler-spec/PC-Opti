// Closed browser check of the actual component and status assembler. No Electron,
// native helper, Windows observation, driver operation or external request runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { chromium } = require('playwright');
const { readBundledStatus } = require('../src/main/input-driver-lifecycle/bundled-status.cjs');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output', 'playwright', `bundled-setup-ui-${Date.now()}`);
const origin = 'http://127.0.0.1:5193';

async function main() {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), '<html><head></head><body><div id="fixture"></div><script type="module" src="./entry.jsx"></script></body></html>');
  fs.writeFileSync(path.join(out, 'entry.jsx'), `import React from 'react';
import { createRoot } from 'react-dom/client';
import { BundledInputStatus } from '/src/components/BundledInputStatus';
import '/src/index.css';
document.body.style.cssText = 'background:#111827;padding:24px;max-width:760px;margin:auto';
window.pcOptiNative = {
 getBundledInputStatus: async () => window.__bundleCase,
 openBundledInputSetup: async (deviceId) => { window.__launchCalls++; (window.__selectionIds ||= []).push(deviceId); throw new Error('Fixture launch canceled. No change was requested.'); }
};
const root = createRoot(document.getElementById('fixture'));
window.__selectDevice = (id, name) => root.render(<BundledInputStatus device={{ id, name, speed:window.__deviceSpeed, filterActive:window.__deviceSpeed !== 'Low-Speed', configuredHz:window.__deviceSpeed === 'Low-Speed' ? null : 1000 }} />);
window.__selectDevice('a'.repeat(64), 'Fixture input');`);
  const server = cp.spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5193', '--strictPort'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', b => { serverLog += b; }); server.stderr.on('data', b => { serverLog += b; });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (server.exitCode !== null) throw new Error('Fixture server exited: ' + serverLog);
      try { const response = await fetch(origin); if (response.ok && serverLog.includes('5193')) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'isolated loopback server ready');
    console.log('Loopback fixture ready; launching isolated Chrome.');
    browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20000 });
    const readyBroker = { available: true, code: 'NATIVE_BROKER_READY', message: 'Open native setup to inspect this exact device and review an operation. Device compatibility is checked there.' };
    const cases = [
      ['ready', readBundledStatus(path.join(root, 'vendor/hidusbf'), { nativeBroker: readyBroker }), true],
      ['expired', readBundledStatus(path.join(root, 'vendor/hidusbf'), { nativeBroker: { available: false, code: 'NATIVE_POLICY_INVALID', message: 'Policy expired.' } }), false],
      ['missing', readBundledStatus(path.join(root, 'vendor/hidusbf')), false],
      ['invalid-bundle', readBundledStatus(path.join(root, 'vendor/hidusbf/missing'), { nativeBroker: readyBroker }), false],
      ['low-speed', readBundledStatus(path.join(root, 'vendor/hidusbf'), { nativeBroker: readyBroker }), false, 'Low-Speed'],
      ['low-speed-invalid-bundle', readBundledStatus(path.join(root, 'vendor/hidusbf/missing'), { nativeBroker: readyBroker }), false, 'Low-Speed'],
      ['full-speed', readBundledStatus(path.join(root, 'vendor/hidusbf'), { nativeBroker: readyBroker }), true, 'Full-Speed'],
    ];
    for (const [name, bundle, available, speed = 'High-Speed'] of cases) {
      console.log('Checking ' + name);
      const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
      context.setDefaultTimeout(15000);
      const errors = [];
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      await context.addInitScript(({ bundle, speed }) => { window.__bundleCase = bundle; window.__deviceSpeed = speed; window.__launchCalls = 0; }, { bundle, speed });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/output/playwright/${path.basename(out)}/index.html`);
      const section = page.getByRole('region', { name: 'Bundled HIDUSBF setup' });
      const launch = section.getByRole('button', { name: /^(Change rate…|Set up polling rate…)$/ });
      const status = section.getByRole('status');
      await launch.waitFor();
      assert.equal(await launch.isEnabled(), available, name);
      const text = await section.innerText();
      assert.match(text, /Saved rate/);
      assert.match(text, /Reconnect status/);
      assert.equal(await section.getByText('Driver setup and compatibility details', { exact: true }).evaluate(el => el.parentElement.open), false);
      if (available) {
        assert.match(text, /Setup is ready to review this device/);
        assert.doesNotMatch(text, /helper is currently unavailable|not activated yet/);
        await launch.click();
        await section.getByRole('alert').filter({ hasText: 'Fixture launch canceled.' }).waitFor();
        assert.equal(await page.evaluate(() => window.__launchCalls), 1);
        assert.deepEqual(await page.evaluate(() => window.__selectionIds), ['a'.repeat(64)]);
        assert.ok(await launch.isEnabled(), 'canceled launch remains usable');
        await page.evaluate(() => window.__selectDevice('b'.repeat(64), 'Fixture second input'));
        await section.getByRole('heading', { name: 'Fixture second input' }).waitFor();
        await launch.click();
        await page.waitForFunction(() => window.__launchCalls === 2);
        assert.deepEqual(await page.evaluate(() => window.__selectionIds), ['a'.repeat(64), 'b'.repeat(64)], 'a changed device must not reuse the first selection');
      } else {
        assert.equal(await page.evaluate(() => window.__launchCalls), 0);
        assert.equal(await launch.getAttribute('aria-describedby'), 'bundled-input-setup-blocked-reason', name);
        assert.ok((await section.locator('#bundled-input-setup-blocked-reason').innerText()).length > 0, name + ' blocking reason');
      }
      await page.screenshot({ path: path.join(out, name + '-normal.png'), fullPage: true });
      await section.getByText('Driver setup and compatibility details', { exact: true }).click();
      if (bundle.identity === 'VERIFIED') {
        assert.match(await section.innerText(), /broader validation, not the result of your last rate change/);
        assert.equal(await section.getByText('Not yet validated', { exact: true }).count(), speed === 'Low-Speed' ? 0 : speed === 'Full-Speed' ? 1 : 4);
        assert.equal(await section.getByText('Unsupported by Low-Speed setup', { exact: true }).count(), speed === 'Low-Speed' ? 4 : 0);
        assert.equal(await section.getByText('Unsupported at Full-Speed', { exact: true }).count(), speed === 'Full-Speed' ? 3 : 0);
      } else {
        assert.match(text, /bundled files did not pass verification/);
        assert.equal(await section.getByText('Not yet validated', { exact: true }).count(), 0);
        assert.equal(await section.getByText('Unavailable — bundle verification failed', { exact: true }).count(), 4);
        assert.equal(await section.getByText('Unsupported by Low-Speed setup', { exact: true }).count(), 0);
      }
      assert.ok((await status.innerText()).length > 0, name + ' live status');
      assert.deepEqual(errors, [], name + ' browser errors');
      await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'RESULT.json'), JSON.stringify({ status: 'PASS', cases: cases.map(x => x[0]), fixtureOnly: true, nativeLaunches: 0, windowsOperations: 0 }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', cases: cases.length, output: out, nativeLaunches: 0 }));
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.writeFileSync(path.join(out, 'VITE.log'), serverLog);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
