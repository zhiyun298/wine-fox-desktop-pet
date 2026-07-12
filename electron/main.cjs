const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, globalShortcut } = require('electron');
const path = require('node:path');
const zlib = require('node:zlib');

const { loadConfig } = require('./ai/config.cjs');
const history = require('./ai/history.cjs');
const settings = require('./ai/settings.cjs');
const context = require('./ai/context.cjs');
const chat = require('./ai/chat.cjs');
const agent = require('./ai/agent.cjs');
const proactive = require('./ai/proactive.cjs');
const lmstudio = require('./ai/lmstudio.cjs');

// 渲染层加载模型后上报的可触发动画名单(供设置窗口列表 / 右键「动作」子菜单)
// 每项为 { name, label }:name=clip 原名(播放用),label=中文显示名。
let animList = [];

const isDev = !app.isPackaged;

const BASE_W = 400;
const BASE_H = 500;

// 独立的 userData/缓存目录,避免与其它 Electron 应用共用 %APPDATA%/Electron 导致的缓存抢锁 / 拒绝访问。
// 仅开发时放项目内 .userdata;打包后 __dirname 在只读的 app.asar 内,若仍指过去会导致设置/记忆无法落盘,
// 故发布版改用系统默认可写目录(%APPDATA%/wine-fox-desktop)。
app.setName('wine-fox-desktop');
if (!app.isPackaged) {
  app.setPath('userData', path.join(__dirname, '..', '.userdata'));
}

// 单实例锁:防止多开互相抢缓存导致窗口空白
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let settingsWin = null;
let tray = null;
let isDragging = false;
let dragTimer = null;
let cursorTimer = null;

// ---- 生成一个 16x16 橙色圆形托盘图标(避免依赖外部图片文件) ----
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
// 用像素回调 rgbaFn(x,y) => [r,g,b,a] 生成一张 size×size 的 PNG nativeImage
function makeIcon(size, rgbaFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = rgbaFn(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
  return nativeImage.createFromBuffer(png);
}
function createTrayIcon() {
  const c = 7.5;
  const rad = 8;
  return makeIcon(16, (x, y) => {
    const inside = (x - c) ** 2 + (y - c) ** 2 <= rad * rad;
    return inside ? [230, 126, 34, 255] : [0, 0, 0, 0];
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: BASE_W,
    height: BASE_H,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false, // 关键:禁止窗口被 OS/贴边缩放(长按放大的元凶)
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 禁用页面级缩放(捏合 / 双击缩放 / Ctrl+滚轮)
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1);
    win.webContents.setZoomFactor(1);
    win.webContents.send('settings:changed', settings.getAll()); // 启动即套用气泡配色
  });

  // 主进程轮询全局光标,喂给渲染进程
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const c2 = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.webContents.send('cursor', {
      screenX: c2.x,
      screenY: c2.y,
      localX: c2.x - b.x,
      localY: c2.y - b.y,
      scale: screen.getDisplayNearestPoint(c2).scaleFactor,
    });
  }, 16);

  win.on('closed', () => {
    if (cursorTimer) clearInterval(cursorTimer);
    cursorTimer = null;
    win = null;
  });
}

// 设置窗口:独立的小窗口,承载配色等选项。已开则聚焦,不重复开。
function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 380,
    height: 640,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '酒狐 · 设置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function minimizeToTray() {
  if (!win) return;
  win.hide();
  if (tray) return;
  // 临时:托盘用指定 PNG 图标(缩到 16px);加载失败则回退到程序生成的橙色圆点。
  let trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'images', 'wine-fox-463x463.png'));
  if (trayIcon.isEmpty()) trayIcon = createTrayIcon();
  else trayIcon = trayIcon.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('酒狐');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示酒狐', click: () => win && win.show() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.on('click', () => win && win.show());
}

// 右键菜单:所有设置集中在这里
ipcMain.on('menu:show', () => {
  if (!win) return;
  const template = [
    { label: '放大', click: () => win.webContents.send('action', 'zoom-in') },
    { label: '缩小', click: () => win.webContents.send('action', 'zoom-out') },
    { label: '重置大小', click: () => win.webContents.send('action', 'zoom-reset') },
    { type: 'separator' },
    { label: '切换明暗', click: () => win.webContents.send('action', 'theme-toggle') },
  ];
  if (animList.length) {
    template.push({
      label: '动作',
      submenu: animList.map((it) => ({
        label: it.label || it.name,
        click: () => win.webContents.send('anim:play', it.name),
      })),
    });
  }
  template.push(
    { label: '设置', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: '最小化到托盘', click: () => minimizeToTray() },
    { label: '退出', click: () => app.quit() },
  );
  Menu.buildFromTemplate(template).popup({ window: win });
});

ipcMain.on('mouse:set-interactive', (_e, interactive) => {
  if (!win || isDragging) return;
  if (interactive) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
});

// ---- AI:悬停打字所需的临时夺焦 / 还焦 ----
ipcMain.on('ai:grab-focus', () => {
  if (!win) return;
  win.setIgnoreMouseEvents(false);
  win.focus();
});

ipcMain.on('ai:release-focus', () => {
  if (!win) return;
  win.blur(); // Windows 上不保证完美回焦,先接受
});

// ---- AI:收到一条消息,按 / 前缀路由到 Agent 或聊天,流式回传 ----
ipcMain.on('ai:send', async (_e, { id, text, state }) => {
  if (!win) return;
  proactive.notifyInteraction();
  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const onToken = (delta, kind) => send('ai:token', { id, delta, kind });

  // 运行期间注册全局 Ctrl+C 用于「及时终止」——窗口无焦点也生效;答完/出错即注销,
  // 尽量缩短对系统级 Ctrl+C(复制)的占用窗口。
  const abortAll = () => { chat.abort(); agent.abort(); };
  globalShortcut.register('CommandOrControl+C', abortAll);

  try {
    let full;
    if (text.startsWith('/')) {
      full = await agent.runAgent(text.slice(1).trim(), onToken);
    } else {
      history.append('user', text);
      const cfg = loadConfig();
      const s = settings.getAll();
      const messages = [
        { role: 'system', content: s.persona || cfg.persona },
        { role: 'system', content: context.buildEnvContext(state) },
        ...history.getAll(),
      ];
      // 动作脚本开关:关闭时额外塞一条"禁止动作描述"指令
      if (!s.showActions) {
        messages.push({ role: 'system', content: '你的回复中不要使用 *动作*、[动作] 或任何形式的角色扮演动作描述。只输出纯对话文本。' });
      }
      messages.push({ role: 'system', content: '不要用引号把整句回复括起来,直接输出对话内容本身。' });
      full = await chat.streamChat(messages, onToken, { temperature: s.temperature, model: s.chatModel || undefined });
      // 小模型可能照抄上下文格式在开头加时间戳,存历史前剥掉,避免被再次喂回强化
      full = full.replace(/^\s*\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s*/, '');
      full = chat.stripWrapQuotes(full); // 剥掉整段被引号包裹的情况,避免喂回强化
      history.append('assistant', full);
      history.save();
    }
    send('ai:done', { id, fullText: full });
  } catch (err) {
    send('ai:error', { id, message: String(err && err.message ? err.message : err) });
  } finally {
    globalShortcut.unregister('CommandOrControl+C');
  }
});

// 缩放窗口(居中锚定:围绕窗口中心增减宽高,狐狸自然留在中央)。
// 为躲开「原点移动 → 系统合成层错帧闪一下」的问题,缩放期间先把窗口透明,
// 尺寸稳定后 ~0.1s 再恢复显示,相当于缩放的一瞬停止渲染。
ipcMain.on('window:set-scale', (_e, scale) => {
  if (!win) return;
  const w = Math.round(BASE_W * scale);
  const h = Math.round(BASE_H * scale);
  const b = win.getBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const bounds = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h };
  win.setOpacity(0);
  win.setResizable(true); // resizable:false 下某些平台会锁死程序化尺寸,临时开锁
  win.setBounds(bounds);
  win.setResizable(false);
  setTimeout(() => {
    if (win && !win.isDestroyed()) win.setOpacity(1);
  }, 110);
});

ipcMain.on('drag:start', () => {
  if (!win) return;
  isDragging = true;
  win.setIgnoreMouseEvents(false);
  // 起点锚定:位置从固定锚点绝对计算,尺寸每帧钉回,杜绝取整累积导致的漂移/放大
  const startCursor = screen.getCursorScreenPoint();
  const [sx, sy] = win.getPosition();
  const [sw, sh] = win.getSize();
  let last = startCursor;
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const now = screen.getCursorScreenPoint();
    if (now.x === last.x && now.y === last.y) return; // 没动就不重设
    last = now;
    win.setBounds({
      x: sx + (now.x - startCursor.x),
      y: sy + (now.y - startCursor.y),
      width: sw,
      height: sh,
    });
  }, 16);
});

ipcMain.on('drag:end', () => {
  isDragging = false;
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
});

ipcMain.on('app:quit', () => app.quit());

// 主动搭话:渲染层发生交互(坐/站点击),重置空闲计时
ipcMain.on('proactive:interact', () => proactive.notifyInteraction());

// 记忆管理:供设置窗口查阅/删除
ipcMain.handle('memory:getAll', () => history.getAllRaw());
ipcMain.handle('memory:remove', (_e, index) => { history.remove(index); });
ipcMain.handle('memory:clear', () => { history.clear(); });

// 设置窗口"立刻试试"按钮
ipcMain.on('proactive:try', async () => {
  console.log('[proactive:try] 收到, win=', !!win);
  const sendProgress = (text) => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.send('proactive:try-progress', text);
    }
  };
  let ok = false;
  let msg = '';
  try {
    await proactive.doProactive(win, sendProgress);
    ok = true;
  } catch (err) {
    msg = err.message || String(err);
    console.error('[proactive:try] 失败:', msg);
  }
  console.log('[proactive:try] 结果 ok=' + ok + ' msg=' + msg);
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('proactive:try-result', { ok, msg });
  }
});

// ---- 设置:读取 / 写入(写入即实时广播给主窗口套用)----
ipcMain.handle('settings:get', () => settings.getAll());
ipcMain.on('settings:set', (_e, patch) => {
  const before = settings.getAll();
  settings.set(patch);
  settings.save();
  if (win && !win.isDestroyed()) win.webContents.send('settings:changed', settings.getAll());

  // 本地服务相关配置变化 → 按需重启 / 起停(仅「拉起 lms」后端)
  const lmsKeys = ['chatBackend', 'lmsPort', 'lmsModel', 'lmsGpu', 'lmsCtx', 'lmsTtl'];
  if (lmsKeys.some((k) => k in patch)) {
    const s = settings.getAll();
    if (s.chatBackend === 'lms' && s.lmsModel) {
      lmstudio.restart().catch(() => {}); // 失败态已进 status,设置窗口会显示
    } else if (before.chatBackend === 'lms' && s.chatBackend !== 'lms') {
      lmstudio.stop();
    }
  }
});

// ---- 动画:渲染层上报名单 / 设置窗口拉取 / 触发播放 ----
ipcMain.on('anim:register', (_e, names) => {
  animList = Array.isArray(names) ? names : [];
});
ipcMain.handle('anim:getList', () => animList);
ipcMain.on('anim:play', (_e, name) => {
  if (win && !win.isDestroyed()) win.webContents.send('anim:play', name);
});

// ---- 拉起 lms:起停 / 状态 / 列模型 ----
ipcMain.handle('lms:start', () => lmstudio.start().then(() => lmstudio.status()).catch(() => lmstudio.status()));
ipcMain.handle('lms:stop', () => { lmstudio.stop(); return lmstudio.status(); });
ipcMain.handle('lms:status', () => lmstudio.status());
ipcMain.handle('lms:listModels', () => lmstudio.listModels().catch(() => []));

// 状态变化推给设置窗口
lmstudio.onStatusChange((st) => {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('lms:status-changed', st);
  }
});

app.whenReady().then(() => {
  loadConfig();
  history.load();
  settings.load();
  createWindow();
  proactive.startTracking(win);
  // 若默认后端为「拉起 lms」且已配模型,后台起服务预热
  const s = settings.getAll();
  if (s.chatBackend === 'lms' && s.lmsModel) {
    lmstudio.start().catch(() => {});
  }
  app.on('second-instance', () => {
    if (win) win.show();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => lmstudio.stop());
app.on('window-all-closed', () => app.quit());
