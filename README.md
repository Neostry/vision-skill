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
node vision.mjs <图片路径...> [--prompt "问题"] [--model mimo-v2.5-free]
```

## 工作原理

```
图片文件 → base64 → POST 到视觉模型 API（OpenAI 兼容格式）→ 返回文字描述
```

- **默认模型**：`mimo-v2.5-free`（支持 text/image/audio/video，200K context，免费）
- **默认 API**：`https://opencode.ai/zen/v1`（OpenCode Zen 统一端点，OpenAI 兼容；同一把 opencode key 即可访问）

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

- **零依赖**：只用 Node 内置 API（`fetch`/`fs`），不安装任何 npm 包，不执行任何下载的代码
- **最小行为**：只做"读你指定的图片 + 发 1 个 HTTP POST + 打印结果"，不扫描目录、不读无关文件、不写文件、不留日志
- **Key 不泄露**：从环境变量或本地 `auth.json` 读取，**绝不硬编码、绝不打印**
- 完整源码约 130 行，欢迎审查：`vision.mjs`

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
