/**
 * ops/checks 共享：隔离站点（临时 SQLite + 临时 ag-config 的 API + 静态托管 web/dist 并反代 /admin、/api）。
 *
 * W7 的浏览器验收脚本都按同一套流程起站点：seed_demo.py → uvicorn → 静态站点反代。
 * 这段流程只有一份实现（脚本之间不再各抄一份），脚本只声明端口、库文件名、密钥与管理员账号。
 *
 * 隔离原则：不碰 3700/3600 与主仓库工作树；数据库与 ag-config 都落在验收脚本自己的证据目录里。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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

/** 选 Python：优先 W7_PYTHON，其次 api/.venv，再退到 PATH 上的 python。 */
export function pythonExecutable(apiRoot) {
  const candidates = [
    process.env.W7_PYTHON || "",
    process.platform === "win32"
      ? path.join(apiRoot, ".venv", "Scripts", "python.exe")
      : path.join(apiRoot, ".venv", "bin", "python"),
    "python",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "python" || fs.existsSync(candidate)) || "python";
}

/**
 * 建一个隔离站点。
 *
 * @param {object} options
 * @param {string} options.apiRoot  api 包根目录（跑 seed_demo.py 与 uvicorn）
 * @param {string} options.webRoot  web 包根目录（提供 web/dist 静态资源）
 * @param {number} options.apiPort  隔离 API 端口（不得是 3700/3600）
 * @param {number} options.webPort  隔离 web 端口（不得是 3700/3600）
 * @param {string} options.outDir    证据目录；server 子目录放库文件与日志
 * @param {string} options.dbName    临时 SQLite 文件名
 * @param {string} options.secretKey 仅用于本地会话签名的临时密钥
 * @param {{ user: string, pass: string }} options.adminCred 种子管理员账号
 * @param {(databaseFile: string) => void | Promise<void>} [options.afterSeed] seed 之后、API 起来之前写夹具
 */
export function createIsolatedSite(options) {
  const { apiRoot, webRoot, apiPort, webPort, outDir, dbName, secretKey, adminCred, afterSeed } = options;
  let apiProc = null;
  let webServer = null;
  let serverLog = "";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function tailLog(lines = 14) {
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
    throw new Error("隔离站点未在 " + timeoutMs + "ms 内就绪：" + lastError + "\n" + tailLog());
  }

  /** web 站点：静态托管 web/dist，并把 /admin、/api 反代到隔离 API（保持 cookie 同源）。 */
  function startWebServer(port, targetPort) {
    const dist = path.join(webRoot, "dist");
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1:" + port);
      if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api")) {
        const headers = { ...req.headers, host: "127.0.0.1:" + targetPort };
        const proxyReq = http.request(
          { hostname: "127.0.0.1", port: targetPort, path: req.url, method: req.method, headers },
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

  /** 起站点：seed → API → web；返回 web 基址。 */
  async function start() {
    if (apiPort === 3700 || apiPort === 3600 || webPort === 3700 || webPort === 3600) {
      throw new Error("拒绝在 3700/3600 上运行（必须使用隔离端口 " + apiPort + "/" + webPort + "）");
    }
    const distIndex = path.join(webRoot, "dist", "index.html");
    if (!fs.existsSync(distIndex)) {
      throw new Error("web/dist 不存在：先 cd web && npx vite build");
    }
    const serverDir = path.join(outDir, "server");
    fs.mkdirSync(path.join(serverDir, "ag-config"), { recursive: true });
    serverLog = path.join(serverDir, "server.log");
    const databaseFile = path.join(serverDir, dbName).replace(/\\/g, "/");
    const env = {
      ...process.env,
      PYTHONPATH: path.join(apiRoot, "src"),
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      SLIPSTREAM_DATABASE_URL: "sqlite:///" + databaseFile,
      SLIPSTREAM_AG_CONFIG_DIR: path.join(serverDir, "ag-config"),
      SLIPSTREAM_AG_DB_PATH: path.join(serverDir, "ag-config", "ag-data.db"),
      SLIPSTREAM_WEB_DIST_DIR: path.join(webRoot, "dist"),
      SLIPSTREAM_JOBS_ENABLED: "0",
      SLIPSTREAM_ADMIN_USERNAME: adminCred.user,
      SLIPSTREAM_ADMIN_PASSWORD: adminCred.pass,
      SLIPSTREAM_SECRET_KEY: secretKey,
      SLIPSTREAM_COOKIE_SECURE: "0",
      SLIPSTREAM_AG_BINARY: "",
      SLIPSTREAM_AG_LLM_PORT: "0",
    };

    const seed = spawnSync(pythonExecutable(apiRoot), ["scripts/seed_demo.py"], {
      cwd: apiRoot,
      env,
      encoding: "utf8",
      timeout: 240000,
    });
    if (seed.status !== 0) {
      throw new Error("seed_demo.py 失败：" + String(seed.stderr || seed.stdout || "").slice(-800));
    }

    if (afterSeed) await afterSeed(databaseFile);

    const logFd = fs.openSync(serverLog, "a");
    apiProc = spawn(
      pythonExecutable(apiRoot),
      ["-m", "uvicorn", "l06_api.app:create_app", "--factory", "--host", "127.0.0.1", "--port", String(apiPort)],
      { cwd: apiRoot, env, stdio: ["ignore", logFd, logFd], windowsHide: true },
    );
    apiProc.on("exit", (code) => {
      // 收尾时主动 kill 会带出非零退出码，那不算异常。
      if (code !== null && code !== 0 && apiProc) console.error("隔离 API 提前退出，code=" + code + "\n" + tailLog());
    });
    await waitForHealth("http://127.0.0.1:" + apiPort);
    webServer = await startWebServer(webPort, apiPort);
    return "http://127.0.0.1:" + webPort;
  }

  /** 收尾：关 web 站点、杀掉 API 进程树。 */
  function stop() {
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

  return { start, stop, tailLog };
}
