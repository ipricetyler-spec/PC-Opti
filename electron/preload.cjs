const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rigorsetDesktopNative', {
  isNativeDesktopApp: true,
  executePowerShell: (scriptContent) => ipcRenderer.invoke('execute-powershell', scriptContent),
});
