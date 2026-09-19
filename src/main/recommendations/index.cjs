const { isCapabilityAvailable, listCapabilities } = require('../capabilities/index.cjs');
const { migrateSystemScanSnapshot, validateSystemScanSnapshot } = require('../snapshot/index.cjs');

function capabilityMap() {
  return new Map(listCapabilities().map((capability) => [capability.id, capability]));
}

function targetPanel(input) {
  if (input.id === 'memory-pressure-review') {
    return { id: 'balancer', label: 'See background apps', sectionId: null };
  }
  if (input.id === 'network-disconnected') {
    return { id: 'network-quality', label: 'Check network', sectionId: null };
  }
  if (input.id === 'startup-review') {
    return { id: 'startup', label: 'Review startup apps', sectionId: null };
  }
  if (input.actionId === 'clear-temp-files' || String(input.actionId || '').startsWith('retrim-drive:')) {
    return { id: 'maintenance', label: 'Open maintenance', sectionId: null };
  }
  if (String(input.id || '').startsWith('low-storage-')) {
    return { id: 'overview', label: 'See drives', sectionId: 'storage-volumes' };
  }
  return { id: 'overview', label: 'See details', sectionId: 'expanded-diagnostics' };
}

// A recommendation's target panel is only reachable if the tab it points to is
// itself visible in the active runtime profile (App.tsx builds availableTabs from
// these same capability ids). Without this check, a guidance-only recommendation
// (no actionId, so it is never removed by the profile filter below) could still
// link to a tab hidden in the public profile, such as Background apps.
const PANEL_REQUIRED_CAPABILITY = {
  overview: 'diagnostic:system-scan',
  startup: 'startup:disable-current-user-run',
  balancer: 'process:enable-ecoqos',
  'network-quality': 'diagnostic:system-scan',
  // maintenance is reachable via either maintenance capability; both share the
  // same profile list today, so checking one is equivalent.
  maintenance: 'maintenance:clear-temp-files',
};
const FALLBACK_PANEL = { id: 'overview', label: 'See details', sectionId: 'expanded-diagnostics' };

function reachableTargetPanel(panel, profile) {
  const requiredCapabilityId = PANEL_REQUIRED_CAPABILITY[panel.id];
  if (requiredCapabilityId && isCapabilityAvailable(requiredCapabilityId, profile)) return panel;
  return FALLBACK_PANEL;
}

function recommendation(capabilities, input) {
  // APPLICABLE means the enclosing observed-evidence condition supports this
  // review. Live prerequisites and authority are rechecked by mutation handlers.
  const capability = capabilities.get(input.capabilityId);
  if (!capability) throw new Error(`Recommendation references unknown capability ${input.capabilityId}.`);
  if (!['APPLICABLE', 'NOT_APPLICABLE', 'UNAVAILABLE'].includes(input.applicability)) throw new Error('Recommendation must explicitly declare evidence applicability.');
  return {
    id: input.id,
    title: input.title,
    category: input.category,
    observation: input.observation,
    rationale: input.rationale,
    evidence: {
      paths: input.paths,
      summary: input.evidence,
    },
    expectedBenefit: input.expectedBenefit || capability.expectedBenefit,
    risk: capability.riskLevel,
    confidence: input.confidence,
    applicability: input.applicability,
    actionStatus: input.actionStatus,
    actionId: input.actionId || null,
    capabilityId: capability.id,
    targetPanel: targetPanel(input),
    rollback: {
      method: capability.rollbackMethod,
      limitations: capability.rollbackLimitations,
    },
    verification: capability.verificationMethod,
  };
}

function available(evidence) {
  return evidence?.status === 'AVAILABLE';
}

function formatBytes(bytes) {
  const amount = Number(bytes);
  if (!Number.isFinite(amount) || amount < 0) return 'an unreported amount';
  if (amount < 1024) return `${amount} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = amount;
  let index = -1;
  do {
    value /= 1024;
    index += 1;
  } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function buildLocalRecommendations(inputSnapshot, profile = 'owner') {
  const snapshot = migrateSystemScanSnapshot(inputSnapshot);
  validateSystemScanSnapshot(snapshot);
  const capabilities = capabilityMap();
  const results = [];
  const guidanceCapabilityId = 'guidance:observed-system-state';

  const memory = available(snapshot.metrics.memory) ? snapshot.metrics.memory.value : null;
  if (memory && Number.isFinite(memory.loadPercentage) && memory.loadPercentage >= 80) {
    results.push(recommendation(capabilities, {
      id: 'memory-pressure-review',
      title: 'Memory use is high',
      category: 'Memory',
      observation: `${memory.loadPercentage}% of memory was in use when Dialed scanned.`,
      rationale: 'If it stays this high while you play, Windows may start using the slower disk. One reading alone is not a problem.',
      evidence: `metrics.memory.value.loadPercentage = ${memory.loadPercentage}`,
      paths: ['metrics.memory.value.loadPercentage', 'metrics.memory.value.freeBytes'],
      applicability: 'APPLICABLE',
      confidence: 'Medium',
      actionStatus: 'GUIDANCE_ONLY',
      capabilityId: guidanceCapabilityId,
      expectedBenefit: 'Check which background apps are running. Dialed does not "clear RAM" or change the page file.',
    }));
  }

  const startupCount = snapshot.metrics.startupItems.filter((item) => item.enabled).length;
  if (startupCount > 0) {
    results.push(recommendation(capabilities, {
      id: 'startup-review',
      title: 'Check your startup apps',
      category: 'Startup',
      observation: `${startupCount} app${startupCount === 1 ? '' : 's'} start${startupCount === 1 ? 's' : ''} with Windows.`,
      rationale: 'Starting with Windows is not bad by itself. Turn off only the ones you recognise and do not need, one at a time.',
      evidence: `metrics.startupItems contains ${startupCount} enabled item${startupCount === 1 ? '' : 's'}.`,
      paths: ['metrics.startupItems'],
      applicability: 'APPLICABLE',
      confidence: 'High',
      actionStatus: 'REVIEW',
      capabilityId: 'startup:disable-current-user-run',
      expectedBenefit: 'Less running in the background after you sign in. It may or may not make startup faster.',
    }));
  }

  if (snapshot.metrics.tempFiles.pathCount > 0) {
    results.push(recommendation(capabilities, {
      id: 'temporary-file-cleanup',
      title: 'Clear temporary files',
      category: 'Storage',
      observation: `${formatBytes(snapshot.metrics.tempFiles.totalSizeBytes)} in ${snapshot.metrics.tempFiles.pathCount} temporary files.`,
      rationale: 'Frees disk space. It does not make your PC faster.',
      evidence: `metrics.tempFiles = ${JSON.stringify(snapshot.metrics.tempFiles)}`,
      paths: ['metrics.tempFiles.totalSizeBytes', 'metrics.tempFiles.pathCount'],
      applicability: 'APPLICABLE',
      confidence: 'High',
      actionStatus: 'OPTIONAL_ACTION',
      actionId: 'clear-temp-files',
      capabilityId: 'maintenance:clear-temp-files',
    }));
  }

  const storage = available(snapshot.metrics.storage) ? snapshot.metrics.storage.value : [];
  for (const drive of storage) {
    const percentFree = drive.totalBytes > 0 ? Math.round((drive.freeBytes / drive.totalBytes) * 100) : null;
    if (percentFree !== null && percentFree <= 10) {
      results.push(recommendation(capabilities, {
        id: `low-storage-${drive.driveLetter}`,
        title: `${drive.driveLetter}: is almost full`,
        category: 'Storage',
        observation: `${drive.driveLetter}: has ${formatBytes(drive.freeBytes)} free (${percentFree}%).`,
        rationale: 'Windows updates and games need free space. Dialed will not guess which of your files to remove.',
        evidence: `metrics.storage.value[${drive.driveLetter}] reports ${drive.freeBytes} free of ${drive.totalBytes} bytes.`,
        paths: ['metrics.storage.value[].driveLetter', 'metrics.storage.value[].freeBytes', 'metrics.storage.value[].totalBytes'],
        applicability: 'APPLICABLE',
        confidence: 'High',
        actionStatus: 'GUIDANCE_ONLY',
        capabilityId: guidanceCapabilityId,
        expectedBenefit: 'Free up space yourself, for example with Windows Storage settings.',
      }));
    }
    if (drive.isSSD && drive.trimEnabled) {
      results.push(recommendation(capabilities, {
        id: `retrim-${drive.driveLetter}`,
        title: `Run TRIM on ${drive.driveLetter}:`,
        category: 'Storage',
        observation: `${drive.driveLetter}: is an SSD with TRIM turned on.`,
        rationale: 'Asks Windows to tell the SSD which space is free, which Windows also does on a schedule. Optional upkeep, not a speed boost.',
        evidence: `metrics.storage.value[${drive.driveLetter}].isSSD = true and trimEnabled = true`,
        paths: ['metrics.storage.value[].driveLetter', 'metrics.storage.value[].isSSD', 'metrics.storage.value[].trimEnabled'],
        applicability: 'APPLICABLE',
        confidence: 'Medium',
        actionStatus: 'OPTIONAL_ACTION',
        actionId: `retrim-drive:${drive.driveLetter}`,
        capabilityId: 'maintenance:retrim-drive',
      }));
    }
  }

  if (available(snapshot.diagnostics.pageFile)) {
    const pageFile = snapshot.diagnostics.pageFile.value;
    if (pageFile.mode === 'Disabled') {
      results.push(recommendation(capabilities, {
        id: 'page-file-disabled',
        title: 'The page file is turned off',
        category: 'Memory',
        observation: 'Windows has no page file.',
        rationale: 'Some games and crash reports need a page file. Dialed never changes page-file settings.',
        evidence: 'diagnostics.pageFile.value.mode = Disabled',
        paths: ['diagnostics.pageFile.value.mode'],
        applicability: 'APPLICABLE',
        confidence: 'High',
        actionStatus: 'GUIDANCE_ONLY',
        capabilityId: guidanceCapabilityId,
        expectedBenefit: 'If games crash with memory errors, turning it back on in Windows is a good first step.',
      }));
    } else if (pageFile.mode === 'Custom') {
      results.push(recommendation(capabilities, {
        id: 'page-file-custom',
        title: 'The page file has a custom size',
        category: 'Memory',
        observation: 'The page file size was set by hand.',
        rationale: 'That may be on purpose. Dialed will not change it.',
        evidence: `diagnostics.pageFile.value.mode = Custom with ${pageFile.settings.length} configured entr${pageFile.settings.length === 1 ? 'y' : 'ies'}.`,
        paths: ['diagnostics.pageFile.value.mode', 'diagnostics.pageFile.value.settings'],
        applicability: 'APPLICABLE',
        confidence: 'High',
        actionStatus: 'REVIEW',
        capabilityId: guidanceCapabilityId,
        expectedBenefit: 'Shown so you know it is set.',
      }));
    }
  }

  if (available(snapshot.diagnostics.storageHealth)) {
    for (const disk of snapshot.diagnostics.storageHealth.value) {
      const healthy = /^healthy$/i.test(disk.healthStatus) && /^(ok|healthy)$/i.test(disk.operationalStatus);
      if (!healthy) {
        results.push(recommendation(capabilities, {
          id: `storage-health-${results.length}`,
          title: 'A drive reports a problem',
          category: 'Storage',
          observation: `${disk.friendlyName} reports ${disk.healthStatus} / ${disk.operationalStatus}.`,
          rationale: 'Back up anything important on it, then check it with the drive maker\'s tool. Dialed does not attempt repairs.',
          evidence: `diagnostics.storageHealth contains ${JSON.stringify({ healthStatus: disk.healthStatus, operationalStatus: disk.operationalStatus })}`,
          paths: ['diagnostics.storageHealth.value[].healthStatus', 'diagnostics.storageHealth.value[].operationalStatus'],
          applicability: 'APPLICABLE',
          confidence: 'High',
          actionStatus: 'GUIDANCE_ONLY',
          capabilityId: guidanceCapabilityId,
          expectedBenefit: 'An early warning so you can back up in time.',
        }));
      }
    }
  }

  if (available(snapshot.diagnostics.secureBoot) && snapshot.diagnostics.secureBoot.value.state === 'Disabled') {
    results.push(recommendation(capabilities, {
      id: 'secure-boot-disabled',
      title: 'Secure Boot is off',
      category: 'Security',
      observation: 'Secure Boot is turned off.',
      rationale: 'Secure Boot protects Windows as it starts. It has no effect on speed, and some anti-cheat requires it. You turn it on in your BIOS.',
      evidence: 'diagnostics.secureBoot.value.state = Disabled',
      paths: ['diagnostics.secureBoot.value.state'],
      applicability: 'APPLICABLE',
      confidence: 'High',
      actionStatus: 'GUIDANCE_ONLY',
      capabilityId: guidanceCapabilityId,
      expectedBenefit: 'Dialed never changes BIOS settings.',
    }));
  }

  if (available(snapshot.diagnostics.tpm)) {
    const tpm = snapshot.diagnostics.tpm.value;
    if (!tpm.present || !tpm.ready) {
      results.push(recommendation(capabilities, {
        id: 'tpm-not-ready',
        title: 'The TPM is not ready',
        category: 'Security',
        observation: `TPM ${tpm.present ? 'found' : 'not found'}, ${tpm.ready ? 'ready' : 'not ready'}.`,
        rationale: 'Windows 11 and some anti-cheat need the TPM. Dialed never changes it.',
        evidence: `diagnostics.tpm.value = ${JSON.stringify({ present: tpm.present, ready: tpm.ready })}`,
        paths: ['diagnostics.tpm.value.present', 'diagnostics.tpm.value.ready'],
        applicability: 'APPLICABLE',
        confidence: 'High',
        actionStatus: 'GUIDANCE_ONLY',
        capabilityId: guidanceCapabilityId,
        expectedBenefit: 'Check Windows Security › Device security, or your PC maker\'s support.',
      }));
    }
  }

  if (available(snapshot.diagnostics.graphics)) {
    for (const adapter of snapshot.diagnostics.graphics.value) {
      if (adapter.status && !/^ok$/i.test(adapter.status) && !/^not returned$/i.test(adapter.status)) {
        results.push(recommendation(capabilities, {
          id: `graphics-status-${results.length}`,
          title: 'Your graphics card reports a problem',
          category: 'Graphics',
          observation: `${adapter.name} reports: ${adapter.status}.`,
          rationale: 'Fix this before tuning anything, usually by reinstalling the driver from NVIDIA, AMD or Intel. Dialed does not install drivers.',
          evidence: `diagnostics.graphics contains ${JSON.stringify({ name: adapter.name, status: adapter.status })}`,
          paths: ['diagnostics.graphics.value[].name', 'diagnostics.graphics.value[].status'],
          applicability: 'APPLICABLE',
          confidence: 'High',
          actionStatus: 'GUIDANCE_ONLY',
          capabilityId: guidanceCapabilityId,
          expectedBenefit: 'A device problem can cause crashes or poor performance.',
        }));
      }
    }
  }

  if (available(snapshot.diagnostics.gameDvr) && ['Enabled', 'Mixed'].includes(snapshot.diagnostics.gameDvr.value.state)) {
    results.push(recommendation(capabilities, {
      id: 'game-dvr-review',
      title: 'Background recording is on',
      category: 'Gaming',
      observation: `Game Bar background recording is ${snapshot.diagnostics.gameDvr.value.state === 'Mixed' ? 'partly on' : 'on'}.`,
      rationale: 'Handy if you save clips; otherwise it records in the background for nothing.',
      evidence: `diagnostics.gameDvr.value.state = ${snapshot.diagnostics.gameDvr.value.state}`,
      paths: ['diagnostics.gameDvr.value.state'],
      applicability: 'APPLICABLE',
      confidence: 'Medium',
      actionStatus: 'REVIEW',
      capabilityId: guidanceCapabilityId,
      expectedBenefit: 'Turn it off if you never use it. Do not expect a big FPS change.',
    }));
  }

  if (available(snapshot.diagnostics.networkAdapters)) {
    const adapters = snapshot.diagnostics.networkAdapters.value;
    if (adapters.length > 0 && adapters.every((adapter) => !/^up$/i.test(adapter.status))) {
      results.push(recommendation(capabilities, {
        id: 'network-disconnected',
        title: 'No network connection',
        category: 'Network',
        observation: 'No network adapter was connected during the scan.',
        rationale: 'Check the cable or Wi-Fi. This only looks at your adapters, not your internet.',
        evidence: `diagnostics.networkAdapters reports states: ${adapters.map((adapter) => adapter.status).join(', ')}`,
        paths: ['diagnostics.networkAdapters.value[].status'],
        applicability: 'APPLICABLE',
        confidence: 'High',
        actionStatus: 'GUIDANCE_ONLY',
        capabilityId: guidanceCapabilityId,
        expectedBenefit: 'Rules out a local connection problem.',
      }));
    }
  }

  return results
    .map((item) => ({ ...item, targetPanel: reachableTargetPanel(item.targetPanel, profile) }))
    .filter((item) => !item.actionId || isCapabilityAvailable(item.capabilityId, profile));
}

module.exports = { buildLocalRecommendations };
