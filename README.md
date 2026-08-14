# Vision Skill（识图技能）

让**没有视觉能力的 AI 模型**（如 DeepSeek V4 Flash）也能"看图"：把图片发送给有视觉能力的模型 API（默认 `mimo-v2.5-free`，OpenCode Zen 免费线路），用文字描述返回给主模型。

符合 **Agent Skills 开放标准**（[agentskills.io](https://agentskills.io)），一套文件兼容多个 AI 编码工具：

| 工具 | 安装位置 |
|---|---|
| Reasonix | `%APPDATA%\reasonix\skills\vision\` |
| opencode | `~/.config/opencode/skills/vision/` |
| Codex | `~/.agents/skills/vision/` |

## 为什么做这个

- 主模型（如 `deepseek-v4-flash`）的输入只支持 `text`，无法直接理解图片
- 网上流行的同类方案要求直接运行第三方脚本，存在**安全隐患**
- 本项目是**纯手写、零依赖、可逐行审查**的替代方案

## 快速开始

### 方式一：一键安装（推荐）

```powershell
git clone https://github.com/Neostry/vision-skill.git
cd vision-skill
./install.ps1        # Windows
./install.sh         # macOS / Linux
```

脚本会把 `SKILL.md` + `vision.mjs` 复制到本机检测到的工具目录（Reasonix / opencode / Codex）。

### 方式二：手动安装

把 `SKILL.md` 和 `vision.mjs` 一起放进任一工具的 skills 目录（见上表），重启工具即可。

### 手动调用

```bash
node vision.mjs <图片路径或文件名...> [--prompt "问题"] [--model mimo-v2.5-free]
```

## 工作原理

```
图片（磁盘文件 或 工作台粘贴图）→ base64 data URL → POST 到视觉模型 API（OpenAI 兼容格式）→ 返回文字描述
```

主模型收不到用户粘贴的图片，但各 AI 工作台都会把粘贴图片以 **base64 data URL** 形式存到本地。脚本按「磁盘文件 → opencode → codex → reasonix」自动探测，找到后**直接复用已存好的 base64 发请求，不落盘、不恢复成文件**：

| 工作台 | 图片存储位置 | 匹配精度 | 识别后清理 |
|---|---|---|---|
| opencode | `~/.local/share/opencode/opencode.db` 的 part 表（`type:"file", mime:"image/*"`） | 按文件名精确匹配 | **默认自动删除**记录（`--keep-db` 保留） |
| codex | `~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl`（`input_image`/`image_url` data URL） | 最近一张 | 只读，不删（jsonl 行式记录，删除破坏回放） |
| reasonix | `%AppData%\reasonix`（Win）/ `~/.config/reasonix`（Linux,macOS）/ `~/.reasonix`（旧版）的会话 jsonl | 最近一张 | 只读，不删 |

> WSL 环境自动兼容 `/mnt/c/Users/<用户>` 下的对应目录。找不到图片时脚本给出明确警告。
> 可通过 `--source disk,opencode,codex,reasonix` 限定来源。

### 端到端实测（2026-08-14）

- opencode：自动定位 `image.png` → base64 直用识别 → 识别后自动删除数据库记录（part 数归零），全程无临时文件
- reasonix：成功从 WSL 侧 `%AppData%\reasonix` 会话 jsonl 定位到图片 data URL
- 各工作台存储位置均在本机实测确认

### API Key 从哪来（自动，按优先级）

1. 环境变量 `VISION_API_KEY`
2. 环境变量 `OPENCODE_API_KEY`
3. opencode 登录态 `~/.local/share/opencode/auth.json`（无需任何配置）

> 如果你用别的 API（阿里云百炼 `qwen-vl-max`、OpenAI `gpt-4o-mini` 等），设置环境变量即可，无需改代码：
> ```powershell
> setx VISION_API_KEY "sk-你的key"
> setx VISION_API_BASE "https://dashscope.aliyuncs.com/compatible-mode/v1"
> setx VISION_MODEL "qwen-vl-max"
> ```

## 安全设计

- **零依赖**：只用 Node 内置 API（`fetch`/`fs`/`os`/`sqlite`），不安装任何 npm 包，不执行任何下载的代码
- **最小行为**：只做"取用户指定的图片 base64 + 发 1 个 HTTP POST + 打印结果"；查工作台数据库默认只读
- **清理可控**：仅识别成功后删除 opencode 数据库里那一条图片记录（默认），`--keep-db` 可保留；codex / reasonix 只读不删
- **Key 不泄露**：从环境变量或本地 `auth.json` 读取，**绝不硬编码、绝不打印**
- 完整源码约 380 行，模块化（适配器架构）且可逐行审查：`vision.mjs`

## 可选视觉模型（--model 覆盖）

| 模型 | 说明 |
|---|---|
| `mimo-v2.5-free` | 默认，**免费**（OpenCode Zen 免费线路，200K context） |
| `mimo-v2-omni` | 额外支持 audio/pdf |
| `qwen3.7-plus` / `qwen3.6-plus` / `qwen3.5-plus` | 阿里系多模态 |
| `kimi-k2.5` / `kimi-k2.6` / `kimi-k3` | Kimi 多模态 |

默认走 Zen 免费线路（不消耗 go 套餐额度）。如需换回 go 套餐线路：`--api https://opencode.ai/zen/go/v1 --model mimo-v2.5`。

更换 API 端点用 `--api <URL>`。

## 许可证

MIT © Neostry
