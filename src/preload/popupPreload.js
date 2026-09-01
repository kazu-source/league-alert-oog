'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Bridge for reminder popups. The popup renderer receives its content and
 * closes itself; it has no other reach into the main process.
 */
contextBridge.exposeInMainWorld('popupApi', {
  onData: (handler) => {
    ipcRenderer.on('popup:data', (_event, data) => handler(data));
  },
  dismiss: () => ipcRenderer.send('popup:dismiss'),
});
