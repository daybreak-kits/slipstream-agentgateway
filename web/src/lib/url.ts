/**
 * 统一的 host / scheme / port 展示格式化（W8 票01）。
 *
 * 背景：数据面端口由当前部署的数据面适配器提供（ADR-029）。数据面可能不监听本机
 * 端口，适配器用 0 表示「没有可连的数据面」；控制台绝不能把 0 当成真实端口渲染成
 * host:0，也不能把默认端口（http 80 / https 443）写进用户要复制的连接地址。
 *
 * 本模块是页面里唯一允许拼连接地址的地方：运营设置、连接密钥、快速上手都从这里取
 * 展示结果，避免各页各写一套规则而漂移；登录页不渲染数据面端口（无连接数据可取）。
 */

/** 端口 0/缺失/非法时的统一文案：不是用户的网络问题，而是数据面未启用。 */
export const PORT_DISABLED_LABEL = "未启用（外部数据面）";

/** 端口是否可用：1..65535 的整数；0、负数、缺失、NaN 都表示未启用。 */
export function isPortEnabled(port: number | null | undefined): boolean {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
}

/** 端口展示：有效端口输出数字，未启用输出 {@link PORT_DISABLED_LABEL}。 */
export function formatPort(port: number | null | undefined): string {
  return isPortEnabled(port) ? String(port) : PORT_DISABLED_LABEL;
}

/**
 * 端口来源/未启用说明的文案种类。这些文案曾分散在运营设置、连接密钥、快速上手三处，
 * 含内部架构词；集中到本模块后页面只按语义取文案，不再各自拼装。
 */
export type DataPlanePortCopyKind =
  | "source-default"
  | "source-disabled"
  | "address-default"
  | "address-disabled"
  | "base-url-hint"
  | "port-hint"
  | "reset-note"
  | "example-disabled";

/** 连接地址区唯一的文案出口：产品语言描述端口来源，不出现内部架构词。 */
export function dataPlanePortCopy(
  kind: DataPlanePortCopyKind,
  port?: number | null,
): string {
  switch (kind) {
    case "source-default":
      return "来源：浏览器当前 host + " + formatPort(port) + " 端口（由当前部署提供）";
    case "source-disabled":
      return "来源：当前部署未提供数据面端口";
    case "address-default":
      return "未配置，使用浏览器当前 host + 当前部署提供的端口";
    case "address-disabled":
      return "未配置，当前部署未提供数据面端口";
    case "base-url-hint":
      return "留空 = 自动取浏览器当前 host + 当前部署提供的数据面端口；保存后所有用户共用。必须 http(s) 且带主机名，不能含账号密码/查询参数/锚点。";
    case "port-hint":
      return "数据面端口由当前部署提供；本设置只影响展示给用户的接入地址。";
    case "reset-note":
      return "清空配置即回到「浏览器当前 host + 当前部署提供的端口」；";
    case "example-disabled":
      return PORT_DISABLED_LABEL + "：当前部署未提供数据面端口，配置公网连接地址后可复制完整示例。";
  }
}

/** 结构化连接地址：浏览器 host + 当前部署提供的数据面端口（无 scheme 时按 http）。 */
export interface UrlParts {
  /** http / https；缺省按 http（与历史「浏览器当前 host」口径一致）。 */
  scheme?: string;
  /** 主机名；IPv6 可裸写（::1）或自带方括号（[::1]）。 */
  host: string;
  /** 端口；0/缺失/非法表示数据面未启用，不生成 host:0。 */
  port?: number | null;
}

/** IPv6 裸地址补一次方括号；已带方括号不重复包。 */
function bracketedHost(host: string): string {
  const trimmed = host.trim();
  const bare = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  return bare.includes(":") ? "[" + bare + "]" : bare;
}

/**
 * 连接地址展示：省略 scheme 默认端口（http:80 / https:443）、去掉尾斜杠，
 * IPv6 host 统一带方括号；端口 0/缺失返回 {@link PORT_DISABLED_LABEL}，绝不输出 host:0。
 * 无法解析的字符串原样返回（只去尾斜杠），不臆造主机。
 */
export function formatUrl(input: string | UrlParts): string {
  if (typeof input !== "string") {
    if (!isPortEnabled(input.port)) return PORT_DISABLED_LABEL;
    const scheme = (input.scheme ?? "http").toLowerCase();
    // 先拼成 URL 再复用字符串分支：默认端口、IPv6、尾斜杠规则只维护一份。
    return formatUrl(scheme + "://" + bracketedHost(input.host) + ":" + input.port);
  }
  const raw = input.trim();
  // 无 scheme（含协议相对的 //host）按 http 补全：控制台展示的统一口径是完整 URL。
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "http://" + raw.replace(/^\/+/, "");
  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return raw.replace(/\/+$/, "");
  }
  // URL 会把 :0 当成有效端口保留；控制台口径是「0 = 未启用」，绝不渲染 host:0。
  if (parsed.port === "0") return PORT_DISABLED_LABEL;
  return (
    parsed.protocol +
    "//" +
    parsed.host +
    parsed.pathname.replace(/\/+$/, "") +
    parsed.search +
    parsed.hash
  );
}

/** 连接地址所需的最小事实：不用整个 ConnectionInfo，formatter 只读 host/port 语义。 */
export interface ConnectionAddressFacts {
  /** 运营设置显式配置的公网地址；空串 = 未配置。 */
  base_url?: string | null;
  /** 当前部署提供的数据面端口；0/缺失 = 数据面未启用。 */
  default_port?: number | null;
}

/** 浏览器当前 host；没有 window 时回退 localhost。 */
export function browserHost(): string {
  if (typeof window === "undefined") return "localhost";
  return window.location.hostname || "localhost";
}

/** 浏览器当前页面的 scheme：https 页面沿用 https；没有 window 时回退 http。 */
export function browserScheme(): string {
  if (typeof window === "undefined") return "http";
  return window.location.protocol === "https:" ? "https" : "http";
}

/**
 * 默认连接地址 = 浏览器当前 host + 当前部署提供的数据面端口。
 * scheme 缺省从当前页面推断（https 页面不再降级成 http），也可显式传入以保持纯函数可测；
 * 端口无效时返回未启用文案。
 */
export function defaultBaseUrl(
  port: number | null | undefined,
  scheme: string = browserScheme(),
): string {
  return formatUrl({ scheme, host: browserHost(), port });
}

/** 当前生效的连接地址：显式配置优先，否则回退默认地址（两者都走同一格式化）。 */
export function effectiveBaseUrl(info: ConnectionAddressFacts | undefined): string {
  const configured = info?.base_url?.trim();
  return configured ? formatUrl(configured) : defaultBaseUrl(info?.default_port);
}

/** 数据面地址是否可用：配置了公网地址，或当前部署给了有效端口（与有效地址同口径）。 */
export function isDataPlaneEnabled(info: ConnectionAddressFacts | undefined): boolean {
  const configured = info?.base_url?.trim();
  return configured ? true : isPortEnabled(info?.default_port);
}
