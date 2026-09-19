// The policy is a flat object of primitives and string arrays. Never use it as
// configuration for commands, paths, trust anchors or additional device scope.
const FIELDS = ['SchemaVersion', 'ExpiresAt', 'BrokerSha256', 'HelperSha256', 'PublisherThumbprint', 'AcceptedPlatformDigests', 'Purpose', 'AuthorizedDeviceDigests'];
const DIGEST = /^[a-f0-9]{64}$/;
function parsePolicy(bytes, now = Date.now()) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 65536 || !Number.isFinite(now)) throw new Error('Native release policy exceeds bounds.');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Native release policy has invalid UTF-8.');
  let policy;
  try { policy = JSON.parse(text); } catch { throw new Error('Native release policy has invalid JSON.'); }
  // Consume entire JSON strings, including escaped quotes, so a colon inside a
  // value cannot masquerade as a field. JSON.parse above validates the grammar.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[^\s]/g) || [];
  const names = tokens.filter((token, index) => token.startsWith('"') && tokens[index + 1] === ':').map(token => JSON.parse(token));
  const schemaIndex = tokens.findIndex((token, index) => token.startsWith('"') && tokens[index + 1] === ':' && JSON.parse(token) === 'SchemaVersion');
  const expiry = typeof policy?.ExpiresAt === 'string' ? Date.parse(policy.ExpiresAt) : NaN;
  if (!policy || Array.isArray(policy) || names.length !== FIELDS.length || new Set(names).size !== FIELDS.length || names.some(name => !FIELDS.includes(name)) ||
      policy.SchemaVersion !== 1 || tokens[schemaIndex + 2] !== '1' || ![',', '}'].includes(tokens[schemaIndex + 3]) || !['VALIDATION_ONLY', 'ACCEPTED_RELEASE'].includes(policy.Purpose) ||
      typeof policy.ExpiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(policy.ExpiresAt) ||
      !Number.isFinite(expiry) || expiry <= now || new Date(expiry).toISOString().slice(0, 19) !== policy.ExpiresAt.slice(0, 19) ||
      ![policy.BrokerSha256, policy.HelperSha256].every(value => typeof value === 'string' && DIGEST.test(value)) ||
      typeof policy.PublisherThumbprint !== 'string' || !/^[a-fA-F0-9]{40}$/.test(policy.PublisherThumbprint) ||
      ![policy.AcceptedPlatformDigests, policy.AuthorizedDeviceDigests].every(values => Array.isArray(values) && values.length >= 1 && values.length <= 128 && new Set(values).size === values.length && values.every(value => typeof value === 'string' && DIGEST.test(value)))) {
    throw new Error('Native release policy is invalid or expired.');
  }
  return policy;
}
module.exports = { parsePolicy, FIELDS };
