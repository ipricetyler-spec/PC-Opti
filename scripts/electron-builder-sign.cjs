const { assertSigningReady, resolveSigningConfiguration, signFile } = require('./windows-signing.cjs');

exports.sign = async function sign(configuration) {
  const signing = resolveSigningConfiguration();
  assertSigningReady(signing);
  if (!signing.requested) return;
  const result = signFile(configuration.path, signing);
  const action = result.alreadyValid ? 'Verified existing signature' : 'Signed and verified';
  console.log(`${action}: ${configuration.path}`);
};
