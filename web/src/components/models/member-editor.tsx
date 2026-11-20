import { useMemo, useState } from "react";

import { conditionalMultiKeyHint, memberChipLabel } from "@/components/models/member-chip";
import { type MemberDraft, nextPriority } from "@/components/models/member-drafts";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ACTION_ICONS } from "@/lib/icons";
import { useUpstreams } from "@/lib/use-upstreams";
import type { RoutingMode, UpstreamModel } from "@/types";

function memberInputs(
  member: MemberDraft,
  index: number,
  mode: RoutingMode,
  update: (index: number, patch: Partial<MemberDraft>) => void,
): React.ReactNode {
  return (
    <>
      <Input
        className="col-span-2"
        aria-label="priority"
        inputMode="numeric"
        placeholder="priority"
        value={member.priority}
        onChange={(e) => update(index, { priority: e.target.value })}
      />
      <Input
        className="col-span-2"
        aria-label="weight"
        inputMode="numeric"
        placeholder="weight"
        value={member.weight}
        disabled={mode !== "weighted"}
        onChange={(e) => update(index, { weight: e.target.value })}
      />
      <Input
        className="col-span-3"
        aria-label="when"
        placeholder="when 条件"
        value={member.when}
        disabled={mode !== "conditional"}
        onChange={(e) => update(index, { when: e.target.value })}
      />
    </>
  );
}

/**
 * 紧凑成员编排（创建公开模型的弹窗内用）：下拉挑选 + 行内调 priority/weight/when。
 * 成员展示名与整页 chip 流一致，统一为「上游渠道/模型」（ticket 14）。
 */
export function MemberEditor({
  members, upstreamModels, mode, onChange,
}: {
  members: MemberDraft[]; upstreamModels: UpstreamModel[]; mode: RoutingMode;
  onChange: (next: MemberDraft[]) => void;
}) {
  const [pick, setPick] = useState("");
  const upstreams = useUpstreams();
  const e20Hint = useMemo(
    () => conditionalMultiKeyHint(members, upstreamModels, upstreams),
    [members, upstreamModels, upstreams],
  );
  const labelOf = (modelId: string) => {
    const model = upstreamModels.find((item) => item.id === modelId);
    return model ? memberChipLabel(model.upstream_name, model.name) : modelId;
  };
  const available = upstreamModels.filter((m) => !members.some((member) => member.upstream_model_id === m.id));
  const update = (index: number, patch: Partial<MemberDraft>) => {
    onChange(members.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Combobox
          className="max-w-64"
          placeholder="选择上游模型加入成员"
          searchPlaceholder="搜索上游模型名称或标识"
          value={pick}
          options={available.map((m) => ({ value: m.id, label: labelOf(m.id) }))}
          onChange={setPick}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={pick === ""}
          onClick={() => {
            onChange([...members, { upstream_model_id: pick, priority: String(nextPriority(members)), weight: "", when: "" }]);
            setPick("");
          }}
        >
          <ACTION_ICONS.add className="h-3.5 w-3.5" /> 添加成员
        </Button>
        <span className="text-2xs text-faint">priority 数值小优先；weighted 用 weight 整数比例。</span>
      </div>
      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {members.map((member, index) => (
          <div key={member.upstream_model_id + ":" + index} className="grid grid-cols-12 items-center gap-1 rounded-md border border-border p-2">
            <span className="col-span-4 truncate text-2sm text-body" title={labelOf(member.upstream_model_id)}>
              {labelOf(member.upstream_model_id)}
            </span>
            {memberInputs(member, index, mode, update)}
            <Button variant="ghost" size="sm" className="col-span-1 text-danger-text" onClick={() => onChange(members.filter((_, i) => i !== index))}>
              <ACTION_ICONS.clear className="h-3.5 w-3.5" /> 移除
            </Button>
          </div>
        ))}
        {members.length === 0 ? <p className="text-2xs text-faint">暂无成员；创建公开模型时至少需要一个成员才能路由。</p> : null}
      </div>
      {e20Hint ? <p className="text-2xs text-warning-text">{e20Hint}</p> : null}
    </div>
  );
}
