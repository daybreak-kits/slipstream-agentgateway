#!/usr/bin/env node
/**
 * W6 ticket 16 门禁脚本：看板 366 天上限单一来源与前置校验。
 *
 * 为什么是脚本而不是单测：本仓前端没有测试运行器（package.json 无 vitest/jest，
 * 说明见 check-ui-foundation.mjs）。时间窗上限的契约同时落在三处——后端
 * l06_api/deps.py（唯一实义定义）、生成的 contract.ts（gen_ts.py 从后端同步）与
 * 前端 time-range-picker/window.ts（唯一消费点）。这里用 Vite 的 SSR 加载器编译
 * 真实 TS 模块，断言契约值、校验语义与「超界不发聚合请求」的接线；期望值用
 * 366×86400000 独立字面量，不用被测模块自己推导（防同义反复）。
 *
 * 「失败请求未发出」的网络面板证据由 ops/checks/dashboard_date_guard.mjs
 * （真实浏览器 + route 拦截计数）承担；本脚本承担常量与接线契约。
 *
 * 用法：node scripts/check-dashboard-date-guard.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (...p) => join(webRoot, "src", ...p);
const read = (p) => readFileSync(join(webRoot, p), "utf8");

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** 独立事实源：366 天的毫秒数（票 16 验收口径），不 import 被测模块。 */
const DAY_MS = 24 * 3_600_000;
const CAP_MS = 366 * DAY_MS;
const CAP_DAYS = 366;

/** 去掉块注释与整行注释后再扫描字面量：注释里提到 366 是说明，不是第二份实现。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** 固定时刻（2026-03-10 12:00 本地时区），避免与 Date.now() 跨零点的竞态。 */
const FIXED_NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();

let server;
const load = async (id) => server.ssrLoadModule(id);

// ---------- 1. 契约单一来源 ----------
check("generated contract：MAX_CUSTOM_SPAN_MS/DAYS 由后端常量同步导出", async () => {
  const contract = await load("/src/generated/contract.ts");
  expect(contract.MAX_CUSTOM_SPAN_MS === CAP_MS, `MAX_CUSTOM_SPAN_MS 应为 ${CAP_MS}，实际 ${contract.MAX_CUSTOM_SPAN_MS}`);
  expect(contract.MAX_CUSTOM_SPAN_DAYS === CAP_DAYS, `MAX_CUSTOM_SPAN_DAYS 应为 ${CAP_DAYS}，实际 ${contract.MAX_CUSTOM_SPAN_DAYS}`);
});

check("window.ts：上限只从契约读取并再导出，前端不再各写一份", async () => {
  const window = await load("/src/components/time-range-picker/window.ts");
  expect(window.TIME_WINDOW_MAX_SPAN_MS === CAP_MS, "TIME_WINDOW_MAX_SPAN_MS 必须等于契约值");
  expect(window.TIME_WINDOW_MAX_SPAN_DAYS === CAP_DAYS, "TIME_WINDOW_MAX_SPAN_DAYS 必须等于契约值");
  const source = stripComments(read("src/components/time-range-picker/window.ts"));
  expect(source.includes('"@/generated/contract"'), "window.ts 必须 import @/generated/contract（单一来源链）");
  expect(!/\b(365|366)\b/.test(source), "window.ts 不得出现硬编码 365/366（上限只来自契约）");
});

// ---------- 2. 校验语义（366 边界/367 拒绝） ----------
check("customWindowSpanError：恰好 366 天放行、367 天拒绝并带两端上限", async () => {
  const { customWindowSpanError } = await load("/src/components/time-range-picker/window.ts");
  expect(customWindowSpanError(0, CAP_MS) === null, "跨度恰好 366 天必须放行（null）");
  expect(customWindowSpanError(FIXED_NOW, FIXED_NOW + CAP_MS) === null, "任意起点的 366 天窗必须放行");
  const over = customWindowSpanError(0, CAP_MS + 1);
  expect(over !== null, "366 天 + 1ms 必须被拒");
  expect(over.includes("366"), "拒绝文案必须带 366 上限值：" + over);
  expect(customWindowSpanError(FIXED_NOW, FIXED_NOW + 7 * DAY_MS) === null, "7 天窗必须放行");
});

check("timeWindowUsable：预设恒可用；自定义窗必须成对有序且不超上限", async () => {
  const { timeWindowUsable } = await load("/src/components/time-range-picker/window.ts");
  expect(timeWindowUsable({ kind: "range", value: "7d" }), "预设 7d 必须可用");
  expect(timeWindowUsable({ kind: "range", value: "today" }), "预设 today 必须可用");
  expect(timeWindowUsable({ kind: "custom", fromMs: 0, toMs: CAP_MS }), "恰好 366 天的 custom 必须可用");
  expect(!timeWindowUsable({ kind: "custom", fromMs: 0, toMs: CAP_MS + 1 }), "366 天 + 1ms 的 custom 必须不可用（不发聚合请求的门）");
  expect(!timeWindowUsable({ kind: "custom", fromMs: CAP_MS, toMs: 0 }), "结束早于开始的 custom 必须不可用");
});

check("earliestCustomDayMs：最早可选日由契约上限推导，最宽零点窗恰好 366 天", async () => {
  const { earliestCustomDayMs, customWindowSpanError, dayStartMs } = await load(
    "/src/components/time-range-picker/window.ts",
  );
  const earliest = earliestCustomDayMs(FIXED_NOW);
  expect(earliest === dayStartMs(FIXED_NOW) - (CAP_DAYS - 1) * DAY_MS, "最早可选日 = 今天 00:00 −（上限−1）天");
  // 「零点」按钮能产出的最宽窗：最早日 00:00 → 今天次日 00:00，恰好等于上限。
  expect(customWindowSpanError(earliest, dayStartMs(FIXED_NOW) + DAY_MS) === null, "最宽零点窗（恰好 366 天）必须放行");
  expect(customWindowSpanError(earliest, dayStartMs(FIXED_NOW) + DAY_MS + 1) !== null, "比最宽零点窗再多 1ms 必须被拒");
});

// ---------- 3. 接线契约：不发聚合请求 ----------
check("use-reports：四个聚合 hook 全部接 timeWindowUsable 门，不自带毫秒常量", () => {
  const source = stripComments(read("src/components/dashboard/use-reports.ts"));
  const wired = source.match(/timeWindowUsable\(/g) ?? [];
  expect(wired.length >= 4, `overview/timeseries/latency/flow 四个 hook 都要接 enabled 门，实际接线 ${wired.length} 处`);
  expect(!source.includes("86_400_000") && !/\b(365|366)\b/.test(source), "use-reports.ts 不得自带跨度常量（单一来源在 window.ts/契约）");
});

check("time-range-picker：日历禁用超界日期，发布前校验失败走通知中心不发请求", () => {
  const picker = read("src/components/time-range-picker/time-range-picker.tsx");
  expect(picker.includes("earliestCustomDayMs"), "日历下界必须来自契约推导的 earliestCustomDayMs");
  expect(!picker.includes("LOOKBACK_DAYS"), "不得保留前端自写的 LOOKBACK_DAYS=365");
  expect(/disabled=\{\{\s*before:/.test(picker), "日历必须 disabled.before 禁用超界日期");
  expect(/disabled=\{\{\s*before:.*after:/.test(picker.replace(/\n/g, " ")), "日历必须同时禁用 after（今天之后）");
  expect(picker.includes("customWindowSpanError"), "发布路径必须先过跨度校验");
  expect(picker.includes("pushErrorNotificationOnce"), "校验失败走通知中心（票07 语义），不弹逐条 toast");
  expect(!/toast\.error\(/.test(picker), "表单校验错误不得用 toast.error 承担");
});

check("logs 页：latency 查询接同一扇门，422 不再静默（可见错误态）", () => {
  const logs = read("src/pages/logs.tsx");
  expect(logs.includes("timeWindowUsable"), "logs 的 latencyQuery 必须接 timeWindowUsable 门");
  expect(logs.includes("latencyQuery.isError"), "latency 失败必须有可见错误态分支");
  expect(logs.includes("延迟分位"), "错误态文案必须点名延迟分位");
});

// ---------- run ----------
const failures = [];
server = await createServer({
  configFile: join(webRoot, "vite.config.ts"),
  root: webRoot,
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  for (const { name, fn } of checks) {
    try {
      await fn();
      console.log("ok   - " + name);
    } catch (error) {
      failures.push({ name, message: error?.message ?? String(error) });
      console.log("FAIL - " + name + "\n       " + (error?.message ?? error));
    }
  }
} finally {
  await server.close();
}

console.log("\n" + (checks.length - failures.length) + "/" + checks.length + " checks passed");
if (failures.length > 0) {
  console.error("\n未通过的契约：");
  for (const failure of failures) console.error("- " + failure.name + "：" + failure.message);
  process.exitCode = 1;
}
