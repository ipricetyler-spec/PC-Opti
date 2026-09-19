const fs = require('fs');
const path = require('path');

const ACCEPTANCE_SWITCH = '--pc-opti-acceptance-user-data-dir=';
const DISPOSABLE_DECLARATION = 'owner-approved disposable Windows environment';
const FIXTURE_MARKER = '.pc-opti-acceptance-fixture.json';
const FIXTURE_PURPOSE = 'pc-opti-interrupted-recovery-acceptance';

function isInsideDirectory(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveAcceptanceUserDataPath(options = {}) {
  const argv = options.argv || [];
  const environment = options.environment || {};
  const readFile = options.readFile || ((filePath) => fs.readFileSync(filePath, 'utf8'));
  const requested = argv.filter((argument) => String(argument).startsWith(ACCEPTANCE_SWITCH));
  if (!requested.length) return null;
  if (requested.length !== 1) throw new Error('Exactly one Dialed acceptance user-data path may be supplied.');
  if (environment.PC_OPTI_DISPOSABLE_TEST_ENV !== DISPOSABLE_DECLARATION) {
    throw new Error('The acceptance user-data path requires the exact owner-approved disposable-environment declaration.');
  }

  const rawPath = requested[0].slice(ACCEPTANCE_SWITCH.length);
  if (!rawPath || rawPath.length > 512 || !path.isAbsolute(rawPath)) {
    throw new Error('The acceptance user-data path must be a bounded absolute path.');
  }
  const resolved = path.resolve(rawPath);
  if (!options.homePath || !isInsideDirectory(options.homePath, resolved)) {
    throw new Error('The acceptance user-data path must be a dedicated directory inside the current test user home.');
  }

  const markerPath = path.join(resolved, FIXTURE_MARKER);
  let marker;
  try {
    marker = JSON.parse(readFile(markerPath));
  } catch (error) {
    throw new Error(`The acceptance user-data marker could not be validated: ${error.message}`);
  }
  if (marker?.schemaVersion !== '1.0.0' || marker?.purpose !== FIXTURE_PURPOSE || marker?.disposable !== true) {
    throw new Error('The acceptance user-data marker does not authorize this disposable recovery fixture.');
  }
  return resolved;
}

function configureAcceptanceUserDataPath(app, options = {}) {
  const requested = resolveAcceptanceUserDataPath({
    argv: options.argv,
    environment: options.environment,
    homePath: options.homePath || app.getPath('home'),
    readFile: options.readFile,
  });
  if (requested) app.setPath('userData', requested);
  return requested;
}

module.exports = {
  ACCEPTANCE_SWITCH,
  DISPOSABLE_DECLARATION,
  FIXTURE_MARKER,
  FIXTURE_PURPOSE,
  configureAcceptanceUserDataPath,
  resolveAcceptanceUserDataPath,
};
