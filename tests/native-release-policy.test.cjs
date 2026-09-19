const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyPolicy, readNativeBrokerStatus } = require('../src/main/input-driver-lifecycle/native-broker.cjs');
const workflow = require('../scripts/native-release-policy.cjs');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-policy-fixture-'));
// Ephemeral test keys only. No production key is generated or stored by tooling.
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
const pem = pair.publicKey.export({ type: 'spki', format: 'pem' });
const fingerprint = crypto.createHash('sha256').update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const identity = workflow.publicIdentity(pem, fingerprint);
const secretFile = path.join(temporary, 'ephemeral-test-key.pem');
fs.writeFileSync(secretFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const candidate = path.join(temporary, 'candidate');
fs.mkdirSync(candidate);
const broker = Buffer.from('inert broker fixture, never executable');
const helper = Buffer.from('inert helper fixture, never executable');
fs.writeFileSync(path.join(candidate, 'Dialed.HidusbfBroker.exe'), broker);
fs.writeFileSync(path.join(candidate, 'Dialed.HidusbfHost.exe'), helper);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const policy = { SchemaVersion: 1, ExpiresAt: new Date(Date.now() + 86400000).toISOString(), BrokerSha256: sha(broker), HelperSha256: sha(helper), PublisherThumbprint: 'c'.repeat(40), AcceptedPlatformDigests: ['f'.repeat(64), 'd'.repeat(64)], Purpose: 'VALIDATION_ONLY', AuthorizedDeviceDigests: ['e'.repeat(64)] };
const raw = value => Buffer.from(JSON.stringify(value));
const review = raw(policy);
const sign = bytes => crypto.sign('sha256', bytes, { key: pair.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test('policy preparation is deterministic, exact, separately scoped and binds final file bytes', () => {
  const bytes = workflow.preparePolicy(review, candidate);
  const reordered = Object.fromEntries(Object.entries({ ...policy, AcceptedPlatformDigests: [...policy.AcceptedPlatformDigests].reverse(), PublisherThumbprint: policy.PublisherThumbprint.toUpperCase() }).reverse());
  assert.deepEqual(bytes, workflow.preparePolicy(raw(reordered), candidate));
  assert.equal(bytes.toString().endsWith('\n'), true);
  assert.deepEqual(JSON.parse(bytes).AuthorizedDeviceDigests, policy.AuthorizedDeviceDigests);
  const signature = workflow.signPolicy(bytes, identity, secretFile);
  assert.equal(workflow.verifyPrepared(bytes, signature, identity, review, candidate).Purpose, 'VALIDATION_ONLY');
  assert.throws(() => workflow.preparePolicy(raw({ ...policy, BrokerSha256: 'a'.repeat(64) }), candidate), /hash/);
  fs.writeFileSync(path.join(candidate, 'Dialed.HidusbfBroker.exe'), 'changed after signing');
  try { assert.throws(() => workflow.verifyPrepared(bytes, signature, identity, review, candidate), /hash/); }
  finally { fs.writeFileSync(path.join(candidate, 'Dialed.HidusbfBroker.exe'), broker); }
  assert.throws(() => workflow.verifyPrepared(Buffer.concat([bytes, Buffer.from(' ')]), signature, identity, review, candidate), /canonical/);
});

test('policy issuance refuses empty, broad, expired, wrong-purpose, wrong-hash and ambiguous review inputs', () => {
  const invalid = [
    { ...policy, SchemaVersion: 2 }, { ...policy, Extra: true }, { ...policy, Purpose: 'ACCEPTED_RELEASE' },
    { ...policy, ExpiresAt: '2000-01-01T00:00:00Z' }, { ...policy, ExpiresAt: '2099-01-01T00:00:00Z' },
    { ...policy, ExpiresAt: '2027-02-30T00:00:00Z' }, { ...policy, ExpiresAt: 2099 },
    { ...policy, BrokerSha256: '*' }, { ...policy, PublisherThumbprint: 123 },
    { ...policy, AcceptedPlatformDigests: [] }, { ...policy, AuthorizedDeviceDigests: [] },
    { ...policy, AuthorizedDeviceDigests: ['*'] }, { ...policy, AuthorizedDeviceDigests: [policy.AuthorizedDeviceDigests[0], policy.AuthorizedDeviceDigests[0]] },
    { ...policy, AcceptedPlatformDigests: Array.from({ length: 129 }, (_, i) => i.toString(16).padStart(64, '0')) },
  ];
  for (const value of invalid) assert.throws(() => workflow.preparePolicy(raw(value), candidate));
  for (const bytes of [Buffer.from('{'), Buffer.alloc(0), Buffer.alloc(65537), Buffer.from(review.toString().replace('"SchemaVersion":1', '"SchemaVersion":1,"SchemaVersion":1')), Buffer.from(review.toString().replace('"SchemaVersion":1', '"SchemaVersion":1,"Schema\\u0056ersion":1'))]) assert.throws(() => workflow.preparePolicy(bytes, candidate));
  const missing = { ...policy }; delete missing.AuthorizedDeviceDigests;
  assert.throws(() => workflow.preparePolicy(raw(missing), candidate));
  assert.throws(() => workflow.preparePolicy(review, path.join(temporary, 'missing')));
  assert.throws(() => workflow.signPolicy(raw({ ...policy, Purpose: 'ACCEPTED_RELEASE' }), identity, secretFile));
});

test('public input demands reviewed SPKI RSA identity and never accepts private material', () => {
  assert.throws(() => workflow.publicIdentity(pem, '0'.repeat(64)), /fingerprint/);
  assert.throws(() => workflow.publicIdentity(pem), /fingerprint/);
  assert.throws(() => workflow.publicIdentity(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), fingerprint), /Only public/);
  for (const [type, options] of [['rsa', { modulusLength: 2048 }], ['ec', { namedCurve: 'prime256v1' }]]) {
    const key = crypto.generateKeyPairSync(type, options).publicKey;
    assert.throws(() => workflow.publicIdentity(key.export({ type: 'spki', format: 'pem' }), sha(key.export({ type: 'spki', format: 'der' }))), /RSA/);
  }
  assert.throws(() => workflow.publicIdentity('-----BEGIN PUBLIC KEY-----\ninvalid\n-----END PUBLIC KEY-----', fingerprint), /malformed/);
});

test('external secret input refuses workspace/output containment, links, wrong key and malformed bytes without disclosure', () => {
  const bytes = workflow.preparePolicy(review, candidate);
  assert.throws(() => workflow.signPolicy(bytes, identity, secretFile, [temporary]), /outside/);
  assert.throws(() => workflow.signPolicy(bytes, identity, path.join(root, 'package.json')), /outside/);
  assert.throws(() => workflow.signPolicy(bytes, identity, 'relative-key.pem'), /absolute/);
  assert.throws(() => workflow.signPolicy(bytes, identity, path.join(temporary, 'missing-key.pem')));
  const wrong = path.join(temporary, 'wrong-fixture.pem');
  fs.writeFileSync(wrong, other.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.throws(() => workflow.signPolicy(bytes, identity, wrong), /^Error: External private key or policy signing rejected; no key material is reported\.$/);
  fs.writeFileSync(wrong, 'SENSITIVE_TEST_SENTINEL');
  assert.throws(() => workflow.signPolicy(bytes, identity, wrong), /^Error: External private key or policy signing rejected; no key material is reported\.$/);
  const linked = path.join(temporary, 'linked-secret.pem');
  fs.linkSync(secretFile, linked);
  try { assert.throws(() => workflow.signPolicy(bytes, identity, linked), /hard link/); }
  finally { fs.unlinkSync(linked); }
  const junction = path.join(temporary, 'linked-candidate');
  fs.symlinkSync(candidate, junction, 'junction');
  assert.throws(() => workflow.preparePolicy(review, junction), /Linked/);
});

test('public-key compilation changes only two literal spans in temporary sources and checks parity', () => {
  const fixtureRoot = path.join(temporary, 'source');
  const before = workflow.anchorValues(root);
  for (const entry of before) {
    fs.mkdirSync(path.dirname(path.join(fixtureRoot, entry.file)), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, entry.file), entry.text);
  }
  assert.equal(workflow.checkAnchors(root), 'UNCONFIGURED');
  assert.equal(readNativeBrokerStatus('unused').code, 'NATIVE_RELEASE_TRUST_UNCONFIGURED');
  assert.throws(() => workflow.checkAnchors(root, identity), /not compiled/);
  assert.ok(workflow.compileAnchors(identity, { root: fixtureRoot }).every(edit => edit.changed));
  assert.equal(workflow.checkAnchors(fixtureRoot), 'UNCONFIGURED');
  workflow.compileAnchors(identity, { root: fixtureRoot, write: true });
  assert.equal(workflow.checkAnchors(fixtureRoot, identity), 'PUBLIC_KEY_COMPILED_INACTIVE');
  assert.ok(workflow.compileAnchors(identity, { root: fixtureRoot }).every(edit => !edit.changed));
  for (const [index, entry] of workflow.anchorValues(fixtureRoot).entries()) {
    assert.equal(entry.value, pem);
    const normalized = entry.text.replace(JSON.stringify(pem), index === 0 ? '""' : "''");
    assert.equal(normalized, before[index].text);
  }
  fs.writeFileSync(path.join(fixtureRoot, before[1].file), before[1].text);
  assert.throws(() => workflow.checkAnchors(fixtureRoot), /differ/);
  fs.appendFileSync(path.join(fixtureRoot, before[1].file), '\nconst RELEASE_PUBLIC_KEY = "";');
  assert.throws(() => workflow.compileAnchors(identity, { root: fixtureRoot, write: true }), /exactly one/);
  assert.equal(workflow.checkAnchors(root), 'UNCONFIGURED');
});

test('release CLI rejects omitted, duplicate and extra options before any mutation', () => {
  for (const args of [[], ['sign'], ['anchors', '--private-key', secretFile], ['anchors', '--public-key', 'x', '--public-key', 'y'], ['anchors', '--public-key', '--write']]) assert.throws(() => workflow.argumentsFor(args));
  assert.deepEqual(workflow.argumentsFor(['anchors', '--public-key', 'x', '--fingerprint', fingerprint]).options, { 'public-key': 'x', fingerprint });
  const publicFile = path.join(temporary, 'public.pem'); fs.writeFileSync(publicFile, pem);
  const reviewFile = path.join(temporary, 'review.json'); fs.writeFileSync(reviewFile, review);
  const output = path.join(temporary, 'must-not-exist');
  assert.throws(() => workflow.main(['sign', '--public-key', publicFile, '--fingerprint', fingerprint, '--review', reviewFile, '--candidate', candidate, '--private-key', secretFile, '--output', output]), /not compiled/);
  assert.equal(fs.existsSync(output), false);
});

test('native build with a closed compiler refuses source drift before issuing a manifest', () => {
  const fixtureRoot = path.join(temporary, 'build-source');
  const files = workflow.anchorValues(root).map(entry => [entry.file, entry.text]);
  files.push(['src/main/input-driver-lifecycle/release-policy-contract.cjs', '// inert fixture'], ['src/main/input-devices/usb-native.cs', '// inert fixture'], ['native/hidusbf-host/Fixture.cs', '// inert fixture'], ['native/hidusbf-broker/Fixture.cs', '// inert fixture']);
  for (const [file, text] of files) { fs.mkdirSync(path.dirname(path.join(fixtureRoot, file)), { recursive: true }); fs.writeFileSync(path.join(fixtureRoot, file), text); }
  const source = fs.readFileSync(path.join(root, 'scripts/build-hidusbf-native.cjs'), 'utf8');
  const execute = (destination, drift) => require('node:vm').runInNewContext(source, {
    __dirname: path.join(fixtureRoot, 'scripts'), console: { log() {} }, process: { argv: ['bun', 'build', '--output', destination] },
    require(name) {
      if (name === './native-release-policy.cjs') return workflow;
      if (name === 'node:child_process') return { execFileSync(command, args) {
        assert.equal(command, 'dotnet');
        const output = args[args.indexOf('-o') + 1]; fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, path.basename(args[1]).replace('.csproj', '.exe')), 'inert compiler output');
        if (drift) fs.appendFileSync(path.join(fixtureRoot, 'native/hidusbf-helper/ReleasePolicy.cs'), '\n// concurrent source edit\n');
      } };
      return require(name);
    },
  });
  const refused = path.join(temporary, 'build-refused');
  assert.throws(() => execute(refused, true), /source changed during compilation/);
  assert.equal(fs.existsSync(path.join(refused, 'BUILD_MANIFEST.json')), false);
  const stable = path.join(temporary, 'build-stable'); execute(stable, false);
  const manifest = JSON.parse(fs.readFileSync(path.join(stable, 'BUILD_MANIFEST.json')));
  assert.equal(manifest.policyTrust, 'UNCONFIGURED');
  assert.equal(manifest.signed, false);
  for (const entry of manifest.sources) assert.equal(entry.sha256, sha(fs.readFileSync(path.join(fixtureRoot, entry.file))));
});

test('isolated CLI prepares, signs and re-verifies exact policy files without packaging keys or overwriting outputs', { timeout: 60000 }, () => {
  const isolated = path.join(temporary, 'cli-source');
  const files = ['scripts/native-release-policy.cjs', 'scripts/build-hidusbf-native.cjs', 'src/main/input-driver-lifecycle/native-broker.cjs', 'src/main/input-driver-lifecycle/release-policy-contract.cjs', 'src/main/input-devices/usb-native.cs'];
  for (const folder of ['native/hidusbf-helper', 'native/hidusbf-helper-fixture', 'native/hidusbf-host', 'native/hidusbf-broker', 'native/hidusbf-boot-diagnostic']) {
    for (const name of fs.readdirSync(path.join(root, folder))) if (/\.(cs|csproj)$/.test(name)) files.push(`${folder}/${name}`);
  }
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(isolated, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(isolated, file));
  }
  const publicFile = path.join(temporary, 'cli-public.pem'); fs.writeFileSync(publicFile, pem);
  const reviewFile = path.join(temporary, 'cli-review.json'); fs.writeFileSync(reviewFile, review);
  const script = path.join(isolated, 'scripts/native-release-policy.cjs');
  const run = args => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  const keyArgs = ['--public-key', publicFile, '--fingerprint', fingerprint];
  assert.match(run(['anchors', ...keyArgs]), /PUBLIC_KEY_PREVIEW_ONLY/);
  assert.equal(workflow.checkAnchors(isolated), 'UNCONFIGURED');
  assert.match(run(['anchors', ...keyArgs, '--write']), /PUBLIC_KEY_COMPILED_INACTIVE/);
  assert.equal(workflow.checkAnchors(isolated, identity), 'PUBLIC_KEY_COMPILED_INACTIVE');
  // A configured default build must stop before dotnet or staged artifact writes.
  assert.throws(() => execFileSync(process.execPath, [path.join(isolated, 'scripts/build-hidusbf-native.cjs')], { stdio: 'pipe' }), /requires --output/);
  assert.equal(fs.existsSync(path.join(isolated, 'output')), false);
  const common = [...keyArgs, '--review', reviewFile, '--candidate', candidate];
  const prepared = path.join(temporary, 'cli-prepared');
  assert.match(run(['prepare', ...common, '--output', prepared]), /UNSIGNED_POLICY_PREPARED/);
  assert.deepEqual(fs.readdirSync(prepared), ['release-policy.json']);
  const signed = path.join(temporary, 'cli-signed');
  const result = run(['sign', ...common, '--private-key', secretFile, '--output', signed]);
  assert.match(result, /VALIDATION_POLICY_CONTRACT_VERIFIED/);
  assert.doesNotMatch(result, /PRIVATE KEY|ephemeral-test-key|BEGIN/);
  assert.deepEqual(fs.readdirSync(signed).sort(), ['release-policy.json', 'release-policy.sig']);
  assert.deepEqual(fs.readFileSync(path.join(prepared, 'release-policy.json')), fs.readFileSync(path.join(signed, 'release-policy.json')));
  assert.match(run(['verify', ...common, '--policy-dir', signed]), /VALIDATION_POLICY_CONTRACT_VERIFIED/);
  const before = fs.readFileSync(path.join(signed, 'release-policy.sig'));
  assert.throws(() => run(['sign', ...common, '--private-key', secretFile, '--output', signed]), /operation refused/);
  assert.deepEqual(fs.readFileSync(path.join(signed, 'release-policy.sig')), before);
  // Detached signing uses the exact prepared bytes and the same verification path.
  fs.writeFileSync(path.join(prepared, 'release-policy.sig'), sign(fs.readFileSync(path.join(prepared, 'release-policy.json'))));
  assert.match(run(['verify', ...common, '--policy-dir', prepared]), /VALIDATION_POLICY_CONTRACT_VERIFIED/);
  fs.writeFileSync(path.join(signed, 'release-policy.sig'), Buffer.alloc(384));
  assert.throws(() => run(['verify', ...common, '--policy-dir', signed]), /operation refused/);
  assert.equal(workflow.checkAnchors(root), 'UNCONFIGURED');
});

test('JavaScript signed-policy verdicts match the actual C# contract on the same adversarial corpus', { timeout: 60000 }, () => {
  const canonical = workflow.preparePolicy(review, candidate);
  const corpus = [];
  function add(name, bytes, accepted, signature = sign(bytes), publicKey = pem) {
    if (accepted) assert.doesNotThrow(() => verifyPolicy(bytes, signature, publicKey), name);
    else assert.throws(() => verifyPolicy(bytes, signature, publicKey), undefined, name);
    corpus.push({ name, bytes: bytes.toString('base64'), signature: signature.toString('base64'), publicKey, accepted });
  }
  add('prepared-external-signature', canonical, true, workflow.signPolicy(canonical, identity, secretFile));
  add('accepted-purpose-remains-a-separate-runtime-contract', raw({ ...policy, Purpose: 'ACCEPTED_RELEASE' }), true);
  add('duplicate-field', Buffer.from(review.toString().replace('"SchemaVersion":1', '"SchemaVersion":1,"SchemaVersion":1')), false);
  add('escaped-duplicate', Buffer.from(review.toString().replace('"SchemaVersion":1', '"SchemaVersion":1,"Schema\\u0056ersion":1')), false);
  add('fractional-schema', Buffer.from(review.toString().replace('"SchemaVersion":1', '"SchemaVersion":1.0')), false);
  add('exponent-schema', Buffer.from(review.toString().replace('"SchemaVersion":1', '"SchemaVersion":1e0')), false);
  for (const [name, change] of Object.entries({ extra: { Extra: true }, nested: { AcceptedPlatformDigests: [{ digest: 'a'.repeat(64) }] }, expired: { ExpiresAt: '2000-01-01T00:00:00Z' }, rollover: { ExpiresAt: '2099-02-30T00:00:00Z' }, dateOnly: { ExpiresAt: '2099-01-01' }, wrongPurpose: { Purpose: 'INSTALL' }, emptyPlatform: { AcceptedPlatformDigests: [] }, emptyDevice: { AuthorizedDeviceDigests: [] }, wildcard: { AuthorizedDeviceDigests: ['*'] }, duplicateScope: { AuthorizedDeviceDigests: ['e'.repeat(64), 'e'.repeat(64)] }, overScope: { AuthorizedDeviceDigests: Array.from({ length: 129 }, (_, i) => i.toString(16).padStart(64, '0')) }, numericPublisher: { PublisherThumbprint: 123 }, badHash: { BrokerSha256: 'A'.repeat(64) }, nullScope: { AuthorizedDeviceDigests: null } })) add(name, raw({ ...policy, ...change }), false);
  add('tampered-bytes', raw({ ...policy, BrokerSha256: 'a'.repeat(64) }), false, sign(review));
  add('wrong-public-key', review, false, sign(review), other.publicKey.export({ type: 'spki', format: 'pem' }));
  add('pkcs1-signature', review, false, crypto.sign('sha256', review, pair.privateKey));
  add('pss-wrong-salt', review, false, crypto.sign('sha256', review, { key: pair.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 0 }));
  add('empty-policy', Buffer.alloc(0), false);
  add('large-policy', Buffer.alloc(65537, 32), false);
  add('large-signature', review, false, Buffer.alloc(1025));
  add('empty-signature', review, false, Buffer.alloc(0));
  add('invalid-utf8', Buffer.concat([canonical.subarray(0, canonical.length - 2), Buffer.from([0xff]), Buffer.from('}')]), false);
  const missing = { ...policy }; delete missing.Purpose;
  add('missing-field', raw(missing), false);
  const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  add('weak-rsa', review, false, crypto.sign('sha256', review, { key: weak.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }), weak.publicKey.export({ type: 'spki', format: 'pem' }));
  const file = path.join(temporary, 'public-only-corpus.json'); fs.writeFileSync(file, JSON.stringify(corpus));
  const result = execFileSync('dotnet', ['run', '--project', path.join(root, 'native/hidusbf-helper-fixture/Dialed.HidusbfProtocolFixture.csproj'), '--configuration', 'Release', '--verbosity', 'quiet', '--', '--verify-policy-corpus', file], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.ok(result.includes(`closed-policy-corpus-pass:${corpus.length}`));
});
