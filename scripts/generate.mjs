#!/usr/bin/env node
/**
 * 高管职业照生成脚本
 * 跨平台：使用 sharp 处理图片（macOS / Linux / Windows）
 *
 * 用法：
 *   node generate.mjs --image <路径> --style <风格ID> [选项]
 *
 * 选项：
 *   --image           人物照片路径（必填）
 *   --style           风格ID（必填，见 styles/ 目录）
 *   --notes           额外要求（可选，如「蓝底」「不戴眼镜」「头发扎起来」）
 *   --count           生成数量，默认1（最多5）
 *   --output-dir      输出目录，默认 ~/Desktop/职业照
 *   --api-key         API Key（也可从配置文件读取）
 *   --base-url        API Base URL
 *   --api-endpoint    完整端点 URL（优先于 base-url，仅 chat 格式）
 *   --model           模型名
 *   --api-format      API 格式：chat（默认，Chat Completions 带图）/ images（OpenAI Images API /v1/images/edits）
 *   --aspect-ratio    比例，默认 3:4（可选 1:1 / 4:5）
 *   --mirror          水平翻转成片（觉得「像又不像」时使用，多因生图模型镜像了人脸）
 *   --beautify        美颜档位 off|light|medium（默认 light，海马体精修级：小脸/淡妆/增发）
 *   --rotate          手动旋转角度：90 / 180 / 270
 *   --no-auto-orient  跳过 EXIF 自动旋转
 *   --retries         失败重试次数，默认 2
 *   --list-styles     列出所有可用风格
 *   --test            只测试 API 连通性，不生成图片
 *
 * 配置读取顺序：
 *   命令行参数 > ~/.config/exec-headshot/config.json
 *   > 环境变量 HEADSHOT_* > ~/.config/xhs-cover/config.json（复用已有配置）
 *
 * Exit codes:
 *   0  成功
 *   1  参数/配置错误
 *   2  API 认证失败（401/403）
 *   3  API 超时
 *   4  网络错误
 *   5  响应中无图片数据
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 检查 sharp ───────────────────────────────────────────────────────────────

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('❌ 缺少依赖 sharp，请在 Skill 目录运行：npm install');
  process.exit(1);
}

// ─── 解析命令行参数 ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

// ─── 读取配置（本 Skill 配置优先，xhs-cover 配置兜底）──────────────────────

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`⚠️ 配置文件损坏（${p}），已忽略: ${e.message}`);
    return null;
  }
}

const ownConfigPath = path.join(os.homedir(), '.config', 'exec-headshot', 'config.json');
const config = readJsonSafe(ownConfigPath) || {};
const fallbackConfig = readJsonSafe(path.join(os.homedir(), '.config', 'xhs-cover', 'config.json')) || {};

const API_KEY      = getArg('api-key')      || config.apiKey      || process.env.HEADSHOT_API_KEY      || fallbackConfig.apiKey      || process.env.GEMINI_API_KEY;
const BASE_URL     = getArg('base-url')     || config.baseUrl     || process.env.HEADSHOT_BASE_URL     || fallbackConfig.baseUrl     || null;
const API_ENDPOINT = getArg('api-endpoint') || config.apiEndpoint || process.env.HEADSHOT_API_ENDPOINT || fallbackConfig.apiEndpoint || null;
const MODEL        = getArg('model')        || config.model       || process.env.HEADSHOT_MODEL        || fallbackConfig.model       || null;
const API_FORMAT   = getArg('api-format')   || config.apiFormat   || process.env.HEADSHOT_API_FORMAT   || 'chat';
if (!['chat', 'images'].includes(API_FORMAT)) {
  console.error(`❌ 不支持的 API 格式: ${API_FORMAT}（可选 chat / images）`); process.exit(1);
}
const OUTPUT_DIR   = getArg('output-dir')   || config.outputDir   || path.join(os.homedir(), 'Desktop', '职业照');
const IMAGE_PATH   = getArg('image');
const STYLE_ID     = getArg('style');
const NOTES        = getArg('notes') || '';
const _countRaw = parseInt(getArg('count') || '1', 10);
if (isNaN(_countRaw) || _countRaw < 1) {
  console.error('❌ --count 必须是 1-5 的整数'); process.exit(1);
}
const COUNT        = Math.min(_countRaw, 5);
const RATIO        = getArg('aspect-ratio') || config.defaultAspectRatio || '3:4';
const MANUAL_ROTATE   = getArg('rotate');
const NO_AUTO_ORIENT  = hasFlag('no-auto-orient');
const _retriesRaw = parseInt(getArg('retries') || '2', 10);
if (isNaN(_retriesRaw) || _retriesRaw < 0) {
  console.error('❌ --retries 必须是非负整数'); process.exit(1);
}
const MAX_RETRIES     = _retriesRaw;
const VALID_RATIOS    = ['3:4', '4:5', '9:16', '1:1', '4:3', '16:9'];
if (!VALID_RATIOS.includes(RATIO)) {
  console.error(`❌ 不支持的比例: ${RATIO}，可选值: ${VALID_RATIOS.join(' / ')}（竖屏 3:4 4:5 9:16 / 方形 1:1 / 横屏 4:3 16:9）`); process.exit(1);
}
const TEST_MODE       = hasFlag('test');
const LIST_STYLES     = hasFlag('list-styles');
const NO_OPEN         = hasFlag('no-open');
const MIRROR          = hasFlag('mirror'); // 水平翻转成片（修复生图模型镜像人脸导致的「像又不像」）
const BEAUTIFY        = (getArg('beautify') || config.beautify || 'light').toLowerCase(); // off | light | medium，默认 light（海马体精修级轻美颜）
if (!['off', 'light', 'medium'].includes(BEAUTIFY)) {
  console.error(`❌ --beautify 只能是 off / light / medium，收到: ${BEAUTIFY}`); process.exit(1);
}

// ─── 动态加载风格 ────────────────────────────────────────────────────────────

const stylesDir = path.join(__dirname, '..', 'styles');
const STYLES = {};
try {
  for (const file of fs.readdirSync(stylesDir).filter(f => f.endsWith('.json'))) {
    const id = file.replace('.json', '');
    const style = JSON.parse(fs.readFileSync(path.join(stylesDir, file), 'utf-8'));
    if (!style.name || !style.prompt) {
      console.warn(`⚠️ 风格 ${id} 缺少 name 或 prompt 字段，已跳过`);
      continue;
    }
    STYLES[id] = style;
  }
} catch (e) {
  console.error(`❌ 无法加载风格文件（${stylesDir}）: ${e.message}`);
  process.exit(1);
}

if (LIST_STYLES) {
  console.log('可用风格：');
  for (const [id, s] of Object.entries(STYLES)) {
    console.log(`  ${id.padEnd(20)} ${s.name}  —  ${s.description || ''}`);
  }
  process.exit(0);
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  return map[ext] || 'image/jpeg';
}

async function normalizeImage(filePath, { noAutoOrient, manualDeg, tmpDir }) {
  const tmpPath = path.join(tmpDir, `_normalized_${Date.now()}.jpg`);
  let pipeline = sharp(filePath);

  if (manualDeg) {
    const deg = parseInt(manualDeg, 10);
    if (isNaN(deg) || ![90, 180, 270].includes(deg)) {
      process.stderr.write(`⚠️ 无效旋转角度: ${manualDeg}（只支持 90/180/270），改用自动旋转\n`);
      pipeline = pipeline.rotate();
    } else {
      pipeline = pipeline.rotate().rotate(deg);
    }
  } else if (!noAutoOrient) {
    pipeline = pipeline.rotate();
  }

  await pipeline
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(tmpPath);

  return tmpPath;
}

async function compressImage(filePath, tmpDir) {
  const tmpPath = path.join(tmpDir, `_compressed_${Date.now()}.jpg`);
  await sharp(filePath)
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toFile(tmpPath);
  return tmpPath;
}

// ─── HTTP 工具 ───────────────────────────────────────────────────────────────

function httpsPost(urlStr, headers, bodyObj, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode === 401 || res.statusCode === 403) {
          const err = new Error(`认证失败（HTTP ${res.statusCode}）：请检查 API Key 是否正确`);
          err.code = 'AUTH_ERROR';
          return reject(err);
        }
        if (res.statusCode >= 500) {
          const err = new Error(`服务端错误（HTTP ${res.statusCode}）：${text.slice(0, 200)}`);
          err.code = 'SERVER_ERROR';
          err.retryable = true;
          return reject(err);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode}: ${text.slice(0, 300)}`);
          err.code = 'HTTP_ERROR';
          return reject(err);
        }
        try { resolve(JSON.parse(text)); }
        catch { reject(Object.assign(new Error(`JSON 解析失败: ${text.slice(0, 200)}`), { code: 'PARSE_ERROR' })); }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(Object.assign(new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`), { code: 'TIMEOUT', retryable: true }));
    });
    req.on('error', (e) => {
      reject(Object.assign(e, { code: e.code || 'NETWORK_ERROR', retryable: true }));
    });
    req.write(body);
    req.end();
  });
}

// ─── API 调用（含重试）───────────────────────────────────────────────────────

/**
 * OpenAI Images API 格式（/v1/images/edits，multipart）
 * 适用于 Aigate 等只提供 Images API 的中转服务（如 gpt-image-2）
 */
async function generateImageViaImagesApi({ apiKey, baseUrl, model, imagePath, mimeType, prompt, aspectRatio, retries = MAX_RETRIES }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/images/edits`;
  const sizeMap = {
    '3:4': '768x1024', '4:5': '1024x1280', '9:16': '576x1024',
    '1:1': '1024x1024',
    '4:3': '1024x768', '16:9': '1024x576',
  };
  let omitSize = false; // 服务端拒绝该尺寸时降级为不传 size，由提示词控制比例

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 5000;
      process.stdout.write(` 重试 ${attempt}/${retries}（等待 ${delay / 1000}s）...`);
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('n', '1');
      if (!omitSize && sizeMap[aspectRatio]) form.append('size', sizeMap[aspectRatio]);
      const buf = fs.readFileSync(imagePath);
      form.append('image', new Blob([buf], { type: mimeType }), path.basename(imagePath));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 240_000);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          body: form,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 401 || res.status === 403) {
        const text = await res.text();
        throw Object.assign(new Error(`认证/额度错误（HTTP ${res.status}）：${text.slice(0, 200)}`), { code: 'AUTH_ERROR' });
      }
      if (!res.ok) {
        const text = await res.text();
        // 服务端不支持该尺寸 → 去掉 size 参数重试一次，比例改由提示词控制
        if (res.status === 400 && /size/i.test(text) && !omitSize) {
          omitSize = true;
          process.stdout.write(` ⚠️ 服务端不支持尺寸 ${sizeMap[aspectRatio]}，降级为提示词控制比例...`);
          continue;
        }
        const err = Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`), { code: 'HTTP_ERROR' });
        if (res.status >= 500) { err.retryable = true; }
        throw err;
      }

      const result = await res.json();
      const item = result?.data?.[0];
      if (item?.b64_json) return { data: item.b64_json, mimeType: 'image/png' };
      if (item?.url) {
        const imgRes = await fetch(item.url);
        if (!imgRes.ok) throw Object.assign(new Error(`下载生成图片失败（HTTP ${imgRes.status}）`), { code: 'HTTP_ERROR', retryable: true });
        const arrBuf = Buffer.from(await imgRes.arrayBuffer());
        return { data: arrBuf.toString('base64'), mimeType: imgRes.headers.get('content-type') || 'image/png' };
      }

      lastError = Object.assign(
        new Error(`响应中未找到图片数据。预览: ${JSON.stringify(result).slice(0, 300)}`),
        { code: 'NO_IMAGE', retryable: false }
      );
      break;
    } catch (e) {
      if (e.name === 'AbortError') {
        lastError = Object.assign(new Error('请求超时（>240s）'), { code: 'TIMEOUT', retryable: true });
      } else if (e.name === 'TypeError' || /fetch failed/i.test(e.message || '')) {
        // Node fetch 的网络层错误（DNS/TLS/连接重置）→ 可重试
        lastError = Object.assign(new Error(`网络错误: ${e.cause?.message || e.message}`), { code: 'NETWORK_ERROR', retryable: true });
      } else {
        lastError = e;
      }
      if (!lastError.retryable) break;
    }
  }
  throw lastError;
}

async function generateImage({ apiKey, baseUrl, apiEndpoint, model, imageBase64, mimeType, prompt, aspectRatio, retries = MAX_RETRIES }) {
  const url = apiEndpoint || `${baseUrl}/v1/chat/completions`;
  const headers = { 'Authorization': `Bearer ${apiKey}` };
  const ratioMap = {
    '3:4': '竖版3:4比例（宽:高），标准证件照/职业照比例',
    '4:5': '竖版4:5比例',
    '9:16': '竖版9:16全屏比例',
    '1:1': '正方形1:1比例，适合社交媒体头像',
    '4:3': '横版4:3比例',
    '16:9': '横版16:9宽屏比例，人物居中、两侧留出背景空间',
  };
  const ratioHint = ratioMap[aspectRatio] || ratioMap['3:4'];
  const fullPrompt = `${prompt}\n\n【输出规格】生成${ratioHint}的图片，人像照片级写实，不是插画。`;

  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: fullPrompt },
      ],
    }],
    response_modalities: ['image', 'text'],
  };

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 5000;
      process.stdout.write(` 重试 ${attempt}/${retries}（等待 ${delay / 1000}s）...`);
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      const result = await httpsPost(url, headers, body);

      // Format 1: markdown image in content string
      const content = result?.choices?.[0]?.message?.content || '';
      if (typeof content === 'string') {
        const match = content.match(/!\[.*?\]\(data:([^;]+);base64,([A-Za-z0-9+/=\s]+)\)/s);
        if (match) return { data: match[2].replace(/\s/g, ''), mimeType: match[1] };
      }
      // Format 2: images array
      const images = result?.choices?.[0]?.message?.images;
      if (Array.isArray(images) && images.length > 0) {
        const imgUrl = images[0]?.image_url?.url;
        if (imgUrl) {
          const m = imgUrl.match(/^data:([^;]+);base64,(.+)$/s);
          if (m) return { data: m[2].replace(/\s/g, ''), mimeType: m[1] };
        }
      }
      // Format 3: Gemini native
      if (result?.candidates?.[0]?.content?.parts) {
        for (const part of result.candidates[0].content.parts) {
          if (part?.inlineData?.data) return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
        }
      }

      lastError = Object.assign(
        new Error(`响应中未找到图片数据。预览: ${JSON.stringify(result).slice(0, 300)}`),
        { code: 'NO_IMAGE', retryable: false }
      );
      break;
    } catch (e) {
      lastError = e;
      if (!e.retryable) break;
    }
  }
  throw lastError;
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

async function main() {
  if (TEST_MODE) {
    if (!API_KEY) { console.error('❌ 未提供 API Key'); process.exit(1); }
    if (!BASE_URL && !API_ENDPOINT) { console.error('❌ 未配置 API 地址'); process.exit(1); }
    if (!MODEL) { console.error('❌ 未配置模型名称'); process.exit(1); }
    console.log(`🔍 测试 API 连通性...`);
    console.log(`   格式: ${API_FORMAT}`);
    console.log(`   Model: ${MODEL}`);
    console.log(`   Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`);
    if (API_FORMAT === 'images') {
      // Images API 没有便宜的探活端点，只验证域名可达（401/404 也说明服务在线）
      const url = `${BASE_URL.replace(/\/+$/, '')}/v1/images/edits`;
      console.log(`   URL: ${url}`);
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${API_KEY}` } });
        console.log(`✅ 服务可达（HTTP ${res.status}，实际生成能力以首次出图为准）`);
      } catch (e) {
        console.error(`❌ 连接失败: ${e.message}`);
        process.exit(4);
      }
      return;
    }
    const url = API_ENDPOINT || `${BASE_URL}/v1/chat/completions`;
    console.log(`   URL: ${url}`);
    try {
      await httpsPost(url,
        { 'Authorization': `Bearer ${API_KEY}` },
        { model: MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 },
        20_000
      );
      console.log(`✅ API 连通正常`);
    } catch (e) {
      console.error(`❌ 连接失败: ${e.message}`);
      process.exit(e.code === 'AUTH_ERROR' ? 2 : e.code === 'TIMEOUT' ? 3 : 4);
    }
    return;
  }

  // 参数校验
  if (!API_KEY) {
    console.error('❌ 未提供 API Key，请通过以下任一方式配置：');
    console.error('   1. 运行 Skill Onboarding（对话中输入「生成职业照」）');
    console.error('   2. 环境变量 HEADSHOT_API_KEY=<key>');
    console.error('   3. 命令行参数 --api-key <key>');
    process.exit(1);
  }
  if (!BASE_URL && !API_ENDPOINT) {
    console.error('❌ 未配置 API 地址（--base-url 或 --api-endpoint，或环境变量 HEADSHOT_BASE_URL）');
    process.exit(1);
  }
  if (API_FORMAT === 'images' && !BASE_URL) {
    console.error('❌ images 格式需要 --base-url（不支持 --api-endpoint）');
    process.exit(1);
  }
  if (!MODEL) {
    console.error('❌ 未配置模型名称（--model 或环境变量 HEADSHOT_MODEL）');
    process.exit(1);
  }
  if (!IMAGE_PATH) { console.error('❌ 未提供图片路径（--image）'); process.exit(1); }
  if (!STYLE_ID)   {
    console.error('❌ 未提供风格ID（--style）\n可用风格：\n' + Object.entries(STYLES).map(([id, s]) => `  ${id} - ${s.name}`).join('\n'));
    process.exit(1);
  }

  const style = STYLES[STYLE_ID];
  if (!style) {
    console.error(`❌ 未知风格: ${STYLE_ID}\n可用风格：\n` + Object.keys(STYLES).map(id => `  ${id} - ${STYLES[id].name}`).join('\n'));
    process.exit(1);
  }

  // 读取图片
  const resolvedImage = expandHome(IMAGE_PATH);
  if (!fs.existsSync(resolvedImage)) {
    console.error(`❌ 图片文件不存在: ${resolvedImage}`);
    process.exit(1);
  }
  const ext = path.extname(resolvedImage).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    console.error(`❌ 不支持的图片格式: ${ext}（支持 JPG / PNG / WebP）`);
    process.exit(1);
  }

  // 处理图片方向 + 压缩
  const tmpDir = os.tmpdir();
  let imagePath = resolvedImage;
  let tmpFiles = [];

  process.stdout.write(`🔄 处理图片（EXIF旋转+压缩）...`);
  try {
    const normalized = await normalizeImage(resolvedImage, {
      noAutoOrient: NO_AUTO_ORIENT,
      manualDeg: MANUAL_ROTATE,
      tmpDir,
    });
    tmpFiles.push(normalized);
    imagePath = normalized;
    process.stdout.write(` ✓\n`);
  } catch (e) {
    process.stdout.write(`\n⚠️  图片处理失败（${e.message}），使用原图\n`);
  }

  const imageSizeBytes = fs.statSync(imagePath).size;
  if (imageSizeBytes > 4 * 1024 * 1024) {
    process.stdout.write(`⚠️  图片较大（${(imageSizeBytes / 1024 / 1024).toFixed(1)}MB），进一步压缩...`);
    try {
      const compressed = await compressImage(imagePath, tmpDir);
      tmpFiles.push(compressed);
      imagePath = compressed;
      process.stdout.write(` ${(fs.statSync(imagePath).size / 1024 / 1024).toFixed(1)}MB ✓\n`);
    } catch (e) {
      process.stdout.write(`\n⚠️  压缩失败，继续使用当前图片\n`);
    }
  }

  const imageBase64 = fs.readFileSync(imagePath, 'base64');
  const mimeType = detectMimeType(imagePath);

  // 构建 prompt：风格提示词 + 全局规则 + 用户额外要求
  // 全局规则针对 AI 职业照三大通病：不像本人、磨皮过重、发丝五官细节失真
  const GLOBAL_RULES = `\n\n【人物身份核对 —— 全局最高优先级，凌驾于风格要求之上】\n- 先观察输入照片：这个人的脸是长是圆、下颌线和下巴的形状、面部的长宽比例——生成时必须原样保持，禁止把长脸画圆、把脸缩短、把下巴磨圆\n- 以输入照片为唯一基准，1:1 复刻这个人的身份特征：脸型轮廓、五官形状与间距、单双眼皮、卧蚕、鼻型、唇形、下颌线、肤色、发际线、发色，全部与输入照片一致\n- 输入照片中的标志性细节必须保留：痣、雀斑、酒窝、卧蚕、牙齿形态、眼镜（如有）等，一个都不要"修掉"\n- 结构层只允许「轻微」美化（见下方美颜档位），禁止「大幅」改动：不大幅瘦脸、不把脸削成尖锥、不缩短脸型、不夸张放大眼睛、不垫高鼻梁、不改变唇形和五官间距——骨相和辨识度必须保持是同一个人\n- 年龄感与原照片严格一致：职业装和正式光线容易让人「显老十岁」，必须避免——不增加皱纹和成熟感、不老化气质；同时也不刻意减龄。看起来就是本人现在的年龄\n- 质感层允许「专业摄影师级精修」：调整肤色均匀白皙、提亮气色、淡化黑眼圈/痘印/油光、柔肤磨皮让皮肤细腻光滑、牙齿轻微提白、整理杂发。目标是「状态最好的本人」——熟人看了说"这张拍得真好"，而不是"这是谁"\n- 磨皮天花板：皮肤细腻光滑即可，但仍要是「真实人的皮肤」，不要纯塑料瓷面、不要失去全部立体感和光影\n- 头发必须有真实细节：发丝根根分明、边缘有自然碎发和飞絮，禁止头盔状的整块头发\n- 完成后自检一次：这张脸放在输入照片旁边，是否会被认成同一个人？不是则重做\n\nIDENTITY LOCK (critical, overrides style): this is the SAME REAL PERSON as in the input photo. Facial STRUCTURE must stay identical: same face shape and length-to-width ratio, same jawline and chin, same eye size and shape (no enlargement), nose, lips and hairline. Light professional retouching IS allowed — even out skin tone, brighten complexion, remove temporary blemishes, skin smoothing for a refined polished finish (still real skin, not plastic) — like a high-end photographer's retouch: the person at their best, NOT a different person. A close friend must instantly recognize them.\n\n【姿态与眼神矫正 —— 输入照片角度刁钻时必须执行】\n- 眼神是证件照的硬性要求：双眼瞳孔正对镜头中心、与观看者对视，眼神聚焦有神。无论输入照片眼睛看向哪里（斜视、看别处、低头垂眼），成片必须矫正为直视镜头\n- 面部朝向：完全正面，或最多向镜头右侧微偏 10–15 度的近正脸；输入是侧脸/大角度时必须转正到这个范围。禁止成片保留侧脸、四分之三侧脸或回头角度\n- 无论输入照片中人物是低头、抬头、侧脸、说话中张嘴、闭眼还是大笑，都必须矫正为标准职业照姿态：头部端正、双肩放平、双眼自然睁开\n- 表情统一调整为该风格要求的表情（默认自然微笑）；说话中的张嘴、瞬间抓拍的夸张表情不得带入成片\n- 手、手势、手臂动作不入镜（除非风格明确要求）\n- 如果输入照片是镜像画面（如自拍视频帧，背景文字反向），按真实方向还原人物\n- 关键：矫正的是姿态和眼神，不是长相——转正角度后的五官、脸型、发型仍必须严格符合输入照片中这个人的身份特征\n\n【构图与头身比例 —— 重点修正：输入多为大头照，必须缩小头部重新构图】\n- 重要：用户上传的几乎都是正脸大头自拍/特写，头部占满画面。生成时必须「重新构图、把镜头明显拉远」，缩小头部在画面里的占比，腾出空间展示肩膀和上半身胸口——绝不能直接沿用原图的大头近距构图\n- 目标是标准证件/职业胸像：头部（含头发）高度只占画面高度的约 25%–32%（宁可更小，不要更大），头顶留出明显呼吸空间，画面下边缘截到上胸/胸口而不是脖子或下巴，人物左右两侧也留出背景空间\n- 头身比例符合真实人体解剖：肩宽明显大于头宽（约 2 倍以上），脖子和肩膀自然衔接，绝不能头大身小、头顶满框、肩膀被裁掉\n- 镜头感像 85mm 中距离拍摄，纠正掉手机前置/贴脸自拍那种「近距大头广角透视」，让五官比例回归正常人像透视\n\n【画面规则】\n- 真实摄影照片质感，不是插画或 3D 渲染\n- 画面中只有这一个人，不出现其他人\n- 移除原照片中的临时物品：头戴麦克风、话筒、工牌、耳机、手机等，不带入新照片\n- 不添加任何文字、水印、logo、边框、装饰图形`;
  // ─── 美颜档位（海马体精修级，可控强度）───
  const BEAUTIFY_BLOCKS = {
    off: '',
    light: `\n\n【轻美颜 —— 海马体精修师标准，自然不假】\n在严格保持本人辨识度（仍一眼认得是同一个人）的前提下，做专业证件照精修师的标准轻美颜：\n- 小脸：下颌线和脸颊轮廓「轻微」收窄柔化，显脸小一点点，但保持原脸型走向、左右对称、透视正确（绝不削成尖锥脸、不缩短脸、不大小脸）\n- 淡妆：自然裸妆感——眉形顺、睫毛根根分明、一点点自然腮红提气色、唇色饱满均匀（裸粉或豆沙色）、卧蚕自然、眼神有光无红血丝；妆感清透不浓艳\n- 增发：发量「增多」一点——颅顶微微增高更蓬松、消除明显发缝空隙、统一发色、收拾杂乱碎发（但不遮挡眉眼），发丝仍保留真实质感不结块\n- 皮肤：调整肤色均匀白皙、提亮气色去暗沉、淡化黑眼圈和瑕疵；做自然柔肤磨皮让皮肤细腻光滑（去掉粗糙颗粒和明显毛孔，但保留一点点真实皮肤质感，不要塑料假面）；牙齿轻微提白\n- 总原则：呈现「本人状态最好+刚做完头发化好淡妆+专业精修」的样子。轻微即可，绝不过度，绝不变成另一个人。`,
    medium: `\n\n【精致美颜 —— 精修写真级，明显变美但仍是本人】\n在保持本人核心辨识度（熟人仍认得出）的前提下，做更精致的写真级美颜：\n- 小脸：下颌和脸颊适度收窄、轮廓更流畅立体，明显显脸小，但保持原脸型基本走向和左右对称、透视正确（不削尖锥、不缩短脸）\n- 精致妆容：完整裸妆——立体眉、分明睫毛、自然眼线、提气色腮红、饱满均匀唇色、卧蚕高光、明亮有神的眼睛；妆感精致但不浓艳\n- 增发：颅顶增高更蓬松饱满、发缝填补、发色统一有光泽、碎发收拾干净（不遮眉眼）、发丝柔顺有真实质感\n- 皮肤：肤色匀净白皙通透、提亮去暗沉、淡化黑眼圈瑕疵；磨皮细腻光滑有高级感、去掉粗糙毛孔（仍是真实人皮肤质感不是塑料假面）；牙齿美白\n- 五官：眼睛可「极轻微」提亮放大、鼻梁可「极轻微」提亮显立体——幅度极小，绝不改变五官比例和辨识度\n- 总原则：像专业写真馆精修成片，明显比生活照好看，但放在本人旁边一眼认得出是同一个人。`,
  };
  const beautifyBlock = BEAUTIFY_BLOCKS[BEAUTIFY] || '';
  const fullPrompt = `${style.prompt}${GLOBAL_RULES}${beautifyBlock}${NOTES ? '\n\n【用户额外要求 —— 优先满足】\n' + NOTES : ''}`;

  const resolvedOutputDir = expandHome(OUTPUT_DIR);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  console.log(`\n📸 风格：${style.name} (${STYLE_ID})`);
  if (NOTES) console.log(`📝 额外要求：${NOTES}`);
  console.log(`📐 比例：${RATIO}  |  数量：${COUNT} 张  |  美颜：${BEAUTIFY}  |  重试上限：${MAX_RETRIES}`);
  console.log(`🔑 API：${API_ENDPOINT || BASE_URL} / ${MODEL}（${API_FORMAT} 格式）`);
  console.log('');

  let successCount = 0;

  try {
    for (let i = 1; i <= COUNT; i++) {
      const label = COUNT > 1 ? ` (${i}/${COUNT})` : '';
      process.stdout.write(`⏳ 生成中${label}...`);
      const startTime = Date.now();
      const timer = setInterval(() => process.stdout.write('.'), 3000);

      try {
        const result = API_FORMAT === 'images'
          ? await generateImageViaImagesApi({
              apiKey: API_KEY,
              baseUrl: BASE_URL,
              model: MODEL,
              imagePath,
              mimeType,
              prompt: fullPrompt,
              aspectRatio: RATIO,
            })
          : await generateImage({
              apiKey: API_KEY,
              baseUrl: BASE_URL,
              apiEndpoint: API_ENDPOINT,
              model: MODEL,
              imageBase64,
              mimeType,
              prompt: fullPrompt,
              aspectRatio: RATIO,
            });

        clearInterval(timer);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const outExt = result.mimeType.includes('png') ? 'png' : 'jpg';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `${style.name}_${timestamp}_${i}.${outExt}`;
        const outputPath = path.join(resolvedOutputDir, fileName);

        let outBuffer = Buffer.from(result.data, 'base64');
        if (MIRROR) {
          try { outBuffer = await sharp(outBuffer).flop().toBuffer(); }
          catch (e) { process.stdout.write(`⚠️ 翻转失败（${e.message}），保存原图 `); }
        }
        fs.writeFileSync(outputPath, outBuffer);
        process.stdout.write(`\r✅ 已生成${label}（${elapsed}s）: ${outputPath}\n`);
        successCount++;

        if (COUNT === 1 && !NO_OPEN) {
          try {
            const opener = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
            if (opener) execFileSync(opener, [outputPath], { stdio: 'ignore' });
          } catch {}
        }
      } catch (err) {
        clearInterval(timer);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        process.stdout.write(`\r❌ 生成失败${label}（${elapsed}s）: ${err.message}\n`);
      }
    }
  } finally {
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }
  }

  console.log(`\n完成：${successCount}/${COUNT} 张成功，保存在 ${resolvedOutputDir}`);
  if (successCount === 0) process.exit(5);
}

main().catch(err => {
  console.error('❌ 未知错误:', err.message);
  process.exit(1);
});
