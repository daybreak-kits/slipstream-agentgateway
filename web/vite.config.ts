import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/** 精确匹配 /node_modules/<pkg>/，避免子串误伤（如 react 与 react-dom 之外的同名前缀包）。 */
function inPackage(id: string, ...names: string[]): boolean {
  return names.some((name) => id.includes("/node_modules/" + name + "/"));
}

/**
 * 手动分包：把体积大、首屏非必需的依赖拆成独立 chunk。
 * - echarts：只有数据看板用到，拆出去后才能随看板路由按需加载，首屏完全不下载；
 * - recharts：备用图表库，独立 chunk，避免混进入口；
 * - react-vendor / radix：首屏需要，拆开便于长期缓存（升级页面代码不会打断这几个 chunk）；
 * - ui-vendor：clsx 这类被入口与 recharts 共用的工具模块，必须单独成 chunk，
 *   否则 rollup 会把它塞进 recharts chunk，入口被迫静态依赖整个图表库（首包 +112KB）。
 */
function manualChunks(rawId: string): string | undefined {
  const id = rawId.replace(/\\/g, "/");
  if (!id.includes("/node_modules/")) return undefined;
  if (inPackage(id, "echarts", "zrender")) return "echarts";
  if (inPackage(id, "recharts")) return "recharts";
  if (inPackage(id, "react", "react-dom", "scheduler", "react-router", "react-router-dom")) return "react-vendor";
  if (inPackage(id, "@radix-ui")) return "radix";
  if (inPackage(id, "clsx", "tailwind-merge", "class-variance-authority")) return "ui-vendor";
  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 单端口交付：生产由控制面 3700 同源托管 web/dist；本地 HMR 时把 API 代理过去，
    // 这样 API_BASE 默认空串在两种模式下都成立（也保持 cookie 同源）。
    proxy: {
      "/admin": { target: "http://localhost:3700", changeOrigin: false },
      "/api": { target: "http://localhost:3700", changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks },
    },
  },
});
