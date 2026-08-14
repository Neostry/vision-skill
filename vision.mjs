#!/usr/bin/env node
/**
 * vision.mjs —— 让无视觉模型（如 deepseek-v4-flash）获得识图能力
 *
 * 设计原则（安全）：
 *   1. 零依赖：只用 Node 内置 API（node:fs / node:path / node:os / node:sqlite / 全局 fetch）
 *   2. 只做一件事：取用户指定图片 -> POST 到视觉模型 API -> 打印文字描述
 *   3. 不执行任何下载的代码、不读取无关文件、不打印 API Key
 *   4. API Key 从环境变量或本地 auth.json 读取，绝不硬编码
 *
 * 多工作台图片定位（适配器架构，可插拔）：
 *   主模型（deepseek-v4-flash）收不到用户粘贴的图片，但各 AI 工作台都会把
 *   粘贴图片以 base64 data URL 形式存到本地。本脚本按"磁盘文件 -> opencode ->
 *   codex -> reasonix"的顺序自动探测（可 --source 指定），直接把已存好的
 *   base64 data URL 发给视觉 API，不落盘、不恢复成文件。
 *
 *   各工作台存储位置与格式：
 *     - opencode:  ~/.local/share/opencode/opencode.db 的 part 表
 *                  （type:"file", mime:"image/*"，图片 = data URL，可按文件名精确匹配）
 *     - codex:     ~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl
 *                  （标准 OpenAI 消息，图片 = input_image/image_url data URL）
 *     - reasonix:  %AppData%\reasonix（Win）/ ~/.config/reasonix（Linux,macOS）/ ~/.reasonix（旧版）
 *                  下的会话 jsonl（data:image data URL）
 *     - WSL 兼容：自动扫描 /mnt/c/Users/<用户> 下对应目录
 *
 * 清理策略：
 *     - opencode 记录识别成功后默认自动删除（减少数据库占用，但会丢失该条会话回放
 *       中的图片），--keep-db 可保留
 *     - codex / reasonix 为 jsonl 行式记录，删除会破坏会话回放，故只读不删
 *
 * 自动降级阶梯（免费优先，限流/失败依次降级，最后 go 套餐兜底）：
 *     默认阶梯（2026-08-14 实测复核：免费线路真正支持识图的免费模型只有
 *     mimo-v2.5-free 一个。hy3-free 虽返回 200 但会静默忽略图片（回复"没有看到
 *     图片附件"），nemotron 系列 / laguna 系列 / deepseek-*-free 直接 400
 *     "No endpoints support image input"，均不可用于识图）：
 *       [1] mimo-v2.5-free @ https://opencode.ai/zen/v1      （免费）
 *       [2] mimo-v2.5      @ https://opencode.ai/zen/go/v1   （go 套餐兜底）
 *     - 任一步非 200 或网络错误，自动尝试下一步，直到成功或耗尽
 *     - --model / --api 指定后作为阶梯起点（其后的默认阶梯项自动补全去重）
 *     - 环境变量 VISION_LADDER="model@api,model@api,..." 可完全自定义阶梯
 *
 * 用法：
 *   node vision.mjs <图片路径 或 文件名...> [--prompt "问题"] [--model mimo-v2.5-free]
 *                  [--api URL] [--source disk,opencode,codex,reasonix] [--keep-db]
 */
import { readFileSync, existsSync, readdirSync, statSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

process.removeAllListeners('warning'); // 抑制 node:sqlite 实验特性警告（本脚本无其他需展示的警告）

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
const TAIL_BYTES = 8 * 1024 * 1024; // 大 jsonl 只读尾部，足够覆盖最近粘贴的图片
const MAX_CANDIDATE_FILES = 30;     // 每次最多探测的文件数

// 自动降级阶梯：免费优先，失败依次降级，最后 go 套餐兜底
// （2026-08-14 复核：hy3-free 等其余免费模型均不可识图，已从阶梯移除）
const DEFAULT_LADDER = [
  { model: 'mimo-v2.5-free', api: 'https://opencode.ai/zen/v1' },
  { model: 'mimo-v2.5',      api: 'https://opencode.ai/zen/go/v1' },
];

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 从文本中提取最后一个 data:image base64 data URL（兼容 JSON 转义），没有则返回 null */
function extractLastDataUrl(text) {
  const re = /data:image\/(?:[a-z0-9+.]+);base64,[^"\\\s]{20,}/gi;
  let m = null, last = null;
  while ((m = re.exec(text))) last = m[0];
  if (!last) return null;
  return last.replace(/\\u003d/g, '=').replace(/\\\//g, '/');
}

/** 递归收集 dir 下符合 match 的文件，按 mtime 降序，最多 limit 个 */
function findRecentFiles(rootDirs, match, limit = MAX_CANDIDATE_FILES) {
  const out = [];
  const seen = new Set();
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        walk(full);
      } else if (match(full) && st.isFile()) {
        if (seen.has(full)) continue;
        seen.add(full);
        out.push({ file: full, mtime: st.mtimeMs, size: st.size });
      }
    }
  };
  for (const d of rootDirs) walk(d);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}

/** 读文件末尾 maxBytes 字节为字符串（大文件友好） */
function readTail(file, maxBytes = TAIL_BYTES) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** WSL 下探测 /mnt/c/Users/<用户> 的相对目录，返回存在的候选绝对路径 */
function wslUserDirs(rel) {
  const candidates = [];
  try {
    for (const user of readdirSync('/mnt/c/Users')) {
      const p = join('/mnt/c/Users', user, rel);
      if (existsSync(p)) candidates.push(p);
    }
  } catch { /* 非 WSL 环境 */ }
  return candidates;
}

// ---------------------------------------------------------------------------
// 图片来源适配器
// ---------------------------------------------------------------------------

/** opencode：SQLite part 表，图片=完整 data URL，支持按文件名匹配，支持删除 */
const opencodeAdapter = {
  name: 'opencode',
  find(filename) {
    const dbPath = process.env.OPENCODE_DB_PATH || resolve(homedir(), '.local', 'share', 'opencode', 'opencode.db');
    if (!existsSync(dbPath)) return null;
    let db = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db.prepare(
        `SELECT id, data, time_created FROM part
         WHERE data LIKE '%"type":"file"%' AND data LIKE '%"mime":"image/%'
         ORDER BY time_created DESC LIMIT 50`
      ).all();

      if (filename) {
        for (const row of rows) {
          try {
            const d = JSON.parse(row.data);
            if (d.type === 'file' && d.mime && d.filename === filename) {
              return { url: d.url, partId: row.id, filename: d.filename || filename };
            }
          } catch { /* 跳过 */ }
        }
      }
      if (rows.length > 0) {
        const d = JSON.parse(rows[0].data);
        return { url: d.url, partId: rows[0].id, filename: d.filename || null };
      }
    } catch { /* 不可用 */ }
    finally { if (db) try { db.close(); } catch { /* 忽略 */ } }
    return null;
  },
  deleteImage(partId) {
    if (!partId) return false;
    const dbPath = process.env.OPENCODE_DB_PATH || resolve(homedir(), '.local', 'share', 'opencode', 'opencode.db');
    let db = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: false });
      db.prepare('DELETE FROM part WHERE id = ?').run(partId);
      return true;
    } catch { return false; }
    finally { if (db) try { db.close(); } catch { /* 忽略 */ } }
  },
};

/** codex：rollout jsonl（标准 OpenAI 消息），图片= input_image/image_url data URL，只读 */
const codexAdapter = {
  name: 'codex',
  find() {
    const roots = process.env.CODEX_SESSIONS_DIR
      ? [process.env.CODEX_SESSIONS_DIR]
      : [resolve(homedir(), '.codex', 'sessions'), ...wslUserDirs('.codex/sessions')];
    const files = findRecentFiles(roots, (f) => basename(f).startsWith('rollout-') && extname(f) === '.jsonl');
    for (const { file } of files) {
      const url = extractLastDataUrl(readTail(file));
      if (url) return { url, partId: null, filename: basename(file) };
    }
    return null;
  },
  deleteImage: null, // 行式 jsonl，删除会破坏回放，只读
};

/** reasonix：会话 jsonl（data:image data URL），只读 */
const reasonixAdapter = {
  name: 'reasonix',
  find() {
    const rel = join('AppData', 'Roaming', 'reasonix');
    const roots = process.env.REASONIX_DATA_DIR
      ? [process.env.REASONIX_DATA_DIR]
      : [
          resolve(homedir(), '.config', 'reasonix'),
          resolve(homedir(), '.reasonix'),
          ...wslUserDirs(rel),
          ...wslUserDirs('.reasonix'),
        ];
    const files = findRecentFiles(roots, (f) => extname(f) === '.jsonl');
    for (const { file } of files) {
      const url = extractLastDataUrl(readTail(file));
      if (url) return { url, partId: null, filename: basename(file) };
    }
    return null;
  },
  deleteImage: null,
};

const ALL_ADAPTERS = [opencodeAdapter, codexAdapter, reasonixAdapter];
const ADAPTER_NAMES = ALL_ADAPTERS.map((a) => a.name);

// ---------------------------------------------------------------------------
// CLI 解析
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`用法: node vision.mjs <图片路径或文件名...> [选项]
  - 传入磁盘路径：直接读取该图片
  - 传入文件名（如 image.png）：按顺序到各工作台查找你最近粘贴的这张图片
选项:
  --prompt "问题"   要问视觉模型的问题（默认: 请详细描述这张图片的内容）
  --model 模型名    阶梯起点模型（默认: ${DEFAULT_MODEL}，降级阶梯自动补全）
  --api URL         阶梯起点的 API 地址（默认: ${DEFAULT_API}）
  --max-tokens N    最大输出 token（默认: 2048）
  --source 列表     图片来源: disk,opencode,codex,reasonix（默认自动全部探测）
  --keep-db         识别成功后保留 opencode 数据库里的图片记录（默认会自动删除）
  --help            显示帮助
自动降级阶梯（失败/429 依次尝试，最后 go 套餐兜底）:
  ${DEFAULT_LADDER.map((s) => `[${DEFAULT_LADDER.indexOf(s) + 1}] ${s.model} @ ${s.api}`).join('\n  ')}
  环境变量 VISION_LADDER="model@api,model@api,..." 可完全自定义
Key 来源（按优先级）: 环境变量 VISION_API_KEY > OPENCODE_API_KEY > opencode 的 auth.json`);
}

function parseArgs(argv) {
  const args = {
    files: [], prompt: '请详细描述这张图片的内容。', model: DEFAULT_MODEL,
    api: DEFAULT_API, maxTokens: 2048, sources: null, keepDb: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt') args.prompt = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--api') args.api = argv[++i];
    else if (a === '--max-tokens') args.maxTokens = Number(argv[++i]);
    else if (a === '--source') args.sources = argv[++i].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === '--keep-db') args.keepDb = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else args.files.push(a);
  }
  if (args.sources && args.sources.includes('auto')) args.sources = null;
  return args;
}

/**
 * 构建自动降级阶梯：
 *   - 环境变量 VISION_LADDER="model@api,..." 优先，完全自定义
 *   - 否则以 --model/--api 指定（或默认）为起点，其后补默认阶梯中未出现的项
 * @returns {Array<{model:string, api:string}>}
 */
function buildLadder(args) {
  const env = process.env.VISION_LADDER;
  if (env) {
    return env.split(',').map((s) => {
      const [model, api] = s.trim().split('@');
      return { model: (model || '').trim(), api: (api || DEFAULT_API).trim() };
    }).filter((s) => s.model);
  }
  const ladder = [];
  const push = (model, api) => {
    if (model && !ladder.some((s) => s.model === model && s.api === api)) {
      ladder.push({ model, api });
    }
  };
  // 起点：用户指定或默认
  push(args.model || DEFAULT_MODEL, args.api || DEFAULT_API);
  // 补默认阶梯
  for (const step of DEFAULT_LADDER) push(step.model, step.api);
  return ladder;
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

/** 解析输入为可发送的图片 URL 列表，返回 [{ url, source, partId, filename }] */
function resolveInputImages(args) {
  const adapters = args.sources
    ? ALL_ADAPTERS.filter((a) => args.sources.includes(a.name))
    : ALL_ADAPTERS;
  const wantDisk = args.sources ? args.sources.includes('disk') : true;

  const result = [];
  for (const f of args.files) {
    const abs = resolve(f);
    if (wantDisk && existsSync(abs)) {
      result.push({ url: toDataUrl(abs), source: 'disk', partId: null, filename: f });
      continue;
    }
    let hit = null;
    for (const adapter of adapters) {
      try {
        const found = adapter.find(f);
        if (found && found.url) {
          hit = { url: found.url, source: adapter.name, partId: found.partId, filename: found.filename || f };
          console.error(`[自动] "${f}" 不在磁盘上，已从 ${adapter.name} 找到你最近粘贴的图片 "${found.filename || '未知'}"（base64 直用，不落盘）`);
          break;
        }
      } catch { /* 单个适配器失败不阻塞 */ }
    }
    if (hit) {
      result.push(hit);
    } else {
      console.error(`[警告] 找不到图片 "${f}"：磁盘无此文件，opencode/codex/reasonix 里也没有最近的粘贴图片`);
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.files.length) {
    console.error('错误: 至少需要一张图片路径或文件名。运行 node vision.mjs --help 查看用法。');
    process.exit(1);
  }
  const key = loadApiKey();
  if (!key) {
    console.error('错误: 找不到 API Key。请设置环境变量 VISION_API_KEY 或 OPENCODE_API_KEY，或确认 opencode 已登录。');
    process.exit(1);
  }

  const images = resolveInputImages(args);
  if (!images.length) {
    console.error('错误: 没有可用的图片。');
    process.exit(1);
  }

  const parts = [{ type: 'text', text: args.prompt }];
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img.url } });
  }

  const ladder = buildLadder(args);
  let lastErr = null;
  let chosen = null;
  for (const step of ladder) {
    const body = {
      model: step.model,
      messages: [{ role: 'user', content: parts }],
      max_tokens: args.maxTokens,
    };
    let res;
    try {
      res = await fetch(step.api.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = { step, status: '网络错误', msg: e && e.message ? e.message : String(e) };
      console.error(`[降级] ${step.model}@${step.api} 网络错误（${lastErr.msg}），尝试下一个`);
      continue;
    }

    if (!res.ok) {
      const err = await res.text();
      lastErr = { step, status: res.status, msg: err.slice(0, 300) };
      console.error(`[降级] ${step.model}@${step.api} 失败（${res.status}），尝试下一个`);
      continue;
    }

    const data = await res.json();
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    const content = typeof msg.content === 'string' ? msg.content.trim() : '';
    if (content) {
      chosen = step;
      console.log(content);
    } else if (msg.reasoning_content) {
      chosen = step;
      console.log(String(msg.reasoning_content).trim());
      console.error('[提示] 模型只返回了 reasoning_content，未返回最终 content');
    } else {
      lastErr = { step, status: 200, msg: 'API 返回内容为空' };
      console.error(`[降级] ${step.model}@${step.api} 返回内容为空，尝试下一个`);
      continue;
    }
    break;
  }

  if (!chosen) {
    console.error(`错误: 阶梯内所有模型均失败。最后一次错误: ${lastErr ? `${lastErr.status}: ${lastErr.msg}` : '未知'}`);
    process.exit(1);
  }

  if (chosen !== ladder[0]) {
    console.error(`[模型] 本次由阶梯第 ${ladder.indexOf(chosen) + 1} 个模型 ${chosen.model}@${chosen.api} 完成识别`);
  }

  // 识别成功后清理：仅 opencode 支持删除；codex/reasonix 行式记录只读
  if (!args.keepDb) {
    for (const img of images) {
      if (img.source !== 'opencode') continue;
      const adapter = opencodeAdapter;
      if (adapter.deleteImage && adapter.deleteImage(img.partId)) {
        console.error(`[已清理] 已从 opencode 数据库删除图片记录 "${img.filename}"`);
      } else {
        console.error(`[警告] 删除 opencode 图片记录 "${img.filename}" 失败，已保留`);
      }
    }
  }
}

// 可直接运行，也可被 import 复用内部函数（集成测试）
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((e) => {
    console.error(`错误: ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
}

export { opencodeAdapter, codexAdapter, reasonixAdapter, extractLastDataUrl, findRecentFiles, resolveInputImages, toDataUrl, loadApiKey };
