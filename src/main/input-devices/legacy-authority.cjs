const fs = require('node:fs');
const path = require('node:path');

// No journal parsing or opening. Any native-owned directory is a conservative
// marker, including partially initialized or inaccessible native history.
function legacyRestoreAuthority(programData = process.env.ProgramData, io = fs) {
  if (!programData || !path.isAbsolute(programData)) return { allowed: false, message: 'Native recovery location is unavailable. Legacy restore is blocked.' };
  const root = path.resolve(programData);
  const target = path.join(root, 'Dialed', 'HidusbfLifecycle');
  const chain = [];
  for (let current = target; ; current = path.dirname(current)) {
    chain.unshift(current); if (current === path.dirname(current)) break;
  }
  try {
    for (const current of chain) {
      let stat;
      try { stat = io.lstatSync(current); }
      catch (error) { if (error.code === 'ENOENT' && current.startsWith(root + path.sep)) return { allowed: true, message: '' }; throw error; }
      if (stat.isSymbolicLink() || !stat.isDirectory()) return { allowed: false, message: 'Native recovery path is linked or unexpected. Legacy restore is blocked.' };
    }
    return { allowed: false, message: 'Native setup has reserved machine history. Legacy restore is blocked to avoid conflicting recovery records. The saved values remain below; migration through native recovery is not implemented. Do not delete native history to enable restore.' };
  } catch { return { allowed: false, message: 'Native recovery location could not be checked. Legacy restore is blocked.' }; }
}
module.exports = { legacyRestoreAuthority };
