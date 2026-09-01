'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge between the settings UI and the main process. The renderer
 * has no Node access, so everything it can do is listed here.
 */
contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('app:getState'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  sendTestNotification: () => ipcRenderer.invoke('notify:test'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  openConfigFolder: () => ipcRenderer.invoke('app:openConfigFolder'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:update', listener);
    return () => ipcRenderer.removeListener('state:update', listener);
  },
});
