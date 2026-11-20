/** 模型探测的展示组件：结果徽章（语义色 + 延迟 + 脱敏错误行）与运行中进度。
 *  纯逻辑/会话状态在 model-probe.ts，本文件只放组件，保证 react-refresh 可用。 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ACTION_ICONS } from "@/lib/icons";
import { probeResultView, probeSummary, type ModelProbeItem, type ModelProbeSession } from "./model-probe";

/** 会话内单项结果：成功绿/失败红/超时琥珀 + 延迟 + 脱敏错误行。 */
export function ModelProbeBadge({ item }: { item: ModelProbeItem }) {
  const view = probeResultView(item);
  const detailTone =
    view.tone === "danger" ? "text-danger-text" : view.tone === "warning" ? "text-warning-text" : "text-faint";
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-probe-tone={view.tone}>
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone={view.tone}>{view.label}</Badge>
        {view.latencyText !== "" ? <span className="tnum text-2xs text-body">{view.latencyText}</span> : null}
        {item.status > 0 ? <span className="tnum text-2xs text-faint">HTTP {item.status}</span> : null}
      </span>
      {view.detail !== "" ? (
        <span className={"max-w-56 truncate text-2xs " + detailTone} title={view.detail}>
          {view.detail}
        </span>
      ) : null}
    </div>
  );
}

/** 运行中进度：N/M + 进度条 + 取消入口。 */
export function ModelProbeProgress({ session, onCancel }: { session: ModelProbeSession; onCancel: () => void }) {
  if (!session.running) return null;
  const summary = probeSummary(session);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-2xs text-body">
        测试中 <span className="tnum font-medium text-title">{session.done + "/" + session.total}</span>
      </span>
      <span
        role="progressbar"
        aria-label="模型探测进度"
        aria-valuemin={0}
        aria-valuemax={session.total}
        aria-valuenow={session.done}
        className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2"
      >
        <span className="block h-full rounded-full bg-info transition-[width]" style={{ width: summary.percent + "%" }} />
      </span>
      <Button variant="ghost" size="dense" onClick={onCancel}>
        <ACTION_ICONS.clear className="h-3.5 w-3.5" aria-hidden="true" /> 取消测试
      </Button>
    </span>
  );
}
