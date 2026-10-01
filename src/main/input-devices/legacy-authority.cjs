const fs = require('node:fs');
const path = require('node:path');

// No journal parsing or opening. Any native-owned directory is a conservative
// marker, including partially initialized or inaccessible native history.
function legacyRestoreAuthority(programData = process.env.ProgramData, io = fs) {
  if (!programData || !path.isAbsolute(programData)) return { allowed: false, message: 'Dialed could not check where setup keeps its history, so this older restore is switched off to avoid two conflicting records. The saved values are listed below.' };
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
      if (stat.isSymbolicLink() || !stat.isDirectory()) return { allowed: false, message: 'The folder where setup keeps its history is not an ordinary folder, so this older restore is switched off to be safe. The saved values are listed below.' };
    }
    return { allowed: false, message: 'Setup now keeps the history for these devices, so this older restore is switched off to avoid two conflicting records. The saved values are listed below. Do not delete setup\'s history to get around this.' };
  } catch { return { allowed: false, message: 'Dialed could not check where setup keeps its history, so this older restore is switched off to avoid two conflicting records. The saved values are listed below.' }; }
}
module.exports = { legacyRestoreAuthority };
