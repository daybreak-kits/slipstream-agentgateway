import { describe, expect, it } from "vitest";

import {
  PORT_DISABLED_LABEL,
  defaultBaseUrl,
  effectiveBaseUrl,
  formatPort,
  formatUrl,
  isDataPlaneEnabled,
} from "./url";

describe("数据面端口展示语义", () => {
  it("有效端口按原值展示", () => {
    expect(formatPort(3600)).toBe("3600");
    expect(formatPort(80)).toBe("80");
    expect(formatPort(443)).toBe("443");
  });

  it("0 表示未启用（外部数据面），不能显示成真实端口", () => {
    expect(formatPort(0)).toBe(PORT_DISABLED_LABEL);
    expect(PORT_DISABLED_LABEL).toBe("未启用（外部数据面）");
  });

  it("缺失或非法端口同样视为未启用", () => {
    expect(formatPort(undefined)).toBe(PORT_DISABLED_LABEL);
    expect(formatPort(null)).toBe(PORT_DISABLED_LABEL);
    expect(formatPort(-1)).toBe(PORT_DISABLED_LABEL);
  });
});

describe("连接地址格式化：默认端口与 scheme", () => {
  it("http 80 / https 443 省略端口", () => {
    expect(formatUrl("http://api.example.com:80/")).toBe("http://api.example.com");
    expect(formatUrl("https://api.example.com:443/")).toBe("https://api.example.com");
  });

  it("非默认端口保留", () => {
    expect(formatUrl("http://api.example.com:8080/")).toBe("http://api.example.com:8080");
    expect(formatUrl("https://api.example.com:8443/")).toBe("https://api.example.com:8443");
  });

  it("默认端口按 scheme 区分：http:443 与 https:80 都要保留", () => {
    expect(formatUrl("http://api.example.com:443/")).toBe("http://api.example.com:443");
    expect(formatUrl("https://api.example.com:80/")).toBe("https://api.example.com:80");
  });
});
describe("连接地址格式化：边界", () => {
  it("IPv6 host 方括号，默认端口仍省略", () => {
    expect(formatUrl("http://[::1]:80/")).toBe("http://[::1]");
    expect(formatUrl("http://[::1]:8080/")).toBe("http://[::1]:8080");
    expect(formatUrl("https://[2001:db8::1]:443/v1/")).toBe("https://[2001:db8::1]/v1");
  });

  it("没有 scheme 时按 http 补全，展示口径统一带 scheme", () => {
    expect(formatUrl("api.example.com:8080/")).toBe("http://api.example.com:8080");
    expect(formatUrl("api.example.com")).toBe("http://api.example.com");
  });

  it("尾斜杠只去掉路径末尾（根路径与子路径同规则）", () => {
    expect(formatUrl("https://api.example.com/")).toBe("https://api.example.com");
    expect(formatUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(formatUrl("https://api.example.com/v1///")).toBe("https://api.example.com/v1");
  });
});
describe("连接地址格式化：浏览器 host + 适配器端口（结构化入参）", () => {
  it("非默认端口拼成可复制地址", () => {
    expect(formatUrl({ scheme: "http", host: "127.0.0.1", port: 3600 })).toBe(
      "http://127.0.0.1:3600",
    );
    expect(formatUrl({ scheme: "https", host: "gw.example.com", port: 8443 })).toBe(
      "https://gw.example.com:8443",
    );
  });

  it("默认端口省略；IPv6 host 自动补方括号且不重复", () => {
    expect(formatUrl({ scheme: "https", host: "api.example.com", port: 443 })).toBe(
      "https://api.example.com",
    );
    expect(formatUrl({ scheme: "http", host: "::1", port: 8080 })).toBe("http://[::1]:8080");
    expect(formatUrl({ scheme: "http", host: "[::1]", port: 80 })).toBe("http://[::1]");
  });

  it("端口 0/缺失不生成 host:0，统一返回未启用文案", () => {
    expect(formatUrl({ scheme: "http", host: "127.0.0.1", port: 0 })).toBe(PORT_DISABLED_LABEL);
    expect(formatUrl({ scheme: "http", host: "127.0.0.1" })).toBe(PORT_DISABLED_LABEL);
    expect(formatUrl("http://api.example.com:0/")).toBe(PORT_DISABLED_LABEL);
  });
});
describe("连接地址解析（运营设置 / 连接密钥 / 快速上手共用）", () => {
  it("显式配置优先：省略默认端口与尾斜杠后展示", () => {
    expect(effectiveBaseUrl({ base_url: "https://gw.example.com:443/", default_port: 0 })).toBe(
      "https://gw.example.com",
    );
    expect(
      effectiveBaseUrl({ base_url: "http://gw.example.com:8080/v1/", default_port: 3600 }),
    ).toBe("http://gw.example.com:8080/v1");
  });

  it("未配置时用浏览器当前 host + 适配器契约端口", () => {
    // 纯 node 单测没有 window：browserHost 回退 localhost。
    expect(defaultBaseUrl(3600)).toBe("http://localhost:3600");
    expect(defaultBaseUrl(8080)).toBe("http://localhost:8080");
    expect(effectiveBaseUrl({ base_url: "", default_port: 3600 })).toBe("http://localhost:3600");
    expect(effectiveBaseUrl(undefined)).toBe(PORT_DISABLED_LABEL);
  });

  it("浏览器 host 取当前页面 host（window 存在时）", () => {
    const scope = globalThis as unknown as { window?: { location: { hostname: string } } };
    scope.window = { location: { hostname: "console.example.com" } };
    try {
      expect(defaultBaseUrl(3600)).toBe("http://console.example.com:3600");
    } finally {
      delete scope.window;
    }
  });

  it("契约端口为 0/缺失时显示未启用，绝不生成 host:0", () => {
    const address = effectiveBaseUrl({ base_url: "", default_port: 0 });
    expect(address).toBe(PORT_DISABLED_LABEL);
    expect(address.includes(":0")).toBe(false);
  });

  it("isDataPlaneEnabled 与地址展示同口径", () => {
    expect(isDataPlaneEnabled({ base_url: "https://gw.example.com", default_port: 0 })).toBe(true);
    expect(isDataPlaneEnabled({ base_url: "", default_port: 3600 })).toBe(true);
    expect(isDataPlaneEnabled({ base_url: "", default_port: 0 })).toBe(false);
    expect(isDataPlaneEnabled(undefined)).toBe(false);
  });
});
