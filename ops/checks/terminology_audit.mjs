#!/usr/bin/env node
/**
 * Slipstream 术语审计（ticket 20 浏览器验收前置）
 *
 * 目的：UI 文案按三期词表（docs/GLOSSARY.md，2026-11-19 用户裁定）管控：正名
 * 上游渠道/公开模型/连接密钥/启用/关闭/代理用户/词元/模型试验；已废旧词不得出现；
 * 页面 title 与 logo 资产必须符合品牌规范。代码标识符（channel、public_models、
 * api_keys 等）不在管控范围。
 *
 * 判定口径：
 *   1. 只扫描 web/src 下的 .ts/.tsx/.css，判定对象是「UI 文案候选」：
 *      字符串/模板字面量（含 title=、aria-label=、toast.* 等 props 文案）与 JSX 文本节点。
 *   2. API 字段与代码标识符天然不在判定范围内：
 *      max_tokens / max_completion_tokens / prompt_tokens / totalTokens / METRIC_ICONS.tokens 等
 *      不在字符串或 JSX 文本里，不会被误报。输出里的「已跳过 API 字段」计数给出命中量，
 *      用来证明排除规则确实生效（而不是把源码里所有 token 都当违规）。
 *   3. 对象字面量的键（形如 "token amounts ...": "中文"）是后端文案的映射键，不是 UI 文案，跳过。
 *   4. 严重级按旧词存量分两档，避免新词表把既有文案一巴掌打死（有存量时精确调规则，
 *      不改业务代码）：
 *      error —— 已废且当前零存量的旧词：tokens/Tokens/收费/qax/qianxin/调用模型/调用名/
 *               调用串/计划窗口/游乐场/裸「渠道」（含「上游」前缀的「上游渠道」除外）。
 *               出现即失败。
 *      warn  —— 已废但 UI 文案仍有存量、待后续工单迁移的旧词：封禁（2 处）/对外模型/
 *               客户端密钥，以及单数 token。默认不失败，只提示人工判断；--strict 时
 *               升级为失败。存量清零后应把对应词提升为 error。
 *   5. 已知启发式：小写单词字符串（如 type: "tokens" 的枚举值）视为数据，不判违规；
 *      模板插值（美元符 + 花括号）视为代码并替换为空。改动判定前请先读 tokenIsUiCopy()。
 *
 * 用法：
 *   node ops/checks/terminology_audit.mjs              # 人类可读报告，0 通过 / 1 有 error / 2 用法错误
 *   node ops/checks/terminology_audit.mjs --strict     # warn 也当失败（发布前门禁用）
 *   node ops/checks/terminology_audit.mjs --json       # 机器可读（CI）
 *   node ops/checks/terminology_audit.mjs --root <repo>
 *
 * 证据位置：本脚本输出；需要归档时重定向到 ops/checks/.logs/terminology_audit.log（.logs/ 不入库）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i];
  if (!token.startsWith("--")) continue;
  const body = token.slice(2);
  const eq = body.indexOf("=");
  if (eq >= 0) flags.set(body.slice(0, eq), body.slice(eq + 1));
  else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags.set(body, argv[i + 1]);
  else flags.set(body, "true");
}

const asJson = flags.has("json");
const strict = flags.has("strict");
const rootDir = flags.has("root") ? path.resolve(String(flags.get("root"))) : DEFAULT_ROOT;
const webDir = path.join(rootDir, "web");
const srcDir = path.join(webDir, "src");
const publicDir = path.join(webDir, "public");
const indexHtmlPath = path.join(webDir, "index.html");

if (!fs.existsSync(srcDir)) {
  console.error("找不到 web/src，仓库根应为 " + rootDir);
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * 1. 文案候选抽取
 * ------------------------------------------------------------------ */

/** 去掉注释、抽出字符串/模板字面量。模板里的插值（美元符 + 花括号）替换成空格：插值属于代码，不是文案。 */
function scanStringLiterals(source) {
  const literals = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "\u0060") {
      const quote = ch;
      const start = i;
      i += 1;
      let text = "";
      while (i < source.length) {
        const c = source[i];
        if (c === "\\") {
          text += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        if (quote === "\u0060" && c === "$" && source[i + 1] === "{") {
          let depth = 1;
          i += 2;
          while (i < source.length && depth > 0) {
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") depth -= 1;
            i += 1;
          }
          text += " ";
          continue;
        }
        text += c;
        i += 1;
      }
      literals.push({ start, end: i, text, kind: quote === "\u0060" ? "template" : "string" });
      continue;
    }
    i += 1;
  }
  return literals;
}

/**
 * JSX 文本节点：>文案<。
 * 纯正则无法区分 JSX 文本与表达式里的比较运算，因此这里对候选做严格过滤：
 * 含代码标点/引号/分号/方括号，或出现 const/function/return 之类的片段一律丢弃；
 * 只保留「含中文」或「≤ 40 字符且不含代码字符」的短片段。
 */
function scanJsxText(source) {
  const out = [];
  const re = />([^<>{}]+)</g;
  let match;
  while ((match = re.exec(source))) {
    const text = match[1];
    if (!text.trim()) continue;
    if (text.length > 200) continue;
    if (/[=;"'\u0060[\]\\|]/.test(text)) continue;
    if (/=>|\/\/|\/\*|\b(const|function|return|let|var|import|export)\b/.test(text)) continue;
    const hasCjk = /[\u4e00-\u9fa5]/.test(text);
    const shortLatin = text.trim().length <= 40 && /^[A-Za-z0-9 .,:!?·()\-]+$/.test(text.trim());
    if (!hasCjk && !shortLatin) continue;
    out.push({ start: match.index + 1, end: match.index + 1 + text.length, text, kind: "jsx-text" });
  }
  return out;
}

function buildLineIndex(source) {
  const offsets = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === "\n") offsets.push(i + 1);
  return offsets;
}

function locate(offsets, offset) {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - offsets[lo] + 1 };
}

/* ------------------------------------------------------------------ *
 * 2. 规则
 * ------------------------------------------------------------------ */

/** tokens/Tokens 的文案判定：含中文、空白、中文标点，或恰好是 Token/Tokens → 文案。 */
function tokenIsUiCopy(text) {
  if (/[\u4e00-\u9fa5]/.test(text)) return true;
  if (/\s/.test(text.trim())) return true;
  if (/[，。、：；·（）()]/.test(text)) return true;
  if (/^(Token|Tokens)$/.test(text.trim())) return true;
  return false;
}

const RULES = [
  {
    id: "fee-term",
    severity: "error",
    pattern: /收费/g,
    allow: () => true,
    suggestion: "改用「花费」（用户实付）或「成本」（上游成本），按语义选择",
  },
  {
    id: "vendor-name",
    severity: "error",
    pattern: /\bqax\b|qianxin/gi,
    allow: () => true,
    suggestion: "旧厂商名不得出现在 UI；使用中性上游名",
  },
  {
    id: "token-plural",
    severity: "error",
    pattern: /(^|[^\w.-])[Tt]okens(?=$|[^\w-])/g,
    allow: (text) => tokenIsUiCopy(text),
    suggestion: "UI 文案统一用「词元」；tokens 只允许作为 API 字段/参数名（max_tokens 等）",
  },
  {
    id: "token-singular",
    severity: "warn",
    pattern: /(^|[^\w.-])[Tt]oken(?=$|[^\w-])/g,
    allow: (text) => tokenIsUiCopy(text),
    suggestion: "指 LLM 用量时统一用「词元」（首 token → 首字/首词元）；指查询条件时用「关键词/查询项」",
  },
  {
    // 裸「渠道」已禁（GLOSSARY 2026-11-19 裁定）：正名是「上游渠道」，简称「上游」。
    // 用 lookbehind 放行「上游渠道」，其余语境的「渠道」一律 error（当前代码零存量）。
    id: "bare-channel",
    severity: "error",
    pattern: /(?<!上游)渠道/g,
    allow: () => true,
    suggestion: "上游语境统一写「上游渠道」，简称「上游」；单独「渠道」已禁（docs/GLOSSARY.md）",
  },
  {
    // 已废且当前 UI 文案零存量的旧词（注释里的「调用串/定时封禁」不属于文案，扫描器会剥注释）。
    id: "retired-term",
    severity: "error",
    pattern: /调用模型|调用名|调用串|计划窗口|游乐场/g,
    allow: () => true,
    suggestion: "按三期词表改用正名：调用模型/对外模型→公开模型，计划窗口→周期冷却，游乐场→模型试验",
  },
  {
    // 已废但仍有存量（封禁 2 处、对外模型 ~15 处、客户端密钥 ~6 处），归后续文案迁移工单；--strict 时失败。
    id: "deprecated-term",
    severity: "warn",
    pattern: /封禁|对外模型|客户端密钥/g,
    allow: () => true,
    suggestion: "旧词待迁移：封禁→关闭/启用，对外模型→公开模型，客户端密钥→连接密钥；存量清零后本条应提升为 error",
  },
];

const SKIP_MODULE_SPECIFIER = /^(@\/|\.{1,2}\/|node:|https?:)/;
const SKIP_FILE_LIKE = /\.(tsx?|mjs|css|svg|png|jpe?g|json|woff2?)$/;
const SKIP_CLASS_LIKE = /^[a-z0-9:_\-/[\].%()\s!]+$/i;

/** 明显不是文案的字符串：模块路径、文件名、纯 class 串、超长常量、对象键。 */
function isCopyCandidate(candidate, source) {
  const text = candidate.text;
  if (!text.trim()) return false;
  if (text.length > 400) return false;
  // JS 的单/双引号字符串不允许裸换行：出现换行说明词法器被正则里的引号带偏了，丢弃该候选。
  if (candidate.kind === "string" && text.includes("\n")) return false;
  if (candidate.kind === "template" && /=>|\bconst\b|\bfunction\b/.test(text)) return false;
  if (SKIP_MODULE_SPECIFIER.test(text.trim())) return false;
  if (SKIP_FILE_LIKE.test(text.trim()) && !/[\u4e00-\u9fa5]/.test(text)) return false;
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(text)) return false;
  if (candidate.kind === "string" && SKIP_CLASS_LIKE.test(text) && !/[A-Z]/.test(text)) return false;
  // 对象键：字符串后面紧跟冒号（允许空白），是数据映射键而不是渲染文案。
  let j = candidate.end;
  while (j < source.length && (source[j] === " " || source[j] === "\t")) j += 1;
  if (source[j] === ":") return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * 3. 扫描 web/src
 * ------------------------------------------------------------------ */

const SOURCE_EXT = new Set([".ts", ".tsx", ".css"]);
const findings = [];
let scannedFiles = 0;
let candidates = 0;
let skippedApiFields = 0;

const API_FIELD_COUNTER = /(?:^|[^A-Za-z0-9])(?:max_tokens|max_completion_tokens|prompt_tokens|completion_tokens|total_tokens|input_tokens|output_tokens|reasoning_tokens|cached_tokens)(?![A-Za-z0-9])/g;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!SOURCE_EXT.has(path.extname(entry.name))) continue;
    scanFile(full);
  }
}

function scanFile(file) {
  const source = fs.readFileSync(file, "utf8");
  scannedFiles += 1;
  skippedApiFields += (source.match(API_FIELD_COUNTER) ?? []).length;

  const offsets = buildLineIndex(source);
  const found = [...scanStringLiterals(source), ...scanJsxText(source)];

  for (const candidate of found) {
    if (!isCopyCandidate(candidate, source)) continue;
    candidates += 1;
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(candidate.text))) {
        if (match[0].length === 0) {
          rule.pattern.lastIndex += 1;
          continue;
        }
        if (!rule.allow(candidate.text, match)) continue;
        const at = locate(offsets, candidate.start + match.index);
        findings.push({
          file: path.relative(rootDir, file).replace(/\\/g, "/"),
          line: at.line,
          column: at.column,
          rule: rule.id,
          severity: rule.severity,
          match: match[0].trim(),
          snippet: candidate.text.replace(/\s+/g, " ").trim().slice(0, 120),
          kind: candidate.kind,
          suggestion: rule.suggestion,
        });
      }
    }
  }
}

walk(srcDir);

const errors = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warn");

/* ------------------------------------------------------------------ *
 * 4. 页面 title 与 logo 资产
 * ------------------------------------------------------------------ */

const EXPECTED_TITLE = "驭流 Slipstream · LLM API 网关";
const checks = [];
function check(id, title, ok, detail) {
  checks.push({ id, title, ok: Boolean(ok), detail });
}

const indexHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, "utf8") : "";
const titleMatch = indexHtml.match(/<title>([\s\S]*?)<\/title>/i);
const actualTitle = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
check(
  "page-title",
  "web/index.html 页面标题为「" + EXPECTED_TITLE + "」",
  actualTitle === EXPECTED_TITLE,
  actualTitle ? "实际：" + actualTitle : "未找到 <title>",
);
check(
  "page-title-old",
  "页面标题不再回退为「Slipstream 管理台」",
  !/Slipstream\s*管理台/.test(indexHtml),
  "web/index.html 标题/文本中不得出现旧回退标题",
);

const faviconMatch = indexHtml.match(/<link[^>]+rel="icon"[^>]*>/i);
const faviconHref = faviconMatch ? (faviconMatch[0].match(/href="([^"]+)"/)?.[1] ?? "") : "";
check("favicon-link", "index.html 声明 favicon", faviconHref !== "", faviconHref || "未找到 favicon link");
if (faviconHref) {
  const faviconFile = path.join(publicDir, faviconHref.replace(/^\//, ""));
  check(
    "favicon-file",
    "favicon 指向 web/public 下真实文件：" + faviconHref,
    fs.existsSync(faviconFile),
    faviconFile,
  );
}

const REQUIRED_ASSETS = ["logo-v10-contrast.svg", "logo.svg", "favicon.svg"];
for (const asset of REQUIRED_ASSETS) {
  const file = path.join(publicDir, asset);
  const exists = fs.existsSync(file);
  const bytes = exists ? fs.statSync(file).size : 0;
  const head = exists ? fs.readFileSync(file, "utf8").slice(0, 200) : "";
  check(
    "asset:" + asset,
    "web/public/" + asset + " 存在且是 SVG（≥ 100 字节）",
    exists && bytes >= 100 && head.includes("<svg"),
    exists ? bytes + " 字节" : "文件不存在",
  );
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

const sidebarSrc = readIfExists(path.join(srcDir, "components", "layout", "sidebar.tsx"));
const loginSrc = readIfExists(path.join(srcDir, "pages", "login.tsx"));

check(
  "brand-lockup",
  "侧栏品牌锁同时出现「驭流」与「Slipstream」并使用 logo-v10-contrast.svg",
  sidebarSrc.includes("驭流") && sidebarSrc.includes("Slipstream") && sidebarSrc.includes("logo-v10-contrast.svg"),
  sidebarSrc ? "" : "components/layout/sidebar.tsx 不存在",
);
check(
  "brand-logo-size",
  "侧栏 logo 为 36×36（h-9 w-9）",
  /h-9\s+w-9/.test(sidebarSrc),
  "sidebar.tsx 中 logo 应使用 h-9 w-9（36px）",
);
check(
  "login-brand",
  "登录页同时出现「驭流」「Slipstream」与 logo",
  loginSrc.includes("驭流") && loginSrc.includes("Slipstream") && loginSrc.includes("logo-v10-contrast.svg"),
  loginSrc ? "" : "pages/login.tsx 不存在",
);

/* ------------------------------------------------------------------ *
 * 5. 输出
 * ------------------------------------------------------------------ */

const assetsFailed = checks.filter((c) => !c.ok);
const ok = errors.length === 0 && assetsFailed.length === 0 && (!strict || warnings.length === 0);

if (asJson) {
  console.log(JSON.stringify({ ok, strict, scannedFiles, candidates, skippedApiFields, errors, warnings, checks }, null, 2));
} else {
  console.log("# 术语审计（web/src 文案）");
  console.log(
    "扫描文件 " + scannedFiles + " 个 · 文案候选 " + candidates + " 条 · 已跳过 API 字段/标识符 " + skippedApiFields + " 处",
  );
  console.log("");
  if (errors.length === 0) {
    console.log("✓ 未发现禁用旧词（error 级：tokens/收费/qax/裸渠道/调用模型/调用名/调用串/计划窗口/游乐场）");
  } else {
    console.log("✗ 禁用旧词 " + errors.length + " 处（error，必须修）：");
    for (const v of errors) {
      console.log("  " + v.file + ":" + v.line + ":" + v.column + "  [" + v.rule + "] 「" + v.match + "」");
      console.log("    片段：" + v.snippet);
      console.log("    建议：" + v.suggestion);
    }
  }
  if (warnings.length > 0) {
    console.log("");
    console.log("▲ 待迁移旧词/单数 token 出现在文案里 " + warnings.length + " 处（warn，--strict 时失败）：");
    for (const v of warnings) {
      console.log("  " + v.file + ":" + v.line + ":" + v.column + "  「" + v.match + "」 " + v.snippet);
    }
  }
  console.log("");
  console.log("# 页面 title 与 logo 资产");
  for (const c of checks) console.log((c.ok ? "✓ " : "✗ ") + c.title + (c.ok ? "" : " —— " + c.detail));
  console.log("");
  console.log(
    ok
      ? "RESULT PASS（error " + errors.length + " · warn " + warnings.length + " · 资产 " + (checks.length - assetsFailed.length) + "/" + checks.length + "）"
      : "RESULT FAIL（error " + errors.length + " · warn " + warnings.length + " · 资产问题 " + assetsFailed.length + " 处）",
  );
}

process.exit(ok ? 0 : 1);
