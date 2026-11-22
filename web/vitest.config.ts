import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * 纯 TS/node 单测（W4 票04）：只测 control-plane 的 typed operations 与错误映射，
 * 不引 jsdom、不加载 React/Tailwind 插件。页面冒烟仍由 Playwright 覆盖。
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
