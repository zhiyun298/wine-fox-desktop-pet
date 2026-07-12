const fs = require('node:fs');
const path = require('node:path');
let app = null;
try { ({ app } = require('electron')); } catch { /* 非 electron 环境:忽略 */ }

// 酒狐默认人设(依官方设定:D:\1\WineFoxModel\README.md 的「人物设定」)
const DEFAULT_PERSONA = [
  '你是「酒狐」(Wine Fox),一只桌面上的狐娘助手。',
  '外形:金黄色长发,蓬松的大尾巴,软乎乎的大耳朵。',
  '性格:善良可爱,称呼用户为「主人」,对主人关怀备至、细致入微;遇到难题时偶尔会犯傻,需要主人帮忙。',
  '爱好:爱喝葡萄酒,爱吃番茄布丁(番茄混糖做的甜点)。',
  '说话:俏皮亲昵、简短口语化。你显示在桌面小气泡里,别长篇大论,一般一两句话。',
  '底线:拒绝色情/擦边/性暗示、血腥暴力、以及任何违法违规内容。',
].join('\n');

let cached = null;

function readSecret(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

// 读取密钥配置。secret.json 查找顺序:
//   1) 用户数据目录 %APPDATA%/wine-fox-desktop/secret.json —— 打包版用户在此配置(可写)
//   2) 项目内 electron/ai/secret.json —— 开发用
// 单项优先级:secret.json > 环境变量 > 内置默认。
// 注:更推荐在「设置窗口 → AI 后端 → 云端」直接填地址/密钥(见 settings 的 cloudBaseURL/cloudApiKey),
//     那条路径优先级最高且免重启;此处是保底与开发用。
function loadConfig() {
  if (cached) return cached;

  let secret = null;
  try {
    if (app) secret = readSecret(path.join(app.getPath('userData'), 'secret.json'));
  } catch { /* app 未就绪等:忽略 */ }
  if (!secret) secret = readSecret(path.join(__dirname, 'secret.json'));
  secret = secret || {};

  cached = {
    baseURL: secret.baseURL || process.env.AI_BASE_URL || 'https://api.vectorengine.ai/v1',
    apiKey: secret.apiKey || process.env.AI_API_KEY || '',
    chatModel: secret.chatModel || 'deepseek-v4-flash',
    visionModel: secret.visionModel || 'doubao-vision',
    persona: secret.persona || DEFAULT_PERSONA,
    // Agent(Claude Code)工作目录,默认 wine-fox 项目根;可在 secret.json 改
    agentCwd: secret.agentCwd || process.env.AI_AGENT_CWD || path.resolve(__dirname, '..', '..'),
    agentModel: secret.agentModel || '', // 空 = 用 claude 默认模型
  };
  return cached;
}

module.exports = { loadConfig, DEFAULT_PERSONA };
