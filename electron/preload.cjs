const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopFox', {
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, data) => cb(data)),
  onAction: (cb) => ipcRenderer.on('action', (_e, action) => cb(action)),
  setInteractive: (v) => ipcRenderer.send('mouse:set-interactive', v),
  setWindowScale: (s) => ipcRenderer.send('window:set-scale', s),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  showMenu: () => ipcRenderer.send('menu:show'),
  quit: () => ipcRenderer.send('app:quit'),

  // AI
  grabFocus: () => ipcRenderer.send('ai:grab-focus'),
  releaseFocus: () => ipcRenderer.send('ai:release-focus'),
  aiSend: (id, text, state) => ipcRenderer.send('ai:send', { id, text, state }),
  onAiToken: (cb) => ipcRenderer.on('ai:token', (_e, data) => cb(data)),
  onAiDone: (cb) => ipcRenderer.on('ai:done', (_e, data) => cb(data)),
  onAiError: (cb) => ipcRenderer.on('ai:error', (_e, data) => cb(data)),

  // 主动搭话
  onProactive: (cb) => ipcRenderer.on('proactive:message', (_e, data) => cb(data)),
  onPerceptionUpdate: (cb) => ipcRenderer.on('perception:update', (_e, data) => cb(data)),
  notifyInteraction: () => ipcRenderer.send('proactive:interact'),

  // 设置(气泡配色等)实时下发
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, data) => cb(data)),
  getSettings: () => ipcRenderer.invoke('settings:get'),

  // 动画:上报可触发名单 / 接收播放指令(设置窗口、右键菜单、AI 统一走这里)
  registerAnims: (names) => ipcRenderer.send('anim:register', names),
  onAnimPlay: (cb) => ipcRenderer.on('anim:play', (_e, name) => cb(name)),
});
