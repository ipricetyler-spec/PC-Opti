const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { createSystemScanSnapshot, listManageableProcesses, listSafePolicies, listStartupItems } = require('../src/main/scanner/index.cjs');
const {
  disableStartupItem,
  enableConsumerFeaturesPolicy,
  enableProcessEcoQos,
  executeMaintenanceAction,
  readJournal,
  rollbackAuditEntry,
} = require('../src/main/journal/index.cjs');

let mainWindow;
let serverProcess = null;
let latestVerifiedSnapshot = null;
let latestStartupItems = new Map();
let latestManageableProcesses = new Map();

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function startBackendServer() {
  const serverPath = path.join(__dirname, '../dist/server.cjs');
  if (!fs.existsSync(serverPath)) return;

  serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '3000',
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  serverProcess.on('error', (error) => {
    console.error('[PC-Opti] Local API server failed to start:', error);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 650,
    title: 'PC-Opti — Transparent System Diagnostics',
    backgroundColor: '#0a0b0d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadURL('http://127.0.0.1:3000');
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('pc-opti:scan-system', async () => {
  latestVerifiedSnapshot = deepFreeze(await createSystemScanSnapshot());
  return latestVerifiedSnapshot;
});

ipcMain.handle('pc-opti:list-startup-items', async () => {
  const inventory = await listStartupItems();
  latestStartupItems = new Map(inventory.items.map((item) => [item.id, item]));
  return {
    items: inventory.items.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path,
      source: item.source,
      enabled: item.enabled,
      scope: item.scope,
      canDisable: item.canDisable,
      managementNote: item.canDisable
        ? 'PC-Opti can disable this current-user Registry Run entry and record a deterministic rollback.'
        : item.source === 'TaskScheduler'
          ? 'Read-only in PC-Opti. Manage this task in Windows Task Scheduler.'
          : 'Read-only in PC-Opti. Machine-wide startup entries require a separate elevated workflow.',
    })),
    errors: inventory.errors,
  };
});

ipcMain.handle('pc-opti:disable-startup-item', async (_event, itemId) => {
  if (typeof itemId !== 'string') throw new Error('Startup item id must be a string.');
  const item = latestStartupItems.get(itemId);
  if (!item) throw new Error('Startup inventory changed. Refresh the list before changing an item.');
  const result = await disableStartupItem(app.getPath('userData'), item);
  if (result.success) latestStartupItems.delete(itemId);
  return result;
});

ipcMain.handle('pc-opti:list-manageable-processes', async () => {
  const inventory = await listManageableProcesses();
  latestManageableProcesses = new Map(inventory.items.map((item) => [item.pid, item]));
  return inventory;
});

ipcMain.handle('pc-opti:enable-process-ecoqos', async (_event, processId) => {
  const pid = Number(processId);
  if (!Number.isInteger(pid)) throw new Error('Process identifier must be an integer.');
  const process = latestManageableProcesses.get(pid);
  if (!process) throw new Error('Process inventory changed. Refresh the Dynamic Eco-Balance list before changing a process.');
  return enableProcessEcoQos(app.getPath('userData'), process);
});

ipcMain.handle('pc-opti:list-safe-policies', async () => listSafePolicies());

ipcMain.handle('pc-opti:enable-consumer-features-policy', async () => {
  return enableConsumerFeaturesPolicy(app.getPath('userData'));
});

ipcMain.handle('pc-opti:run-ai-audit', async () => {
  if (!latestVerifiedSnapshot) {
    throw new Error('Run a verified system scan before requesting an AI audit.');
  }

  let response;
  try {
    response = await fetch('http://127.0.0.1:3000/api/ai/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot: latestVerifiedSnapshot }),
    });
  } catch (error) {
    throw new Error(`AI audit is unavailable: ${error.message}`);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload?.data) {
    throw new Error(payload?.error || `AI audit request failed with HTTP ${response.status}.`);
  }
  return payload.data;
});

ipcMain.handle('pc-opti:execute-maintenance', async (_event, actionId) => {
  if (typeof actionId !== 'string') {
    throw new Error('Maintenance action id must be a string.');
  }
  return executeMaintenanceAction(app.getPath('userData'), actionId);
});

ipcMain.handle('pc-opti:get-audit-history', async () => readJournal(app.getPath('userData')));

ipcMain.handle('pc-opti:rollback-audit-entry', async (_event, entryId) => {
  if (typeof entryId !== 'string') throw new Error('Audit entry id must be a string.');
  return rollbackAuditEntry(app.getPath('userData'), entryId);
});

app.whenReady().then(() => {
  startBackendServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
