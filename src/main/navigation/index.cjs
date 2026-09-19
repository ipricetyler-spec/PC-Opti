function normalizeExternalTarget(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('External link is not valid.');
  }
  const trimmed = value.trim();
  if (/^mailto:/i.test(trimmed)) {
    if (!/^mailto:[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/i.test(trimmed)) throw new Error('External email link is not valid.');
    return trimmed;
  }
  let parsed;
  try { parsed = new URL(trimmed); }
  catch { throw new Error('External link is not a valid URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('External links must use credential-free HTTPS.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || /^\d+(?:\.\d+){3}$/.test(hostname) || hostname.includes(':')) {
    throw new Error('Local and numeric external-link hosts are not supported.');
  }
  return parsed.toString();
}

function isAllowedAppNavigation(value, trustedEntry) {
  try {
    const candidate = new URL(value);
    const trusted = new URL(trustedEntry);
    if (trusted.protocol === 'file:') {
      const candidateFile = decodeURIComponent(candidate.href.split(/[?#]/, 1)[0]).toLowerCase();
      const trustedFile = decodeURIComponent(trusted.href.split(/[?#]/, 1)[0]).toLowerCase();
      return candidate.protocol === 'file:' && candidateFile === trustedFile;
    }
    return candidate.protocol === trusted.protocol && candidate.origin === trusted.origin;
  } catch {
    return false;
  }
}

module.exports = { isAllowedAppNavigation, normalizeExternalTarget };
