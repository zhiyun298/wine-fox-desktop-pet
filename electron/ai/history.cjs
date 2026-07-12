const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// 聊天历史持久化到 .userdata/ai-history.json,重启仍记得。
// 只存 user/assistant 轮次;persona/环境上下文不入历史,由 context 每次现拼。

const MAX_TURNS = 40; // 最多保留的消息条数(user+assistant 合计),超出丢最旧
const MAX_CHARS = 8000; // 粗略上限:历史总字符数,超出从最旧开始丢(近似 token 预算)

let history = [];

function filePath() {
  return path.join(app.getPath('userData'), 'ai-history.json');
}

function timeStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function trim() {
  if (history.length > MAX_TURNS) {
    history = history.slice(history.length - MAX_TURNS);
  }
  let total = history.reduce((n, m) => n + (m.content ? m.content.length : 0), 0);
  while (total > MAX_CHARS && history.length > 1) {
    const dropped = history.shift();
    total -= dropped.content ? dropped.content.length : 0;
  }
}

function load() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    history = [];
  }
  return history;
}

function save() {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(history), 'utf-8');
  } catch {
    // 落盘失败不致命,忽略
  }
}

function append(role, content) {
  history.push({ role, content, time: timeStr() });
  trim();
}

function getAll() {
  // 只给 user 消息加时间前缀作上下文;assistant 不加,否则小模型会照抄格式在回复里带时间戳。
  return history.map(m => ({
    role: m.role,
    content: (m.role === 'user' && m.time) ? `[${m.time}] ${m.content}` : m.content,
  }));
}

function getAllRaw() {
  return history;
}

function remove(index) {
  if (index >= 0 && index < history.length) {
    history.splice(index, 1);
    save();
  }
}

function clear() {
  history = [];
  save();
}

module.exports = { load, save, append, getAll, getAllRaw, remove, clear };
