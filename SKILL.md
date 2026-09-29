---
name: vision
description: 让无视觉能力的模型（如 deepseek-v4-flash）也能看图：把用户提供的图片发给视觉模型 API（默认 mimo-v2.5，OpenCode Zen go 线路），返回文字描述。用户发送图片/截图或询问图像内容时使用。
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
node "<本 SKILL.md 所在目录>/vision.mjs" <图片路径或文件名> [更多...] [--prompt "具体问题"] [--model mimo-v2.5]
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
- **自动降级阶梯**（成本优先，首选失败自动降级）：
  1. `mimo-v2.5` @ `https://opencode.ai/zen/go/v1`（首选，最便宜）
  2. `deepseek-v4-flash-vision-exp` @ `https://opencode.ai/zen/go/v1`（备胎，不同供应商）

  任一步返回非 200 或网络错误会自动尝试下一步，直到成功或耗尽。`--model`/`--api` 指定后作为阶梯起点（其后默认项自动补全）；环境变量 `VISION_LADDER="model@api,model@api,..."` 可完全自定义阶梯。

  > **线路复核（2026-09-29）**：Zen **免费层**（`zen/v1` 的 `*-free` 模型，含 `mimo-v2.6-flash-free`）现已限制为"只能在 OpenCode 客户端内部调用"，外部脚本一律 `403 FreeTierError`，故默认改走 go 线路。go 线路要求请求带自定义 `User-Agent` + 稳定 `x-opencode-session` 头（脚本已内置），否则 `400 MissingSessionID`。

- API Key 来源（自动，按优先级）：
  1. 环境变量 `VISION_API_KEY`
  2. 环境变量 `OPENCODE_API_KEY`
  3. 回退读取 opencode 登录态的 `auth.json`（`~/.local/share/opencode/auth.json` 中的 opencode-go key）

默认走 go 线路，需要一把有效的 **OpenCode Go 订阅 key**（登录 opencode 后即存于 `auth.json` 的 `opencode-go` 字段）。免费层已不支持外部脚本调用。

## 安全规则（不可违反）
- 只把**用户明确给出的图片**发往视觉 API，绝不扫描、上传无关文件
- 脚本零依赖，只做"取图片 base64 + 一个 HTTP POST + 打印结果"
- 查库默认只读；仅识别成功后按上面的清理策略删除（opencode 记录），`--keep-db` 可保留
- 不打印、不写盘、不展示 API Key
- 图片超过 8MB 会提示，但可继续

## 常用可选模型（--model 覆盖，均走 go 线路）
- `mimo-v2.5`（默认，最便宜）
- `deepseek-v4-flash-vision-exp`（备胎，专为视觉、非推理）
- `mimo-v2.6-flash` / `mimo-v2-omni`（omni 还支持 audio/pdf）
- `qwen3.8-flash` / `qwen3.7-plus` / `qwen3.6-plus`（阿里系多模态）
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