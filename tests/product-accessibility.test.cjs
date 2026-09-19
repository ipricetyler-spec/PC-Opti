const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function sourceFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(relativePath) : [relativePath];
  });
}

test('active interface copy never relies on nine or ten pixel text', () => {
  const offenders = sourceFiles('src')
    .filter((relativePath) => relativePath.endsWith('.tsx'))
    .filter((relativePath) => /text-\[(?:9|10)px\]/.test(read(relativePath)));

  assert.deepEqual(offenders, []);
});

test('every plain subtab row uses one keyboard-operable WAI-ARIA tab component', () => {
  const component = read('src/components/TabRow.tsx');
  const appSource = read('src/App.tsx');
  const networkSource = read('src/components/NetworkQualityLab.tsx');
  const inputSource = read('src/components/InputDevicesCenter.tsx');

  assert.match(component, /role="tablist"/);
  assert.match(component, /role="tab"/);
  assert.match(component, /aria-selected=\{selected\}/);
  assert.match(component, /tabIndex=\{selected \? 0 : -1\}/);
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']) assert.match(component, new RegExp(key));
  // Home, Tweaks, Games and Measure. Restore is one page since simplification stage 5.
  assert.equal([...appSource.matchAll(/<TabRow(?:<[^>]+>)? ariaLabel=/g)].length, 4);
  assert.doesNotMatch(appSource, /ariaLabel="Verification categories"/);
  assert.equal([...networkSource.matchAll(/<TabRow(?:<[^>]+>)? ariaLabel=/g)].length, 1);
  assert.equal([...inputSource.matchAll(/<TabRow(?:<[^>]+>)? ariaLabel=/g)].length, 1);
  assert.doesNotMatch(`${appSource}\n${networkSource}\n${inputSource}`, /aria-pressed=\{(?:optimizeView|measureView|gameView|verifyView|view|tab) ===/);
});

test('all filtered result counts announce updates politely and atomically', () => {
  for (const fileName of [
    'BenchmarkEvidence.tsx',
    'DriftMonitor.tsx',
    'GameSettingsCenter.tsx',
    'LocalAuditHistory.tsx',
    'MaintenanceQueue.tsx',
    'ProcessBalancer.tsx',
    'RecommendationsPanel.tsx',
    'SafePolicies.tsx',
    'StartupCenter.tsx',
  ]) {
    const source = read(`src/components/${fileName}`);
    assert.match(source, /role="status" aria-live="polite" aria-atomic="true"[^>]*>\s*Showing/s, fileName);
  }
});

test('Local Audit filters use a consistent responsive grid and full-width controls', () => {
  const source = read('src/components/LocalAuditHistory.tsx');

  assert.ok(source.includes('grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))]'));
  assert.match(source, /<span className="mb-1 block">Show<\/span>/);
  assert.match(source, /<span className="mb-1 block">Sort<\/span>/);
  assert.equal([...source.matchAll(/className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2/g)].length, 3);
  assert.match(source, /<button type="button" onClick=\{\(\) => \{ showAll\(\); setHistorySort\('newest'\); \}\}/);
  // Opening one entry filters by id without hiding it in the search box, and says how to see the rest.
  assert.match(source, /if \(focusedEntry\) return entry\.id === focusedEntry\.id;/);
  assert.match(source, /Show all \{entries\.length\} entries/);
  assert.doesNotMatch(source, /setHistoryQuery\(focusedId/);
  assert.match(source, /className="inline-flex items-center justify-center gap-1 self-end/);
});

test('batch optimization progress is exposed as a named polite live log', () => {
  const source = read('src/components/OptimizationCatalog.tsx');

  assert.match(source, /role="log" aria-live="polite" aria-labelledby="optimization-run-log-heading"/);
  assert.match(source, /id="optimization-run-log-heading"[^>]*>Results</);
});

test('network history chart derives its surfaces, labels, and series from theme tokens', () => {
  const component = read('src/components/NetworkQualityLab.tsx');
  const styles = read('src/index.css');

  assert.doesNotMatch(component, /#[0-9a-f]{3,8}/i);
  for (const token of [
    '--app-border-strong',
    '--app-muted',
    '--app-surface-strong',
    '--app-text',
    '--app-chart-idle',
    '--app-chart-loaded',
    '--app-chart-download',
    '--app-chart-upload',
  ]) {
    assert.match(component, new RegExp(`var\\(${token}\\)`), token);
  }
  for (const token of ['--app-chart-idle', '--app-chart-loaded', '--app-chart-download', '--app-chart-upload']) {
    assert.match(styles, new RegExp(`${token}:`), token);
  }
});

test('the current section is marked by shape and weight, not colour alone, at every width', () => {
  const source = read('src/components/Sidebar.tsx');
  const css = read('src/index.css');

  assert.match(source, /aria-current=\{selected \? 'page' : undefined\}/);
  assert.match(source, /selected \? 'nav-item-selected font-semibold'/);
  // The accent bar is not tied to a breakpoint, so it shows in the mobile row too.
  assert.match(css, /\.nav-item-selected::before \{[^}]*width: 2px;/s);
});

test('mobile primary navigation exposes overflow-only edge fades', () => {
  const source = read('src/components/Sidebar.tsx');

  assert.match(source, /aria-label="Primary navigation"/);
  assert.match(source, /left: nav\.scrollLeft > 1/);
  assert.match(source, /right: nav\.scrollLeft \+ nav\.clientWidth < nav\.scrollWidth - 1/);
  assert.match(source, /overflowEdges\.left \? <span aria-hidden="true"/);
  assert.match(source, /overflowEdges\.right \? <span aria-hidden="true"/);
  assert.equal([...source.matchAll(/pointer-events-none absolute inset-y-0/g)].length, 2);
});

test('keyboard users can bypass primary navigation and focus the main workspace', () => {
  const source = read('src/App.tsx');

  assert.match(source, /<a href="#main-content"[^>]*>Skip to main content<\/a>/);
  assert.match(source, /<main id="main-content" tabIndex=\{-1\}/);
});

test('keyboard focus uses the active theme accent even where controls reset browser outlines', () => {
  const source = read('src/index.css');

  assert.match(source, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--app-accent\);[^}]*outline-offset:\s*2px;/s);
  assert.match(source, /:root,\s*:root\[data-theme='console'\]\s*\{[^}]*--app-accent:/s);
  for (const theme of ['instrument']) {
    assert.match(source, new RegExp(`:root\\[data-theme='${theme}'\\]\\s*\\{[^}]*--app-accent:`, 's'));
  }
});

test('bundled setup announces resolved status and describes a disabled setup control', () => {
  const source = read('src/components/BundledInputStatus.tsx');

  assert.match(source, /id="bundled-input-setup-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /Unavailable — bundle verification failed/);
  assert.match(source, /aria-describedby=\{setupBlocked && setupBlockReason \? 'bundled-input-setup-blocked-reason' : undefined\}/);
  assert.match(source, /id="bundled-input-setup-blocked-reason"/);
});

test('the five structured-data confirmations use one accessible themed preview dialog', () => {
  const appSource = read('src/App.tsx');
  const dialogSource = read('src/components/ActionPreviewDialog.tsx');

  assert.equal([...appSource.matchAll(/await requestPreviewConfirmation\(\{/g)].length, 5);
  assert.doesNotMatch(appSource, /JSON\.stringify\(preview\./);
  for (const call of [
    'getAuditExportPreview',
    'getAuditDeletionPreview',
    'previewBenchmarkImport',
    'preparePresentMonImport',
    'previewBenchmarkDeletion',
    'exportAuditHistory',
    'deleteAuditHistory(preview.token)',
    'applyBenchmarkImport(preview.token)',
    'deleteBenchmarkExperiment(preview.token)',
  ]) {
    assert.match(appSource, new RegExp(call.replace(/[().]/g, '\\$&')));
  }

  assert.match(appSource, /<ActionPreviewDialog request=\{actionPreview\}/);
  assert.match(dialogSource, /role="dialog"/);
  assert.match(dialogSource, /aria-modal="true"/);
  assert.match(dialogSource, /cancelButtonRef\.current\?\.focus\(\)/);
  assert.match(dialogSource, /event\.key === 'Escape'/);
  assert.match(dialogSource, /querySelectorAll<HTMLElement>\(FOCUSABLE_SELECTOR\)/);
  assert.match(dialogSource, /previouslyFocused\?\.isConnected/);
  assert.match(dialogSource, /max-h-\[calc\(100vh-2rem\)\]/);
  assert.match(dialogSource, /<pre[^>]*tabIndex=\{0\}[^>]*overflow-auto/);
});

test('the Input Devices page credits HIDUSBF in normal mode, not only behind Technical details', () => {
  const source = read('src/components/InputDevicesCenter.tsx');
  const creditIndex = source.indexOf('data-hidusbf-credit');
  assert.ok(creditIndex > 0, 'the normal-mode HIDUSBF credit block must exist');

  const creditBlock = source.slice(creditIndex, source.indexOf('</div>', creditIndex));
  assert.equal(creditBlock.includes('data-technical-detail'), false, 'the credit must not be hidden behind Technical details');
  assert.match(creditBlock, /SweetLow/);
  assert.match(creditBlock, /LordOfMice/);
  assert.match(creditBlock, /Dialed did not write it and does not modify it/);
  assert.match(creditBlock, /openExternalLink\(HIDUSBF_PROJECT_URL\)/);
});

test('the upstream credit link is one fixed destination sent through the main-owned authority', () => {
  const source = read('src/components/InputDevicesCenter.tsx');

  assert.match(source, /const HIDUSBF_PROJECT_URL = 'https:\/\/github\.com\/LordOfMice\/hidusbf';/);
  // Every external navigation in this component goes through the constant and the
  // preload bridge; no raw URL string may be handed to openExternalLink.
  const openCalls = source.match(/openExternalLink\((.*?)\)/g) || [];
  assert.ok(openCalls.length > 0);
  for (const call of openCalls) {
    assert.match(call, /openExternalLink\((?:HIDUSBF_PROJECT_URL|'https:\/\/github\.com\/LordOfMice\/hidusbf')\)/, call);
  }
  assert.equal(/window\.open\(/.test(source), false);
});

test('the upstream credit never implies Dialed authored the driver', () => {
  const source = read('src/components/InputDevicesCenter.tsx');
  const creditIndex = source.indexOf('data-hidusbf-credit');
  const creditBlock = source.slice(creditIndex, source.indexOf('</div>', creditIndex));

  for (const phrase of ['Dialed driver', 'our driver', 'Dialed-built driver', 'Dialed kernel driver']) {
    assert.equal(creditBlock.includes(phrase), false, phrase);
  }
});

test('Recovery & history pairs each undone change with its undo', () => {
  const source = read('src/components/LocalAuditHistory.tsx');
  const journal = fs.readFileSync(path.join(__dirname, '..', 'src/main/journal/index.cjs'), 'utf8');
  // The component parses the exact reason the journal writes when an entry is restored.
  assert.match(journal, /reason: `Restored by audit entry \$\{entry\.id\}\.`/);
  assert.match(source, /Restored by audit entry \(\[0-9a-f-\]\{8,\}\)/);
  assert.match(source, />Undone<\/span>/);
  assert.match(source, />Undo<\/span>/);
  assert.match(source, /see the undo/);
  assert.match(source, /see the change/);
  assert.match(source, /value: 'undone', label: 'Undone changes and undos'/);
});
