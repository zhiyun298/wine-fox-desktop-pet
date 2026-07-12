const fs = require('node:fs');
const path = require('node:path');

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

// 读取配置。密钥优先环境变量 AI_API_KEY,否则读同目录 secret.json。
function loadConfig() {
  if (cached) return cached;

  let secret = {};
  const secretPath = path.join(__dirname, 'secret.json');
  try {
    secret = JSON.parse(fs.readFileSync(secretPath, 'utf-8'));
  } catch {
    // 没有 secret.json 也没关系,可能用环境变量
  }

  cached = {
    baseURL: process.env.AI_BASE_URL || secret.baseURL || 'https://api.vectorengine.ai/v1',
    apiKey: process.env.AI_API_KEY || secret.apiKey || '',
    chatModel: secret.chatModel || 'deepseek-v4-flash',
    visionModel: secret.visionModel || 'doubao-vision',
    persona: secret.persona || DEFAULT_PERSONA,
    // Agent(Claude Code)工作目录,默认 wine-fox 项目根;可在 secret.json 改
    agentCwd: process.env.AI_AGENT_CWD || secret.agentCwd || path.resolve(__dirname, '..', '..'),
    agentModel: secret.agentModel || '', // 空 = 用 claude 默认模型
  };
  return cached;
}

module.exports = { loadConfig, DEFAULT_PERSONA };
