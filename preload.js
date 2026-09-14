const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('parityGoDesktop', { isElectron: true, platform: process.platform });
