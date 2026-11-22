import { controlPlane } from "./control-plane";
import { pushNotification } from "./notification-store";

export type { SystemStatus, SystemStatusNotice } from "./control-plane/operations/system";

/**
 * 每日状态提醒进通知中心（W6 票08）：后端每日任务做配置 hash 与前后端版本
 * 两项检查，不一致时在这里把提醒落进通知中心——只进中心不弹 toast（story 23，
 * 不打断操作）。
 *
 * 去重分两层：后端任务侧按问题 24 小时窗口去重（app_settings 持久化，重启不
 * 失效）；这里按提醒的 notified_at_ms 去重——同一条提醒只推一次，本地记录也
 * 持久化，页面刷新/重新登录不会把同一条提醒再灌一遍。恢复后后端产生新提醒
 * （新的 notified_at_ms），自然再次推送。
 */

/** 已推送记录：check -> 最近推送过的 notified_at_ms。 */
const PUSHED_KEY = "slipstream.status_notice.pushed";

/** 会话内缓存：localStorage 不可用时去重仍在本会话内生效。 */
let inMemoryPushed: Record<string, number> | null = null;

function pushedMap(): Record<string, number> {
  if (inMemoryPushed) return inMemoryPushed;
  const empty: Record<string, number> = {};
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(PUSHED_KEY);
    if (!raw) return (inMemoryPushed = empty);
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return (inMemoryPushed = empty);
    }
    const map: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number") map[key] = value;
    }
    return (inMemoryPushed = map);
  } catch {
    return (inMemoryPushed = empty);
  }
}

function savePushed(map: Record<string, number>): void {
  try {
    localStorage.setItem(PUSHED_KEY, JSON.stringify(map));
  } catch {
    // 存储写满/被禁用时只放弃跨会话持久化；会话内去重仍由缓存保证。
  }
}

/** 拉一次系统状态；把未见过的提醒记入通知中心。失败静默（查询失败已由 lib/api 的票07路径去重上报）。 */
export async function pollSystemStatus(): Promise<void> {
  const status = await controlPlane.system.status();
  if (!status.notices?.length) return;
  const pushed = pushedMap();
  let changed = false;
  for (const notice of status.notices) {
    if (pushed[notice.check] === notice.notified_at_ms) continue;
    pushNotification({ kind: "warning", title: notice.title, description: notice.detail });
    pushed[notice.check] = notice.notified_at_ms;
    changed = true;
  }
  if (changed) savePushed(pushed);
}
