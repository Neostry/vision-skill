#!/usr/bin/env node
/**
 * vision.mjs —— 让无视觉模型（如 deepseek-v4-flash）获得识图能力
 *
 * 设计原则（安全）：
 *   1. 零依赖：只用 Node 内置 API（node:fs / node:path / node:os / 全局 fetch）
 *   2. 只做一件事：读取用户指定图片 -> base64 -> POST 到视觉模型 API -> 打印文字描述
 *   3. 不执行任何下载的代码、不写任何文件、不读取无关文件、不打印 API Key
 *   4. API Key 从环境变量或本地 auth.json 读取，绝不硬编码
 *
 * 用法：
 *   node vision.mjs <图片路径...> [--prompt "问题"] [--model mimo-v2.5-free] [--api https://opencode.ai/zen/v1]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

const DEFAULT_MODEL = process.env.VISION_MODEL || 'mimo-v2.5-free';
const DEFAULT_API = process.env.VISION_API_BASE || 'https://opencode.ai/zen/v1';
const MAX_MB = 8; // 超过则提示（可继续，但提醒）

function printHelp() {
  console.log(`用法: node vision.mjs <图片路径...> [选项]
选项:
  --prompt "问题"   要问视觉模型的问题（默认: 请详细描述这张图片的内容）
  --model 模型名    视觉模型（默认: ${DEFAULT_MODEL}）
  --api URL         OpenAI 兼容 API 地址（默认: ${DEFAULT_API}）
  --max-tokens N    最大输出 token（默认: 2048）
  --help            显示帮助
Key 来源（按优先级）: 环境变量 VISION_API_KEY > OPENCODE_API_KEY > opencode 的 auth.json`);
}

function parseArgs(argv) {
  const args = { files: [], prompt: '请详细描述这张图片的内容。', model: DEFAULT_MODEL, api: DEFAULT_API, maxTokens: 2048 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt') args.prompt = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--api') args.api = argv[++i];
    else if (a === '--max-tokens') args.maxTokens = Number(argv[++i]);
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else args.files.push(a);
  }
  return args;
}

function loadApiKey() {
  if (process.env.VISION_API_KEY) return process.env.VISION_API_KEY.trim();
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY.trim();
  try {
    const p = process.env.OPENCODE_AUTH_PATH || resolve(homedir(), '.local', 'share', 'opencode', 'auth.json');
    const auth = JSON.parse(readFileSync(p, 'utf8'));
    const k = (auth['opencode-go'] || {}).key || (auth.opencode_go || {}).key;
    if (k) return k.trim();
  } catch { /* 找不到就返回 null */ }
  return null;
}

function toDataUrl(file) {
  const abs = resolve(file);
  const buf = readFileSync(abs); // 只读用户明确指定的文件
  const ext = abs.split('.').pop().toLowerCase();
  const mime = MIME[ext] || 'image/png';
  if (buf.length > MAX_MB * 1024 * 1024) {
    console.error(`[提示] ${abs} 超过 ${MAX_MB}MB（${(buf.length / 1024 / 1024).toFixed(1)}MB），继续发送但可能较慢`);
  }
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.files.length) {
    console.error('错误: 至少需要一张图片路径。运行 node vision.mjs --help 查看用法。');
    process.exit(1);
  }
  const key = loadApiKey();
  if (!key) {
    console.error('错误: 找不到 API Key。请设置环境变量 VISION_API_KEY 或 OPENCODE_API_KEY，或确认 opencode 已登录。');
    process.exit(1);
  }

  const parts = [{ type: 'text', text: args.prompt }];
  for (const f of args.files) {
    parts.push({ type: 'image_url', image_url: { url: toDataUrl(f) } });
  }

  const body = {
    model: args.model,
    messages: [{ role: 'user', content: parts }],
    max_tokens: args.maxTokens,
  };

  const res = await fetch(args.api.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`API 错误 ${res.status}: ${err.slice(0, 1000)}`);
    process.exit(1);
  }

  const data = await res.json();
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  const content = typeof msg.content === 'string' ? msg.content.trim() : '';
  if (content) {
    console.log(content);
  } else if (msg.reasoning_content) {
    // 部分推理模型只回 reasoning_content 时给出提示
    console.log(String(msg.reasoning_content).trim());
    console.error('[提示] 模型只返回了 reasoning_content，未返回最终 content');
  } else {
    console.error('错误: API 返回内容为空');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`错误: ${e && e.message ? e.message : e}`);
  process.exit(1);
});
