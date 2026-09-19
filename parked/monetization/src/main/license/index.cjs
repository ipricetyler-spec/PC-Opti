// PARKED: unreachable historical prototype; excluded from the active build.
const fs = require('node:fs');

const LICENSE_STATE_FILE = 'pc-opti-license.json';
const DEFAULT_STATE = {
  tier: 'free',
  mode: 'free',
  expiresAt: null,
  source: 'manual',
  updatedAt: new Date().toISOString(),
};

// No usable entitlement secrets or offline master codes belong in source control.
const ACTIVATION_CODE_MAP = Object.freeze({});

const TRIAL_OPTIONS = Object.freeze({
  7: 7,
  14: 14,
});

function getLicensePath(userDataPath) {
  return `${userDataPath}\\${LICENSE_STATE_FILE}`;
}

function parseLicenseState(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === 'object'
      && ['free', 'premium'].includes(parsed.tier)
      && ['free', 'trial', 'activated'].includes(parsed.mode)
      && ['local-trial', 'activation-code', 'manual', 'unknown'].includes(parsed.source)
      && (parsed.expiresAt === null || typeof parsed.expiresAt === 'string')
    ) {
      return parsed;
    }
  } catch {
    // Intentionally fall through to null on malformed state payloads.
  }
  return null;
}

function normalizeDate(value) {
  if (!value) return null;
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) return null;
  return new Date(epoch).toISOString();
}

function isTrialExpired(state) {
  if (!state || state.mode !== 'trial' || !state.expiresAt) return false;
  const expiresAt = Date.parse(state.expiresAt);
  if (Number.isNaN(expiresAt)) return true;
  return Date.now() >= expiresAt;
}

function buildState(overrides) {
  return {
    ...DEFAULT_STATE,
    ...overrides,
    updatedAt: new Date().toISOString(),
  };
}

function writeLicenseState(userDataPath, state) {
  const target = getLicensePath(userDataPath);
  fs.writeFileSync(target, JSON.stringify(state), 'utf8');
  return state;
}

function readLicenseState(userDataPath) {
  const target = getLicensePath(userDataPath);
  try {
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = parseLicenseState(raw);
    if (!parsed) return buildState({});
    if (parsed.tier === 'premium' && parsed.mode === 'trial' && isTrialExpired(parsed)) {
      return writeLicenseState(userDataPath, buildState({ tier: 'free', mode: 'free', source: 'manual', expiresAt: null }));
    }
    return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return buildState({});
    }
    return buildState({});
  }
}

function clearLicenseState(userDataPath) {
  const target = getLicensePath(userDataPath);
  try {
    fs.unlinkSync(target);
  } catch {
    // No file is also a valid clear state.
  }
  return buildState({});
}

function startConsumerTrial(userDataPath, days) {
  const trialDays = TRIAL_OPTIONS[days] ?? 14;
  const expiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  return writeLicenseState(
    userDataPath,
    buildState({
      tier: 'premium',
      mode: 'trial',
      source: 'local-trial',
      expiresAt,
    }),
  );
}

function redeemPremiumCode(userDataPath, code) {
  const normalized = String(code || '').toUpperCase().trim().replace(/\s+/g, '-');
  const match = ACTIVATION_CODE_MAP[normalized];
  if (!match) {
    throw new Error('This activation code is not recognized. Contact support for a valid code.');
  }
  if (match.expiresAt) {
    const [, amount] = String(match.expiresAt).match(/^(\d+)$/) || [];
    const expiration = amount ? new Date(Date.now() + Number(amount) * 24 * 60 * 60 * 1000).toISOString() : null;
    return writeLicenseState(userDataPath, buildState({ ...match, expiresAt: expiration }));
  }
  return writeLicenseState(userDataPath, buildState({ ...match }));
}

function hasPremiumEntitlement(state) {
  if (!state || state.tier !== 'premium') return false;
  if (state.mode === 'trial' && isTrialExpired(state)) return false;
  return true;
}

module.exports = {
  clearLicenseState,
  hasPremiumEntitlement,
  readLicenseState,
  redeemPremiumCode,
  startConsumerTrial,
};
