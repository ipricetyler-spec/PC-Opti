// The policy is a flat object of primitives and string arrays. Never use it as
// configuration for commands, paths, trust anchors or additional device scope.
const FIELDS = ['SchemaVersion', 'ExpiresAt', 'BrokerSha256', 'HelperSha256', 'PublisherThumbprint', 'AcceptedPlatformDigests', 'Purpose', 'AuthorizedDeviceDigests'];
const DIGEST = /^[a-f0-9]{64}$/;
// Schema 2, the general release: device and speed classes instead of listed devices.
// Must accept and refuse exactly what native/hidusbf-helper/ReleasePolicy.cs does.
const GENERAL_FIELDS = ['SchemaVersion', 'ExpiresAt', 'BrokerSha256', 'HelperSha256', 'PublisherThumbprint', 'Purpose', 'DeviceClasses', 'SpeedClasses', 'MinimumWindowsBuild', 'DeniedDevices'];
const DEVICE_CLASSES = ['MOUSE', 'KEYBOARD', 'GAMEPAD', 'JOYSTICK'];
const SPEED_CLASSES = ['FULL', 'HIGH'];
const MAXIMUM_GENERAL_LIFETIME_MS = 400 * 24 * 60 * 60 * 1000;

const boundedSet = (values, minimum, maximum, valid) => Array.isArray(values) && values.length >= minimum && values.length <= maximum
  && new Set(values).size === values.length && values.every((value) => typeof value === 'string' && valid(value));

function readTokens(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 65536) throw new Error('Native release policy exceeds bounds.');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Native release policy has invalid UTF-8.');
  let policy;
  try { policy = JSON.parse(text); } catch { throw new Error('Native release policy has invalid JSON.'); }
  // Strings are consumed whole, and numbers as one token, so a raw number can be compared.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|[^\s]/g) || [];
  const names = tokens.filter((token, index) => token.startsWith('"') && tokens[index + 1] === ':').map(token => JSON.parse(token));
  const rawValue = (name) => { const index = tokens.findIndex((token, i) => token.startsWith('"') && tokens[i + 1] === ':' && JSON.parse(token) === name); return index < 0 ? null : tokens[index + 2]; };
  return { policy, names, rawValue };
}

function isGeneralRelease(bytes) {
  try { const { policy, rawValue } = readTokens(bytes); return policy?.SchemaVersion === 2 && rawValue('SchemaVersion') === '2'; } catch { return false; }
}

function parseGeneralPolicy(bytes, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error('Native release policy exceeds bounds.');
  const { policy, names, rawValue } = readTokens(bytes);
  const expiry = typeof policy?.ExpiresAt === 'string' ? Date.parse(policy.ExpiresAt) : NaN;
  if (!policy || Array.isArray(policy) || names.length !== GENERAL_FIELDS.length || new Set(names).size !== names.length || names.some((name) => !GENERAL_FIELDS.includes(name)) ||
      policy.SchemaVersion !== 2 || rawValue('SchemaVersion') !== '2' || policy.Purpose !== 'ACCEPTED_RELEASE' ||
      typeof policy.ExpiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(policy.ExpiresAt) ||
      !Number.isFinite(expiry) || expiry <= now || expiry - now > MAXIMUM_GENERAL_LIFETIME_MS ||
      ![policy.BrokerSha256, policy.HelperSha256].every(value => typeof value === 'string' && DIGEST.test(value)) ||
      typeof policy.PublisherThumbprint !== 'string' || !/^[a-fA-F0-9]{40}$/.test(policy.PublisherThumbprint) ||
      !boundedSet(policy.DeviceClasses, 1, DEVICE_CLASSES.length, (value) => DEVICE_CLASSES.includes(value)) ||
      !boundedSet(policy.SpeedClasses, 1, SPEED_CLASSES.length, (value) => SPEED_CLASSES.includes(value)) ||
      !Number.isInteger(policy.MinimumWindowsBuild) || rawValue('MinimumWindowsBuild') !== String(policy.MinimumWindowsBuild) ||
      policy.MinimumWindowsBuild < 17763 || policy.MinimumWindowsBuild > 99999 ||
      !boundedSet(policy.DeniedDevices, 0, 512, (value) => /^[0-9A-F]{4}:[0-9A-F]{4}$/.test(value))) {
    throw new Error('Native release policy is invalid or expired.');
  }
  return policy;
}

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
module.exports = { parsePolicy, parseGeneralPolicy, isGeneralRelease, FIELDS, GENERAL_FIELDS, DEVICE_CLASSES, SPEED_CLASSES };
