import { defineConfig, mergeConfig } from "vite";

import base from "./vite.config";

// 仅用于 ticket 15 冒烟：5173 被主检出占用，用 5174 + 同源代理把 /admin 转发到 3700。
// 文件在提交前删除，不进入仓库。
export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: 5174,
      strictPort: true,
      host: "127.0.0.1",
      proxy: {
        "/admin": {
          target: "http://127.0.0.1:3700",
          changeOrigin: true,
        },
      },
    },
  }),
);
