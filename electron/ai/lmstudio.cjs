const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const settings = require('./settings.cjs');

// 用 LM Studio 的命令行 `lms` 无界面地起服务 + 加载模型(底层是它自带的 CUDA llama.cpp)。
// 仅在「拉起 lms」后端使用;带状态机 + 运行日志,供设置窗口显示。
// 「连接 LM Studio」后端不经过这里(chat.cjs 直接用 externalBaseURL)。

let state = 'stopped';        // 'stopped' | 'starting' | 'ready' | 'error'
let lastError = '';
const logTail = [];           // 最近若干行日志(供设置窗口显示)
const LOG_MAX = 80;
let startPromise = null;
const statusListeners = new Set();

function port() {
  return Number(settings.getAll().lmsPort) || 1234;
}

function getBaseURL() {
  return `http://127.0.0.1:${port()}/v1`;
}

function status() {
  return { status: state, error: lastError, logTail: logTail.join('') };
}

function onStatusChange(cb) {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

function setState(next, err) {
  state = next;
  lastError = err || '';
  for (const cb of statusListeners) {
    try { cb(status()); } catch { /* 监听器出错不影响主流程 */ }
  }
}

function pushLog(chunk) {
  const s = chunk.toString();
  logTail.push(s);
  while (logTail.length > LOG_MAX) logTail.shift();
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'lmstudio.log'), s);
  } catch { /* 落盘失败忽略 */ }
}

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    pushLog(`$ lms ${args.join(' ')}\n`);
    execFile('lms', args, { windowsHide: true, timeout: timeoutMs || 60000 }, (err, stdout, stderr) => {
      if (stdout) pushLog(stdout);
      if (stderr) pushLog(stderr);
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// 轮询 /v1/models,直到 200 或超时。
async function waitReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const url = `${getBaseURL()}/models`;
  while (Date.now() < deadline) {
    if (state === 'stopped' || state === 'error') return false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* 还没起来,继续等 */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

async function startServer() {
  const r = await run(['server', 'start', '--port', String(port())], 30000);
  if (r.err && /ENOENT/i.test(String(r.err.code || r.err.message || r.err))) {
    throw new Error('未找到 lms 命令(LM Studio CLI)。请确认已安装 LM Studio 且 lms 在 PATH 中。');
  }
  return true; // 已在运行时 lms 也会正常返回,无害
}

// 模型名规范化:key 里的 @(量化变体分隔符)在 lms load 时需写成 -
function normalizeModel(m) {
  return (m || '').trim().replace(/@/g, '-');
}

async function loadModel() {
  const s = settings.getAll();
  const model = normalizeModel(s.lmsModel);
  if (!model) throw new Error('未指定要加载的模型(在设置里填 lms 模型 key,如 qwen2.5-3b-instruct)。');
  // 已加载则跳过,避免重复占显存
  const ps = await run(['ps'], 15000);
  if (ps.stdout && ps.stdout.includes(model)) return true;
  const args = ['load', model, '-y'];
  const gpu = (s.lmsGpu || 'max').trim();
  if (gpu) args.push('--gpu', gpu);
  const ctx = Number(s.lmsCtx) || 0;
  if (ctx > 0) args.push('--context-length', String(ctx));
  const ttl = Number(s.lmsTtl) || 0;
  if (ttl > 0) args.push('--ttl', String(ttl));
  const r = await run(args, 180000); // 首次加载可能较久
  if (r.err) {
    throw new Error('lms load 失败:' + String(r.stderr || r.err.message || r.err).slice(0, 200));
  }
  return true;
}

function start() {
  if (startPromise) return startPromise;
  if (state === 'ready') return Promise.resolve(true);
  setState('starting');
  logTail.length = 0;
  startPromise = (async () => {
    try {
      await startServer();
      await loadModel();
      const ok = await waitReady(60000);
      if (!ok) {
        if (state === 'starting') throw new Error('启动超时:60s 内 /v1/models 未就绪');
        throw new Error(lastError || '启动失败');
      }
      setState('ready');
      return true;
    } catch (err) {
      setState('error', err.message || String(err));
      throw err;
    } finally {
      startPromise = null;
    }
  })();
  return startPromise;
}

function stop() {
  setState('stopped');
  startPromise = null;
  run(['server', 'stop'], 15000).catch(() => {});
}

// 确保就绪:未起则启动并等待;已在启动则复用同一 promise。返回 baseURL。
async function ensureReady() {
  if (state === 'ready') return getBaseURL();
  await start();
  return getBaseURL();
}

function restart() {
  stop();
  return start();
}

// 列出本地已下载的模型 key(供设置窗口下拉/补全,best-effort,失败返回空)。
async function listModels() {
  const r = await run(['ls', '--json'], 15000);
  if (r.err || !r.stdout) return [];
  try {
    const arr = JSON.parse(r.stdout);
    if (!Array.isArray(arr)) return [];
    return arr.map((m) => m.modelKey || m.path || m.address || m.name || '').filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { start, stop, restart, ensureReady, getBaseURL, status, onStatusChange, listModels, normalizeModel };
