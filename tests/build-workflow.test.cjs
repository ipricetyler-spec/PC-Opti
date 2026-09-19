const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('development watcher excludes native packaging and fixture outputs while retaining the HMR disable switch', () => {
  const source = fs.readFileSync(path.join(__dirname, '../vite.config.ts'), 'utf8');
  assert.match(source, /watch: process.env.DISABLE_HMR === 'true' \? null/);
  assert.ok(source.includes("'**/output/**'"));
  assert.ok(source.includes("'**/dist-electron/**'"));
});

test('release manifest labels unsigned packages and deferred monetization truthfully', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/generate-release-manifest.cjs'), 'utf8');
  assert.match(source, /'unsigned-test-candidate'/);
  assert.match(source, /monetization: 'deferred'/);
  assert.match(source, /enabled: false/);
  assert.doesNotMatch(source, /manual-redemption-and-outbound-checkout-ready|manual-redemption-only/);
});

test('private candidate verifier is read-only toward the host and pins bundled driver payloads', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/verify-private-candidate.cjs'), 'utf8');
  assert.match(source, /dist-electron-current-source/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /Only the exact reviewed upstream resource payload may be bundled/);
  assert.match(source, /verifyBundledInventory\(hidusbfRoot, \{ packaged: true \}\)/);
  assert.match(source, /packagedInputDriver\?\.status, 'UNCONFIGURED'/);
  assert.match(source, /cleanMachineAcceptance, 'PENDING'/);
  assert.match(source, /sourceGatesExecutedByThisVerifier: false/);
  assert.match(source, /sourceTests: 'NOT_RUN_BY_THIS_VERIFIER'/);
  assert.doesNotMatch(source, /sourceTests:\s*\d+/);
  assert.doesNotMatch(source, /Start-Process|electron-builder|signFile|installFile|spawnSync/);
});

test('documented and hosted quality gates include parity, UI fixtures, audit, and release metadata checks', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8');
  const contributing = fs.readFileSync(path.join(__dirname, '../CONTRIBUTING.md'), 'utf8');
  const required = [
    'bun run check:clean-room-parity',
    'bun test',
    'bun run lint',
    'bun run build',
    'bun run test:ui:fixtures',
    'bun run sbom',
    'bun run license:inventory',
    'bun audit --audit-level=high',
  ];
  for (const command of required) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(contributing, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('clean-room parity scans every main-process module instead of a fixed file allowlist', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/check-clean-room-parity.cjs'), 'utf8');
  assert.match(source, /collectModuleFiles\(path\.join\(repositoryRoot, 'src', 'main'\)\)/);
  assert.match(source, /entry\.isDirectory\(\).*collectModuleFiles\(target\)/);
  assert.match(source, /entry\.name\.endsWith\('\.cjs'\)/);
  assert.doesNotMatch(source, /'timing', 'index\.cjs'[\s\S]*'journal', 'index\.cjs'/);
});

test('the Tailwind Vite build does not retain an unused autoprefixer dependency', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const lockfile = fs.readFileSync(path.join(__dirname, '../bun.lock'), 'utf8');
  const viteConfig = fs.readFileSync(path.join(__dirname, '../vite.config.ts'), 'utf8');

  assert.equal(packageJson.dependencies?.autoprefixer, undefined);
  assert.equal(packageJson.devDependencies?.autoprefixer, undefined);
  assert.doesNotMatch(lockfile, /\bautoprefixer\b/);
  assert.doesNotMatch(viteConfig, /\bautoprefixer\b/);
});
