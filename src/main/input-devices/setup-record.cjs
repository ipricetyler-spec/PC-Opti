// A read-only look at native setup's machine record, so the Input devices page can say when it
// needs attention without opening setup. It verifies the same hash chain the native helper writes
// (native/hidusbf-helper/ProtectedJournal.cs) and reads only the latest record. It never writes,
// locks or repairs anything; anything it cannot verify is reported as unknown (null), never as fine.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_PAYLOAD = 65536;
const MAX_FILE = 64 * 1024 * 1024;
const sha256 = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/** The latest payload of a verified journal, or null when it is truncated, altered or not UTF-8. */
function latestVerifiedPayload(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = 0, revision = 0, previous = '0'.repeat(64), last = null;
  while (offset < bytes.length) {
    if (bytes.length - offset < 4) return null;
    const length = bytes.readInt32LE(offset); offset += 4;
    if (length < 1 || length > MAX_PAYLOAD || bytes.length - offset < length + 64) return null;
    let payload;
    try { payload = decoder.decode(bytes.subarray(offset, offset + length)); } catch { return null; }
    offset += length;
    const recorded = bytes.subarray(offset, offset + 64).toString('ascii'); offset += 64;
    const hash = sha256(`${revision + 1}\n${previous}\n${payload}`);
    if (recorded !== hash) return null;
    revision += 1; previous = hash; last = payload;
  }
  return last;
}

// Setup names a device "<product> · <instance id>"; the page shows only the product name.
const plainName = (name) => typeof name === 'string' ? name.split(' · ')[0].replace(/[\x00-\x1f]/g, '').trim().slice(0, 120) : '';

/** NONE: setup has no record yet. OK / NEEDS_REVIEW / PENDING come from the latest record. */
function summarizeSetupRecord(payload) {
  if (payload === null) return { state: 'NONE', ownedDeviceIds: [], names: {} };
  let record;
  try { record = JSON.parse(payload); } catch { return null; }
  if (!record || typeof record !== 'object' || typeof record.NeedsReview !== 'boolean') return null;
  const devices = record.Ownership?.Devices && typeof record.Ownership.Devices === 'object' ? Object.keys(record.Ownership.Devices).filter((id) => /^[a-f0-9]{64}$/.test(id)) : [];
  // Names come from the saved observation, so a device that is not connected can still be named.
  const names = {};
  for (const device of Array.isArray(record.Expected?.Devices) ? record.Expected.Devices : []) {
    if (device && devices.includes(device.Id) && plainName(device.Name)) names[device.Id] = plainName(device.Name);
  }
  return { state: record.NeedsReview ? 'NEEDS_REVIEW' : record.Pending ? 'PENDING' : 'OK', ownedDeviceIds: devices, names };
}

function readSetupRecord(programData = process.env.ProgramData, io = fs) {
  try {
    if (!programData || !path.isAbsolute(programData)) return null;
    const file = path.join(path.resolve(programData), 'Dialed', 'HidusbfLifecycle', 'journal.bin');
    // Same link refusal as the helper: a redirected path is not setup's record.
    for (let current = file; current !== path.dirname(current); current = path.dirname(current)) {
      let stat;
      try { stat = io.lstatSync(current); } catch (error) { if (error.code === 'ENOENT' && current === file) return summarizeSetupRecord(null); if (error.code === 'ENOENT') return summarizeSetupRecord(null); throw error; }
      if (stat.isSymbolicLink()) return null;
      if (current === file && (!stat.isFile() || stat.size > MAX_FILE)) return null;
    }
    const payload = latestVerifiedPayload(io.readFileSync(file));
    return payload === null && io.statSync(file).size > 0 ? null : summarizeSetupRecord(payload);
  } catch { return null; }
}

module.exports = { latestVerifiedPayload, summarizeSetupRecord, readSetupRecord };
