#!/usr/bin/env node
/**
 * W6 ticket 17：分流 mock 与前端链路计算的纯函数 seam 检查。
 *
 * 为什么存在：web 没有单测框架，而 mock 投影（collapse/focus/q/topN）与搜索闭包
 * （flow-search）是纯逻辑，错了只有演示模式才会暴露。本脚本用 esbuild 把
 * control-plane/memory/report-fixtures 与 lib/reports/flow-search 打包成临时 ESM，在 node 里跑行为断言，
 * 语义与后端 pytest（test_reports_flow_focus.py）逐条对齐：
 *
 *   1. mock 默认输出：五段、节点/边形状、totals = 窗口全量；
 *   2. mock 按 collapse 投影：隐藏段不出现、相邻重连、每路径边数守恒（Σvalue）；
 *   3. mock focus：祖先+后代闭包（单向 BFS，兄弟不入链）；
 *   4. mock q：label 子串命中 → 同一闭包；大小写不敏感；
 *   5. mock topN：折尾 other:<stage>，Σvalue 守恒（每路径边数不变）；
 *   6. flowSearchView：高亮闭包/仅显示链所需的集合与计数。
 *
 * 运行：node web/scripts/check-flow-mock.mjs   退出码 0 全过 / 1 有失败。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import esbuild from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(WEB_ROOT, ".scratch", "check-flow-mock");

const asPosix = (target) => path.relative(WEB_ROOT, target).replace(/\\/g, "/");

const ENTRY = `
export { mockFlow } from "${asPosix(path.join(WEB_ROOT, "src/lib/control-plane/memory/report-fixtures"))}";
export { flowMatchNodes, flowChainOf, flowSearchView } from "${asPosix(path.join(WEB_ROOT, "src/lib/reports/flow-search"))}";
`;

let failures = 0;
function check(label, fn) {
  try {
    const detail = fn();
    console.log("PASS " + label + (detail ? " — " + detail : ""));
  } catch (error) {
    failures += 1;
    console.log("FAIL " + label + " — " + String((error && error.message) || error));
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(label + " 期望 " + right + " 实际 " + left);
}
function sumValue(links) {
  return links.reduce((sum, link) => sum + link.value, 0);
}
function stageOf(id) {
  if (id.startsWith("user:")) return "user";
  if (id.startsWith("key:")) return "key";
  if (id.startsWith("model:")) return "model";
  if (id.startsWith("umodel:")) return "upstream";
  if (id.startsWith("other:")) return id.slice("other:".length);
  return "channel";
}

const run = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bundled = await esbuild.build({
    stdin: { contents: ENTRY, loader: "ts", resolveDir: WEB_ROOT },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const outfile = path.join(OUT_DIR, "bundle-" + process.pid + ".mjs");
  fs.writeFileSync(outfile, bundled.outputFiles[0].text);
  const { mockFlow, flowMatchNodes, flowChainOf, flowSearchView } = await import(
    pathToFileURL(outfile).href
  );

  const full = mockFlow("requests");
  check("mock 默认输出：五段与节点形状", () => {
    assertEqual(
      full.stages.map((stage) => stage.id),
      ["user", "key", "model", "upstream", "channel"],
      "stages",
    );
    const stages = new Set(Object.values(full.node_meta).map((meta) => meta.stage));
    assertEqual(
      [...stages].sort(),
      ["channel", "key", "model", "upstream", "user"],
      "节点阶段集合",
    );
    return "节点 " + full.nodes.length + " 个，边 " + full.links.length + " 条";
  });
  const edgeSum = sumValue(full.links);
  const totalsSnapshot = JSON.stringify(full.totals);

  check("mock collapse=model：隐藏段不出现、相邻重连、每路径边数守恒", () => {
    const collapsed = mockFlow("requests", ["model"]);
    assertEqual(
      collapsed.stages.map((stage) => stage.id),
      ["user", "key", "upstream", "channel"],
      "stages",
    );
    assert(
      collapsed.nodes.every((id) => !id.startsWith("model:")),
      "隐藏段节点仍出现在 nodes",
    );
    const visiblePrefixOrder = ["user", "key", "upstream", "channel"];
    for (const link of collapsed.links) {
      const from = visiblePrefixOrder.indexOf(stageOf(link.source));
      const to = visiblePrefixOrder.indexOf(stageOf(link.target));
      assert(from >= 0 && to >= 0, "边端点阶段越界：" + link.source + "→" + link.target);
      assert(to === from + 1, "collapse 后出现跨段边：" + link.source + "→" + link.target);
    }
    // 每条路径贡献 (可见段数-1) 条边：投影后 Σvalue = 全图 Σvalue × 3/4。
    assertEqual(
      sumValue(collapsed.links),
      (edgeSum * 3) / 4,
      "collapse 后 Σvalue",
    );
    assertEqual(collapsed.totals, full.totals, "totals 必须等于窗口全量");
    return "Σvalue " + sumValue(collapsed.links) + " 守恒，totals 不变";
  });

  check("mock collapse 多段组合：链路仍逐段相邻", () => {
    const collapsed = mockFlow("requests", ["key", "upstream"]);
    assertEqual(
      collapsed.stages.map((stage) => stage.id),
      ["user", "model", "channel"],
      "stages",
    );
    for (const link of collapsed.links) {
      const from = ["user", "model", "channel"].indexOf(stageOf(link.source));
      const to = ["user", "model", "channel"].indexOf(stageOf(link.target));
      assert(to === from + 1, "两段隐藏后出现跨段边：" + link.source + "→" + link.target);
    }
    assertEqual(sumValue(collapsed.links), (edgeSum * 2) / 4, "Σvalue");
    return "Σvalue " + sumValue(collapsed.links);
  });

  check("mock focus：祖先+后代闭包，兄弟不入链", () => {
    const focused = mockFlow("requests", [], { focus: "model:glm" });
    const ids = new Set(focused.nodes);
    assert(ids.has("model:glm"), "focus 目标必须保留");
    assert(!ids.has("model:fast") && !ids.has("model:claude"), "兄弟模型不应入链");
    assert(ids.has("umodel:glm-5.3"), "后代上游模型应入链");
    assert(!ids.has("umodel:qwen3-max"), "兄弟上游模型不应入链");
    for (const link of focused.links) {
      assert(
        ids.has(link.source) && ids.has(link.target),
        "focus 子图出现闭包外边：" + link.source + "→" + link.target,
      );
    }
    assertEqual(focused.stages.length, 5, "stages 不因 focus 改变");
    assertEqual(focused.totals, full.totals, "totals 不因 focus 改变");
    return "链 " + focused.nodes.length + " 节点";
  });

  check("mock q：label 子串（大小写不敏感）命中后取闭包", () => {
    const searched = mockFlow("requests", [], { q: "FAST" });
    const ids = new Set(searched.nodes);
    assert(ids.has("model:fast"), "命中节点必须保留");
    assert(!ids.has("model:glm"), "未命中兄弟不应入链");
    assert(ids.has("umodel:qwen3-max") && ids.has("channel:OpenRouter"), "后代应入链");
    const focused = mockFlow("requests", [], { focus: "model:fast" });
    assertEqual(searched.nodes, focused.nodes, "q 命中单个节点时应与该节点 focus 等价");
    return "q=FAST 命中 1 节点，链 " + searched.nodes.length + " 节点";
  });

  check("mock q 无命中：空子图（stages/totals 不变）", () => {
    const none = mockFlow("requests", [], { q: "不存在的标签" });
    assertEqual(none.nodes, [], "nodes");
    assertEqual(none.links, [], "links");
    assertEqual(none.stages.length, 5, "stages");
    assertEqual(none.totals, full.totals, "totals");
    return "空子图";
  });

  check("mock topN：折尾 other:<stage>，Σvalue 守恒", () => {
    const folded = mockFlow("requests", [], { topN: 2 });
    const others = folded.nodes.filter((id) => id.startsWith("other:"));
    assert(others.includes("other:user"), "用户段 3 节点应折叠出 other:user");
    assert(others.includes("other:model"), "公开模型段 3 节点应折叠出 other:model");
    assert(others.includes("other:upstream"), "上游模型段 4 节点应折叠出 other:upstream");
    // topN 只重挂边端点，每条路径仍贡献 4 条边：Σvalue 与全图一致。
    assertEqual(sumValue(folded.links), edgeSum, "topN 后 Σvalue");
    assertEqual(folded.totals, full.totals, "totals");
    const perStage = {};
    for (const id of folded.nodes) {
      perStage[stageOf(id)] = (perStage[stageOf(id)] ?? 0) + 1;
    }
    for (const stage of ["user", "key", "model", "upstream", "channel"]) {
      assert(perStage[stage] <= 3, stage + " 段节点数超过 topN+1：" + perStage[stage]);
    }
    return "other 节点 " + others.length + " 个，Σvalue 守恒";
  });

  check("flowSearchView：高亮闭包与计数（方向性）", () => {
    // 方向性判别：b 的另一个孩子 c2 不是 c 的祖先/后代（双向 BFS 会误收）。
    const graph = {
      nodes: ["a", "b", "sibling", "c", "c2", "d"],
      node_meta: {
        a: { label: "节点A", stage: "user" },
        b: { label: "节点B", stage: "key" },
        sibling: { label: "旁支", stage: "user" },
        c: { label: "目标C", stage: "model" },
        c2: { label: "旁支C2", stage: "model" },
        d: { label: "节点D", stage: "channel" },
      },
      links: [
        { source: "a", target: "b" },
        { source: "sibling", target: "b" },
        { source: "b", target: "c" },
        { source: "b", target: "c2" },
        { source: "c", target: "d" },
      ],
    };
    assertEqual(flowMatchNodes(graph, "目标"), ["c"], "命中");
    assertEqual(
      flowChainOf(graph, ["c"]),
      new Set(["a", "sibling", "b", "c", "d"]),
      "闭包不含祖先的其他下游 c2（方向性 BFS）",
    );
    const view = flowSearchView(graph, "目标");
    assert(view !== null, "view 不应为 null");
    assertEqual(view.matchedCount, 1, "matchedCount");
    assertEqual(view.chainNodeCount, 5, "chainNodeCount");
    assertEqual(view.chainLinkCount, 4, "chainLinkCount");
    assert(flowSearchView(graph, "  ") === null, "空搜索应返回 null");
    assertEqual(
      flowMatchNodes(graph, "节点"),
      ["a", "b", "d"],
      "多命中按 nodes 顺序",
    );
    return "命中 1 / 链 5 节点 4 边（不含旁支 c2）";
  });

  fs.rmSync(outfile, { force: true });
  console.log("");
  if (failures > 0) {
    console.log("FAIL " + failures + " 项");
    process.exitCode = 1;
  } else {
    console.log("全部通过");
  }
};

run().catch((error) => {
  console.error("check-flow-mock 环境错误：" + String((error && error.stack) || error));
  process.exitCode = 2;
});
