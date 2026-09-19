// Parked for v0.1. This module is retained as design history and is not part of the runtime tree.
const { migrateSystemScanSnapshot } = require('../snapshot/index.cjs');

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createAiAuditPreview(snapshot) {
  const normalizedSnapshot = migrateSystemScanSnapshot(snapshot);

  const payload = {
    schemaVersion: '1.1.0-ai-redacted',
    snapshotTimestamp: String(normalizedSnapshot.timestamp || ''),
    metrics: {
      os: {
        caption: String(normalizedSnapshot.metrics?.os?.caption || 'Unavailable'),
        version: String(normalizedSnapshot.metrics?.os?.version || 'Unavailable'),
        build: String(normalizedSnapshot.metrics?.os?.build || 'Unavailable'),
        architecture: String(normalizedSnapshot.metrics?.os?.architecture || 'Unavailable'),
      },
      cpu: {
        name: String(normalizedSnapshot.metrics?.cpu?.name || 'Unavailable'),
        cores: finiteNumber(normalizedSnapshot.metrics?.cpu?.cores),
        logicalProcessors: finiteNumber(normalizedSnapshot.metrics?.cpu?.logicalProcessors),
        maxClockSpeedMhz: finiteNumber(normalizedSnapshot.metrics?.cpu?.maxClockSpeedMhz),
      },
      memory: {
        totalBytes: finiteNumber(normalizedSnapshot.metrics?.memory?.totalBytes),
        freeBytes: finiteNumber(normalizedSnapshot.metrics?.memory?.freeBytes),
        loadPercentage: finiteNumber(normalizedSnapshot.metrics?.memory?.loadPercentage),
      },
      storage: (Array.isArray(normalizedSnapshot.metrics?.storage) ? normalizedSnapshot.metrics.storage : []).map((drive) => ({
        totalBytes: finiteNumber(drive.totalBytes),
        freeBytes: finiteNumber(drive.freeBytes),
        isSSD: Boolean(drive.isSSD),
        trimEnabled: Boolean(drive.trimEnabled),
      })),
      startup: {
        enabledItemCount: (Array.isArray(normalizedSnapshot.metrics?.startupItems) ? normalizedSnapshot.metrics.startupItems : [])
          .filter((item) => item?.enabled).length,
      },
      tempFiles: {
        totalSizeBytes: finiteNumber(normalizedSnapshot.metrics?.tempFiles?.totalSizeBytes),
        pathCount: finiteNumber(normalizedSnapshot.metrics?.tempFiles?.pathCount),
      },
    },
    metadata: {
      elevated: Boolean(normalizedSnapshot.metadata?.elevated),
      incompleteComponents: (Array.isArray(normalizedSnapshot.metadata?.errors) ? normalizedSnapshot.metadata.errors : [])
        .map((error) => String(error?.component || 'unknown')),
    },
  };

  return {
    provider: 'Google Gemini',
    model: 'gemini-2.5-flash',
    payload,
    omittedFields: [
      'deviceHash',
      'storage drive letters and labels',
      'startup item names and command paths',
      'raw scan error messages',
      'expanded GPU, motherboard, power, gaming, page-file, storage-health, network, Secure Boot, TPM, and virtualization diagnostics',
      'usernames, machine name, IP addresses, serial numbers, and installed-software inventory',
    ],
  };
}

function isAuditResult(value) {
  return Boolean(value) &&
    Array.isArray(value.facts) &&
    Array.isArray(value.inferences) &&
    Array.isArray(value.recommendations) &&
    Array.isArray(value.limitations) &&
    value.recommendations.every((item) => item &&
      typeof item.title === 'string' &&
      typeof item.rationale === 'string' &&
      ['REVIEW', 'OPTIONAL_MAINTENANCE', 'NO_ACTION'].includes(item.action));
}

async function runGroundedAiAudit(snapshot) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('AI audit is unavailable: GEMINI_API_KEY is not configured.');
  }
  const preview = createAiAuditPreview(snapshot);
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `You are a cautious Windows maintenance analyst. Analyze only the redacted JSON below.\n\nRules:\n- Never invent measurements, applications, driver versions, temperatures, game installations, benchmark gains, or successful maintenance outcomes.\n- Facts must be directly present in the payload and cite their JSON path.\n- Put judgement only in inferences or recommendations.\n- Do not recommend driver changes, RAM cleaners, pagefile changes, registry sweeps, network tweaks, service disabling, or one-click optimization.\n- Recommendations may only suggest reviewing startup load, optionally clearing the observed temporary-file estimate, or optionally requesting ReTRIM when an SSD reports TRIM enabled.\n- If metadata.incompleteComponents is non-empty, describe the scan as incomplete.\n- Return JSON only with: facts, inferences, recommendations [{title,rationale,action}], limitations.\n\nRedacted payload:\n${JSON.stringify(preview.payload)}`;
  const response = await ai.models.generateContent({
    model: preview.model,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });
  const text = response.text?.trim();
  if (!text) throw new Error('The AI provider returned an empty response.');
  const result = JSON.parse(text);
  if (!isAuditResult(result)) throw new Error('The AI provider returned an invalid audit schema.');
  return result;
}

module.exports = { createAiAuditPreview, isAuditResult, runGroundedAiAudit };
