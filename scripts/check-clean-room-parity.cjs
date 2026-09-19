const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const matrixPath = path.join(repositoryRoot, 'docs', 'CLEAN_ROOM_PARITY_MATRIX.md');
const allowedScanFiles = collectModuleFiles(path.join(repositoryRoot, 'src', 'main'));

function collectModuleFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectModuleFiles(target);
      return entry.isFile() && entry.name.endsWith('.cjs') ? [target] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function parseMatrixAllowedFamilies(matrixPathArg) {
  const matrix = fs.readFileSync(matrixPathArg, 'utf8');
  const lines = matrix.split(/\r?\n/);
  const rowLines = lines.filter((line) => line.trim().startsWith('| CRP-'));
  const allowed = new Set();
  for (const line of rowLines) {
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 7) continue;
    const families = (cells[5] || '').toLowerCase().replace(/[`]/g, '');
    for (const family of families.split(',')) {
      const token = family.trim();
      if (!token || token === '(none)') continue;
      allowed.add(token);
    }
  }
  return allowed;
}

function scanForMutationFamilies(filePath, families) {
  const content = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const mutations = [
    { family: 'bcdedit', pattern: /\bbcdedit\b/i },
    { family: 'startup-registry-run', pattern: /\b(New-ItemProperty|Remove-ItemProperty|Set-ItemProperty)\b/i },
  ];

  const used = new Set();
  const findings = [];

  content.forEach((line, index) => {
    for (const mut of mutations) {
      if (mut.pattern.test(line)) {
        used.add(mut.family);
        if (!families.has(mut.family)) {
          findings.push({
            file: path.relative(repositoryRoot, filePath),
            line: index + 1,
            family: mut.family,
            text: line.trim(),
          });
        }
      }
    }
  });

  return { findings, used };
}

function formatFindings(findings) {
  return findings
    .map((item) => `- ${item.file}:${item.line} → ${item.family} [${item.text}]`)
    .join('\n');
}

function main() {
  const allowed = parseMatrixAllowedFamilies(matrixPath);
  const allUsed = new Set();
  let allFindings = [];
  for (const target of allowedScanFiles) {
    if (!fs.existsSync(target)) continue;
    const { findings, used } = scanForMutationFamilies(target, allowed);
    findings.forEach((finding) => allFindings.push(finding));
    used.forEach((family) => allUsed.add(family));
  }

  if (allFindings.length > 0) {
    console.error('Clean-room parity guard failed: undocumented mutation family detected.');
    console.error(formatFindings(allFindings));
    process.exit(1);
  }

  const unused = [...allowed].filter((family) => !allUsed.has(family));
  const report = unused.length > 0 ? `Allowed but not observed this pass: ${unused.join(', ')}` : 'All documented families were observed.';
  console.log(`Clean-room parity guard passed. ${report}`);
}

main();
