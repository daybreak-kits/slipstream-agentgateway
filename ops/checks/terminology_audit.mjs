#!/usr/bin/env node
/**
 * Slipstream 术语审计（ticket 20 浏览器验收前置）
 *
 * 目的：UI 文案按三期词表（docs/GLOSSARY.md，2026-11-19 用户裁定）管控：正名
 * 上游渠道/公开模型/连接密钥/启用/关闭/分销商/客户/词元/模型试验；已废旧词不得出现；
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
 *   4. 扫描范围固定为 web 文案（web/src + index.html + public），**不含 docs/ 与 README**：
 *      历史 ADR 原文、调研快照与交付文档不参与门禁，docs 术语由 docs/GLOSSARY.md 与
 *      docs/ACCEPTANCE.md/§0.1 人工核对（ticket 17）。
 *   5. 严重级按旧词存量分两档，避免新词表把既有文案一巴掌打死（有存量时精确调规则，
 *      不改业务代码）：
 *      error —— 已废且存量已清零（W6 清零后提升）的旧词：tokens/Tokens/收费/
 *               调用模型/调用名/调用串/计划窗口/游乐场/裸「渠道」（含「上游」前缀的
 *               「上游渠道」除外）/封禁/对外模型/客户端密钥/令牌。出现即失败。
 *      warn  —— 仍有启发式存量的旧词：单数 token（指代查询条件时应为「关键词/查询项」，
 *               指代用量时应为「词元」）。默认不失败，只提示人工判断；--strict 时
 *               升级为失败。
 *   6. 已知启发式：小写单词字符串（如 type: "tokens" 的枚举值）视为数据，不判违规；
 *      模板插值（美元符 + 花括号）视为代码并替换为空。改动判定前请先读 tokenIsUiCopy()。
 *
 * 用法：
 *   node ops/checks/terminology_audit.mjs              # 人类可读报告，0 通过 / 1 有 error / 2 用法错误
 *   node ops/checks/terminology_audit.mjs --strict     # warn 也当失败（发布前门禁用）
 *   node ops/checks/terminology_audit.mjs --json       # 机器可读（CI）
 *   node ops/checks/terminology_audit.mjs --root <repo>
 *   node ops/checks/terminology_audit.mjs --boundary-only   # 只跑边界词表节（ticket 06，见下）
 *   node ops/checks/terminology_audit.mjs --update-baseline # 把 em/en dash 当前残留写入 baseline JSON
 *
 * em dash 分类与 baseline 棘轮（W6 ticket 20）：UI 文案层 em dash（缺值→「-」、区间→「至」、
 * 正文→标点）与 en dash 区间一律 error；现行 docs（README + 现行规范/契约文档）单独扫描。
 * 棘轮规则（em-dash / en-dash-range / docs-em-dash / docs-en-dash）按 ops/checks/
 * terminology_baseline.json 放行存量残留，新增违规 EXIT=1；其余规则零容忍。
 *
 * 边界词表节（W6 ticket 06 / ADR-029 §6）：扫描 web/src 字符串/模板字面量与 JSX 文本，
 * 数据面列名（trace_id、span_id、parent_span_id、attributes_json）、wire 词（gen_ai_*、
 * agw.*、agentgateway_user、keyHash、virtualModels、frontendPolicies）、数据面存储文件
 * （ag-data.db、ag_config_dir）、接收端口 4318、OTLP 与 raw_json 不得进入契约出参；
 * 注释、import 路径不算文案，adapter_id 审计值与适配器文案端口内容除外。全量审计
 * 把该节计入退出码（违规即失败）。
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
const boundaryOnly = flags.has("boundary-only");
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
  const REGEX_PRECEDERS = new Set(["(", "[", "{", ",", ";", "=", ":", "!", "&", "|", "?", "+", "-", "*", "%", "~", "^", "<", ">"]);
  const REGEX_KEYWORDS = /^(return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/;
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
    // 正则字面量判定（ticket 20）：message-list.tsx 等文件的 regex 体含反引号/引号，
    // 旧词法器会把它当字符串吞掉后续代码。按「前一个非空白字符」判定表达式位置。
    if (ch === "/" && next !== "/" && next !== "*") {
      let k = i - 1;
      while (k >= 0 && /\s/.test(source[k])) k -= 1;
      const prev = k >= 0 ? source[k] : "";
      const wordBefore = k >= 0 ? /[\w$]+$/.exec(source.slice(0, k + 1)) : null;
      const isRegex =
        prev === "" ||
        REGEX_PRECEDERS.has(prev) ||
        (wordBefore !== null && REGEX_KEYWORDS.test(wordBefore[0]));
      if (isRegex) {
        i += 1;
        let inClass = false;
        while (i < source.length) {
          const c = source[i];
          if (c === "\\") { i += 2; continue; }
          if (c === "\n") break; // 防御：正则字面量不跨行
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) { i += 1; break; }
          i += 1;
        }
        while (i < source.length && /[a-z]/i.test(source[i])) i += 1; // flags
        continue;
      }
      i += 1; // 除法等普通斜杠
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
    // 缺值占位常直接写成 JSX 文本「—」或「-」（ticket 20）：无中文也无拉丁字母，单独放行。
    const dashOnly = /^[—–-]+$/.test(text.trim());
    if (!hasCjk && !shortLatin && !dashOnly) continue;
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
    // W6 ticket 21: old role display names are gone; keys are customer/reseller.
    id: "retired-role-name",
    severity: "error",
    pattern: /代理用户|普通用户/g,
    allow: () => true,
    suggestion: "角色显示名已迁移：代理用户→分销商，普通用户→客户（docs/GLOSSARY.md §7）",
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
    // W6 存量清零（封禁/对外模型/客户端密钥各归位）→ 提升为 error；--strict 语义不变（warn 档仍失败）。
    id: "deprecated-term",
    severity: "error",
    pattern: /封禁|对外模型|客户端密钥/g,
    allow: () => true,
    suggestion: "旧词已禁用：封禁→关闭/启用，对外模型→公开模型，客户端密钥→连接密钥",
  },
  {
    // 「令牌」是 W6 旧词清零后的补充：连接令牌→连接密钥、用量令牌→词元、登录令牌→登录凭证。
    id: "legacy-token-word",
    severity: "error",
    pattern: /令牌/g,
    allow: () => true,
    suggestion: "旧词「令牌」已禁用：连接令牌→连接密钥，用量令牌→词元，登录令牌→登录凭证",
  },
  {
    // W6 ticket 20：产品对外名统一「模型接口网关」，旧英文产品名（LLM API GATEWAY / LLM 网关）
    // 从 UI 与页面 title 移除（SYSTEM-BOUNDARY §6.2）。品牌「驭流 Slipstream」不受影响。
    id: "product-name",
    severity: "error",
    pattern: /LLM API GATEWAY|LLM API 网关|LLM 网关|API GATEWAY/gi,
    allow: () => true,
    suggestion: "产品对外名统一「模型接口网关」；旧英文产品名不得出现在 UI 与页面 title",
  },
  {
    // W6 ticket 20：数据面版本语句不得出现在系统 UI 文案（SYSTEM-BOUNDARY §6.2）。
    // 「AG 1.7 不支持/拒收」之类的表述由适配器经 capability_note 提供中性文案（票05 端口模式）。
    id: "ag-version-copy",
    severity: "error",
    pattern: /AG 1\.7|pinned AG/gi,
    allow: () => true,
    suggestion: "数据面版本语句不进 UI 文案：改中性表述（如「数据面拒收/不支持」），能力文案走适配器 capability_note",
  },
  {
    // W6 ticket 20：UI 文案层 em dash 分类替换——缺值占位统一半角横线「-」，正文破折号改
    // 标点；中文破折号 —— 只保留在注释、归档、ADR 原文（注释已被词法器剥离）。
    id: "em-dash",
    severity: "error",
    pattern: /—/g,
    allow: () => true,
    suggestion: "缺值占位用「-」；数字/时间/版本区间用「至」；正文破折号改「，/：」；注释、归档、ADR 原文豁免",
  },
  {
    // W6 ticket 20：区间统一「至」（含 en dash）。en dash 在 UI 文案里只可能是区间或占位。
    id: "en-dash-range",
    severity: "error",
    pattern: /–/g,
    allow: () => true,
    suggestion: "区间统一用「至」（如 1 至 128、P50 至 P95）；注释、归档、ADR 原文豁免",
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
  // 纯横线占位（ticket 20）：「—」既无中文也无拉丁字母，旧判定直接漏检 99+ 处缺值占位。
  if (/^[—–\s]+$/.test(text)) return true;
  // 含 em/en dash 的字符串一律是文案候选（数字区间如 "1–"/"0–20" 无字母，旧判定漏检）。
  if (/[—–]/.test(text)) return true;
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(text)) return false;
  if (candidate.kind === "string" && SKIP_CLASS_LIKE.test(text) && !/[A-Z]/.test(text)) return false;
  // 对象键：字符串后面紧跟冒号（允许空白），是数据映射键而不是渲染文案。
  let j = candidate.end;
  while (j < source.length && (source[j] === " " || source[j] === "\t")) j += 1;
  if (source[j] === ":") return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * 2b. 边界词表（系统契约出参，W6 ticket 06 / ADR-029 §6）
 *
 * 数据面列名、wire 属性词、数据面存储文件、接收端口与 OTLP 不得进入契约出参
 * （生成契约 web/src/generated/contract.ts 与 mock 模式响应都在 web/src 内）。
 * 判定对象是字符串/模板字面量与 JSX 文本；注释里的历史说明与 import 路径
 * 不算文案（SYSTEM-BOUNDARY §6.2 例外）。adapter_id 审计值（恰为
 * "agentgateway" 的字面量）与适配器经 capability_note 端口提供的文案不在
 * 禁用清单内——数据面列名/端口作为适配器自有事实经端口出参是既定设计。
 * ------------------------------------------------------------------ */

const BOUNDARY_RULES = [
  {
    id: "dp-column",
    pattern: /\b(?:trace_id|span_id|parent_span_id|attributes_json)\b/g,
    suggestion: "数据面列名不进契约出参；系统只出现中性领域键（correlation_key 等）",
  },
  {
    id: "dp-wire",
    pattern: /gen_ai_[\w.]*|agw\.[\w]+|agentgateway_user|keyHash|virtualModels|frontendPolicies/g,
    suggestion: "wire 属性词由适配器归一化后再进系统；文案用中性词",
  },
  {
    id: "dp-store",
    pattern: /ag-data\.db|ag_config_dir/g,
    suggestion: "数据面存储文件/配置目录名属于适配器内部，不进系统契约",
  },
  {
    id: "dp-telemetry",
    pattern: /\bOTLP\b/g,
    suggestion: "遥测实现词（OTLP/span/接收器）是适配器内部知识，系统只存 RequestAttempt",
  },
  {
    id: "dp-port",
    pattern: /\b4318\b/g,
    suggestion: "数据面接收端口经 client_contract() 出参，不硬编码在系统表面",
  },
  {
    id: "dp-raw",
    pattern: /\braw_json\b/g,
    suggestion: "raw_json 是内部诊断附件，API 不返回它（SYSTEM-BOUNDARY §2/§5）",
  },
];

const boundaryFindings = [];

/** 边界判定对象：字符串/模板字面量 + JSX 文本；跳过 import 路径，保留对象键。 */
function boundaryCandidates(source) {
  return [...scanStringLiterals(source), ...scanJsxText(source)].filter((candidate) => {
    if (!candidate.text.trim()) return false;
    if (SKIP_MODULE_SPECIFIER.test(candidate.text.trim())) return false;
    return true;
  });
}

function scanBoundary(file) {
  const source = fs.readFileSync(file, "utf8");
  const offsets = buildLineIndex(source);
  for (const candidate of boundaryCandidates(source)) {
    for (const rule of BOUNDARY_RULES) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(candidate.text))) {
        if (match[0].length === 0) {
          rule.pattern.lastIndex += 1;
          continue;
        }
        const at = locate(offsets, candidate.start + match.index);
        boundaryFindings.push({
          file: path.relative(rootDir, file).replace(/\\/g, "/"),
          line: at.line,
          column: at.column,
          rule: rule.id,
          match: match[0].trim(),
          snippet: candidate.text.replace(/\s+/g, " ").trim().slice(0, 120),
          suggestion: rule.suggestion,
        });
      }
    }
  }
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
  scanBoundary(file);
  if (boundaryOnly) return; // 边界单跑：只做契约出参词表，不跑 UI 文案规则
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

/* ------------------------------------------------------------------ *
 * 3b. 现行 docs 扫描（W6 ticket 20：em dash 分类替换 + 产品名统一）
 *
 * 只扫「现行文档」：README + 现行规范/契约/交付/验收文档 + docs/contracts。
 * 排除（不进门禁，属「注释、归档、ADR 原文」豁免口径）：DECISIONS.md（ADR 原文）、
 * AUDIT-WEB/FEATURE-PARITY/FRONTEND-PLAN/PLAN.md（历史快照与历史计划）、
 * CHANGELOG-*（归档日志）、docs/research|experiments|plans|agents/**。
 * 剥离代码围栏（``` … ```，示例输出不得改）、行内代码与 HTML 注释后再判定。
 * ------------------------------------------------------------------ */

const DOCS_RULES = [
  {
    id: "docs-em-dash",
    pattern: /—/g,
    suggestion: "表格空值/缺值用「-」；正文破折号按语义改「，/：/（）」；ADR 原文与归档不在扫描清单内",
  },
  {
    id: "docs-en-dash",
    pattern: /–/g,
    suggestion: "数字/时间/版本区间统一用「至」（含 ticket/Story/实验编号区间）",
  },
  {
    id: "docs-product-name",
    pattern: /LLM API GATEWAY|LLM API 网关|LLM 网关|API GATEWAY/gi,
    suggestion: "产品对外名统一「模型接口网关」；旧英文产品名不得出现在现行 docs",
  },
];

const CURRENT_DOCS = [
  "README.md",
  "docs/api-contract.md",
  "docs/GLOSSARY.md",
  "docs/DESIGN-AUDIT.md",
  "docs/ACCEPTANCE.md",
  "docs/DELIVERY.md",
  "docs/SYSTEM-BOUNDARY.md",
  "docs/contracts/adapter-spi.md",
  "docs/contracts/billing.md",
  "docs/contracts/ir-and-rendering.md",
  "docs/contracts/transforms-compiler.md",
];

const ARCHIVED_DOCS = [
  "docs/DECISIONS.md（ADR 原文）",
  "docs/AUDIT-WEB.md / docs/FEATURE-PARITY.md（历史快照对照）",
  "docs/FRONTEND-PLAN.md / docs/PLAN.md（历史计划/方案快照）",
  "docs/CHANGELOG-*.md（归档日志）",
  "docs/research/**、docs/experiments/**、docs/plans/**（调研与历史计划归档）",
];

/** 剥离代码围栏/行内代码/HTML 注释；等长替换保行号。 */
function stripDocsNoise(source) {
  let out = source.replace(/```[\s\S]*?(?:```|$)/g, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
  out = out.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  return out;
}

const docsScanned = [];
for (const rel of CURRENT_DOCS) {
  const full = path.join(rootDir, rel);
  if (!fs.existsSync(full)) continue;
  docsScanned.push(rel);
  const source = stripDocsNoise(fs.readFileSync(full, "utf8"));
  const offsets = buildLineIndex(source);
  for (const rule of DOCS_RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(source))) {
      if (match[0].length === 0) {
        rule.pattern.lastIndex += 1;
        continue;
      }
      const at = locate(offsets, match.index);
      findings.push({
        file: rel,
        line: at.line,
        column: at.column,
        rule: rule.id,
        severity: "error",
        match: match[0].trim(),
        snippet: source.split("\n")[at.line - 1].trim().slice(0, 120),
        kind: "docs",
        suggestion: rule.suggestion,
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3c. baseline 棘轮（W6 ticket 20）
 *
 * RATCHET_RULES 内的规则允许 baseline 记录残留（ops/checks/terminology_baseline.json，
 * 形如 { "<rule>": { "<file>": <count> } }）：超出 baseline 的新增违规 EXIT=1，
 * baseline 内的残留只提示不失败（分批清理）。其余规则（旧词/边界/产品名/AG 版本语句）
 * 零容忍，不吃 baseline。--update-baseline 把当前残留写入 JSON。
 * ------------------------------------------------------------------ */

const RATCHET_RULES = new Set(["em-dash", "en-dash-range", "docs-em-dash", "docs-en-dash"]);
const BASELINE_PATH = path.join(HERE, "terminology_baseline.json");
const updateBaseline = flags.has("update-baseline");

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return {};
  }
}

const baseline = loadBaseline();
const bucketCounts = new Map();
for (const f of findings) {
  if (!RATCHET_RULES.has(f.rule)) continue;
  const key = f.rule + "|" + f.file;
  bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
}

let newBeyondBaseline = 0;
const baselineKept = [];
for (const [key, count] of bucketCounts) {
  const sep = key.indexOf("|");
  const rule = key.slice(0, sep);
  const file = key.slice(sep + 1);
  const allowed = baseline[rule]?.[file] ?? 0;
  if (count > allowed) {
    newBeyondBaseline += count - allowed;
  } else {
    for (const f of findings) {
      if (f.rule === rule && f.file === file) {
        f.suppressed = true;
        baselineKept.push(f);
      }
    }
  }
}

if (updateBaseline) {
  const next = {};
  for (const f of findings) {
    if (!RATCHET_RULES.has(f.rule)) continue;
    next[f.rule] ??= {};
    next[f.rule][f.file] = (next[f.rule][f.file] ?? 0) + 1;
  }
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log("baseline 已写入 " + BASELINE_PATH);
}

const errors = findings.filter((f) => f.severity === "error" && !f.suppressed);
const warnings = findings.filter((f) => f.severity === "warn");

if (boundaryOnly) {
  // 边界单跑输出（fixture 测试与 CI 子集用）：只报契约出参词表。
  if (asJson) {
    console.log(JSON.stringify({ ok: boundaryFindings.length === 0, boundaryFindings }, null, 2));
  } else {
    console.log("# 边界词表（系统契约出参，W6 ticket 06 / ADR-029 §6）");
    console.log(
      "范围：web/src 字符串/模板字面量 + JSX 文本（注释与 import 路径不算）；" +
        "数据面列名（trace_id/span_id/parent_span_id/attributes_json）、wire 词" +
        "（gen_ai_*/agw.*/agentgateway_user/keyHash/virtualModels/frontendPolicies）、" +
        "存储文件（ag-data.db/ag_config_dir）、接收端口 4318、OTLP 与 raw_json 不进契约出参；" +
        "adapter_id 审计值与适配器文案端口内容除外。",
    );
    console.log("findings: " + boundaryFindings.length);
    for (const v of boundaryFindings) {
      console.log("  " + v.file + ":" + v.line + ":" + v.column + "  [" + v.rule + "] 「" + v.match + "」");
      console.log("    片段：" + v.snippet);
      console.log("    建议：" + v.suggestion);
    }
    console.log(
      boundaryFindings.length === 0 ? "RESULT PASS（边界词表干净）" : "RESULT FAIL（边界词表违规 " + boundaryFindings.length + " 处）",
    );
  }
  process.exit(boundaryFindings.length === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ *
 * 4. 页面 title 与 logo 资产
 * ------------------------------------------------------------------ */

const EXPECTED_TITLE = "驭流 Slipstream · 模型接口网关";
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
  "页面标题不再回退为「Slipstream 管理台」且不含旧英文产品名（LLM API 网关等）",
  !/Slipstream\s*管理台/.test(indexHtml) && !/LLM API GATEWAY|LLM API 网关|LLM 网关|API GATEWAY/i.test(indexHtml),
  "web/index.html 标题/文本中不得出现旧回退标题或旧英文产品名（W6 ticket 20）",
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
const ok =
  errors.length === 0 &&
  boundaryFindings.length === 0 &&
  newBeyondBaseline === 0 &&
  assetsFailed.length === 0 &&
  (!strict || warnings.length === 0);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok,
        strict,
        scannedFiles,
        candidates,
        skippedApiFields,
        docsScanned,
        newBeyondBaseline,
        baselineKept: baselineKept.length,
        errors,
        warnings,
        boundaryFindings,
        checks,
      },
      null,
      2,
    ),
  );
} else {
  console.log("# 术语审计（web/src 文案）");
  console.log("范围：web/src 的 .ts/.tsx/.css 文案 + index.html + public 资产；不含 docs/ 与 README（历史 ADR 原文、调研快照不在门禁内，docs 术语按 docs/GLOSSARY.md 人工核对，ticket 17）。");
  console.log(
    "扫描文件 " + scannedFiles + " 个 · 文案候选 " + candidates + " 条 · 已跳过 API 字段/标识符 " + skippedApiFields + " 处",
  );
  console.log("");
  const webErrors = errors.filter((f) => !f.rule.startsWith("docs-"));
  if (webErrors.length === 0) {
    console.log("✓ 未发现禁用旧词（error 级：tokens/收费/裸渠道/代理用户/普通用户/调用模型/调用名/调用串/计划窗口/游乐场/封禁/对外模型/客户端密钥/令牌/旧产品名/AG 版本语句/em dash/en dash 区间）");
  } else {
    console.log("✗ 禁用旧词/UI 文案违规 " + webErrors.length + " 处（error，必须修）：");
    for (const v of webErrors) {
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
  console.log("# 边界词表（系统契约出参，W6 ticket 06 / ADR-029 §6）");
  console.log(
    "数据面列名（trace_id/span_id/parent_span_id/attributes_json）、wire 词（gen_ai_*/agw.*/" +
      "agentgateway_user/keyHash/virtualModels/frontendPolicies）、存储文件（ag-data.db/" +
      "ag_config_dir）、接收端口 4318、OTLP 与 raw_json 不进契约出参（字符串/模板字面量 + JSX 文本；" +
      "注释与 import 路径除外；adapter_id 审计值与适配器文案端口内容除外）。",
  );
  if (boundaryFindings.length === 0) {
    console.log("✓ 契约出参边界词表干净（findings: 0）");
  } else {
    console.log("✗ 边界词表违规 " + boundaryFindings.length + " 处（必须修）：");
    for (const v of boundaryFindings) {
      console.log("  " + v.file + ":" + v.line + ":" + v.column + "  [" + v.rule + "] 「" + v.match + "」");
      console.log("    片段：" + v.snippet);
      console.log("    建议：" + v.suggestion);
    }
  }
  console.log("");
  console.log("# 现行 docs 扫描（W6 ticket 20：em dash 分类 + 产品名）");
  console.log(
    "范围：" + docsScanned.join("、") +
      "；剥离代码围栏/行内代码/HTML 注释后判定。豁免（不在清单）：",
  );
  for (const a of ARCHIVED_DOCS) console.log("  - " + a);
  const docsErrs = findings.filter((f) => f.rule.startsWith("docs-") && !f.suppressed);
  const docsKept = findings.filter((f) => f.rule.startsWith("docs-") && f.suppressed);
  if (docsErrs.length === 0) {
    console.log(
      "✓ 现行 docs 无 em dash / en dash 区间 / 旧产品名违规" +
        (docsKept.length > 0 ? "（baseline 残留 " + docsKept.length + " 处，见下）" : ""),
    );
  } else {
    console.log("✗ 现行 docs 违规 " + docsErrs.length + " 处（超出 baseline 的新增，必须修）：");
    for (const v of docsErrs) {
      console.log("  " + v.file + ":" + v.line + ":" + v.column + "  [" + v.rule + "] 「" + v.match + "」");
      console.log("    片段：" + v.snippet);
      console.log("    建议：" + v.suggestion);
    }
  }
  console.log("");
  console.log("# baseline 棘轮（W6 ticket 20）");
  console.log(
    "棘轮规则：em-dash / en-dash-range / docs-em-dash / docs-en-dash；baseline=" +
      BASELINE_PATH + "（" + (baselineKept.length > 0 ? baselineKept.length + " 处残留" : "空，零容忍") + "）" +
      "；新增违规 " + newBeyondBaseline + " 处。",
  );
  for (const v of baselineKept) {
    console.log("  ~ " + v.file + ":" + v.line + "  [" + v.rule + "] " + v.snippet.slice(0, 80));
  }
  console.log("");
  console.log("# 页面 title 与 logo 资产");
  for (const c of checks) console.log((c.ok ? "✓ " : "✗ ") + c.title + (c.ok ? "" : " —— " + c.detail));
  console.log("");
  console.log(
    ok
      ? "RESULT PASS（error " + errors.length + " · warn " + warnings.length + " · 边界 " + boundaryFindings.length + " · baseline 残留 " + baselineKept.length + " · 资产 " + (checks.length - assetsFailed.length) + "/" + checks.length + "）"
      : "RESULT FAIL（error " + errors.length + " · warn " + warnings.length + " · 边界 " + boundaryFindings.length + " · baseline 新增 " + newBeyondBaseline + " · 资产问题 " + assetsFailed.length + " 处）",
  );
}

process.exit(ok ? 0 : 1);
