const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { buildScopeEvidence } = require('../scripts/collect-native-policy-scope.cjs');
const { execFileSync, spawnSync } = require('node:child_process');
const dotnet = spawnSync('dotnet', ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
test('native framing, preview refusals, scope construction and journal survive closed fixtures without device or service access', { skip: process.platform !== 'win32' || dotnet.status !== 0 ? 'Windows .NET SDK unavailable; native fixture not run' : false }, (context) => {
  const platform = { machine: 'FIXTURE', os: '10.0.26200.0', codeIntegrityOptions: 57349, secureBoot: 1, usbXhci: 'a'.repeat(64), usbPort: 'b'.repeat(64) };
  const nodes = ['054C:0DF2', '1532:00A5', '1038:1622'].flatMap((product, index) => {
    const [vid, pid] = product.split(':');
    const root = `USB\\VID_${vid}&PID_${pid}\\FIXTURE`;
    const child = `USB\\VID_${vid}&PID_${pid}&MI_00\\CHILD`;
    return [
      { id: root, parent: 'USB\\ROOT_HUB30\\ROOT', location: `PORT:${index}`, speed: index ? 1 : 2, present: true, problem: 0 },
      { id: child, parent: root, location: '', inputKind: 'MOUSE', present: true, problem: 0 },
      { id: `HID\\VID_${vid}&PID_${pid}&MI_00\\HID`, parent: child, location: '', inputKind: 'MOUSE', present: true, problem: 0 },
    ];
  });
  const collect = nodes => buildScopeEvidence({ nodes }, platform, ['054C:0DF2', '1532:00A5']);
  const corpus = [
    collect(nodes), collect([...nodes].reverse()),
    collect(nodes.map(node => node.id.startsWith('USB\\VID_1038') && !node.id.includes('&MI_') ? { ...node, location: 'OTHER_PORT' } : node)),
    collect([...nodes, { id: 'HID\\VID_1038&PID_1622\\EXTRA', parent: nodes[6].id, inputKind: 'KEYBOARD', present: true, problem: 0 }]),
    collect(nodes.slice(0, 6)),
  ];
  assert.equal(corpus[0].platformDigest, corpus[1].platformDigest);
  for (const changed of corpus.slice(2)) {
    assert.notEqual(changed.platformDigest, corpus[0].platformDigest);
    assert.deepEqual(changed.authorizedDeviceDigests, corpus[0].authorizedDeviceDigests);
  }
  for (const entry of corpus) {
    const unselected = entry.eligibleInputScopes.find(scope => scope.productId === '1038:1622');
    if (unselected) {
      assert.equal(unselected.selected, false);
      assert.equal(entry.authorizedDeviceDigests.includes(unselected.interfaceDigest), false);
    }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-scope-corpus-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'corpus.json');
  fs.writeFileSync(file, JSON.stringify(corpus), { flag: 'wx' });
  const output = execFileSync('dotnet', ['run', '--project', path.resolve(__dirname, '../native/hidusbf-helper-fixture/Dialed.HidusbfProtocolFixture.csproj'), '--configuration', 'Release', '--verbosity', 'quiet', '--', '--digest-corpus', file], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.match(output, /closed-native-protocol-pass:115\b/);
  assert.match(output, /closed-boot-recovery-pass:61/);
  assert.match(output, /closed-boot-session-pass:\d+/);
  assert.match(output, /closed-preview-transport-pass:55/);
  assert.match(output, /closed-session-diagnostics-pass:91/);
  assert.match(output, /closed-boot-observation-pass:122/);
  assert.match(output, /closed-scope-construction-pass:114/);
  assert.match(output, /closed-input-scope-ownership-pass:7\b/);
  assert.match(output, /closed-operation-scope-pass:151/);
  assert.match(output, /closed-inventory-reconciliation-pass:\d+/);
  assert.match(output, /closed-setup-presentation-pass:64\b/);
  assert.match(output, /closed-setup-state-pass:\d+/);
  assert.match(output, /closed-setup-selection-pass:\d+/);
  assert.match(output, /closed-device-reconnect-pass:\d+/);
  context.diagnostic(output.trim());
  const machineSource = fs.readFileSync(path.resolve(__dirname, '../native/hidusbf-helper/WindowsMachine.cs'), 'utf8');
  assert.match(machineSource, /ScopeDigests\.Device\(device\.InstanceId, detail\?\.parent, detail\?\.location, speed, scope\)/);
  assert.match(machineSource, /ScopeDigests\.Platform\(/);
  assert.match(machineSource, /states\.Where\(x => x\.Eligible\)\.Select\(x => x\.InterfaceDigest\)/);
  assert.match(machineSource, /ScopeDigests\.InputMembers\(device\.InstanceId,/);
  assert.match(machineSource, /inputMembers\.Contains\(x\.id\)/);
  const hostSource = fs.readFileSync(path.resolve(__dirname, '../native/hidusbf-host/Program.cs'), 'utf8');
  assert.match(hostSource, /NativeSessionServer\.Run\(server, nonce, session, machine, peer\.AssertAliveAndConnected, diagnostics, deadline\.Token\)/);
});
