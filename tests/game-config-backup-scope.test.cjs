const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gc = require('../src/main/game-config/index.cjs');

test('a settings file outside the user profile is refused at backup time, not hidden afterwards', () => {
  // Reproduces the review finding: a backup of a file on another drive used to be
  // written, then silently left out of the list because restores are profile-only.
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-gc-scope-'));
  const outside = fs.mkdtempSync(path.join(__dirname, '..', '.test-outside-profile-'));
  const configFile = path.join(outside, 'settings.ini');
  fs.writeFileSync(configFile, '[Video]\nFrameCap=141\n');
  const environment = { LOCALAPPDATA: path.join(os.tmpdir(), 'no-such-local'), APPDATA: path.join(os.tmpdir(), 'no-such-roaming'), USERPROFILE: path.join(os.tmpdir(), 'no-such-profile') };
  try {
    assert.throws(() => gc.createGameConfigBackup(userData, 'valorant', [configFile], { environment }), /only back up game settings files inside your own user folder/);
    assert.deepEqual(gc.listGameConfigBackups(userData), []);
    assert.equal(fs.readdirSync(userData).length, 0, 'nothing is written');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a settings file inside the user profile is still backed up and listed', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-gc-scope-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-gc-profile-'));
  const configFile = path.join(profile, 'GameUserSettings.ini');
  fs.writeFileSync(configFile, '[Video]\nFrameCap=141\n');
  const environment = { LOCALAPPDATA: profile, APPDATA: profile, USERPROFILE: profile };
  try {
    gc.createGameConfigBackup(userData, 'valorant', [configFile], { environment });
    const previous = { ...process.env };
    Object.assign(process.env, environment);
    try {
      assert.equal(gc.listGameConfigBackups(userData).length, 1);
    } finally {
      for (const key of Object.keys(environment)) process.env[key] = previous[key];
    }
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
