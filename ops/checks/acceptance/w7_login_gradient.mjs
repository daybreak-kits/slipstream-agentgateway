#!/usr/bin/env node
/**
 * W7 ticket 13 验收：登录页渐变「可见但克制」（spec User Stories 1–3、
 * Implementation Decisions「交互与界面-登录」、Conflict Review C8）。
 *
 * 覆盖：
 *   1. 渐变存在且肉眼可见：浅色 / 深色 / 跟随系统三态下，背景实际像素各采样点之间
 *      的 RGB 差异必须超过可见阈值——证明「有渐变而且看得见」，而不是同名不可见的
 *      类名（口径：截图取样 + 计算样式，不看类名是否存在）。
 *   2. 层次一致且克制：三态下渐变层数与每层几何一致；采样色至少三簇可分辨（多层）；
 *      任意两采样点的差异不得越过克制上限（无突兀色块）；单点不得高饱和。
 *   3. 不压过表单：正文文字（text-title）压在渐变上的对比度 ≥ 4.5:1，次级文字
 *      （text-faint）≥ 3:1，提交按钮文字与按钮底色 ≥ 4.5:1（WCAG AA 口径）。
 *   4. 布局零位移：开/关渐变时登录框、输入、按钮、主题切换、错误槽、提示槽逐像素
 *      一致；375/768/1440 三档无横向溢出。
 *   5. W6 t12 固定槽契约未破坏：错误区 40px、提示区 20px、登录框三档宽度
 *      384/460/576、密码显隐、三态主题切换器。
 *
 * 运行：
 *   node ops/checks/acceptance/w7_login_gradient.mjs               # 自起隔离站点：API 3902 + web 3903
 *   node ops/checks/acceptance/w7_login_gradient.mjs --base-url http://127.0.0.1:3903  # 复用已起站点
 *   node ops/checks/acceptance/w7_login_gradient.mjs --headed
 *
 * 前提：web/dist 已构建（cd web && npx vite build）。脚本自管 seed/服务进程，结束后全部清理；
 * 使用临时 SQLite 与临时 ag-config，绝不触碰 3700/3600 与主仓库工作树。
 *
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/依赖未就绪。
 * 证据：ops/checks/.logs/acceptance/w7-login-<时间戳>/（report.md + *.png，.logs/ 不入库）。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { launchBrowser, loadPlaywright, parseFlags, stamp } from "../lib/cli.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const WEB_ROOT = path.join(ROOT, "web");
const API_ROOT = path.join(ROOT, "api");

const flags = parseFlags(process.argv.slice(2));
const API_PORT = Number(flags.get("api-port") || process.env.W7_LOGIN_API_PORT || 3902);
const WEB_PORT = Number(flags.get("web-port") || process.env.W7_LOGIN_WEB_PORT || 3903);
const HEADED = flags.has("headed");
const CHANNEL = flags.get("channel") || process.env.PLAYWRIGHT_CHANNEL || "";
const REUSE = Boolean(flags.get("base-url"));
const BASE_URL = (flags.get("base-url") || "").replace(/\/$/, "");
const OUT = path.resolve(flags.get("out") || path.join(ROOT, "ops", "checks", ".logs", "acceptance", "w7-login-" + stamp()));
fs.mkdirSync(OUT, { recursive: true });

/* 验收口径常量（0–255 RGB 标度 / WCAG 对比度）。 */
const VISIBLE_MIN = 14; // 肉眼可见下限：采样点之间的最大通道差低于此值视为「看不出渐变」（≈5.5% 标度）
const RESTRAIN_MAX = 48; // 克制上限：超过此值视为出现突兀色块（不再是低饱和柔光）
const CHROMA_MAX = 70; // 单点最大通道差（色度）上限：低饱和
const CONTRAST_BODY_MIN = 4.5; // 正文压在渐变上的对比度（WCAG AA）
const CONTRAST_MUTED_MIN = 3.0; // 次级文字压在渐变上的对比度下限
const CONTRAST_BUTTON_MIN = 4.5; // 提交按钮文字与按钮底色
const MIN_COLOR_CLUSTERS = 3; // 至少三簇可分辨颜色（多层柔光的可见层次）
const CLUSTER_MIN_DIFF = 4; // 计入「可分辨簇」的最小两两差异
const THEME_SPREAD_RATIO_MIN = 0.5; // 浅色底的渐变强度不得只剩深色底的一半（否则等于看不见）

/* 零位移量测点：登录框 + 表单 + 固定槽 + 主题切换（W6 t12 的像素契约）。 */
const GEOMETRY_SLOTS = [
  ["login-root", '[data-slot="login-root"]'],
  ["login-card", '[data-slot="login-card"]'],
  ["login-username", "#login-username"],
  ["login-password", "#login-password"],
  ["login-password-toggle", '[data-slot="login-password-toggle"]'],
  ["login-submit", 'button[type="submit"]'],
  ["login-error", '[data-slot="login-error"]'],
  ["login-hint", '[data-slot="login-hint"]'],
  ["login-theme", '[data-slot="login-theme"]'],
];

/* 响应式三档（票内要求）+ 登录框三档宽度（W6 user story 32）。 */
const RESPONSIVE_WIDTHS = [
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];
const CARD_WIDTH_TIERS = [
  { width: 640, height: 900, expect: 384 },
  { width: 768, height: 1024, expect: 460 },
  { width: 1536, height: 864, expect: 576 },
];

const results = [];
/** 三态之间的强度对照（浅色底不得把渐变洗没）。 */
const themeSpread = { light: 0, dark: 0, system: 0 };
let currentEvidence = [];
let browser = null;
let apiProc = null;
let webServer = null;
let serverLog = "";

class CheckError extends Error {}

function assert(condition, message) {
  if (!condition) throw new CheckError(message);
}

function rel(target) {
  return path.relative(ROOT, target).replace(/\\/g, "/");
}

async function test(id, name, fn) {
  currentEvidence = [];
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, status: "pass", detail: detail || "", evidence: currentEvidence.slice(), ms: Date.now() - started });
    console.log("PASS " + id + " (" + (Date.now() - started) + "ms)" + (detail ? " — " + detail : ""));
    return true;
  } catch (error) {
    const message = String((error && error.message) || error);
    results.push({ id, name, status: "fail", detail: message, evidence: currentEvidence.slice(), ms: Date.now() - started });
    console.log("FAIL " + id + " — " + message);
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 1. 隔离站点：API 3902 + web 3903（静态托管 + /admin、/api 反代）
 * ------------------------------------------------------------------ */

function pythonExecutable() {
  const candidates = [
    process.env.W6_PYTHON || "",
    process.platform === "win32" ? path.join(API_ROOT, ".venv", "Scripts", "python.exe") : path.join(API_ROOT, ".venv", "bin", "python"),
    "python",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "python" || fs.existsSync(candidate)) || "python";
}

function tailServerLog(lines = 14) {
  if (!serverLog || !fs.existsSync(serverLog)) return "";
  return fs.readFileSync(serverLog, "utf8").split(/\r?\n/).slice(-lines).join("\n");
}

async function waitForHealth(base, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/admin/health", { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
      lastError = "HTTP " + response.status;
    } catch (error) {
      lastError = String((error && error.message) || error);
    }
    await sleep(400);
  }
  throw new CheckError("隔离站点未在 " + timeoutMs + "ms 内就绪：" + lastError + "\n" + tailServerLog());
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** web 站点：静态托管 web/dist，并把 /admin、/api 反代到隔离 API（保持 cookie 同源）。 */
function startWebServer(port, apiPort) {
  const dist = path.join(WEB_ROOT, "dist");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1:" + port);
    if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api")) {
      const headers = { ...req.headers, host: "127.0.0.1:" + apiPort };
      const proxyReq = http.request(
        { hostname: "127.0.0.1", port: apiPort, path: req.url, method: req.method, headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on("error", () => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "isolated api unreachable" } }));
      });
      req.pipe(proxyReq);
      return;
    }
    let filePath = path.join(dist, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(dist)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(dist, "index.html");
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function startIsolatedSite() {
  if (API_PORT === 3700 || API_PORT === 3600 || WEB_PORT === 3700 || WEB_PORT === 3600) {
    throw new CheckError("拒绝在 3700/3600 上运行（必须使用隔离端口 3902/3903）");
  }
  const distIndex = path.join(WEB_ROOT, "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    throw new CheckError("web/dist 不存在：先 cd web && npx vite build");
  }
  const serverDir = path.join(OUT, "server");
  fs.mkdirSync(path.join(serverDir, "ag-config"), { recursive: true });
  serverLog = path.join(serverDir, "server.log");
  const databaseFile = path.join(serverDir, "w7-login.db").replace(/\\/g, "/");
  const env = {
    ...process.env,
    PYTHONPATH: path.join(API_ROOT, "src"),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    SLIPSTREAM_DATABASE_URL: "sqlite:///" + databaseFile,
    SLIPSTREAM_AG_CONFIG_DIR: path.join(serverDir, "ag-config"),
    SLIPSTREAM_AG_DB_PATH: path.join(serverDir, "ag-config", "ag-data.db"),
    SLIPSTREAM_WEB_DIST_DIR: path.join(WEB_ROOT, "dist"),
    SLIPSTREAM_JOBS_ENABLED: "0",
    SLIPSTREAM_ADMIN_USERNAME: "admin",
    SLIPSTREAM_ADMIN_PASSWORD: "admin12345",
    SLIPSTREAM_SECRET_KEY: "w7-login-acceptance-only",
    SLIPSTREAM_COOKIE_SECURE: "0",
    SLIPSTREAM_AG_BINARY: "",
    SLIPSTREAM_AG_LLM_PORT: "0",
  };

  const seed = spawnSync(pythonExecutable(), ["scripts/seed_demo.py"], {
    cwd: API_ROOT,
    env,
    encoding: "utf8",
    timeout: 240000,
  });
  if (seed.status !== 0) {
    throw new CheckError("seed_demo.py 失败：" + String(seed.stderr || seed.stdout || "").slice(-800));
  }

  const logFd = fs.openSync(serverLog, "a");
  apiProc = spawn(
    pythonExecutable(),
    ["-m", "uvicorn", "l06_api.app:create_app", "--factory", "--host", "127.0.0.1", "--port", String(API_PORT)],
    { cwd: API_ROOT, env, stdio: ["ignore", logFd, logFd], windowsHide: true },
  );
  apiProc.on("exit", (code) => {
    if (code !== null && code !== 0 && apiProc) console.error("隔离 API 提前退出，code=" + code + "\n" + tailServerLog());
  });
  await waitForHealth("http://127.0.0.1:" + API_PORT);
  webServer = await startWebServer(WEB_PORT, API_PORT);
  return "http://127.0.0.1:" + WEB_PORT;
}

function stopIsolatedSite() {
  if (webServer) {
    try {
      webServer.close();
    } catch {
      // 已关闭
    }
    webServer = null;
  }
  const pid = apiProc ? apiProc.pid : null;
  apiProc = null;
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // 已退出
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ *
 * 2. 量测助手：像素取样 / 计算样式 / 对比度
 * ------------------------------------------------------------------ */

/**
 * 截图取样：把视口截图解码回页面画布，按区域取平均 RGB。
 * 区域均值可以抹掉 1px 网格线的噪声，得到「这一片底色实际长什么样」。
 */
async function sampleRegions(page, regions) {
  const buffer = await page.screenshot({ type: "png" });
  const dataUrl = "data:image/png;base64," + buffer.toString("base64");
  return await page.evaluate(
    async ({ dataUrl, regions }) => {
      const blob = await (await fetch(dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const samples = [];
      for (const region of regions) {
        const x = Math.max(0, Math.min(Math.round(region.x), bitmap.width - 1));
        const y = Math.max(0, Math.min(Math.round(region.y), bitmap.height - 1));
        const w = Math.max(1, Math.min(Math.round(region.w), bitmap.width - x));
        const h = Math.max(1, Math.min(Math.round(region.h), bitmap.height - y));
        const data = ctx.getImageData(x, y, w, h).data;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        const count = data.length / 4;
        samples.push({ name: region.name, rgb: [Math.round(r / count), Math.round(g / count), Math.round(b / count)] });
      }
      return { width: bitmap.width, height: bitmap.height, samples };
    },
    { dataUrl, regions },
  );
}

/** 背景采样点：登录根容器外圈 16px 内的纯背景带（内容不进入该带）。 */
async function backgroundRegions(page) {
  return await page.evaluate(() => {
    const root = document.querySelector('[data-slot="login-root"]');
    const rect = root.getBoundingClientRect();
    const width = Math.min(window.innerWidth, rect.width);
    const height = Math.min(window.innerHeight, rect.height);
    const size = 10;
    const inset = 2;
    const points = [
      ["左上", inset, inset],
      ["右上", width - inset - size, inset],
      ["左下", inset, height - inset - size],
      ["右下", width - inset - size, height - inset - size],
      ["上中", width / 2 - size / 2, inset],
      ["下中", width / 2 - size / 2, height - inset - size],
      ["左中", inset, height / 2 - size / 2],
      ["右中", width - inset - size, height / 2 - size / 2],
    ];
    return points.map(([name, x, y]) => ({ name, x, y, w: size, h: size }));
  });
}

/** 两个 RGB 的最大通道差（0–255 标度上的「肉眼可辨差异」）。 */
function rgbDiff(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** 一个采样点的色度（最大通道差）。 */
function chroma(rgb) {
  return Math.max(...rgb) - Math.min(...rgb);
}

/** 相对亮度与对比度（WCAG 2.x 定义）。 */
function relativeLuminance(rgb) {
  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 计算样式里的渐变层（按顶层逗号切分，忽略括号内的逗号）。 */
function splitLayers(backgroundImage) {
  const layers = [];
  let depth = 0;
  let current = "";
  for (const char of backgroundImage) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      layers.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

/** 每层的「几何部分」：渐变函数里第一个顶层逗号之前的尺寸/位置，颜色一律剔除。 */
function layerShape(layer) {
  const open = layer.indexOf("(");
  if (open < 0) return layer;
  let depth = 0;
  let cut = -1;
  for (let i = open; i < layer.length; i += 1) {
    const char = layer[i];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        cut = i;
        break;
      }
    } else if (char === "," && depth === 1) {
      cut = i;
      break;
    }
  }
  const prefix = layer.slice(open + 1, cut < 0 ? layer.length : cut);
  const withoutColors = prefix.replace(
    /(?:color-mix|color|rgba?|oklab|oklch|lab|lch|hsla?|hwb)\((?:[^()]|\([^()]*\))*\)|var\([^()]*\)/g,
    "COLOR",
  );
  return layer.slice(0, open + 1) + withoutColors;
}

/** 读根容器的渐变计算样式（层数、几何、是否静态）。 */
async function readGradientStyle(page) {
  return await page.evaluate(() => {
    const root = document.querySelector('[data-slot="login-root"]');
    const style = getComputedStyle(root);
    return {
      backgroundImage: style.backgroundImage,
      backgroundColor: style.backgroundColor,
      animationName: style.animationName,
      transitionProperty: style.transitionProperty,
    };
  });
}

/** 隐藏页面内容后量测「文字底下的渐变实际颜色」。 */
async function sampleBehind(page, selector) {
  const locator = page.locator(selector).first();
  const box = await locator.boundingBox();
  assert(box, "找不到元素用于对比度量：" + selector);
  const handle = await page.addStyleTag({ content: '[data-slot="login-root"] * { visibility: hidden !important; }' });
  try {
    const region = [{ name: selector, x: box.x, y: box.y, w: Math.max(1, box.width), h: Math.max(1, box.height) }];
    const result = await sampleRegions(page, region);
    const color = await page.evaluate(() => {
      const node = document.querySelector('[data-slot="login-root"]');
      return getComputedStyle(node).backgroundColor;
    });
    return { rgb: result.samples[0].rgb, backgroundColor: color };
  } finally {
    await handle.evaluate((node) => node.remove()).catch(() => {});
  }
}

/** 元素的实际文字颜色（rgb 三元组）。 */
async function textColorOf(page, selector) {
  return await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const raw = getComputedStyle(node).color;
    const parts = (raw.match(/[\d.]+/g) ?? []).map(Number);
    return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : null;
  }, selector);
}

/** 提交按钮的文字色与底色（半透明底色先与祖先实底合成）。 */
async function buttonContrast(page) {
  return await page.evaluate(() => {
    const node = document.querySelector('button[type="submit"]');
    if (!node) return null;
    const parse = (raw) => {
      const parts = (raw.match(/[-\d.]+/g) ?? []).map(Number);
      if (parts.length >= 4) return { rgb: [parts[0], parts[1], parts[2]], a: parts[3] };
      if (parts.length === 3) return { rgb: [parts[0], parts[1], parts[2]], a: 1 };
      return null;
    };
    const style = getComputedStyle(node);
    const fg = parse(style.color);
    let bg = parse(style.backgroundColor);
    let ancestor = node.parentElement;
    while (ancestor && bg && bg.a < 1) {
      const ancestorBg = parse(getComputedStyle(ancestor).backgroundColor);
      if (ancestorBg && ancestorBg.a >= 1) {
        bg = {
          rgb: bg.rgb.map((value, i) => Math.round(value * bg.a + ancestorBg.rgb[i] * (1 - bg.a))),
          a: 1,
        };
        break;
      }
      ancestor = ancestor.parentElement;
    }
    return { fg: fg && fg.rgb, bg: bg && bg.rgb };
  });
}

/** 填入占位账号，让提交按钮进入可用态（对比度按用户真正看到的状态量）。 */
async function enableSubmit(page) {
  await page.fill("#login-username", "w7-gradient-probe");
  await page.fill("#login-password", "w7-gradient-probe");
  await page.waitForTimeout(150);
}

/** 元素矩形集合（零位移量测）。 */
async function geometryOf(page) {
  return await page.evaluate((slots) => {
    const out = {};
    for (const [name, selector] of slots) {
      const node = document.querySelector(selector);
      if (!node) {
        out[name] = null;
        continue;
      }
      const rect = node.getBoundingClientRect();
      out[name] = {
        x: Math.round(rect.x * 100) / 100,
        y: Math.round(rect.y * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
      };
    }
    return out;
  }, GEOMETRY_SLOTS);
}

function diffGeometry(before, after) {
  const parts = [];
  for (const key of Object.keys(before)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      parts.push(key + " " + JSON.stringify(before[key]) + " → " + JSON.stringify(after[key]));
    }
  }
  return parts.join("；");
}

/** 断言一组背景采样点满足「可见但克制」。 */
function assertVisibleButRestrained(samples, label) {
  assert(samples.length >= 6, label + "：有效背景采样点只有 " + samples.length + " 个（至少 6 个）");
  let maxDiff = 0;
  let pair = "";
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      const diff = rgbDiff(samples[i].rgb, samples[j].rgb);
      if (diff > maxDiff) {
        maxDiff = diff;
        pair = samples[i].name + "/" + samples[j].name;
      }
    }
  }
  assert(
    maxDiff >= VISIBLE_MIN,
    label + "：背景采样点之间最大 RGB 差 " + maxDiff + " < 可见下限 " + VISIBLE_MIN + "（" + pair + "）——渐变看不出/不存在：" +
      samples.map((s) => s.name + "=" + s.rgb.join(",")).join(" "),
  );
  assert(
    maxDiff <= RESTRAIN_MAX,
    label + "：背景采样点之间最大 RGB 差 " + maxDiff + " > 克制上限 " + RESTRAIN_MAX + "（" + pair + "）——出现突兀色块",
  );
  for (const sample of samples) {
    assert(
      chroma(sample.rgb) <= CHROMA_MAX,
      label + "：采样点 " + sample.name + " 色度 " + chroma(sample.rgb) + " > " + CHROMA_MAX + "（低饱和要求）",
    );
  }
  // 可分辨色簇：两两差异 ≥ CLUSTER_MIN_DIFF 的独立颜色至少 MIN_COLOR_CLUSTERS 簇（多层柔光）。
  const clusters = [];
  for (const sample of samples) {
    if (clusters.every((cluster) => rgbDiff(cluster, sample.rgb) >= CLUSTER_MIN_DIFF)) clusters.push(sample.rgb);
  }
  assert(
    clusters.length >= MIN_COLOR_CLUSTERS,
    label + "：可分辨色簇只有 " + clusters.length + " 簇 < " + MIN_COLOR_CLUSTERS + "（缺少多层层次）",
  );
  return { maxDiff, pair, clusters: clusters.length };
}

/* ------------------------------------------------------------------ *
 * 3. 页面准备：主题切换 + 视口切换
 * ------------------------------------------------------------------ */

async function openLoginPage(browser, base, { width = 1440, height = 900, colorScheme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, locale: "zh-CN" });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator('[data-slot="login-card"]').waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(300);
  return { context, page };
}

/** 切主题并等 .dark 类落定（点三态主题切换器上的按钮）。 */
async function switchTheme(page, name) {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForTimeout(300);
  return await page.evaluate(() => ({
    dark: document.documentElement.classList.contains("dark"),
    stored: localStorage.getItem("slipstream.theme"),
  }));
}

async function shot(page, name) {
  const file = path.join(OUT, name + ".png");
  try {
    await page.screenshot({ path: file });
    currentEvidence.push(rel(file));
    return rel(file);
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ *
 * 4. 验收项
 * ------------------------------------------------------------------ */

async function runChecks(base) {
  /* —— 浅色主题：渐变必须存在、看得见、层次分明 —— */
  const light = await openLoginPage(browser, base, { width: 1440, height: 900 });
  try {
    await test("gradient.style.light", "浅色主题：计算样式里有多层径向渐变（≥3 层 radial + 底层承托）", async () => {
      const style = await readGradientStyle(light.page);
      const layers = splitLayers(style.backgroundImage);
      const radial = layers.filter((layer) => layer.startsWith("radial-gradient")).length;
      assert(layers.length >= 4, "渐变层数 " + layers.length + " < 4（多层柔光要求）");
      assert(radial >= 3, "radial-gradient 层数 " + radial + " < 3（多层柔光径向渐变要求）");
      assert(
        style.animationName === "none",
        "渐变层必须静态：animation-name=" + style.animationName,
      );
      return "层数 " + layers.length + "（radial " + radial + "）· background-color=" + style.backgroundColor;
    });

    await test("gradient.visible.light", "浅色主题：背景实际像素有多样性——肉眼可见（≥" + VISIBLE_MIN + "）且克制（≤" + RESTRAIN_MAX + "）", async () => {
      const regions = await backgroundRegions(light.page);
      const result = await sampleRegions(light.page, regions);
      const summary = assertVisibleButRestrained(result.samples, "浅色主题");
      themeSpread.light = summary.maxDiff;
      await shot(light.page, "gradient-light");
      return (
        "最大 RGB 差 " + summary.maxDiff + "（" + summary.pair + "）· 可分辨色簇 " + summary.clusters +
        " · 采样 " + result.samples.map((s) => s.name + "=" + s.rgb.join("/")).join(" ")
      );
    });

    await test("gradient.static.light", "浅色主题：渐变是静态的——间隔采样像素不变", async () => {
      const regions = await backgroundRegions(light.page);
      const first = await sampleRegions(light.page, regions);
      await light.page.waitForTimeout(600);
      const second = await sampleRegions(light.page, regions);
      const diff = diffGeometry(
        Object.fromEntries(first.samples.map((s) => [s.name, s.rgb])),
        Object.fromEntries(second.samples.map((s) => [s.name, s.rgb])),
      );
      assert(diff === "", "渐变在 600ms 内发生变化（应为静态）：" + diff);
      return "600ms 间隔两次取样完全一致";
    });

    await test("gradient.contrast.light", "浅色主题：渐变不压过文字与按钮（正文 ≥4.5:1、次级 ≥3:1、按钮 ≥4.5:1）", async () => {
      const headline = 'p.text-3xl';
      const sub = 'p.text-sm.text-faint';
      const hint = '[data-slot="login-hint"]';
      await enableSubmit(light.page);
      const headlineColor = await textColorOf(light.page, headline);
      const subColor = await textColorOf(light.page, sub);
      const hintColor = await textColorOf(light.page, hint);
      assert(headlineColor && subColor && hintColor, "读不到登录页文字颜色");
      const behindHeadline = await sampleBehind(light.page, headline);
      const behindSub = await sampleBehind(light.page, sub);
      const behindHint = await sampleBehind(light.page, hint);
      const bodyRatio = contrastRatio(headlineColor, behindHeadline.rgb);
      const mutedRatio = contrastRatio(subColor, behindSub.rgb);
      const hintRatio = contrastRatio(hintColor, behindHint.rgb);
      const button = await buttonContrast(light.page);
      assert(button && button.fg && button.bg, "读不到提交按钮配色");
      const buttonRatio = contrastRatio(button.fg, button.bg);
      assert(
        bodyRatio >= CONTRAST_BODY_MIN,
        "标题文字对比度 " + bodyRatio.toFixed(2) + " < " + CONTRAST_BODY_MIN + "（底色 " + behindHeadline.rgb.join(",") + "）",
      );
      assert(
        mutedRatio >= CONTRAST_MUTED_MIN,
        "副标题文字对比度 " + mutedRatio.toFixed(2) + " < " + CONTRAST_MUTED_MIN + "（底色 " + behindSub.rgb.join(",") + "）",
      );
      assert(
        hintRatio >= CONTRAST_MUTED_MIN,
        "底部提示文字对比度 " + hintRatio.toFixed(2) + " < " + CONTRAST_MUTED_MIN + "（底色 " + behindHint.rgb.join(",") + "）",
      );
      assert(
        buttonRatio >= CONTRAST_BUTTON_MIN,
        "提交按钮文字对比度 " + buttonRatio.toFixed(2) + " < " + CONTRAST_BUTTON_MIN,
      );
      return (
        "标题 " + bodyRatio.toFixed(2) + ":1 · 副标题 " + mutedRatio.toFixed(2) + ":1 · 提示 " +
        hintRatio.toFixed(2) + ":1 · 按钮 " + buttonRatio.toFixed(2) + ":1"
      );
    });

    await test("gradient.no-displacement.light", "浅色主题：开/关渐变时布局元素坐标逐像素一致（渐变不推挤、不位移）", async () => {
      const before = await geometryOf(light.page);
      await light.page.evaluate(() => {
        document.querySelector('[data-slot="login-root"]').style.backgroundImage = "none";
      });
      await light.page.waitForTimeout(150);
      const after = await geometryOf(light.page);
      const diff = diffGeometry(before, after);
      assert(diff === "", "开/关渐变后布局位移：" + diff);
      await light.page.evaluate(() => {
        document.querySelector('[data-slot="login-root"]').style.removeProperty("background-image");
      });
      await light.page.waitForTimeout(150);
      return "登录框/输入/按钮/主题切换/错误槽/提示槽 " + GEOMETRY_SLOTS.length + " 个量测点全部一致";
    });
  } finally {
    await light.context.close().catch(() => {});
  }

  /* —— 深色主题：同样的层次与可见性 —— */
  const dark = await openLoginPage(browser, base, { width: 1440, height: 900 });
  try {
    await test("gradient.visible.dark", "深色主题：背景实际像素有多样性——肉眼可见且克制", async () => {
      const switched = await switchTheme(dark.page, "深色");
      assert(switched.dark, "点「深色」后 html 未切 .dark");
      const regions = await backgroundRegions(dark.page);
      const result = await sampleRegions(dark.page, regions);
      const summary = assertVisibleButRestrained(result.samples, "深色主题");
      themeSpread.dark = summary.maxDiff;
      await shot(dark.page, "gradient-dark");
      return (
        "最大 RGB 差 " + summary.maxDiff + "（" + summary.pair + "）· 可分辨色簇 " + summary.clusters +
        " · 采样 " + result.samples.map((s) => s.name + "=" + s.rgb.join("/")).join(" ")
      );
    });

    await test("gradient.contrast.dark", "深色主题：渐变不压过文字与按钮", async () => {
      const headline = 'p.text-3xl';
      const sub = 'p.text-sm.text-faint';
      const hint = '[data-slot="login-hint"]';
      await enableSubmit(dark.page);
      const headlineColor = await textColorOf(dark.page, headline);
      const subColor = await textColorOf(dark.page, sub);
      const hintColor = await textColorOf(dark.page, hint);
      const behindHeadline = await sampleBehind(dark.page, headline);
      const behindSub = await sampleBehind(dark.page, sub);
      const behindHint = await sampleBehind(dark.page, hint);
      const bodyRatio = contrastRatio(headlineColor, behindHeadline.rgb);
      const mutedRatio = contrastRatio(subColor, behindSub.rgb);
      const hintRatio = contrastRatio(hintColor, behindHint.rgb);
      const button = await buttonContrast(dark.page);
      assert(button && button.fg && button.bg, "读不到提交按钮配色");
      const buttonRatio = contrastRatio(button.fg, button.bg);
      assert(bodyRatio >= CONTRAST_BODY_MIN, "深色标题文字对比度 " + bodyRatio.toFixed(2) + " < " + CONTRAST_BODY_MIN);
      assert(mutedRatio >= CONTRAST_MUTED_MIN, "深色副标题文字对比度 " + mutedRatio.toFixed(2) + " < " + CONTRAST_MUTED_MIN);
      assert(hintRatio >= CONTRAST_MUTED_MIN, "深色提示文字对比度 " + hintRatio.toFixed(2) + " < " + CONTRAST_MUTED_MIN);
      assert(buttonRatio >= CONTRAST_BUTTON_MIN, "深色按钮文字对比度 " + buttonRatio.toFixed(2) + " < " + CONTRAST_BUTTON_MIN);
      return (
        "标题 " + bodyRatio.toFixed(2) + ":1 · 副标题 " + mutedRatio.toFixed(2) + ":1 · 提示 " +
        hintRatio.toFixed(2) + ":1 · 按钮 " + buttonRatio.toFixed(2) + ":1"
      );
    });
  } finally {
    await dark.context.close().catch(() => {});
  }

  /* —— 跟随系统（系统偏好深色）：层次与显式深色一致 —— */
  const system = await openLoginPage(browser, base, { width: 1440, height: 900, colorScheme: "dark" });
  try {
    await test("gradient.visible.system", "跟随系统（系统深色）：同样看得见、同样克制，层次与显式深色一致", async () => {
      const switched = await switchTheme(system.page, "跟随系统");
      assert(switched.stored === "system", "主题未持久化为 system：" + switched.stored);
      assert(switched.dark, "系统偏好深色时跟随系统未解析为深色");
      const regions = await backgroundRegions(system.page);
      const result = await sampleRegions(system.page, regions);
      const summary = assertVisibleButRestrained(result.samples, "跟随系统（深色）");
      themeSpread.system = summary.maxDiff;
      await shot(system.page, "gradient-system-dark");
      const style = await readGradientStyle(system.page);
      const layers = splitLayers(style.backgroundImage);
      const radial = layers.filter((layer) => layer.startsWith("radial-gradient")).length;
      assert(layers.length >= 4, "跟随系统主题下渐变层数 " + layers.length + " < 4");
      assert(radial >= 3, "跟随系统主题下 radial 层数 " + radial + " < 3");
      return "最大 RGB 差 " + summary.maxDiff + " · 可分辨色簇 " + summary.clusters + " · 层数 " + layers.length;
    });
  } finally {
    await system.context.close().catch(() => {});
  }

  /* —— 三态强度一致：浅色底不得把渐变洗没 —— */
  await test("gradient.theme.consistent", "浅色底的渐变强度不得只剩深色底的一半（三态层次一致）", async () => {
    assert(themeSpread.light > 0 && themeSpread.dark > 0, "缺少三态强度读数：" + JSON.stringify(themeSpread));
    const ratio = themeSpread.light / themeSpread.dark;
    assert(
      ratio >= THEME_SPREAD_RATIO_MIN,
      "浅色底强度只有深色底的 " + (ratio * 100).toFixed(0) + "%（< " + THEME_SPREAD_RATIO_MIN * 100 + "%）：浅色 ΔRGB " +
        themeSpread.light + " / 深色 ΔRGB " + themeSpread.dark + "——浅色主题等于看不见",
    );
    return "浅色 ΔRGB " + themeSpread.light + " · 深色 " + themeSpread.dark + " · 跟随系统 " + themeSpread.system +
      " · 浅/深 = " + (ratio * 100).toFixed(0) + "%";
  });

  /* —— 三态层次一致：层数与每层几何一致 —— */
  await test("gradient.layers.consistent", "三态下渐变层数与每层几何一致（层次一致、不出现突兀色块）", async () => {
    const shapes = {};
    for (const theme of ["浅色", "深色"]) {
      const session = await openLoginPage(browser, base, { width: 1440, height: 900 });
      try {
        if (theme === "深色") await switchTheme(session.page, "深色");
        const style = await readGradientStyle(session.page);
        shapes[theme] = splitLayers(style.backgroundImage).map(layerShape);
      } finally {
        await session.context.close().catch(() => {});
      }
    }
    assert(
      JSON.stringify(shapes["浅色"]) === JSON.stringify(shapes["深色"]),
      "浅色与深色的渐变几何不一致：浅色 " + JSON.stringify(shapes["浅色"]) + " 深色 " + JSON.stringify(shapes["深色"]),
    );
    return "浅/深各 " + shapes["浅色"].length + " 层，几何逐一相同";
  });

  /* —— 响应式：三档无横向溢出，渐变不造成滚动/位移 —— */
  await test("gradient.responsive", "375/768/1440 三档无横向溢出，渐变不造成滚动或元素位移", async () => {
    const session = await openLoginPage(browser, base, { width: 375, height: 667 });
    const details = [];
    try {
      for (const item of RESPONSIVE_WIDTHS) {
        await session.page.setViewportSize({ width: item.width, height: item.height });
        await session.page.waitForTimeout(350);
        const overflow = await session.page.evaluate(() => ({
          docScrollWidth: document.documentElement.scrollWidth,
          docClientWidth: document.documentElement.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        assert(
          overflow.docScrollWidth <= overflow.docClientWidth + 1,
          item.width + " 下出现横向溢出：scrollWidth " + overflow.docScrollWidth + " > clientWidth " + overflow.docClientWidth,
        );
        assert(
          overflow.bodyScrollWidth <= overflow.innerWidth + 1,
          item.width + " 下 body 横向溢出：" + overflow.bodyScrollWidth + " > " + overflow.innerWidth,
        );
        const before = await geometryOf(session.page);
        await session.page.evaluate(() => {
          document.querySelector('[data-slot="login-root"]').style.backgroundImage = "none";
        });
        await session.page.waitForTimeout(120);
        const after = await geometryOf(session.page);
        await session.page.evaluate(() => {
          document.querySelector('[data-slot="login-root"]').style.removeProperty("background-image");
        });
        const diff = diffGeometry(before, after);
        assert(diff === "", item.width + " 下开/关渐变后布局位移：" + diff);
        await shot(session.page, "gradient-responsive-" + item.width);
        details.push(item.width + " 无溢出");
      }
      return details.join("、");
    } finally {
      await session.context.close().catch(() => {});
    }
  });

  /* —— W6 t12 固定槽契约未破坏 —— */
  await test("gradient.w6-contract", "W6 t12 契约未破坏：错误区 40px、提示区 20px、登录框三档宽度 384/460/576", async () => {
    const session = await openLoginPage(browser, base, { width: 640, height: 900 });
    const details = [];
    try {
      const slots = await session.page.evaluate(() => {
        const area = document.querySelector('[data-slot="login-error"]');
        const hint = document.querySelector('[data-slot="login-hint"]');
        const toggle = document.querySelector('[data-slot="login-password-toggle"]');
        const password = document.querySelector("#login-password");
        const switcher = document.querySelector('[data-slot="login-theme"]');
        return {
          errorHeight: area ? getComputedStyle(area).height : "",
          hintHeight: hint ? getComputedStyle(hint).height : "",
          togglePressed: toggle ? toggle.getAttribute("aria-pressed") : "",
          passwordType: password ? password.getAttribute("type") : "",
          themeOptions: switcher ? switcher.querySelectorAll("button").length : 0,
        };
      });
      assert(Math.round(parseFloat(slots.errorHeight)) === 40, "错误区固定高度应为 40px，实际 " + slots.errorHeight);
      assert(Math.round(parseFloat(slots.hintHeight)) === 20, "提示区固定高度应为 20px，实际 " + slots.hintHeight);
      assert(slots.togglePressed === "false", "密码显隐按钮初始 aria-pressed 应为 false，实际 " + slots.togglePressed);
      assert(slots.passwordType === "password", "密码框默认应隐藏，实际 type=" + slots.passwordType);
      assert(slots.themeOptions === 3, "主题切换器应有 3 个选项，实际 " + slots.themeOptions);
      for (const tier of CARD_WIDTH_TIERS) {
        await session.page.setViewportSize({ width: tier.width, height: tier.height });
        await session.page.waitForTimeout(250);
        const width = await session.page.evaluate(() => {
          const card = document.querySelector('[data-slot="login-card"]');
          return card ? card.getBoundingClientRect().width : 0;
        });
        assert(
          Math.abs(width - tier.expect) <= 2,
          tier.width + " 下登录框宽度 " + Math.round(width) + "px ≠ " + tier.expect + "px（W6 三档契约）",
        );
        details.push(tier.width + "→" + Math.round(width));
      }
      return "错误区 40px · 提示区 20px · 密码显隐 · 三态切换 · 登录框 " + details.join("、");
    } finally {
      await session.context.close().catch(() => {});
    }
  });
}

/* ------------------------------------------------------------------ *
 * 5. 主流程
 * ------------------------------------------------------------------ */

async function main() {
  if (!REUSE && (API_PORT === 3700 || WEB_PORT === 3700)) {
    console.error("拒绝在 3700 上运行（隔离端口应为 3902/3903）");
    process.exitCode = 2;
    return;
  }
  const playwright = await loadPlaywright();
  if (!playwright) {
    console.error("未找到 playwright / playwright-core（先在 web 目录 npm install）");
    process.exitCode = 2;
    return;
  }

  let base = BASE_URL;
  if (!base) {
    try {
      base = await startIsolatedSite();
      console.log("隔离站点已起：" + base + "（API " + API_PORT + "）");
    } catch (error) {
      console.error(String((error && error.message) || error));
      process.exitCode = 2;
      return;
    }
  } else {
    console.log("复用已起站点：" + base);
  }

  const launched = await launchBrowser(playwright, { channel: CHANNEL, headed: HEADED });
  browser = launched.browser;

  try {
    await runChecks(base);
  } catch (error) {
    console.error(String((error && error.message) || error));
    results.push({ id: "run", name: "验收脚本执行", status: "fail", detail: String((error && error.message) || error), evidence: [] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopIsolatedSite();
  }

  const failed = results.filter((row) => row.status === "fail");
  const report = [
    "# W7 ticket 13 · 登录渐变「可见但克制」浏览器验收",
    "",
    "- 时间：" + new Date().toISOString(),
    "- 站点：" + base,
    "- 口径：可见下限 ΔRGB " + VISIBLE_MIN + " · 克制上限 " + RESTRAIN_MAX + " · 色度上限 " + CHROMA_MAX +
      " · 正文对比度 ≥ " + CONTRAST_BODY_MIN + ":1 · 次级 ≥ " + CONTRAST_MUTED_MIN + ":1",
    "- 结果：" + (results.length - failed.length) + "/" + results.length + " 通过",
    "",
    "| 用例 | 结果 | 说明 |",
    "| --- | --- | --- |",
    ...results.map((row) => "| " + row.id + " | " + row.status + " | " + String(row.detail).replace(/\|/g, "\\|") + " |"),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "report.md"), report, "utf8");

  console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
  if (failed.length > 0) {
    console.error("未通过：");
    for (const row of failed) console.error("- " + row.id + "：" + row.detail);
    process.exitCode = 1;
  }
}

await main();
