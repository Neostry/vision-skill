---
name: vision
description: 让无视觉能力的模型（如 deepseek-v4-flash）也能看图：把用户提供的图片发给视觉模型 API（默认 mimo-v2.5-free），返回文字描述。用户发送图片/截图或询问图像内容时使用。
---

# Vision（识图技能）

本技能解决：主模型（如 deepseek-v4-flash）没有视觉输入能力，无法直接"看"图片。

## 何时使用
- 用户发送图片文件、截图、或粘贴的图片
- 用户问"这张图里是什么 / 帮我看看这个截图 / 这个 UI 怎么样"
- 任何需要理解图像内容的场景

## 怎么用
运行（需要 node）：

```
node "<本 SKILL.md 所在目录>/vision.mjs" <图片路径或文件名> [更多...] [--prompt "具体问题"] [--model mimo-v2.5-free]
```

把脚本返回的文字描述当作"看到的画面"，整合进你的回答。

**识别粘贴的图片（重要）**：主模型收不到用户粘贴的图片，但各 AI 工作台都会把图片以 base64 data URL 存到本地。脚本按「磁盘文件 → opencode → codex → reasonix」自动探测（可用 `--source` 指定），找到后**直接复用数据库里的 base64 发请求，不落盘、不恢复成文件**：

| 工作台 | 图片存储位置 | 匹配 |
|---|---|---|
| opencode | `~/.local/share/opencode/opencode.db` 的 part 表（`type:"file", mime:"image/*"`） | 可按文件名精确匹配 |
| codex | `~/.codex/sessions/.../rollout-*.jsonl`（`input_image`/`image_url` data URL） | 最近一张 |
| reasonix | `%AppData%\reasonix`（Win）/ `~/.config/reasonix`（Linux,macOS）/ `~/.reasonix`（旧版）的会话 jsonl | 最近一张 |

WSL 环境自动兼容 `/mnt/c/Users/<用户>` 下的对应目录。找不到时脚本会给出明确警告。

**自动清理**：
- **opencode**：识别成功后默认自动删除数据库里的图片记录（减少占用，但该条会话回放会丢失图片）；`--keep-db` 可保留
- **codex / reasonix**：会话为 jsonl 行式记录，删除会破坏回放，故只读不删

## 默认配置
- **自动降级阶梯**（默认免费优先，限流/失败依次降级，最后 go 套餐兜底）：
  1. `mimo-v2.5-free` @ `https://opencode.ai/zen/v1`（免费）
  2. `mimo-v2.5` @ `https://opencode.ai/zen/go/v1`（go 套餐兜底）

  任一步返回非 200 或网络错误会自动尝试下一步，直到成功或耗尽。`--model`/`--api` 指定后作为阶梯起点（其后默认项自动补全）；环境变量 `VISION_LADDER="model@api,model@api,..."` 可完全自定义阶梯。

  > **免费线路识图模型实测（2026-08-14 复核）**：免费线路真正能识图的模型**只有 `mimo-v2.5-free` 一个**。`hy3-free` 虽返回 200 但会静默忽略图片（回复"没有收到图片附件"），nemotron/laguna/deepseek 系列免费模型直接 400 不支持图片输入——均不可用于识图，已从阶梯移除。

- API Key 来源（自动，按优先级）：
  1. 环境变量 `VISION_API_KEY`
  2. 环境变量 `OPENCODE_API_KEY`
  3. 回退读取 opencode 登录态的 `auth.json`（`~/.local/share/opencode/auth.json` 中的 opencode-go key）

同一把 opencode key 即可访问 Zen 免费线路（已验证 `opencode-go` 的 key 可直接用于 `https://opencode.ai/zen/v1`）。

## 安全规则（不可违反）
- 只把**用户明确给出的图片**发往视觉 API，绝不扫描、上传无关文件
- 脚本零依赖，只做"取图片 base64 + 一个 HTTP POST + 打印结果"
- 查库默认只读；仅识别成功后按上面的清理策略删除（opencode 记录），`--keep-db` 可保留
- 不打印、不写盘、不展示 API Key
- 图片超过 8MB 会提示，但可继续

## 常用可选模型（--model 覆盖）
- `mimo-v2.5-free`（默认，免费）
- `mimo-v2-omni`（还支持 audio/pdf）
- `qwen3.7-plus` / `qwen3.6-plus` / `qwen3.5-plus`（阿里系多模态）
- `kimi-k2.5` / `kimi-k2.6` / `kimi-k3`（Kimi 多模态）
- 更换 API 可用 `--api <URL>`（OpenAI 兼容端点）

## 示例
```
node "...\vision.mjs" image.png --prompt "这个界面是什么软件？指出所有按钮和报错信息"     # 自动定位粘贴图，opencode 记录识别后删除
node "...\vision.mjs" image.png --keep-db                                                # 保留 opencode 数据库记录
node "...\vision.mjs" image.png --source opencode                                         # 只从 opencode 找
node "...\vision.mjs" C:\Users\me\Pictures\截图1.png --prompt "描述这张图"               # 读取磁盘文件
node "...\vision.mjs" a.png b.png --prompt "对比这两张图的差异"
```