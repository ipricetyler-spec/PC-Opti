function resourceVersionMatches(packageVersion, resourceVersion) {
  const expected = String(packageVersion || '').trim();
  const actual = String(resourceVersion || '').trim();
  if (!expected || !actual) return false;
  const escaped = [...expected].map((character) => '\\.^$*+?()[]{}|'.includes(character) ? '\\' + character : character).join('');
  return new RegExp('^' + escaped + '(?:\\.0+)*$').test(actual);
}

function assertArtifactVersion(packageVersion, artifact, name) {
  if (resourceVersionMatches(packageVersion, artifact?.fileVersion)
    && resourceVersionMatches(packageVersion, artifact?.productVersion)) return;
  const fileVersion = String(artifact?.fileVersion || '').trim() || 'unknown';
  const productVersion = String(artifact?.productVersion || '').trim() || 'unknown';
  throw new Error(name + ' reports version ' + fileVersion + ' / ' + productVersion + ', not ' + packageVersion + '. Rebuild it rather than publishing a stale artifact.');
}

module.exports = { assertArtifactVersion, resourceVersionMatches };
