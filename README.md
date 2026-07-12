# 酒狐桌宠

## 快速开始
在Release下载任意一种版本，安装或打开，不需要任何依赖。

你可以安装[Llmstudio](https://lmstudio.ai/download)或在[VectorEngine](https://vectorengine.ai/)注册（这家的API价格不贵，不过你也可以使用别的API提供商或中转站）以使用AI服务。

应用的个性化设置可以在右键菜单->设置里修改

**特别提示：左键长按可以唤出聊天框，以`/`开头的消息将会被转交给Claude Code CLI（如果你安装了），这可以用于执行临时快速简单的任务。**

聊天框的命令：
- `!p`或`!previous`，用于查看上一条消息
- `!n`或`!next`，用于查看下一条消息

## 从源码运行
### 环境要求
- **[npm](https://www.npmjs.com/)**
- **pnpm**
- **[Llmstudio](https://lmstudio.ai/download)（可选）**
- **Claude Code（可选）**

### 安装依赖并运行
1. 克隆项目
```bash
git clone https://github.com/zhiyun298/wine-fox-desktop-pet.git
```

2. 安装依赖
```bash
cd wine-fox-desktop-pet
pnpm install
```

3. 复制`electron/ai/secret.example.json`到`electron/ai/secret.json`并编辑secret.json，如下

   | 项 | 描述 | 举例 |
   | ---|---|--- |
   | baseURL | BaseURL | `https://example.com/v1` |
   | apiKey | API Key | `sk-your-api-key-here` |
   | chatModel | 聊天使用的模型 | `deepseek-v4-flash` |
   | visionModel | 图像分析使用的模型 | `doubao-seed-2-0-lite` |
   | agentCwd | Claude Code的工作目录 | `D:\` |

4. 运行
```bash
pnpm app
```

## 许可

- 项目代码为MIT许可.
- **项目基于[`ctrlkk/wine-fox`](https://github.com/ctrlkk/wine-fox)为MIT许可.**
- **[`ctrlkk/wine-fox`](https://github.com/ctrlkk/wine-fox)包含的`wine fox`模型许可证为[CC-BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), 来自[Yes Steve Model](https://modrinth.com/mod/yes-steve-model).**

详见`THIRD-PARTY-NOTICES.md`.

## 免责声明
本项目仅供学习与个人非商业使用。使用 AI 功能需自备第三方接口，产生的费用与内容由使用者自行负责。
