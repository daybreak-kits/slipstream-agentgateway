import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "@/lib/notify";

import { EmptyState, ErrorState } from "@/components/governance/panel";
import { PageHeader } from "@/components/layout/page-header";
import { PublicModelPageView } from "@/components/models/public-model-page";
import {
  changedMemberCount,
  EMPTY_PUBLIC_MODEL_FORM,
  formOf,
  missingPermissions,
  normalizeForm,
  patchPayloadOf,
  sameMemberDrafts,
  type PublicModelForm,
} from "@/components/models/public-model-form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { controlPlane } from "@/lib/control-plane";
import { usePermissions } from "@/lib/permissions";
import { useDirtyFields } from "@/lib/use-dirty-fields";
import { useDirtyGuard } from "@/lib/use-dirty-guard";

/**
 * 公开模型单页编辑器（ticket 13，路由 /models/public/:id）。
 *
 * W4-C 的两个 Tab（基本信息 / 成员编排）与两个保存按钮合并为一页三段：
 * 页头 h1 + 状态 + 脏标记，底部唯一「保存」。一次保存只发一个
 * PATCH /admin/public-models/{id}（含 targets 整批替换），服务端在同一事务里
 * 提交基本字段、策略、启用与成员——不会出现基本信息已改、成员未改的半成功
 * （ticket 12 契约）。成员编排是 ticket 14 的分层 chip 流（MemberChipFlow），
 * 保存语义不变：草稿里的 members 与其他字段一起进入同一个 PATCH。
 */
export function PublicModelEditor({ id }: { id: string }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const q = useQuery({
    queryKey: ["public-models"],
    queryFn: () => controlPlane.models.listPublicModels(),
    refetchInterval: 30_000,
  });
  // 成员候选需要全量上游模型：列表端点分页档位 25/50/100/200（默认 50），
  // 这里取最大档 200（与 upstream-model-drawer 兑入同一口径）；键加 editor 段避免
  // 改变表格/全局搜索等共用键的取数行为，前缀失效（["upstream-models"]）仍然命中。
  const qModels = useQuery({
    queryKey: ["upstream-models", "editor"],
    queryFn: () => controlPlane.models.listUpstreamModels({ pageSize: 200 }),
  });
  const model = useMemo(() => (q.data ?? []).find((row) => row.id === id) ?? null, [q.data, id]);
  const upstreamModels = qModels.data ?? [];

  const [form, setForm] = useState<PublicModelForm>(EMPTY_PUBLIC_MODEL_FORM);
  // baseline = 上一次保存成功（或首次载入）时的整页快照：保存成功回填后脏标记清零，
  // 保存失败不换 baseline——用户输入与未保存标记都会保留。
  const [baseline, setBaseline] = useState<PublicModelForm | null>(null);
  const [hydratedId, setHydratedId] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // 首次载入（或路由换到另一行）时以服务端行为准重置草稿；保存后的 refetch 不回灌，
  // 避免覆盖正在编辑的内容。
  useEffect(() => {
    if (model && model.id !== hydratedId) {
      const next = formOf(model);
      setForm(next);
      setBaseline(next);
      setSaveError(null);
      setHydratedId(model.id);
    }
  }, [model, hydratedId]);

  const dirty = useDirtyFields(baseline, form, { equals: { members: sameMemberDrafts } });
  // W9：成员差异条数放在页头公开模型名旁（成员是整页最容易改乱的一段）。
  const memberDiffCount = useMemo(
    () => changedMemberCount(baseline?.members, form.members),
    [baseline, form.members],
  );
  const permissionGaps = missingPermissions(can);

  // 服务端 targets 的 id → 名称兜底：上游模型列表不含已被删除的引用行时仍可显示。
  const fallbackNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of model?.targets ?? []) {
      if (target.upstream_model_id) map.set(target.upstream_model_id, target.upstream_model_name);
    }
    return map;
  }, [model]);

  // 单 PATCH 提交整页：基本字段 + 策略 + 启用 + 成员整批替换，服务端单事务提交。
  const save = useMutation({
    mutationFn: () => controlPlane.models.updatePublicModel(id, patchPayloadOf(form)),
    onSuccess: () => {
      const saved = normalizeForm(form);
      setForm(saved);
      setBaseline(saved);
      setSaveError(null);
      toast.success("公开模型已保存");
      void qc.invalidateQueries({ queryKey: ["public-models"] });
    },
    onError: (error: Error) => {
      // 不清 form/baseline：失败后保留用户输入与脏标记，可直接修正后重试。
      setSaveError(error.message);
      toast.error("保存失败", { description: "修改已保留，可修正后重试" });
    },
  });

  const leaveGuard = useDirtyGuard(dirty.isDirty);

  const resetField = (field: keyof PublicModelForm) => {
    if (!baseline) return;
    setForm((previous) => {
      switch (field) {
        case "name":
          return { ...previous, name: baseline.name };
        case "routing_mode":
          return { ...previous, routing_mode: baseline.routing_mode };
        case "note":
          return { ...previous, note: baseline.note };
        case "enabled":
          return { ...previous, enabled: baseline.enabled };
        case "members":
          return { ...previous, members: baseline.members };
      }
    });
  };

  if (q.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="space-y-3">
        <PageHeader title="编辑公开模型" description="公开模型列表加载失败；已保存的数据不受影响。" />
        <ErrorState
          description={q.error.message}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
        <Link
          to="/models?tab=public"
          className="inline-flex items-center gap-1 text-2sm text-primary-text hover:underline"
        >
          返回模型管理
        </Link>
      </div>
    );
  }

  if (model === null) {
    return (
      <div className="space-y-3">
        <PageHeader title="公开模型不存在" description="该公开模型可能已被删除；从模型管理重新选择。" />
        <EmptyState
          title="未找到该公开模型"
          description="它可能已被删除，或链接里的编号无效。"
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/models?tab=public">返回模型管理</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <>
      <PublicModelPageView
        model={model}
        form={form}
        upstreamModels={upstreamModels}
        fallbackNames={fallbackNames}
        dirty={dirty}
        memberDiffCount={memberDiffCount}
        saving={save.isPending}
        saveError={saveError}
        missingPermissions={permissionGaps}
        onFormChange={(patch) => setForm((previous) => ({ ...previous, ...patch }))}
        onMembersChange={(members) => setForm((previous) => ({ ...previous, members }))}
        onResetField={resetField}
        onResetAll={() => {
          if (baseline) setForm(baseline);
        }}
        onSave={() => save.mutate()}
      />
      {leaveGuard}
    </>
  );
}
