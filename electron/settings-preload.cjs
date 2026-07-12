const { contextBridge, ipcRenderer } = require('electron');

// 设置窗口与主进程的桥:读当前设置、写入改动(改动即实时广播给主窗口)。
contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.send('settings:set', patch),
  tryProactive: () => ipcRenderer.send('proactive:try'),
  onTryProactiveResult: (cb) => ipcRenderer.on('proactive:try-result', (_e, data) => cb(data)),
  onTryProactiveProgress: (cb) => ipcRenderer.on('proactive:try-progress', (_e, text) => cb(text)),
  // 记忆管理
  memoryGetAll: () => ipcRenderer.invoke('memory:getAll'),
  memoryRemove: (index) => ipcRenderer.invoke('memory:remove', index),
  memoryClear: () => ipcRenderer.invoke('memory:clear'),
  // 动画控制
  getAnimList: () => ipcRenderer.invoke('anim:getList'),
  playAnim: (name) => ipcRenderer.send('anim:play', name),
  // 拉起 lms(LM Studio CLI 管理)
  lmsStart: () => ipcRenderer.invoke('lms:start'),
  lmsStop: () => ipcRenderer.invoke('lms:stop'),
  lmsStatus: () => ipcRenderer.invoke('lms:status'),
  lmsListModels: () => ipcRenderer.invoke('lms:listModels'),
  onLmsStatus: (cb) => ipcRenderer.on('lms:status-changed', (_e, st) => cb(st)),
});
