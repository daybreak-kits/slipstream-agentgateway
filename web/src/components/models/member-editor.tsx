import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { type MemberDraft, nextPriority } from "@/components/models/member-drafts";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { apiList, ENDPOINTS } from "@/lib/api";
import { ACTION_ICONS } from "@/lib/icons";
import type { RoutingMode, Upstream, UpstreamModel } from "@/types";

/** 成员行的展示名：上游模型名 · 所属上游；列表缺失时回退到服务端 join 名或 id。 */
function memberLabel(
  member: MemberDraft,
  upstreamModels: UpstreamModel[],
  fallbackNames: Map<string, string>,
): string {
  const model = upstreamModels.find((m) => m.id === member.upstream_model_id);
  if (model) return model.name + (model.upstream_name ? " · " + model.upstream_name : "");
  return fallbackNames.get(member.upstream_model_id) ?? member.upstream_model_id;
}

/** 上游列表（复用页面级 ["upstreams"] 缓存）：key_count 是 E20 提示的判断依据。 */
function useUpstreams(): Upstream[] {
  const query = useQuery({ queryKey: ["upstreams"], queryFn: () => apiList<Upstream>(ENDPOINTS.upstreams) });
  return query.data?.items ?? [];
}

/**
 * E20（P0-RESULTS §E20）：conditional 模式 × 成员引用的上游配了多把密钥 →
 * AG conditional targets first-match 首条独占，密钥平权与密钥级容错不生效，
 * 渲染时每目标只使用第一把密钥。key_count 缺失（旧载荷）时按未知处理，不误报。
 */
function conditionalMultiKeyHint(
  members: MemberDraft[],
  upstreamModels: UpstreamModel[],
  upstreams: Upstream[],
): string | null {
  const multiKey = members.some((member) => {
    const model = upstreamModels.find((m) => m.id === member.upstream_model_id);
    const upstream = upstreams.find((u) => u.id === model?.upstream_id);
    return (upstream?.key_count ?? 0) > 1;
  });
  return multiKey
    ? "conditional 模式下密钥平权与密钥级容错不生效（E20），每目标仅使用第一把密钥"
    : null;
}

function memberInputs(
  member: MemberDraft,
  index: number,
  mode: RoutingMode,
  update: (index: number, patch: Partial<MemberDraft>) => void,
): React.ReactNode {
  return (
    <>
      <Input className="col-span-2" inputMode="numeric" placeholder="priority" value={member.priority} onChange={(e) => update(index, { priority: e.target.value })} />
      <Input className="col-span-2" inputMode="numeric" placeholder="weight" value={member.weight} disabled={mode !== "weighted"} onChange={(e) => update(index, { weight: e.target.value })} />
      <Input className="col-span-3" placeholder="when 条件" value={member.when} disabled={mode !== "conditional"} onChange={(e) => update(index, { when: e.target.value })} />
    </>
  );
}

/** 紧凑成员编排（创建公开模型的弹窗内用）：下拉挑选 + 行内调 priority/weight/when。 */
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
          options={available.map((m) => ({
            value: m.id,
            label: m.name + (m.upstream_name ? " · " + m.upstream_name : ""),
          }))}
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
            <span className="col-span-4 truncate text-2sm text-body">
              {memberLabel(member, upstreamModels, new Map())}
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

/**
 * 双栏成员编排（整页编辑器 Tab2，W4-C 用户定案）：
 * 左 = 现有成员（行内调 priority/weight/when，删除移除）；右 = 全部可选上游模型
 * （搜索过滤、点击加入、已加入高亮/再点移除）。保存由页面底部「保存成员」整批提交。
 */
export function MemberBoard({
  members, upstreamModels, fallbackNames, mode, onChange,
}: {
  members: MemberDraft[];
  upstreamModels: UpstreamModel[];
  /** 服务端 targets 的 id → 名称兜底（上游模型列表不含已被删除的引用行时仍可显示）。 */
  fallbackNames: Map<string, string>;
  mode: RoutingMode;
  onChange: (next: MemberDraft[]) => void;
}) {
  const [needle, setNeedle] = useState("");
  const upstreams = useUpstreams();
  const e20Hint = useMemo(
    () => conditionalMultiKeyHint(members, upstreamModels, upstreams),
    [members, upstreamModels, upstreams],
  );
  const update = (index: number, patch: Partial<MemberDraft>) => {
    onChange(members.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  };
  const add = (modelId: string) => {
    if (members.some((member) => member.upstream_model_id === modelId)) return;
    onChange([...members, { upstream_model_id: modelId, priority: String(nextPriority(members)), weight: "", when: "" }]);
  };
  const remove = (modelId: string) => {
    onChange(members.filter((member) => member.upstream_model_id !== modelId));
  };
  const keyword = needle.trim().toLowerCase();
  const candidates = useMemo(
    () => upstreamModels.filter((m) =>
      keyword === "" ||
      m.name.toLowerCase().includes(keyword) ||
      (m.upstream_name ?? "").toLowerCase().includes(keyword),
    ),
    [upstreamModels, keyword],
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-2sm font-medium text-title">现有成员（{members.length}）</h3>
          <span className="text-2xs text-faint">排序即优先级：priority 数值小优先</span>
        </div>
        <div className="max-h-96 space-y-2 overflow-auto rounded-md border border-border bg-surface p-2">
          {members.map((member, index) => (
            <div key={member.upstream_model_id + ":" + index} className="grid grid-cols-12 items-center gap-1 rounded-md border border-border p-2">
              <span className="col-span-4 truncate text-2sm text-body" title={memberLabel(member, upstreamModels, fallbackNames)}>
                {memberLabel(member, upstreamModels, fallbackNames)}
              </span>
              {memberInputs(member, index, mode, update)}
              <Button
                variant="ghost"
                size="sm"
                className="col-span-1 text-danger-text"
                title="从成员中移除"
                onClick={() => remove(member.upstream_model_id)}
              >
                <ACTION_ICONS.clear className="h-3.5 w-3.5" /> 移除
              </Button>
            </div>
          ))}
          {members.length === 0 ? <p className="p-2 text-2xs text-faint">暂无成员；从右侧选择上游模型加入。</p> : null}
        </div>
        {e20Hint ? <p className="text-2xs text-warning-text">{e20Hint}</p> : null}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-2sm font-medium text-title">全部上游模型（{candidates.length}）</h3>
          <Input
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder="搜索过滤"
            aria-label="搜索上游模型"
            className="h-8 w-44"
          />
        </div>
        <div className="max-h-96 space-y-1 overflow-auto rounded-md border border-border bg-surface p-2">
          {candidates.map((model) => {
            const joined = members.some((member) => member.upstream_model_id === model.id);
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => (joined ? remove(model.id) : add(model.id))}
                className={
                  "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-2sm transition-colors " +
                  (joined
                    ? "bg-primary-soft text-primary-text"
                    : "text-body hover:bg-surface-2")
                }
              >
                <span className="min-w-0 flex-1 truncate font-mono" title={model.name}>{model.name}</span>
                <span className="shrink-0 text-2xs text-faint">{model.upstream_name ?? ""}</span>
                {joined ? (
                  <span className="shrink-0 text-2xs text-primary-text">已加入，点击移除</span>
                ) : (
                  <ACTION_ICONS.add className="h-3.5 w-3.5 shrink-0 text-faint" />
                )}
              </button>
            );
          })}
          {candidates.length === 0 ? <p className="p-2 text-2xs text-faint">没有匹配的上游模型。</p> : null}
        </div>
      </div>
    </div>
  );
}
