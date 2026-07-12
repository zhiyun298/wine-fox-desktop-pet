import * as THREE from 'three';
import { KanbanGirl } from 'wine-fox';
import { urls } from 'wine-fox/assets';
import { withFrameRateLimit } from 'wine-fox/tools';

const container = document.querySelector('#container');
const model = new KanbanGirl(container);

// 加载模型资源(酒狐官方模型,来自 wine-fox 包)
await model.load(urls);

// 桌面悬浮:确保渲染器背景完全透明,窗口里只显示狐狸
const { renderer, camera, composer } = model.getThreeInfo();
renderer.setClearColor(0x000000, 0);

// Windows 透明窗口会把 devicePixelRatio 退化成 1,导致画面变糊。
// 用主进程传来的真实缩放系数强制像素比,并同步 composer 尺寸。
let appliedScale = 0;
function applyResolution(scale) {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setPixelRatio(scale);
  renderer.setSize(w, h);
  composer?.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
applyResolution(window.devicePixelRatio || 1);

// 相机取景固定,狐狸始终占窗口约一半、不溢出。每帧钉死,防止意外 dolly。
const CAMERA_Z = 80;

// 「放大/缩小」= 调整窗口尺寸(窗口越大狐狸越大,取景不变故不溢出)。
const WIN_SCALE_MIN = 0.5;
const WIN_SCALE_MAX = 3;
const WIN_SCALE_STEP = 0.25;
let winScale = 1;
function applyWinScale(s) {
  winScale = Math.min(WIN_SCALE_MAX, Math.max(WIN_SCALE_MIN, s));
  window.desktopFox?.setWindowScale(winScale);
}

const canvas = renderer.domElement;
const foxRoot = model.mainModel.object3d;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

const clock = new THREE.Clock();
const mouse = { x: 0, y: 0 }; // 供 lookAt 使用的全局屏幕坐标

// ---- 动画控制 ----
const animMgr = model.mainModel?.animationsManage;
// 该模型有 200+ 动画,多为定位/武器/mod 专用。这里精选「有意义的手势/动作」并配中文名;
// 顺序即设置列表与右键菜单的展示顺序。playAnimation 只播存在的,故对不同模型自动裁剪。
const ANIM_LABELS = {
  extra5: '卖萌',
  game_win: '开心',
  game_lost: '难过',
  beg: '讨要',
  'use_mainhand:eat': '吃东西',
  'use_mainhand:drink': '喝东西',
  'use_mainhand$minecraft:brush': '刷子',
  'use_mainhand:spyglass': '望远镜',
  extra1: '打招呼', extra2: '鼓掌', extra7: '跳舞',
  extra0: '特技1', extra6: '特技2',
  // extra3/4 全面禁用(不列入清单);extra0/6 意义不明,更名为特技1/2 排在末尾,仅手动/预览保留,不给 AI(见 ANIM_TAGS)。
  // 坐下(picnic)、下棋(gomoku)等「坐姿」片段不适合一次性播放(会瞬间坐下再起身),
  // 故不列入手势清单。坐下改由「点击狐狸」持久坐姿处理(见 SIT_ANIM/toggleSit)。
};
const animLabel = (n) => ANIM_LABELS[n] || n;
function triggerableAnims() {
  const have = new Set((animMgr?.clips || []).map((c) => c.name));
  return Object.keys(ANIM_LABELS).filter((n) => have.has(n));
}
// 播放:一次性(LoopOnce)+ 淡入;可排队。播完由 mixer 'finished' 淡出回 idle 并出队下一个。
let animBusy = false;
const animQueue = [];
const ownActions = new Set(); // 只登记「我们主动播」的 action;finished 只处理这些,避免干预库自管的坐姿/道具动作
let heldAction = null; // 持久性动作(game_win/game_lost)播完保持的最后一帧;下次任意动作时淡出清除
const PERSISTENT_ANIMS = new Set(['game_win', 'game_lost']); // 播完不淡回 idle,保持定格,直到下一次动作(随机/手动/AI)替换
function clearHeld() { // 淡出并清除持久定格,让位给下一个动作(随机挑选/坐下/新的播放),避免定格叠加到其它动作上
  if (heldAction) { try { heldAction.fadeOut(0.3); } catch { /* 已停止 */ } heldAction = null; }
}
function playAnimation(name, opts = {}) {
  const a = animMgr?.get?.(name);
  if (!a) return; // 只播存在的
  if (opts.queue && animBusy) { animQueue.push(name); return; }
  if (!opts.queue) animQueue.length = 0; // 手动/预览:清队列,立即播(打断当前)
  if (heldAction && heldAction !== a) clearHeld(); // 清掉上一个持久定格
  heldAction = null;
  a.reset();
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true; // 保持最后一帧,交给 finished 里的 fadeOut 平滑淡回 idle(false 会在结束瞬间弹回,fadeOut 无从淡)
  ownActions.add(a);
  animBusy = true;
  animMgr.play(name);
  a.fadeIn?.(0.2);
}
// 一次性动画播完:仅对「我们主动播」的 action 处理。持久性动作定格保持;其余平滑淡出回 idle。
// 库自管的坐姿/道具(eat/drink/hold)动作在此一概不碰,保证 classic 风格与原版(release-0.1)完全一致。
animMgr?.mixer?.addEventListener('finished', (e) => {
  if (!ownActions.has(e.action)) return; // 库触发的动作:放行,不干预
  ownActions.delete(e.action);
  animBusy = false;
  if (PERSISTENT_ANIMS.has(e.action.getClip?.()?.name)) {
    heldAction = e.action; // 持久:保持定格(clampWhenFinished),不淡出,等下一次动作替换
  } else {
    try { e.action.fadeOut(0.4); } catch { /* 已停止 */ }
  }
  const next = animQueue.shift();
  if (next) playAnimation(next, { queue: true });
});
window.desktopFox?.registerAnims(triggerableAnims().map((n) => ({ name: n, label: animLabel(n) })));
window.desktopFox?.onAnimPlay?.((name) => playAnimation(name));

// AI 情绪标记 → 动画。渲染层剥掉标记文本、按标记触发对应片段(可多个,依次排队播)。
// 值为字符串=一次性播的 clip;值为函数=特殊动作(如坐/站,走持久坐姿而非一次性播放)。
const ANIM_TAGS = {
  cute: 'extra5', happy: 'game_win', sad: 'game_lost',
  eat: 'use_mainhand:eat', drink: 'use_mainhand:drink',
  wave: 'extra1', clap: 'extra2', dance: 'extra7',
  sit: () => sitDown(),   // 已坐则忽略
  stand: () => standUp(), // 没坐则忽略
};
function stripAnimTags(t) {
  return stripWrapQuotes((t || '')
    .replace(/^\s*\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s*/, '') // 剥掉小模型误加的时间戳前缀
    .replace(/\[anim:\w+\]/gi, '')
    .replace(/\[mood:\d+\]/gi, '') // 心情标记(仅原版随机风格生效)也从展示文本剥掉
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd());
}
// 剥掉整段被成对引号包裹的情况(模型偶尔把整句回复用引号括起来)
function stripWrapQuotes(t) {
  let s = (t || '').trim();
  const pairs = [['"', '"'], ['“', '”'], ['「', '」'], ['『', '』']];
  let go = true;
  while (go) {
    go = false;
    for (const [a, b] of pairs) {
      if (s.length >= 2 && s.startsWith(a) && s.endsWith(b) && s.slice(1, -1).indexOf(a) === -1) {
        s = s.slice(1, -1).trim();
        go = true;
      }
    }
  }
  return s;
}
let aiAnimEnabled = true; // 设置里的「允许触发动画」;关掉则 AI 标记不触发动画
// AI 用 [mood:N](0~100)设定「原版」随机风格下的心情指数(库据此加权挑选自发动作)。
// 不受 aiAnimEnabled 约束:它调的是随机系统的倾向,与「AI 直接触发动画」是两码事;custom 风格不读 mood,设了也无害。
function setMood(v) {
  const rt = model.mainModel?.randomTask;
  if (!rt || !Number.isFinite(v)) return;
  rt.mood = Math.max(0, Math.min(100, v));
}
function applyMoodFromText(t) {
  const m = (t || '').match(/\[mood:(\d{1,3})\]/i);
  if (m) setMood(Number(m[1]));
}
function playTagFromText(t) {
  applyMoodFromText(t); // 先应用心情(即使关了 AI 动画触发也生效)
  if (!aiAnimEnabled) return;
  const vals = [...(t || '').matchAll(/\[anim:(\w+)\]/gi)]
    .map((m) => ANIM_TAGS[m[1].toLowerCase()])
    .filter(Boolean);
  // 持久性动作(game_win/game_lost = happy/sad)会定格保持,多标记时若不在队尾会被下一个动作瞬间顶掉、白播;
  // 故规则:仅当它排在整串标记的末尾才播,否则丢弃。
  const list = vals.filter((v, i) => !(typeof v === 'string' && PERSISTENT_ANIMS.has(v)) || i === vals.length - 1);
  let queued = 0;
  for (const v of list) {
    if (typeof v === 'function') { v(); continue; } // 特殊动作(坐/站):立即执行,自带条件判断
    playAnimation(v, { queue: queued > 0 }); // clip:首个立即播,其余排队依次
    queued++;
  }
}

// ---- 随机动作:两种风格 ----
// custom:接管调度,每帧顶住 lastTime 让库自身挑选永不触发,按间隔从「允许自发」子集等概率一次性播。
// classic:库原版随机(心情加权 + 苹果/酒瓶道具 + 80% 不动),但节奏由设置里的「间隔」驱动 ——
//          库把 60s 写死在 lastTime 比较里,这里通过读写 lastTime 让它按 randomIntervalMs 挑选。
//          动画层面零副作用(仍是库原版逻辑),仅「心情值」随间隔同比演化。间隔=60s 即等同 release-0.1。
let randomEnabled = true;
let randomIntervalMs = 60000;
let randomStyle = 'custom';
let randomActionAnims; // undefined=默认(除坐姿全允许);数组=白名单。仅 custom 生效
function allowedRandomAnims() {
  const all = triggerableAnims().filter((n) => n !== SIT_ANIM);
  return Array.isArray(randomActionAnims) ? all.filter((n) => randomActionAnims.includes(n)) : all;
}
{
  const randomTask = model.mainModel?.randomTask;
  if (randomTask) {
    const origUpdate = randomTask.update.bind(randomTask); // 库原版随机逻辑
    let lastForced = performance.now();
    randomTask.update = () => {
      if (randomStyle === 'classic') {
        if (!randomEnabled) return;
        const now = performance.now();
        if (now - lastForced >= randomIntervalMs) {
          clearHeld();               // 先淡出上一次持久定格(难过/开心),避免叠加到库随机动作上
          randomTask.lastTime = 0;   // 库看到「已过 60s」→ 本帧挑选(内部又把 lastTime 设回 now)
          lastForced = now;
        } else {
          randomTask.lastTime = now; // 压住库自身 60s,仅让它推进 actionTask.update()(道具动画照常)
        }
        origUpdate();
        return;
      }
      // custom
      randomTask.lastTime = performance.now(); // 每帧顶住 → 库自身 60s 挑选永不触发
      if (!randomEnabled) return;
      const now = performance.now();
      if (isSitting()) {
        // 坐着:到点把她从坐姿拉起来(保留原「不会永远坐」的行为),下一轮再随机
        if (now - lastForced >= randomIntervalMs) {
          randomTask.actionTask?.stop?.();
          randomTask.actionTask = undefined;
          lastForced = now;
        }
        return;
      }
      if (now - lastForced >= randomIntervalMs) {
        lastForced = now;
        const pool = allowedRandomAnims();
        if (pool.length) playAnimation(pool[(Math.random() * pool.length) | 0]);
      }
    };
  }
}

const isElectron = !!window.desktopFox;
let interactive = false;
let dragging = false;

function setInteractive(v) {
  if (v === interactive) return;
  interactive = v;
  window.desktopFox?.setInteractive(v);
  canvas.style.cursor = v ? 'grab' : 'default';
}

// ===== 聊天:悬停夺焦 + 输入条 =====
const chatLog = document.querySelector('#chat-log');
const chatInput = document.querySelector('#chat-input');
const LONG_PRESS_MS = 275; // 在酒狐上按住不动多久 → 弹输入
let chatOpen = false;
let pressTimer = null;    // 长按计时器
let longPressed = false;  // 本次按下是否已触发长按
let busy = false; // 一轮问答进行中(未给出回答前),此时禁止弹输入
let busySafety = null;

// 窗口刚拿到系统焦点时,DOM 的 focus 可能要补一拍才生效
function focusInput() {
  chatInput.focus();
  requestAnimationFrame(() => { if (chatOpen) chatInput.focus(); });
  setTimeout(() => { if (chatOpen) chatInput.focus(); }, 60);
}
window.addEventListener('focus', () => { if (chatOpen) chatInput.focus(); });

function openChat() {
  if (chatOpen || busy) return; // 回答未给出前不弹输入
  chatOpen = true;
  window.desktopFox?.grabFocus();
  chatInput.style.display = 'block';
  focusInput();
}
function closeChat() {
  if (!chatOpen) return;
  chatOpen = false;
  chatInput.style.display = 'none';
  chatInput.blur();
  window.desktopFox?.releaseFocus();
}

// 光标(窗口内局部坐标)是否落在狐狸模型上
function isOverFox(localX, localY) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((localX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((localY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(foxRoot, true).length > 0;
}

// 光标是否落在回答气泡上(用于让窗口在气泡上也可交互 → 能拖滚动条/滚轮)
function isOverBubble(localX, localY) {
  if (!curBubble) return false;
  const el = document.elementFromPoint(localX, localY);
  return !!(el && el.closest && el.closest('#chat-log'));
}

function handleCursor(screenX, screenY, localX, localY, scale) {
  if (scale && scale !== appliedScale) {
    appliedScale = scale;
    applyResolution(scale);
  }
  mouse.x = screenX;
  mouse.y = screenY;
  // 长按判定:按住期间光标移动超阈值 → 视作拖动,取消长按
  if (pressTimer && downScreen) {
    const dx = screenX - downScreen.x;
    const dy = screenY - downScreen.y;
    if (dx * dx + dy * dy > 25) { clearTimeout(pressTimer); pressTimer = null; }
  }
  if (dragging) return;
  if (!isElectron) return;
  if (chatOpen) {
    setInteractive(true); // 聊天开着,全窗口可交互(输入框可点)
    return;
  }
  setInteractive(isOverFox(localX, localY) || isOverBubble(localX, localY));
}

if (isElectron) {
  window.desktopFox.onCursor(({ screenX, screenY, localX, localY, scale }) => {
    handleCursor(screenX, screenY, localX, localY, scale);
  });
  // 右键菜单的动作
  window.desktopFox.onAction((action) => {
    switch (action) {
      case 'zoom-in': applyWinScale(winScale + WIN_SCALE_STEP); break;
      case 'zoom-out': applyWinScale(winScale - WIN_SCALE_STEP); break;
      case 'zoom-reset': applyWinScale(1); break;
      case 'theme-toggle': toggleTheme(); break;
    }
  });
} else {
  window.addEventListener('mousemove', (e) => {
    handleCursor(e.screenX, e.screenY, e.clientX, e.clientY, window.devicePixelRatio);
  });
}

// 左键按在狐狸上:轻点 => 坐下/站起;长按不动 => 弹输入;按住拖动 => 移动窗口。
let downScreen = null;
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!isOverFox(e.clientX, e.clientY)) return;
  downScreen = { x: e.screenX, y: e.screenY };
  longPressed = false;
  if (isElectron) {
    dragging = true;
    canvas.style.cursor = 'grabbing';
    window.desktopFox.dragStart();
  }
  // 长按(按住不动)到点 => 弹输入。此刻窗口已因点击拿到系统焦点,focus() 才稳。
  pressTimer = setTimeout(() => {
    pressTimer = null;
    longPressed = true;
    if (isElectron && dragging) {
      dragging = false;
      canvas.style.cursor = 'grab';
      window.desktopFox.dragEnd();
    }
    openChat();
  }, LONG_PRESS_MS);
});

window.addEventListener('mouseup', (e) => {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  if (dragging) {
    dragging = false;
    canvas.style.cursor = 'grab';
    window.desktopFox?.dragEnd();
  }
  if (downScreen && !longPressed) {
    const dx = e.screenX - downScreen.x;
    const dy = e.screenY - downScreen.y;
    if (dx * dx + dy * dy <= 25) toggleSit(); // 短按不移动 => 坐/站
  }
  downScreen = null;
  longPressed = false;
});

// 右键狐狸 => 弹出原生设置菜单
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!isElectron) return;
  if (isOverFox(e.clientX, e.clientY)) window.desktopFox.showMenu();
});

window.addEventListener('resize', () => applyResolution(appliedScale || window.devicePixelRatio || 1));

// 明暗主题
let isDark = false;
function toggleTheme() {
  isDark = !isDark;
  model.setTheme(isDark ? 'dark' : 'light');
}

// 点击狐狸 => 坐下 / 站起。判据统一为「调度器当前动作是不是坐姿」,手动与随机通用。
const SIT_ANIM = 'picnic'; // 坐姿动画:'sit'(裸坐)或 'picnic'(野餐坐)等
function isSitting() {
  return model.mainModel?.randomTask.actionTask?.name === SIT_ANIM;
}
function toggleSit() {
  window.desktopFox?.notifyInteraction(); // 坐/站交互重置空闲计时
  if (isSitting()) standUp(); else sitDown();
}
// 坐下:进入持久坐姿(已坐则忽略)。坐姿动画常驻循环保持,交给点击/调度器/AI 站起。
function sitDown() {
  if (isSitting()) return;
  clearHeld(); // 若正定格在难过/开心,先淡出,避免坐下后仍叠加着表情
  const am = model.mainModel?.animationsManage;
  const sit = am?.get(SIT_ANIM);
  if (!sit) return;
  const rt = model.mainModel.randomTask;
  // 归一化:若坐姿动画刚被一次性预览过(LoopOnce/clamp/paused),复位成常驻循环,保证能持续坐住。
  sit.reset();
  sit.setLoop(THREE.LoopRepeat, Infinity);
  sit.clampWhenFinished = false;
  am.play(SIT_ANIM);
  sit.fadeIn(0.3);
  // 挂到调度器当作当前动作:到点后调度器会先淡出坐姿再随机拉起,而不是永远坐着。
  rt.actionTask = { name: SIT_ANIM, update() {}, stop() { sit.fadeOut(0.3); } };
  rt.lastTime = performance.now();
}
// 站起:退出坐姿(没坐则忽略)。
function standUp() {
  if (!isSitting()) return;
  const rt = model.mainModel?.randomTask;
  if (!rt) return;
  rt.actionTask?.stop?.();
  rt.actionTask = undefined;
  rt.lastTime = performance.now();
}

// 轻量 Markdown → HTML。先转义 HTML 防 XSS,再应用规则。
// 流式时每次用全文重渲,所以跨 token 的 ** / ` 也能正确闭合。
function mdToHtml(text) {
  if (!text) return '';
  let h = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 代码块 ```
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // 行内代码 `…`
  h = h.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  // 删除线 ~~…~~
  h = h.replace(/~~(.+?)~~/g, '<s>$1</s>');
  // 粗体 **…**
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // 斜体 *…*(单 *,不碰 ** 残留)
  h = h.replace(/(^|[^*])\*([^*\n]+?)\*($|[^*])/g, '$1<i>$2</i>$3');
  // 链接 [text](url)
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // 标题 # / ## / ### …(行首)
  h = h.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  return h;
}

function setBubbleHtml(el, rawText) {
  el.dataset.rawText = rawText;
  el.innerHTML = mdToHtml(rawText);
}

// 聊天:发送 + 流式渲染。极简 —— 每条回答独立气泡,答完 1 分钟自动消失;PageUp/Down 翻阅历史。
function currentState() {
  return { sitting: isSitting(), dragging, winScale };
}
const ANSWER_TTL_MS = 60000; // 回答显示时长
let curId = null;    // 当前这轮的 id(过滤旧流)
let curBubble = null;

// 用户正拖动/滚动气泡回看 → 1分钟倒计时重计;
// 注意:必须挂在气泡(.msg,pointer-events:auto)上,chatLog 父层是穿透的,不触发。
function attachScrollReset(el) {
  const onInteract = () => {
    const entry = msgHistory.find(e => e.el === el);
    if (entry) resetEntryTimer(entry);
  };
  el.addEventListener('wheel', onInteract, { passive: true });
  el.addEventListener('scroll', onInteract, { passive: true });
}

// 按文本查找历史条目(流式更新时用)
function findEntryByEl(el) {
  return msgHistory.find(e => e.el === el);
}

// 历史记录:数据(text/cls)永存(本次启动内),DOM 按 60s TTL 过期、!p 时按需重建。
const msgHistory = [];   // [{ text, cls, el, hideTimer }]
let historyIdx = -1;     // 当前正在看哪条(-1 = 最新)

function resetEntryTimer(entry) {
  clearTimeout(entry.hideTimer);
  entry.hideTimer = setTimeout(() => {
    if (entry.el) { entry.el.remove(); entry.el = null; }
    entry.hideTimer = null;
    if (curBubble === entry.el) curBubble = null;
  }, ANSWER_TTL_MS);
}

function ensureBubble(entry) {
  if (entry.el && entry.el.parentNode) { resetEntryTimer(entry); return entry.el; }
  const el = document.createElement('div');
  el.className = 'msg ' + entry.cls;
  setBubbleHtml(el, entry.text);
  attachScrollReset(el);
  chatLog.appendChild(el);
  entry.el = el;
  resetEntryTimer(entry);
  return el;
}

function showAnswer(cls, text) {
  // 隐藏所有现存气泡
  for (const h of msgHistory) { if (h.el) h.el.style.display = 'none'; }
  const el = document.createElement('div');
  el.className = 'msg ' + cls;
  setBubbleHtml(el, text);
  attachScrollReset(el);
  chatLog.appendChild(el);
  const entry = { text, cls, el, hideTimer: null };
  msgHistory.push(entry);
  historyIdx = msgHistory.length - 1;
  curBubble = el;
  resetEntryTimer(entry);
  return el;
}

// 重置当前可见气泡的倒计时(供 onAiDone 等沿用)
function scheduleHide() {
  const entry = msgHistory.find(e => e.el === curBubble);
  if (entry) resetEntryTimer(entry);
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeChat(); return; }

  if (e.key !== 'Enter' || e.isComposing) return; // isComposing:避免中文输入法回车误发
  const text = chatInput.value.trim();
  if (!text) return;

  // 临时提示气泡(不入历史,3 秒自消,显示在输入框下方)
  function hintBubble(text) {
    const el = document.createElement('div');
    el.className = 'msg hint';
    el.textContent = text;
    chatInput.insertAdjacentElement('afterend', el);
    setTimeout(() => el.remove(), 3000);
  }

  // !p / !previous:向前翻历史
  if (text === '!p' || text === '!previous') {
    chatInput.value = '';
    closeChat();
    if (msgHistory.length <= 1) { hintBubble('还没有历史记录哦'); return; }
    if (historyIdx <= 0) { hintBubble('没有历史记录了哦'); return; }
    const prev = historyIdx - 1;
    for (const h of msgHistory) { if (h.el) h.el.style.display = 'none'; }
    const entry = msgHistory[prev];
    const el = ensureBubble(entry);
    el.style.display = '';
    historyIdx = prev;
    curBubble = el;
    return;
  }

  // !n / !next:向后翻历史
  if (text === '!n' || text === '!next') {
    chatInput.value = '';
    closeChat();
    if (msgHistory.length <= 1) return;
    if (historyIdx >= msgHistory.length - 1) return;
    const next = historyIdx + 1;
    for (const h of msgHistory) { if (h.el) h.el.style.display = 'none'; }
    const entry = msgHistory[next];
    const el = ensureBubble(entry);
    el.style.display = '';
    historyIdx = next;
    curBubble = el;
    return;
  }

  curId = Date.now().toString(36) + Math.random().toString(16).slice(2);
  const isAgent = text.startsWith('/');
  showAnswer('fox' + (isAgent ? ' agent' : ''), isAgent ? '运行中…' : '…'); // 只显示酒狐的回答,不回显用户
  window.desktopFox?.aiSend(curId, text, currentState());
  chatInput.value = '';
  busy = true;      // 进入「回答中」:锁住输入,收起输入条
  closeChat();
  clearTimeout(busySafety);
  busySafety = setTimeout(() => { busy = false; }, 90000); // 兜底:异常挂死也能解锁
});
chatInput.addEventListener('blur', closeChat); // 失焦(切到别的应用)即收起、还焦

function endBusy() {
  busy = false;
  clearTimeout(busySafety);
}

if (isElectron) {
  window.desktopFox.onAiToken(({ id, delta, kind }) => {
    if (id !== curId || !curBubble) return; // 只认当前这轮
    if (kind === 'reasoning') {
      if (!curBubble.dataset.started) curBubble.innerHTML = '思考中…';
      return;
    }
    // content 或 status(Agent 工具动作/启动提示):首段清掉占位并去前导换行
    // 追加前先判断是否贴底:贴底才自动跟随,否则尊重用户手动上滚回看。
    const atBottom = curBubble.scrollHeight - curBubble.scrollTop - curBubble.clientHeight < 24;
    if (!curBubble.dataset.started) {
      curBubble.dataset.rawText = '';
      curBubble.dataset.started = '1';
      delta = delta.replace(/^\n+/, '');
    }
    const raw = (curBubble.dataset.rawText || '') + delta;
    curBubble.dataset.rawText = raw;
    curBubble.innerHTML = mdToHtml(stripAnimTags(raw));
    if (atBottom) curBubble.scrollTop = curBubble.scrollHeight;
  });
  window.desktopFox.onAiDone(({ id, fullText }) => {
    if (id !== curId) return;
    // 终止或整轮无流式输出时,气泡还停在「运行中…」占位 —— 用最终文本兜底刷新。
    const aborted = typeof fullText === 'string' && fullText.endsWith('(已终止)');
    const clean = stripAnimTags(fullText || '');
    if (curBubble && (!curBubble.dataset.started || aborted)) {
      setBubbleHtml(curBubble, clean || '(完成)');
      curBubble.dataset.started = '1';
      curBubble.scrollTop = curBubble.scrollHeight;
    }
    // 把最终文本存进历史,即使 DOM 过期后 !p 仍能重建;Ctrl+C 终止的除外。
    const entry = msgHistory.find(e => e.el === curBubble);
    if (aborted) {
      if (entry) {
        const i = msgHistory.indexOf(entry);
        if (i !== -1) msgHistory.splice(i, 1);
        if (historyIdx >= msgHistory.length) historyIdx = msgHistory.length - 1;
        if (msgHistory.length === 0) historyIdx = -1;
      }
    } else if (entry) {
      entry.text = clean || '(完成)';
    }
    endBusy();      // 回答给出,解锁输入
    scheduleHide(); // 答完 1 分钟后消失
    if (!aborted) playTagFromText(fullText); // 按情绪标记触发动画(存在才播)
  });
  window.desktopFox.onAiError(({ id, message }) => {
    if (id !== curId) return;
    endBusy();
    // 复用当前气泡,不改写历史条目(避免出错的 placeholder 留作"纪录")
    if (curBubble) {
      curBubble.className = 'msg err';
      setBubbleHtml(curBubble, '出错了:' + message);
      curBubble.dataset.started = '1';
      const entry = msgHistory.find(e => e.el === curBubble);
      if (entry) { entry.text = '出错了:' + message; entry.cls = 'err'; }
    }
    scheduleHide();
  });

  // 屏幕感知:缓存最新结果供调试显示
  window.desktopFox.onPerceptionUpdate((data) => {
    perceptionDebug = data;
  });

  // 主动搭话:收到消息后直接创建气泡,不进历史
  window.desktopFox.onProactive(({ id, text }) => {
    curId = id;
    showAnswer('fox', stripAnimTags(text));
    scheduleHide();
    playTagFromText(text);
  });

  // 设置:实时套用气泡配色(聊天 / Agent)。选色器给的是 #rrggbb,套用时补固定透明度,
  // 保留桌面悬浮的半透明质感。
  const BUBBLE_ALPHA = 0.9;
  function hexToRgba(hex, a) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
    if (!m) return hex; // 非法值就原样返回,交给 CSS 兜底
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  function applySettings(s) {
    const root = document.documentElement.style;
    if (s.chatColor) root.setProperty('--fox-bubble', hexToRgba(s.chatColor, BUBBLE_ALPHA));
    if (s.agentColor) root.setProperty('--agent-bubble', hexToRgba(s.agentColor, BUBBLE_ALPHA));
    if (s.hintColor) root.setProperty('--hint-bubble', hexToRgba(s.hintColor, BUBBLE_ALPHA));
    if (typeof s.bubbleWidth === 'number') {
      root.setProperty('--bubble-width', Math.max(10, Math.min(90, s.bubbleWidth)) + '%');
    }
    if (s.bubbleAlign) {
      root.setProperty('--bubble-align', s.bubbleAlign === 'right' ? 'flex-end' : 'flex-start');
    }
    if (typeof s.showDebug === 'boolean') {
      debugVisible = s.showDebug;
      dbg.style.display = s.showDebug ? 'block' : 'none';
    }
    if (typeof s.camPitch === 'number') camPitch = s.camPitch;
    if (typeof s.camYaw === 'number') camYaw = s.camYaw;
    if (typeof s.camRoll === 'number') camRoll = s.camRoll;
    if (typeof s.randomAction === 'boolean') randomEnabled = s.randomAction;
    if (typeof s.randomActionSec === 'number') {
      randomIntervalMs = Math.max(10, Math.min(300, s.randomActionSec)) * 1000;
    }
    if ('randomActionAnims' in s) {
      randomActionAnims = Array.isArray(s.randomActionAnims) ? s.randomActionAnims : undefined;
    }
    if (s.randomStyle === 'classic' || s.randomStyle === 'custom') randomStyle = s.randomStyle;
    if (typeof s.showAnimTags === 'boolean') aiAnimEnabled = s.showAnimTags;
  }
  window.desktopFox.onSettingsChanged?.(applySettings);
  // 主动拉取一次:防止 did-finish-load 的推送在监听器注册前漏掉
  window.desktopFox.getSettings().then(applySettings);
}


const dbg = document.querySelector('#dbg');
let debugVisible = false;
let perceptionDebug = { winTitle: '', screenDesc: '' };
let camPitch = 0;
let camYaw = 0;
let camRoll = 0;
const vv = window.visualViewport;

// 【调试】把随机动作间隔从 60s 缩短到 3s,方便验证「随机坐下→点击站起」。
// 测完把 DEBUG_FAST_RANDOM 改回 false 即可恢复原版 60s 间隔。
const DEBUG_FAST_RANDOM = false;
const DEBUG_RANDOM_INTERVAL = 3000;
let lastNudge = performance.now();

const limit = withFrameRateLimit(60)(() => {
  // 相机位置由固定距离 + 用户可调的俯仰/偏航决定(设置窗口)
  const p = camPitch * Math.PI / 180;
  const y = camYaw * Math.PI / 180;
  camera.position.x = CAMERA_Z * Math.sin(y) * Math.cos(p);
  camera.position.y = CAMERA_Z * Math.sin(p);
  camera.position.z = CAMERA_Z * Math.cos(y) * Math.cos(p);
  camera.lookAt(0, 0, 0);
  camera.rotateZ(camRoll * Math.PI / 180);
  // 【调试】每隔 DEBUG_RANDOM_INTERVAL 把计时器往前拨,逼本帧立刻触发一次随机动作。
  if (DEBUG_FAST_RANDOM && model.mainModel && performance.now() - lastNudge >= DEBUG_RANDOM_INTERVAL) {
    model.mainModel.randomTask.lastTime = performance.now() - 60 * 1000;
    lastNudge = performance.now();
  }
  model.update(clock.getDelta());
  model.lookAt(mouse);
  if (debugVisible) {
    const p = perceptionDebug;
    const mood = model.mainModel?.randomTask?.mood;
    dbg.textContent =
      `z=${camera.position.z.toFixed(1)} winScale=${winScale.toFixed(2)}\n` +
      `win=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}\n` +
      `vvScale=${vv ? vv.scale.toFixed(3) : 'n/a'} vvW=${vv ? vv.width.toFixed(0) : 'n/a'}\n` +
      `drag=${dragging} interactive=${interactive}\n` +
      `随机=${randomStyle} 心情=${typeof mood === 'number' ? Math.round(mood) : 'n/a'}\n` +
      `窗口:${p.winTitle || '-'}\n屏幕:${p.screenDesc || '-'}`;
  }
});
limit.start();
