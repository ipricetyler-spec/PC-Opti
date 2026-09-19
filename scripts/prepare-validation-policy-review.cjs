// Convert independently reviewed read-only scope evidence plus the preserved
// Authenticode manifest into the exact eight-field VALIDATION_ONLY review input.
// This script does not sign, package, launch or mutate anything.
const fs = require('node:fs');
const path = require('node:path');

const SHA256 = /^[a-f0-9]{64}$/;
const THUMBPRINT = /^[A-F0-9]{40}$/;

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!['--scope', '--signature-manifest', '--expires', '--output'].includes(name) || !value || options[name]) throw new Error('Expected unique scope, signature-manifest, expires and output options.');
    options[name] = value;
  }
  if (Object.keys(options).length !== 4 || !path.isAbsolute(options['--scope']) || !path.isAbsolute(options['--signature-manifest']) || !path.isAbsolute(options['--output'])) throw new Error('Review paths must be absolute.');
  if (fs.existsSync(options['--output']) || !fs.statSync(path.dirname(options['--output'])).isDirectory()) throw new Error('Review output must be a new file with an existing parent.');
  return options;
}

function buildReview(scope, signatures, expiresAt, now = Date.now()) {
  if (!scope || scope.schemaVersion !== 1 || scope.status !== 'READ_ONLY_VALIDATION_SCOPE_REVIEWED' || scope.readOnly !== true ||
      scope.deviceOperationsAuthorized !== false || scope.physicalAcceptance !== false || scope.observationCount < 2 ||
      typeof scope.machine !== 'string' || !Array.isArray(scope.selectedProducts) || scope.selectedProducts.length < 1 ||
      !Array.isArray(scope.acceptedPlatformDigests) || scope.acceptedPlatformDigests.length !== 1 || !scope.acceptedPlatformDigests.every((value) => SHA256.test(value)) ||
      !Array.isArray(scope.authorizedDeviceDigests) || scope.authorizedDeviceDigests.length !== scope.selectedProducts.length || !scope.authorizedDeviceDigests.every((value) => SHA256.test(value)) ||
      new Set(scope.authorizedDeviceDigests).size !== scope.authorizedDeviceDigests.length) throw new Error('Scope evidence is incomplete or not issuance-ready.');
  if (!signatures || signatures.schemaVersion !== 1 || signatures.status !== 'NATIVE_AUTHENTICODE_VERIFIED_POLICY_PENDING' ||
      signatures.ownerAuthorized !== true || signatures.policyIssued !== false || signatures.unsignedBuildPreserved !== true ||
      !Array.isArray(signatures.artifacts) || signatures.artifacts.length !== 2) throw new Error('Signed-native manifest is not the preserved verified candidate.');
  const byFile = new Map(signatures.artifacts.map((artifact) => [artifact.file, artifact]));
  const host = byFile.get('Dialed.HidusbfHost.exe'), broker = byFile.get('Dialed.HidusbfBroker.exe');
  if (!host || !broker || byFile.size !== 2) throw new Error('Signed-native manifest must contain only the broker and host.');
  for (const artifact of [host, broker]) {
    if (!SHA256.test(artifact.sha256) || !SHA256.test(artifact.unsignedSha256) || artifact.authenticode !== 'Valid' || artifact.timestampPresent !== true || artifact.signToolExit !== 0 || artifact.executed !== false || !THUMBPRINT.test(artifact.publisherThumbprint)) throw new Error('Signed-native artifact identity is incomplete.');
  }
  if (host.publisherThumbprint !== broker.publisherThumbprint || host.publisher !== broker.publisher) throw new Error('Signed-native publishers differ.');
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== expiresAt || expiry <= now || expiry > now + 7 * 24 * 60 * 60 * 1000) throw new Error('Expiry must be canonical UTC, future and within seven days.');
  return {
    SchemaVersion: 1,
    ExpiresAt: expiresAt,
    BrokerSha256: broker.sha256,
    HelperSha256: host.sha256,
    PublisherThumbprint: host.publisherThumbprint,
    AcceptedPlatformDigests: [...scope.acceptedPlatformDigests],
    Purpose: 'VALIDATION_ONLY',
    AuthorizedDeviceDigests: [...scope.authorizedDeviceDigests],
  };
}

function main(argv) {
  const options = parseArguments(argv);
  const scope = JSON.parse(fs.readFileSync(options['--scope'], 'utf8'));
  const signatures = JSON.parse(fs.readFileSync(options['--signature-manifest'], 'utf8'));
  const review = buildReview(scope, signatures, options['--expires']);
  fs.writeFileSync(options['--output'], `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: 'VALIDATION_POLICY_REVIEW_PREPARED', purpose: review.Purpose, expiresAt: review.ExpiresAt, platformCount: review.AcceptedPlatformDigests.length, deviceCount: review.AuthorizedDeviceDigests.length, output: options['--output'] }));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch { console.error('Validation policy review preparation refused. No policy was issued.'); process.exitCode = 1; }
}

module.exports = { buildReview, parseArguments };
