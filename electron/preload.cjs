const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bananaDesktop', {
  isDesktopApp: true,
  platform: process.platform,
  getStartupEnabled: () => ipcRenderer.invoke('banana:get-startup'),
  setStartupEnabled: (enabled) => ipcRenderer.invoke('banana:set-startup', enabled),
});
