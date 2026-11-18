#!/usr/bin/env node
/**
 * 从 src/routes.ts 生成 ops/checks/routes.json —— 页面清单的只读导出。
 *
 * routes.ts 只放数据（不 import React/图标/页面模块），所以这里用 TypeScript 的
 * transpileModule 去掉类型后直接 import，既不需要额外运行时（tsx/ts-node），
 * 也不需要先 build。输出的 JSON 不含时间戳，重复生成结果稳定；
 * route-audit / interaction_audit 都读它，不再从 JSX 正则抠路由或手抄路径。
 *
 * 用法：cd web && npm run routes:json
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "src", "routes.ts");
const target = resolve(here, "..", "..", "ops", "checks", "routes.json");

const code = ts.transpileModule(readFileSync(source, "utf8"), {
  fileName: "routes.ts",
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const tmp = join(tmpdir(), "slipstream-routes-" + process.pid + "-" + Date.now() + ".mjs");
writeFileSync(tmp, code, "utf8");
let mod;
try {
  mod = await import(pathToFileURL(tmp).href);
} finally {
  rmSync(tmp, { force: true });
}

if (!Array.isArray(mod.ROUTES)) {
  console.error("[routes:json] src/routes.ts 没有导出 ROUTES 数组");
  process.exit(1);
}

const payload = {
  version: 1,
  source: "web/src/routes.ts",
  generatedBy: "cd web && npm run routes:json",
  sections: mod.NAV_SECTION_ORDER || [],
  routes: mod.ROUTES,
};
writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log("[routes:json] " + payload.routes.length + " 条路由 -> " + target);
