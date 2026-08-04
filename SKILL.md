---
name: vision
description: 让无视觉能力的模型（如 deepseek-v4-flash）也能看图：把用户提供的图片发给视觉模型 API（默认 mimo-v2.5），返回文字描述。用户发送图片/截图或询问图像内容时使用。
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
node "<本 SKILL.md 所在目录>/vision.mjs" <图片路径> [更多图片路径...] [--prompt "具体问题"] [--model mimo-v2.5]
```

把脚本返回的文字描述当作"看到的画面"，整合进你的回答。

## 默认配置
- 模型：`mimo-v2.5`（支持 text/image/audio/video，1M context）
- API：`https://opencode.ai/zen/go/v1`（opencode-go 网关，OpenAI 兼容格式）
- API Key 来源（自动，按优先级）：
  1. 环境变量 `VISION_API_KEY`
  2. 环境变量 `OPENCODE_API_KEY`
  3. 回退读取 opencode 登录态的 `auth.json`（`~/.local/share/opencode/auth.json` 中的 opencode-go key）

## 安全规则（不可违反）
- 只把**用户明确给出的图片**发往视觉 API，绝不扫描、上传无关文件
- 脚本零依赖、只做"读文件 + 一个 HTTP POST"，不做任何其他操作
- 不打印、不写盘、不展示 API Key
- 图片超过 8MB 会提示，但可继续

## 常用可选模型（--model 覆盖）
- `mimo-v2.5`（默认，最便宜）
- `mimo-v2-omni`（还支持 audio/pdf）
- `qwen3.7-plus` / `qwen3.6-plus` / `qwen3.5-plus`（阿里系多模态）
- `kimi-k2.5` / `kimi-k2.6` / `kimi-k3`（Kimi 多模态）
- 更换 API 可用 `--api <URL>`（OpenAI 兼容端点）

## 示例
```
node "...\vision.mjs" C:\Users\me\Pictures\截图1.png --prompt "这个界面是什么软件？指出所有按钮和报错信息"
node "...\vision.mjs" a.png b.png --prompt "对比这两张图的差异"
```
