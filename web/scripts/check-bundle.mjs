#!/usr/bin/env node
/**
 * 前端包体门禁：验证「路由级 code-split + echarts 独立 chunk」真实生效。
 *
 * 断言（只看 dist/ 产物，不依赖 vite 的控制台输出）：
 *   1. 首包（index.html 的 entry + modulepreload + stylesheet）gzip 不超过阈值；
 *   2. 存在独立的 echarts chunk，且不在首包里（按需加载，不预加载）；
 *   3. 至少 N 个 JS chunk，证明路由级 lazy 生效（不是单文件打包）；
 *   4. 任何单个 chunk gzip 不超过 400KB（避免拆完还有巨无霸）。
 *
 * 用法：
 *   npm run build && npm run check:bundle
 *   node scripts/check-bundle.mjs --json
 * 阈值可用环境变量覆盖：BUNDLE_MAX_FIRST_LOAD_KB / BUNDLE_MIN_CHUNKS。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const maxFirstLoadKb = Number(process.env.BUNDLE_MAX_FIRST_LOAD_KB ?? 220);
const minChunks = Number(process.env.BUNDLE_MIN_CHUNKS ?? 20);
const maxChunkKb = Number(process.env.BUNDLE_MAX_CHUNK_KB ?? 400);

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
const gz = (file) => kb(gzipSync(readFileSync(file), { level: 9 }).length);

if (!existsSync(join(distDir, "index.html"))) {
  console.error("[check-bundle] dist/index.html 不存在，先跑 npm run build");
  process.exit(2);
}

const html = readFileSync(join(distDir, "index.html"), "utf8");
const assetUrl = (url) => join(distDir, url.replace(/^\//, "").split("?")[0]);
const entry = (html.match(/<script[^>]+src="([^"]+\.js)"/) ?? [])[1];
const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]*href="([^"]+\.js)"/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+\.(?:css|js))"/g)].map((m) => m[1]);

if (!entry) {
  console.error("[check-bundle] index.html 里找不到入口 script");
  process.exit(2);
}

const assets = readdirSync(join(distDir, "assets")).filter((name) => name.endsWith(".js"));
const chunks = assets
  .map((name) => ({ name, gzipKb: gz(join(distDir, "assets", name)), rawKb: kb(readFileSync(join(distDir, "assets", name)).length) }))
  .sort((a, b) => b.gzipKb - a.gzipKb);

const entryName = entry.split("/").pop();
const firstLoad = [entry, ...preloads, ...styles].filter((url, i, all) => all.indexOf(url) === i);
const firstLoadKb = firstLoad.reduce((sum, url) => sum + gz(assetUrl(url)), 0);

const echartsChunk = chunks.find((c) => c.name.startsWith("echarts-"));
const firstLoadNames = new Set(firstLoad.map((url) => url.split("/").pop()));
const entrySource = readFileSync(assetUrl(entry), "utf8");
/** 入口是否有一条静态 ESM 边指向该 chunk（只排除静态 import；入口里的动态 import 依赖表是正常的）。 */
const staticallyImportedByEntry = (name) => entrySource.includes('from"./' + name + '"');

const failures = [];
if (firstLoadKb > maxFirstLoadKb) {
  failures.push(`首包 gzip ${firstLoadKb}KB 超过阈值 ${maxFirstLoadKb}KB（产物未拆分或拆分不足）`);
}
if (!echartsChunk) {
  failures.push("没有找到独立 echarts chunk（manualChunks 未生效或 echarts 未被用到）");
} else if (firstLoadNames.has(echartsChunk.name) || staticallyImportedByEntry(echartsChunk.name)) {
  failures.push(`echarts chunk (${echartsChunk.name}) 进入首包/被入口静态依赖，未做到按需加载`);
}
if (chunks.length < minChunks) {
  failures.push(`JS chunk 只有 ${chunks.length} 个，少于 ${minChunks}：路由级 lazy 未生效`);
}
for (const chunk of chunks) {
  if (chunk.gzipKb > maxChunkKb) failures.push(`chunk ${chunk.name} gzip ${chunk.gzipKb}KB 超过上限 ${maxChunkKb}KB`);
}

const report = {
  package: "slipstream-web",
  entry: entryName,
  firstLoad: { chunks: firstLoad.map((url) => url.split("/").pop()), gzipKb: Math.round(firstLoadKb * 10) / 10 },
  chunks,
  thresholds: { maxFirstLoadKb, minChunks, maxChunkKb },
  failures,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("[check-bundle] 产物 chunk（按 gzip 降序）");
  for (const chunk of chunks) {
    console.log(`  ${chunk.name.padEnd(34)} raw ${String(chunk.rawKb).padStart(8)}KB  gzip ${String(chunk.gzipKb).padStart(7)}KB`);
  }
  console.log(`  ${"首包合计".padEnd(34)} raw ${String("-").padStart(8)}      gzip ${String(report.firstLoad.gzipKb).padStart(7)}KB`);
  if (failures.length) {
    console.error("[check-bundle] FAIL");
    for (const failure of failures) console.error("  - " + failure);
  } else {
    console.log("[check-bundle] PASS：首包 gzip " + report.firstLoad.gzipKb + "KB，chunk " + chunks.length + " 个，echarts 独立按需 " + (echartsChunk?.gzipKb ?? 0) + "KB");
  }
}

process.exit(failures.length ? 1 : 0);
