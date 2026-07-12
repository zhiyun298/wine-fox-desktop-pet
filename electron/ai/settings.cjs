const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// 界面/行为设置持久化到 .userdata/ai-settings.json。
// 气泡配色、temperature、自定义人设、动作脚本开关。

const DEFAULTS = {
  chatColor: '#1c1c20',     // 聊天(酒狐)气泡背景
  agentColor: '#3c2a0c',    // Agent 气泡背景
  hintColor: '#555555',     // 提示泡背景
  temperature: 0.65,         // 聊天温度(越高越"发烧",越低越呆)
  persona: '',               // 自定义人设;空 = 用 config.cjs 的 DEFAULT_PERSONA
  showActions: true,         // 是否允许 *动作描述*;关掉则只输出纯对话
  showAnimTags: true,        // 是否允许 AI 用 [anim:…] 标记触发动画(与 showActions 独立)
  showDebug: false,          // 调试信息叠加层
  proactive: false,          // 主动搭话开关(默认关)
  proactiveIdleMin: 5,       // 空闲几分钟后搭话(1~30)
  screenshotQuality: 70,      // 截图 JPEG 质量(50-100),默认 70
  screenshotPrompt: '',       // 截图分析提示词;空 = 用内置默认
  screenPerception: false,   // 屏幕感知(截图分析),默认关(隐私)
  bubbleWidth: 60,           // 气泡/输入框宽度占比(10-100)
  bubbleAlign: 'left',       // 气泡/输入框停靠:'left' | 'right'
  randomAction: true,        // 自动随机动作开关
  randomActionSec: 60,       // 随机动作间隔(秒),UI 10-300
  randomStyle: 'custom',     // 随机风格:'custom'(勾选子集等概率一次性播) | 'classic'(库原版:心情加权+道具+80%不动)
  randomActionAnims: null,   // 允许自发触发的动画白名单(clip 名数组);null=默认(除坐姿外全允许)。仅 custom 风格生效
  chatBackend: 'cloud',      // 聊天后端:'cloud'(中转站) | 'lmstudio'(连接已运行的 LM Studio) | 'lms'(用 lms CLI 自动拉起并管理)
  localMaxTokens: 0,         // 回复最大 token 上限:0=不限(lmstudio/lms 生效)
  // 连接 LM Studio(仅连接已运行的本地服务器,不自己拉起)
  externalBaseURL: 'http://127.0.0.1:1234/v1', // LM Studio 本地服务地址
  externalModel: '',         // 模型名;空=发 'local'(LM Studio 用当前加载的)
  // 拉起 lms(用 LM Studio CLI 自动起服务 + 加载模型)
  lmsPort: 1234,             // lms 服务端口
  lmsModel: '',              // 要加载的模型 key(如 qwen2.5-3b-instruct)
  lmsGpu: 'max',             // GPU 卸载:max | off | 0~1 比例
  lmsCtx: 4096,              // 上下文长度(--context-length)
  lmsTtl: 0,                 // 空闲卸载秒数(--ttl),0=不设
  proactiveUseMaster: true,  // 主动搭话使用"主人"称呼
  chatModel: '',             // 聊天模型;空 = 用 secret.json 的 chatModel
  visionModel: '',           // 截图分析模型;空 = 用 secret.json 的 visionModel
  camPitch: 0,               // 相机俯仰角(度),正=从上方看,负=从下方看
  camYaw: 0,                 // 相机偏航角(度),正=从右侧看,负=从左侧看
  camRoll: 0,                // 相机滚转角(度),正=顺时针歪头,负=逆时针
};

let settings = { ...DEFAULTS };

function filePath() {
  return path.join(app.getPath('userData'), 'ai-settings.json');
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf-8'));
    settings = { ...DEFAULTS, ...parsed };
  } catch {
    settings = { ...DEFAULTS };
  }
  return settings;
}

function save() {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(settings), 'utf-8');
  } catch {
    // 落盘失败不致命,忽略
  }
}

function getAll() {
  return { ...settings };
}

function set(patch) {
  settings = { ...settings, ...patch };
}

module.exports = { load, save, getAll, set, DEFAULTS };
