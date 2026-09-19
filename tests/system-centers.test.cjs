const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('read-only system centers stay inside Scan and expose the intended evidence boundaries', () => {
  const root = path.join(__dirname, '..');
  const appSource = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const componentSource = fs.readFileSync(path.join(root, 'src', 'components', 'SystemInsightCenters.tsx'), 'utf8');

  assert.match(appSource, /activeTab === 'overview' && <SystemInsightCenters/);
  for (const label of ['Storage & apps', 'System status', 'Security', 'Power & hardware']) assert.match(componentSource, new RegExp(label.replace('/', '\\/')));
  assert.match(componentSource, /Some apps do not report their size/);
  assert.match(componentSource, /does not run system repair tools or registry cleaners/);
  for (const phrase of ['Complete with', 'drive', 'Windows managed', 'No automatic repairs', 'System board']) assert.match(componentSource, new RegExp(phrase));
  assert.match(componentSource, /role="tablist" aria-label="System evidence views"/);
  assert.match(componentSource, /role="tab" aria-selected=/);
  assert.match(componentSource, /role="tabpanel" aria-labelledby=/);
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']) assert.match(componentSource, new RegExp(`event\\.key === '${key}'`));
  assert.doesNotMatch(componentSource, /uninstall-string|UninstallString|msiexec|Remove-AppxPackage|winget uninstall/i);
});

test('Optimize keeps one fix list: the separate Plan tab and composer are removed', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  assert.doesNotMatch(source, /\['plan', 'Plan'\]/);
  assert.doesNotMatch(source, /PlanComposer/);
  assert.equal(fs.existsSync(path.join(root, 'src', 'components', 'PlanComposer.tsx')), false);
  assert.match(source, /optimizeView === 'recommended' && <div className="space-y-6">[^\n]*<OptimizationCatalog/);
});

test('power-plan query preserves the escaped Windows response parser at runtime', () => {
  const scanner = require('../src/main/scanner/index.cjs');
  assert.match(scanner.POWER_SCHEME_DIAGNOSTIC_SCRIPT, /\\s\+\\\(\(\.\+\)\\\)/);
  assert.doesNotMatch(scanner.POWER_SCHEME_DIAGNOSTIC_SCRIPT, /Name not returned/);
});

test('installed-app inventory IPC is read-only and exposes no uninstall command', () => {
  const root = path.join(__dirname, '..');
  const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const inventorySource = fs.readFileSync(path.join(root, 'src', 'main', 'game-config', 'index.cjs'), 'utf8');
  const capabilities = require('../src/main/capabilities/index.cjs');

  assert.equal(capabilities.requireCapability('diagnostic:installed-app-inventory', 'public').id, 'diagnostic:installed-app-inventory');
  assert.match(mainSource, /ipcMain\.handle\('pc-opti:list-installed-applications'/);
  assert.match(preloadSource, /listInstalledApplications: \(\) => ipcRenderer\.invoke\('pc-opti:list-installed-applications'\)/);
  assert.match(inventorySource, /Registry::HKEY_CURRENT_USER/);
  assert.match(inventorySource, /Registry::HKEY_LOCAL_MACHINE/);
  assert.doesNotMatch(preloadSource, /UninstallString|QuietUninstallString|ModifyPath/i);
  assert.doesNotMatch(inventorySource, /Start-Process|Remove-Item|UninstallString|QuietUninstallString/i);
});

test('recommendations lead with plain-language relevance and keep internal scope under technical evidence', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'src', 'components', 'RecommendationsPanel.tsx'), 'utf8');
  for (const label of ['What Dialed found', 'Why this may matter', 'Possible benefit', 'What happens here', 'How to check']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /<summary[^>]*>Technical evidence<\/summary>/);
  assert.match(source, /Action:<\/span> \{item\.capabilityId\}/);
  assert.doesNotMatch(source, /label="Capability boundary"/);
});

test('settings explain bounded background lifecycle without claiming zero app overhead', () => {
  const root = path.join(__dirname, '..');
  const appSource = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'src', 'components', 'BackgroundActivity.tsx'), 'utf8');
  assert.match(appSource, /<BackgroundActivity \/>/);
  for (const phrase of ['Once when Dialed opens', 'Only while you request it', 'Never continuous', 'a few helper processes in Task Manager']) {
    assert.match(source, new RegExp(phrase));
  }
  assert.match(source, /Closing Dialed quits it completely/);
});

test('shared Technical details mode is default-off across evidence surfaces without hiding safeguards', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8');
  const setting = fs.readFileSync(path.join(root, 'src', 'components', 'TechnicalDetailsSetting.tsx'), 'utf8');
  assert.match(app, /localStorage\.getItem\(TECHNICAL_DETAILS_STORAGE_KEY\) === 'shown'/);
  assert.match(css, /data-technical-details='hidden'.*data-technical-detail/s);
  assert.match(setting, /Safety warnings and undo steps are always shown either way/);
  for (const fileName of [
    'BackgroundActivity.tsx',
    'BenchmarkEvidence.tsx',
    'BiosGuidanceCenter.tsx',
    'DashboardOverview.tsx',
    'DriftMonitor.tsx',
    'GameConfigCenter.tsx',
    'GameOptimizationCenter.tsx',
    'GameSettingsCenter.tsx',
    'InputDevicesCenter.tsx',
    'LocalAuditHistory.tsx',
    'MaintenanceQueue.tsx',
    'NativePresentMonCapture.tsx',
    'NetworkQualityLab.tsx',
    'OptimizationCatalog.tsx',
    'PerformanceLab.tsx',
    'ProcessBalancer.tsx',
    'ReadinessCenter.tsx',
    'RecommendationsPanel.tsx',
    'ReleaseStatusCard.tsx',
    'SafePolicies.tsx',
    'StartupCenter.tsx',
    'SystemInsightCenters.tsx',
    'WindowsControlsCenter.tsx',
  ]) {
    assert.match(fs.readFileSync(path.join(root, 'src', 'components', fileName), 'utf8'), /data-technical-detail/, fileName);
  }
  const bios = fs.readFileSync(path.join(root, 'src', 'components', 'BiosGuidanceCenter.tsx'), 'utf8');
  assert.doesNotMatch(bios, /data-technical-detail[^>]*>\s*<summary[^>]*>Before changing BIOS/);
  const input = fs.readFileSync(path.join(root, 'src', 'components', 'InputDevicesCenter.tsx'), 'utf8');
  assert.match(input, /<TabRow<typeof tab> ariaLabel="Input device tools"/);
  assert.match(input, />USB connection<\/>/);
  assert.match(input, />Polling rate<\/>/);
  assert.match(input, /data-technical-detail[^>]*>\{device\.portNumber/);
  assert.doesNotMatch(input, /data-technical-detail[^>]*>[\s\S]{0,120}Review exact restore/);
  const history = fs.readFileSync(path.join(root, 'src', 'components', 'LocalAuditHistory.tsx'), 'utf8');
  assert.doesNotMatch(history, /data-technical-detail[^>]*>[\s\S]{0,120}onRollback/);
});
