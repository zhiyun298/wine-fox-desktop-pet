const { loadConfig } = require('./config.cjs');
const settings = require('./settings.cjs');
const lmstudio = require('./lmstudio.cjs');

let controller = null; // 当前请求的 AbortController,供「^C 终止」用

// OpenAI 兼容流式聊天。messages 已是完整的 [{role,content}, ...]。
// 逐 token 回调 onToken(delta),返回完整文本。出错抛异常,交上层转 ai:error。
async function streamChat(messages, onToken, opts) {
  const cfg = loadConfig();
  const s = settings.getAll();
  const backend = s.chatBackend || 'cloud';

  // 后端选择:lms=用 lms CLI 自动拉起并加载模型;lmstudio=连接已运行的 LM Studio;cloud=中转站。
  let baseURL, apiKey, model;
  if (backend === 'lms') {
    baseURL = await lmstudio.ensureReady(); // 未起则用 lms 拉起并等就绪,失败抛错
    apiKey = '';
    model = lmstudio.normalizeModel(s.lmsModel) || 'local';
  } else if (backend === 'lmstudio') {
    baseURL = (s.externalBaseURL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');
    apiKey = '';
    model = s.externalModel || 'local';
  } else {
    if (!cfg.apiKey) {
      throw new Error('未配置 API key:请在 electron/ai/secret.json 填 apiKey,或设环境变量 AI_API_KEY');
    }
    baseURL = cfg.baseURL;
    apiKey = cfg.apiKey;
    model = (opts && opts.model) || cfg.chatModel;
  }

  const body = {
    model,
    messages,
    stream: true,
  };
  if (opts && typeof opts.temperature === 'number') {
    body.temperature = opts.temperature;
  }
  if (backend !== 'cloud') {
    const mt = Number(s.localMaxTokens) || 0;
    if (mt > 0) body.max_tokens = mt; // 限制回复长度,秒回体感的最大杠杆
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  controller = new AbortController();
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`聊天请求失败 ${res.status}:${body.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (err) {
      // AbortController.abort() → 读中断:保留已流出的部分,标「已终止」
      if (err && err.name === 'AbortError') return full ? full + '\n(已终止)' : '(已终止)';
      throw err;
    }
    const { done, value } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 按行解析,累积到出现空行/完整 data: 行
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return full;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          // 正文:计入完整回复,标 kind='content'
          full += delta.content;
          onToken(delta.content, 'content');
        } else if (delta.reasoning_content) {
          // 推理模型的思考过程:不计入历史,仅作「思考中」提示
          onToken(delta.reasoning_content, 'reasoning');
        }
      } catch {
        // 半包/非 JSON 行忽略
      }
    }
  }
  return full;
}

// 终止当前聊天流(供「^C 终止」用)
function abort() {
  if (controller) controller.abort();
}

// 剥掉整段被成对引号包裹的情况(模型偶尔把整句回复用引号括起来)。
// 仅当首尾为配对引号、且内部无同款引号(说明是包裹而非正常引用)时才剥。
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

module.exports = { streamChat, abort, stripWrapQuotes };
