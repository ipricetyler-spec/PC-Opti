const fs = require('node:fs');
const path = require('node:path');
const {
  assertSigningReady,
  resolveSigningConfiguration,
  signFile,
  verifySignature,
} = require('./windows-signing.cjs');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_ROOT = path.join(ROOT, 'dist-electron');
const REPORT_PATH = path.join(ARTIFACT_ROOT, 'CODESIGN_REPORT.json');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function isCurrentReleaseArtifact(name) {
  const productName = String(PACKAGE.build?.productName || PACKAGE.name || '').trim();
  const version = String(PACKAGE.version || '').trim();
  return name === `${productName} ${version}.exe`
    || name === `${productName} Setup ${version}.exe`
    || name === `${productName} ${version}.msi`;
}

function listSignableArtifacts() {
  if (!fs.existsSync(ARTIFACT_ROOT)) return [];
  const targets = fs.readdirSync(ARTIFACT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isCurrentReleaseArtifact(entry.name))
    .map((entry) => path.join(ARTIFACT_ROOT, entry.name));
  const productName = String(PACKAGE.build?.productName || PACKAGE.name || '').trim();
  const unpackedExecutable = path.join(ARTIFACT_ROOT, 'win-unpacked', `${productName}.exe`);
  if (fs.existsSync(unpackedExecutable)) targets.push(unpackedExecutable);
  return targets.sort();
}

function relativeArtifact(filePath) {
  return path.relative(ARTIFACT_ROOT, filePath).replaceAll('\\', '/');
}

function writeReport(report) {
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  if (!fs.existsSync(ARTIFACT_ROOT)) {
    throw new Error('dist-electron does not exist. Run bun run electron:build first.');
  }

  const signing = resolveSigningConfiguration();
  const targets = listSignableArtifacts();
  const report = {
    generatedAt: new Date().toISOString(),
    requested: signing.requested,
    requireSigning: signing.required,
    provider: signing.provider,
    platform: process.platform,
    artifactsScanned: targets.map(relativeArtifact),
    signed: [],
    verified: [],
    skipped: [],
    errors: [],
    verifier: 'Windows SignTool Authenticode policy verification',
  };

  try {
    assertSigningReady(signing);
    if (!targets.length) throw new Error('No signable release artifacts were found.');

    for (const filePath of targets) {
      const artifact = relativeArtifact(filePath);
      try {
        const current = verifySignature(filePath, signing);
        if (current.valid) {
          report.verified.push(artifact);
          continue;
        }
        if (!signing.requested) {
          report.skipped.push(`${artifact}: signing disabled and no valid signature was found.`);
          continue;
        }
        const result = signFile(filePath, signing);
        if (result.signed) report.signed.push(artifact);
        report.verified.push(artifact);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.errors.push(`${artifact}: ${message}`);
      }
    }

    if (signing.required && report.verified.length !== targets.length) {
      throw new Error(`Required signing verification passed for ${report.verified.length} of ${targets.length} artifacts.`);
    }
    if (report.errors.length) throw new Error(`Signing completed with ${report.errors.length} error(s).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!report.errors.includes(message)) report.errors.push(message);
    throw error;
  } finally {
    writeReport(report);
  }

  console.log(`Verified ${report.verified.length} signed artifact(s).`);
  console.log(`Wrote signing report: ${REPORT_PATH}`);
}

main();
