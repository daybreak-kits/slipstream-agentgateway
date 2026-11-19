import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/models/field";
import { MemberBoard } from "@/components/models/member-editor";
import { type MemberDraft, memberDraftsOf, targetsPayload, validateMembers } from "@/components/models/member-drafts";
import { ROUTING_LABELS } from "@/components/models/model-vocab";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { availabilityText, availabilityTone } from "@/components/models/availability";
import type { PublicModel, RoutingMode, UpstreamModel } from "@/types";

/**
 * 公开模型整页编辑器（W4-C，路由 /models/public/:id；编辑+成员合并入口，ADR-025）。
 * Tab1 基本信息+策略；Tab2 双栏成员编排（保存 = 整批替换，现有 PUT 语义不变）。
 * 未保存改动按现行弹窗草稿处理（离开即丢，改写守卫归 G 波）。
 */
export function PublicModelEditor({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["public-models"],
    queryFn: () => apiList<PublicModel>(ENDPOINTS.publicModels),
    refetchInterval: 30_000,
  });
  const qModels = useQuery({ queryKey: ["upstream-models"], queryFn: () => apiList<UpstreamModel>(ENDPOINTS.upstreamModels) });
  const model = useMemo(() => (q.data?.items ?? []).find((row) => row.id === id) ?? null, [q.data, id]);
  const upstreamModels = qModels.data?.items ?? [];

  const [form, setForm] = useState({
    name: "",
    routing_mode: "failover" as RoutingMode,
    note: "",
    enabled: true,
  });
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [hydratedId, setHydratedId] = useState("");

  // 首次载入（或路由换到另一行）时以服务端行为准重置草稿；保存后的 refetch 不回灌，避免覆盖编辑中内容。
  useEffect(() => {
    if (model && model.id !== hydratedId) {
      setForm({
        name: model.name,
        routing_mode: model.routing_mode,
        note: model.note ?? "",
        enabled: model.enabled,
      });
      setMembers(memberDraftsOf(model));
      setHydratedId(model.id);
    }
  }, [model, hydratedId]);

  // 服务端 targets 的 id → 名称兜底：上游模型列表不含已被删除的引用行时仍可显示。
  const fallbackNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of model?.targets ?? []) {
      if (target.upstream_model_id) map.set(target.upstream_model_id, target.upstream_model_name);
    }
    return map;
  }, [model]);

  const memberErrors = validateMembers(members, form.routing_mode);

  const saveBasic = useMutation({
    mutationFn: () =>
      api.patch<PublicModel>(ENDPOINTS.publicModelUpdate(id), {
        name: form.name.trim(),
        routing_mode: form.routing_mode,
        note: form.note.trim(),
        enabled: form.enabled,
      }),
    onSuccess: () => {
      toast.success("公开模型已更新");
      void qc.invalidateQueries({ queryKey: ["public-models"] });
    },
    onError: (e: Error) => toast.error("保存失败", { description: e.message }),
  });
  const saveMembers = useMutation({
    mutationFn: () => api.put(ENDPOINTS.publicModelTargets(id), { targets: targetsPayload(members) }),
    onSuccess: () => {
      toast.success("成员已保存");
      void qc.invalidateQueries({ queryKey: ["public-models"] });
    },
    onError: (e: Error) => toast.error("保存失败", { description: e.message }),
  });

  if (q.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (model === null) {
    return (
      <div className="space-y-3">
        <Link to="/models?tab=public" className="inline-flex items-center gap-1 text-2sm text-primary-text hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> 返回模型管理
        </Link>
        <p className="text-2sm text-faint">未找到该公开模型，可能已被删除。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/models?tab=public" className="inline-flex items-center gap-1 text-2sm text-primary-text hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> 返回模型管理
        </Link>
        <span className="text-base font-medium text-title">{model.name}</span>
        <Badge tone="primary">{ROUTING_LABELS[form.routing_mode].label}</Badge>
        <Badge tone={availabilityTone(model)}>{availabilityText(model)}</Badge>
        <span className="text-2xs text-faint">保存整页生效；成员保存是整批替换。</span>
      </div>
      <Tabs
        items={[
          {
            key: "basic",
            label: "基本信息",
            content: (
              <div className="max-w-2xl space-y-3">
                <Field label="名称" hint="用户请求时使用的模型名">
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 glm-5.3" />
                </Field>
                <Field label="策略" hint="strategy 与 priority/weight 的渲染语义一致；旧系统 priority 已翻转为数值小优先">
                  <RadioGroup value={form.routing_mode} onValueChange={(v) => setForm({ ...form, routing_mode: v as RoutingMode })} className="gap-2">
                    {(Object.keys(ROUTING_LABELS) as RoutingMode[]).map((mode) => (
                      <label key={mode} className="flex items-start gap-2 rounded-md border border-border p-2 text-2sm">
                        <RadioGroupItem value={mode} className="mt-0.5" />
                        <span>
                          <span className="font-medium text-body">{ROUTING_LABELS[mode].label}</span>
                          <span className="block text-2xs text-faint">{ROUTING_LABELS[mode].desc}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </Field>
                <Field label="备注">
                  <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="选填" />
                </Field>
                <label className="flex items-center gap-2 text-2sm text-body">
                  <Checkbox checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked === true })} />
                  启用
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    disabled={saveBasic.isPending || form.name.trim() === ""}
                    onClick={() => saveBasic.mutate()}
                  >
                    {saveBasic.isPending ? "保存中…" : "保存基本信息"}
                  </Button>
                </div>
              </div>
            ),
          },
          {
            key: "members",
            label: "成员编排",
            content: (
              <div className="space-y-3">
                <p className="text-2xs text-faint">{ROUTING_LABELS[form.routing_mode].desc}。保存是整批替换；后端按 priority 升序校验，被引用的上游模型不能删除。</p>
                <MemberBoard
                  members={members}
                  upstreamModels={upstreamModels}
                  fallbackNames={fallbackNames}
                  mode={form.routing_mode}
                  onChange={setMembers}
                />
                {memberErrors.length > 0 ? <p className="text-2xs text-danger-text">{memberErrors.join("；")}</p> : null}
                <Button disabled={saveMembers.isPending || memberErrors.length > 0} onClick={() => saveMembers.mutate()}>
                  {saveMembers.isPending ? "保存中…" : "保存成员"}
                </Button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
