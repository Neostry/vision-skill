# Vision Skill（识图技能）

让**没有视觉能力的 AI 模型**（如 DeepSeek V4 Flash）也能"看图"：把图片发送给有视觉能力的模型 API（默认 `mimo-v2.5`，OpenCode Zen go 线路），用文字描述返回给主模型。

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
node vision.mjs <图片路径或文件名...> [--prompt "问题"] [--model mimo-v2.5]
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

### 线路复核（2026-09-29）

- 确认免费层（`zen/v1` 的 `*-free`）对外部脚本一律 `403 FreeTierError`（仅限 OpenCode 客户端内）
- 确认 go 线路须带自定义 `User-Agent` + `x-opencode-session`，否则 `400 MissingSessionID`
- 默认改为 `mimo-v2.5`（go 线路，$0.14/$0.28），实测识图正确；备胎 `deepseek-v4-flash-vision-exp`

### API Key 从哪来（自动，按优先级）

1. 环境变量 `VISION_API_KEY`
2. 环境变量 `OPENCODE_API_KEY`
3. opencode 登录态 `~/.local/share/opencode/auth.json`（无需任何配置）

> 默认走 go 线路，因此需要一把有效的 **OpenCode Go 订阅 key**（登录 opencode 后即存于 `auth.json` 的 `opencode-go` 字段）。免费层已不再支持外部脚本调用。

### 自动降级阶梯（成本优先，首选失败自动降级）

默认阶梯（任一步非 200 或网络错误，自动尝试下一步）：

| 序号 | 模型 | 线路 | 说明 |
|---|---|---|---|
| 1 | `mimo-v2.5` | `https://opencode.ai/zen/go/v1` | 首选，go 线路中最便宜 |
| 2 | `deepseek-v4-flash-vision-exp` | `https://opencode.ai/zen/go/v1` | 备胎（不同供应商，避免一起挂） |

- `--model` / `--api` 指定后作为阶梯起点，其后默认项自动补全去重
- 环境变量 `VISION_LADDER="model@api,model@api,..."` 可完全自定义阶梯
- **go 线路要求**：请求必须带自定义 `User-Agent` 和稳定的 `x-opencode-session` 头，否则返回 `400 MissingSessionID`。本脚本已内置（每次运行生成一个 UUID），无需手动配置
- **实测复核（2026-09-29）**：Zen **免费层**（`zen/v1` 上的 `*-free` 模型，含 `mimo-v2.6-flash-free`）现已限制为"**只能在 OpenCode 客户端内部调用**"，外部脚本一律 `403 FreeTierError`，故默认改走 go 线路
- **成本对比**（同一张测试图，按 1M token 计价）：`mimo-v2.5` $0.14/$0.28、`deepseek-v4-flash-vision-exp` $0.15/$0.60（off-peak，peak 翻倍）；实测单次成本约 $0.000151 / $0.000157，故首选 mimo

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
- 完整源码模块化（适配器架构）且可逐行审查：`vision.mjs`

## 可选视觉模型（--model 覆盖）

`--model` 指定**阶梯起点**，其后的默认阶梯项会自动补全（不指定时从 `mimo-v2.5` 起步）。以下均走 go 线路（`https://opencode.ai/zen/go/v1`）：

| 模型 | 说明 |
|---|---|
| `mimo-v2.5` | 默认起点，go 线路中最便宜（$0.14/$0.28） |
| `deepseek-v4-flash-vision-exp` | 备胎，专为视觉、非推理、低延迟 |
| `mimo-v2.6-flash` | mimo-v2.5 的同族新版（同价，推理模型） |
| `mimo-v2-omni` | 额外支持 audio/pdf |
| `qwen3.8-flash` / `qwen3.7-plus` / `qwen3.6-plus` | 阿里系多模态 |
| `kimi-k2.5` / `kimi-k2.6` / `kimi-k3` | Kimi 多模态 |

例如想优先用 `qwen3.8-flash`：`--model qwen3.8-flash`，默认阶梯会在其后自动兜底。

更换 API 端点用 `--api <URL>`；完全自定义降级链用 `VISION_LADDER="model@api,..."`。

> 注：`zen/v1` 上的免费模型（如 `mimo-v2.5-free`、`mimo-v2.6-flash-free`、`space-bunny-free`）现已只能从 OpenCode 客户端内部调用，外部脚本不可用。

## 许可证

MIT © Neostry
