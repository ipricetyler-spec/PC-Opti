const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pcOptiNative', {
  scanSystem: () => ipcRenderer.invoke('pc-opti:scan-system'),
  runAiAudit: () => ipcRenderer.invoke('pc-opti:run-ai-audit'),
  listStartupItems: () => ipcRenderer.invoke('pc-opti:list-startup-items'),
  disableStartupItem: (itemId) => ipcRenderer.invoke('pc-opti:disable-startup-item', itemId),
  listManageableProcesses: () => ipcRenderer.invoke('pc-opti:list-manageable-processes'),
  enableProcessEcoQos: (processId) => ipcRenderer.invoke('pc-opti:enable-process-ecoqos', processId),
  listSafePolicies: () => ipcRenderer.invoke('pc-opti:list-safe-policies'),
  enableConsumerFeaturesPolicy: () => ipcRenderer.invoke('pc-opti:enable-consumer-features-policy'),
  executeMaintenance: (actionId) => ipcRenderer.invoke('pc-opti:execute-maintenance', actionId),
  getAuditHistory: () => ipcRenderer.invoke('pc-opti:get-audit-history'),
  rollbackAuditEntry: (entryId) => ipcRenderer.invoke('pc-opti:rollback-audit-entry', entryId),
});
