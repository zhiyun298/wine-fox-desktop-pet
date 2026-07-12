const chat = require('./chat.cjs');
const perception = require('./perception.cjs');
const history = require('./history.cjs');
const { loadConfig } = require('./config.cjs');
const settings = require('./settings.cjs');
const context = require('./context.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// 主动搭话:定时检测距上次交互的时间,超时后做屏幕感知,然后自然搭话。
// 交互 = 聊天/Agent 发送、点击坐下/站起(不含悬停和菜单)。
// 主动搭话与聊天共享上下文(ai-history.json)。

function dlog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'proactive-debug.log'), line);
  } catch {}
}

let timer = null;
let lastInteraction = Date.now();
let busy = false;
let effectiveIdleMs = 5 * 60000; // 本次周期的实际阈值(含随机偏移)

function resetIdle() {
  lastInteraction = Date.now();
  const s = settings.getAll();
  const base = (s.proactiveIdleMin ?? 5) * 60000;
  const jitter = (Math.random() - 0.5) * 2 * 60000; // ±1 分钟
  effectiveIdleMs = Math.max(5000, base + jitter);  // 不低于 5 秒
}

function notifyInteraction() {
  resetIdle();
}

function startTracking(win) {
  if (timer) return;
  resetIdle();
  const INTERVAL = 10000; // 每 10s 检查一次

  timer = setInterval(async () => {
    if (busy) return;
    const s = settings.getAll();
    if (!s.proactive) return;

    if (Date.now() - lastInteraction >= effectiveIdleMs) {
      try {
        await doProactive(win);
      } catch { /* 搭话失败静默,不影响下次 */ }
      resetIdle();
    }
  }, INTERVAL);
}

async function doProactive(win, onProgress) {
  if (!win || win.isDestroyed()) { dlog('跳过: win=' + !!win); return; }
  if (busy) { dlog('跳过: busy'); return; }
  busy = true;
  dlog('开始, screenPerception=' + (settings.getAll().screenPerception || false));
  try {
    const s = settings.getAll();
    const cfg = loadConfig();
    const M = s.proactiveUseMaster !== false ? '主人' : '';

    // 1. 屏幕感知(仅当开关开启)
    let extra = '';
    if (s.screenPerception) {
      try {
        dlog('取活动窗口...');
        onProgress && onProgress('截图中…');
        const wt = await perception.getActiveWindow();
        let winTitle = '';
        if (wt) {
          const parts = wt.split('|');
          winTitle = `${parts[1] || ''}(${parts[0] || ''})`;
          extra += M ? `${M}当前在用:${winTitle}。` : `当前窗口:${winTitle}。`;
        }
        onProgress && onProgress('分析中…');
        const sc = await perception.captureAndAnalyze(s.visionModel || undefined);
        if (sc) extra += M ? `${M}屏幕内容:${sc}。` : `屏幕内容:${sc}。`;
        dlog('感知完成: win=' + winTitle + ' screen=' + (sc || '(空)').slice(0, 40));
        if (win && !win.isDestroyed()) {
          win.webContents.send('perception:update', { winTitle, screenDesc: sc || '' });
        }
      } catch (e) { dlog('感知失败: ' + (e && e.message)); }
    }

    // 2. 组装提示词(略)
    const now = new Date();
    const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ` +
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` +
      ` 星期${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}`;

    const idleMsg = M
      ? `${M}好一会儿没和她互动了。`
      : '好一会儿没和酒狐互动了。';
    const promptMsg = M
      ? `${M}空闲中,你自然地搭一句话。要俏皮简短,一两句。可以根据屏幕内容吐槽或问候。不要用*动作*。`
      : '你自然地搭一句话。要俏皮简短,一两句。可以根据屏幕内容吐槽或问候。不要用*动作*。';

    const messages = [
      { role: 'system', content: s.persona || cfg.persona },
      { role: 'system', content: `[环境] ${timeStr}。${idleMsg}${extra}` },
      ...history.getAll(),
      { role: 'system', content: promptMsg },
    ];
    const animHint = context.animTagHint();
    if (animHint) messages.splice(2, 0, { role: 'system', content: animHint });
    const moodHint = context.moodHint();
    if (moodHint) messages.splice(2, 0, { role: 'system', content: moodHint });

    // 3. 调聊天,共享上下文
    dlog('调 chat.streamChat...');
    onProgress && onProgress('聊天中…');
    let text = await chat.streamChat(messages, () => {}, { temperature: s.temperature, model: s.chatModel || undefined });
    // 小模型可能照抄上下文格式在开头加时间戳,剥掉
    if (text) text = text.replace(/^\s*\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s*/, '');
    if (text) text = chat.stripWrapQuotes(text); // 剥掉整段被引号包裹的情况
    dlog('chat 返回: ' + (text ? text.slice(0, 60) : '(空)'));

    // 4. 写入历史 + 推到渲染层
    if (text) {
      history.append('assistant', text);
      history.save();
    }
    if (win && !win.isDestroyed() && text) {
      const id = 'p' + Date.now().toString(36);
      win.webContents.send('proactive:message', { id, text });
      dlog('已发送 proactive:message id=' + id);
    } else {
      dlog('未发送: win=' + !!win + ' destroyed=' + (win && win.isDestroyed()) + ' text=' + !!text);
    }
  } catch (e) { dlog('异常: ' + (e && (e.message || e))); throw e; }
  finally { busy = false; dlog('结束'); }
}

function stopTracking() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startTracking, stopTracking, notifyInteraction, doProactive };
