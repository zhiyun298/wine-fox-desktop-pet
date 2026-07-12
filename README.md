# 酒狐 Wine Fox · 桌宠

一只在桌面上悬浮的狐娘桌宠 —— 基于 [Electron](https://www.electronjs.org/) + [Three.js](https://threejs.org/)（[`wine-fox`](https://www.npmjs.com/package/wine-fox) 库渲染），内置可接入云端 / 本地大模型的 AI 聊天层。她会陪你聊天、做动作、犯傻卖萌，还能感知屏幕内容主动搭话。

> 截图 / 演示 GIF 占位：`docs/preview.gif`

## ✨ 功能特性

- **透明悬浮桌宠**：无边框全透明窗口，狐狸始终置顶；可拖动、缩放、切换明暗、点击坐/站。
- **动画系统**：右键菜单「动作」直接触发；随机动作两种风格——「自定义」（勾选子集等概率随机）与「原版」（库自带心情加权 + 苹果吃/酒瓶喝 + 大概率不动）。
- **AI 聊天**：长按狐狸打开气泡输入，流式回复；支持情绪动作标记 `[anim:happy]` 等，让她边说边动；「原版」随机风格下 AI 还能用 `[mood:N]` 设定心情。
- **主动搭话**：空闲一段时间后她会主动开口（可关）。
- **屏幕感知**（可选，默认关）：截图交给视觉模型分析，让她能「看到」你在做什么再吐槽/问候。
- **多 AI 后端**：云端中转站 / 连接本地 LM Studio / 用 `lms` CLI 自动拉起本地模型，设置窗口一键切换。
- **`/` 命令 → 本机 Agent**（可选，进阶）：以 `/` 开头的消息转交本机 [Claude Code](https://claude.com/claude-code) `claude` CLI 执行。

## 🖥 环境要求

- **Node.js** ≥ 18
- **pnpm**（推荐；也可用 npm）
- **Windows 10/11**（打包目标为 Windows；开发在 macOS/Linux 亦可）
- 可选：[LM Studio](https://lmstudio.ai/)（本地模型后端）、`claude` CLI（`/` Agent 功能）

## 🚀 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置 AI 密钥：复制示例并填入你的 apiKey / baseURL
cp electron/ai/secret.example.json electron/ai/secret.json
#   然后编辑 electron/ai/secret.json（也可改用环境变量 AI_API_KEY / AI_BASE_URL）

# 3. 开发运行（vite 热更新 + electron）
pnpm app
```

> 不配 `secret.json` 也能启动，只是云端聊天不可用；可改用本地 LM Studio 后端（设置窗口里切换）。

## ⚙️ AI 配置（`electron/ai/secret.json`）

| 字段 | 必填 | 说明 |
|---|---|---|
| `baseURL` | 是 | OpenAI 兼容接口地址（云端中转站或自建） |
| `apiKey` | 是 | 接口密钥（也可用环境变量 `AI_API_KEY`） |
| `chatModel` | 否 | 聊天模型名，默认 `deepseek-v4-flash` |
| `visionModel` | 否 | 屏幕感知用的视觉模型名 |
| `agentModel` | 否 | `/` Agent 用的模型；空 = claude 默认 |
| `persona` | 否 | 自定义人设，覆盖内置默认人设 |

后端在**设置窗口 → AI 后端**切换：`cloud`（中转站）/ `lmstudio`（连接已运行的 LM Studio）/ `lms`（用 `lms` CLI 自动拉起并加载模型）。

> ⚠️ 安全提示：`/` Agent 会以 `bypassPermissions`（无护栏）模式在项目目录运行本机 `claude` CLI。仅在你信任的环境使用，不需要可忽略此功能。

## 📦 打包发布

```bash
pnpm dist            # 输出到 release/：NSIS 安装包 + 免安装 portable + zip 视配置而定
```

国内网络下，electron / electron-builder 的二进制可走镜像加速：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
pnpm dist
```

产物运行时的用户数据（设置、聊天记忆）存放于 `%APPDATA%/wine-fox-desktop`。

## 📁 目录结构

```
main.js                 渲染进程：狐狸渲染、交互、动画、聊天 UI
index.html              页面骨架与样式
vite.config.js          构建配置（base:'./' 以便 file:// 加载）
electron/
  main.cjs              主进程：窗口/托盘/IPC/全局快捷键
  preload.cjs           渲染进程 bridge
  settings.html         设置窗口
  settings-preload.cjs  设置窗口 bridge
  ai/
    config.cjs          读取 secret.json / 环境变量 + 默认人设
    chat.cjs            聊天（流式，多后端）
    agent.cjs           "/" 命令 → 本机 Claude Code
    context.cjs         环境上下文（时间/状态/动画·心情提示）
    history.cjs         聊天记忆持久化
    proactive.cjs       主动搭话
    perception.cjs      屏幕感知（截图分析）
    lmstudio.cjs        本地 LM Studio / lms 管理
    settings.cjs        界面/行为设置持久化
    secret.example.json 密钥示例（复制为 secret.json 使用）
images/                 托盘图标
```

## 📜 开源协议与致谢 / License & Credits

本项目采用**代码 / 资产分离**授权：

- **源代码** —— [MIT](./LICENSE)。你可自由使用、修改、再分发本仓库代码。
- **酒狐（Wine Fox）3D 模型** —— **CC-BY-NC-SA 4.0**。模型来自 `wine-fox` 包，署名原作者、**非商业**、修改需相同方式共享。
- 基于 [`wine-fox`](https://github.com/ctrlkk/wine-fox) © 2025 ctrlkk（MIT）；依赖 [three.js](https://threejs.org/)（MIT）、[Electron](https://www.electronjs.org/)（MIT）。

各第三方组件的完整版权与许可文本见 [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)，并随打包成品一并分发。

> **重要**：由于**打包后的应用内嵌了 CC-BY-NC-SA 的酒狐模型**，因此**成品（exe / zip 等分发物）仅限非商业用途**，再分发时须署名模型原作者并保持相同协议。仓库源码本身不含模型文件（模型在安装依赖时由 `wine-fox` 包提供）。
>
> 本说明不构成法律意见；如有商业化需求，请先与模型原作者确认授权。

## ⚠️ 免责声明

本项目仅供学习与个人非商业使用。使用 AI 功能需自备第三方接口，产生的费用与内容由使用者自行负责。
