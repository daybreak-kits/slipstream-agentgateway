import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { SectionCard } from "@/components/governance/panel";
import { PageHeader } from "@/components/layout/page-header";
import { availabilityText, availabilityTone } from "@/components/models/availability";
import { Field } from "@/components/models/field";
import { type MemberDraft, validateMembers } from "@/components/models/member-drafts";
import { MemberBoard } from "@/components/models/member-editor";
import { ROUTING_LABELS, toInt } from "@/components/models/model-vocab";
import {
  PERMISSION_SCOPE,
  validateForm,
  type PublicModelForm,
} from "@/components/models/public-model-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DirtyCountBadge, DirtyField, DirtyFooter, DirtySaveButton } from "@/components/ui/dirty-field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatDateTime, useTimezone } from "@/lib/time";
import type { DirtyFieldsState } from "@/lib/use-dirty-fields";
import type { PublicModel, RoutingMode, UpstreamModel } from "@/types";

/**
 * 公开模型单页编辑器的展示层（ticket 13）：一页三段（基本信息 / 成员编排 /
 * 只读摘要），页头 h1 + 状态 + 脏标记，底部只有一个「保存」。
 *
 * 容器（public-model-editor.tsx）负责取数、草稿与单 PATCH 提交；这里只接收
 * props 渲染用户能看到的 DOM，SSR 门禁（check-semantic-dirty.mjs 第 8 段）直接
 * 断言这份 DOM，不进入组件内部状态。成员 chip 流归 ticket 14，本票仍复用
 * MemberBoard 的成员编辑能力，保存语义不受影响。
 */
export interface PublicModelPageViewProps {
  model: PublicModel;
  form: PublicModelForm;
  upstreamModels: UpstreamModel[];
  /** 服务端 targets 的 id → 名称兜底（上游模型列表不含已被删除的引用行时仍可显示）。 */
  fallbackNames: Map<string, string>;
  dirty: DirtyFieldsState<PublicModelForm>;
  saving: boolean;
  saveError: string | null;
  missingPermissions: string[];
  onFormChange: (patch: Partial<PublicModelForm>) => void;
  onMembersChange: (members: MemberDraft[]) => void;
  onResetField: (field: keyof PublicModelForm) => void;
  onResetAll: () => void;
  onSave: () => void;
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-1.5 last:border-b-0">
      <span className="w-20 shrink-0 text-2xs text-faint">{label}</span>
      <div className="min-w-0 flex-1 text-2sm text-body">{children}</div>
    </div>
  );
}

/** 成员展示名：上游模型名 · 所属上游；列表缺失时回退到服务端 join 名或 id。 */
function memberLabel(
  member: MemberDraft,
  upstreamModels: UpstreamModel[],
  fallbackNames: Map<string, string>,
): string {
  const model = upstreamModels.find((item) => item.id === member.upstream_model_id);
  if (model) return model.name + (model.upstream_name ? " · " + model.upstream_name : "");
  return fallbackNames.get(member.upstream_model_id) ?? member.upstream_model_id;
}

/** conditional 末位兜底成员：按 priority 排序后的最后一位，且 when 留空。 */
function conditionalFallbackOf(form: PublicModelForm): MemberDraft | null {
  if (form.routing_mode !== "conditional" || form.members.length === 0) return null;
  const sorted = [...form.members].sort((left, right) => toInt(left.priority) - toInt(right.priority));
  const last = sorted[sorted.length - 1];
  return last !== undefined && last.when.trim() === "" ? last : null;
}

export function PublicModelPageView({
  model,
  form,
  upstreamModels,
  fallbackNames,
  dirty,
  saving,
  saveError,
  missingPermissions,
  onFormChange,
  onMembersChange,
  onResetField,
  onResetAll,
  onSave,
}: PublicModelPageViewProps) {
  const { mode } = useTimezone();
  const routing = ROUTING_LABELS[form.routing_mode];
  const formErrors = validateForm(form);
  const memberErrors = validateMembers(form.members, form.routing_mode);
  const readOnly = missingPermissions.length > 0;
  const controlsDisabled = readOnly || saving;

  // 页头状态按草稿预览：启停开关一动，徽章立即反映保存后的状态。
  const statusRow = {
    enabled: form.enabled,
    cooldown_until_ms: model.cooldown_until_ms,
    availability: model.availability,
  };
  const statusText = availabilityText(statusRow);
  const statusTone = availabilityTone(statusRow);

  const fallback = conditionalFallbackOf(form);
  const fallbackLabel =
    fallback === null ? null : memberLabel(fallback, upstreamModels, fallbackNames);
  const layerPriorities = Array.from(
    new Set(form.members.map((member) => toInt(member.priority))),
  ).sort((left, right) => left - right);

  const blockedReasons: string[] = [];
  if (readOnly) blockedReasons.push("缺少权限，无法保存");
  if (formErrors.length > 0) blockedReasons.push("有 " + formErrors.length + " 处校验未通过，无法保存");

  return (
    <div className="space-y-3" data-slot="public-model-page">
      <Link
        to="/models?tab=public"
        className="inline-flex items-center gap-1 text-2sm text-primary-text hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> 返回模型管理
      </Link>

      <PageHeader
        title={form.name.trim() || model.name}
        description="公开模型 · 一次保存提交基本信息、策略、启用与成员；服务端单事务，失败整页回滚。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">{routing.label}</Badge>
            <Badge tone={statusTone}>{statusText}</Badge>
            <DirtyCountBadge count={dirty.dirtyCount} />
          </div>
        }
      />

      {readOnly ? (
        <Alert variant="warning" data-slot="permission-alert">
          <div className="space-y-1">
            <div className="font-medium">缺少权限，页面只读</div>
            {missingPermissions.map((permission) => (
              <div key={permission} className="text-2sm">
                <span className="font-mono">{permission}</span>：不能修改
                {PERMISSION_SCOPE[permission as keyof typeof PERMISSION_SCOPE] ?? "该配置"}
              </div>
            ))}
          </div>
        </Alert>
      ) : null}

      {saveError !== null ? (
        <Alert variant="destructive" data-slot="save-error">
          <div className="space-y-1">
            <div className="font-medium">保存失败，修改已保留</div>
            <div className="text-2sm">{saveError}</div>
          </div>
        </Alert>
      ) : null}

      <SectionCard title="基本信息" description="名称、策略、备注与启用；与成员一起在同一个事务里提交。">
        <fieldset disabled={controlsDisabled} className="m-0 min-w-0 space-y-3 border-0 p-0">
          <DirtyField dirty={dirty.isDirtyField("name")} onReset={() => onResetField("name")} resetLabel="恢复名称">
            <Field label="名称" hint="用户请求时使用的模型名">
              <Input
                value={form.name}
                onChange={(event) => onFormChange({ name: event.target.value })}
                placeholder="如 glm-5.3"
              />
            </Field>
          </DirtyField>

          <DirtyField
            dirty={dirty.isDirtyField("routing_mode")}
            onReset={() => onResetField("routing_mode")}
            resetLabel="恢复策略"
          >
            <Field label="策略" hint={routing.desc}>
              <RadioGroup
                value={form.routing_mode}
                onValueChange={(value) => onFormChange({ routing_mode: value as RoutingMode })}
                className="gap-2"
              >
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
          </DirtyField>

          <DirtyField dirty={dirty.isDirtyField("note")} onReset={() => onResetField("note")} resetLabel="恢复备注">
            <Field label="备注">
              <Input
                value={form.note}
                onChange={(event) => onFormChange({ note: event.target.value })}
                placeholder="选填"
              />
            </Field>
          </DirtyField>

          <DirtyField
            dirty={dirty.isDirtyField("enabled")}
            onReset={() => onResetField("enabled")}
            resetLabel="恢复启用状态"
          >
            <label className="flex items-center gap-2 text-2sm text-body">
              <Checkbox
                checked={form.enabled}
                onCheckedChange={(checked) => onFormChange({ enabled: checked === true })}
              />
              启用
            </label>
            <p className="text-2xs text-faint">
              公开模型只有启用/关闭；可用性措施（冷却）挂在上游模型，不在此页（ADR-025）。
            </p>
          </DirtyField>
        </fieldset>
      </SectionCard>

      <SectionCard title="成员编排" description="保存时按 priority 整批替换；priority 数值小优先。">
        <div className="space-y-3">
          <p className="text-2xs text-faint" data-slot="member-rules">
            规则：至少保留 1 个成员；成员不可重复；conditional 模式只有末位成员可以留空 when（兜底）。
          </p>
          <fieldset disabled={controlsDisabled} className="m-0 min-w-0 border-0 p-0">
            <MemberBoard
              members={form.members}
              upstreamModels={upstreamModels}
              fallbackNames={fallbackNames}
              mode={form.routing_mode}
              onChange={onMembersChange}
            />
          </fieldset>
          {fallbackLabel !== null ? (
            <p className="text-2xs text-info-text" data-slot="conditional-fallback">
              条件路由末位兜底：{fallbackLabel}（when 留空，前面成员都不命中时使用）
            </p>
          ) : null}
          {memberErrors.length > 0 ? (
            <ul className="space-y-0.5 text-2xs text-danger-text" data-slot="member-errors">
              {memberErrors.map((error) => (
                <li key={error}>● {error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="只读摘要" description="按当前草稿计算的渲染语义；保存后生效。">
        <div className="min-w-0" data-slot="public-model-summary">
          <SummaryRow label="模型 ID">
            <span className="break-all font-mono text-2xs">{model.id}</span>
          </SummaryRow>
          <SummaryRow label="渲染策略">
            <div className="font-medium">{routing.label}</div>
            <div className="text-2xs text-faint">{routing.desc}</div>
          </SummaryRow>
          <SummaryRow label="成员构成">
            {form.members.length} 个成员
            {form.members.length > 0
              ? " · " + layerPriorities.length + " 个 priority 层（" + layerPriorities.join(" / ") + "）"
              : ""}
            {form.routing_mode === "failover" ? "；按 priority 数值小优先逐层尝试" : null}
          </SummaryRow>
          {form.routing_mode === "conditional" ? (
            <SummaryRow label="末位兜底">
              {fallbackLabel !== null ? fallbackLabel + "（when 留空）" : "缺少兜底：末位成员必须留空 when"}
            </SummaryRow>
          ) : null}
          <SummaryRow label="启用状态">
            {statusText}。公开模型只支持启用/关闭；可用性措施（冷却）挂在上游模型（ADR-025）。
          </SummaryRow>
          <SummaryRow label="创建时间">{formatDateTime(model.created_at_ms, mode)}</SummaryRow>
        </div>
      </SectionCard>

      <DirtyFooter count={dirty.dirtyCount} onResetAll={onResetAll} saving={saving}>
        {blockedReasons.length > 0 ? (
          <span className="text-2xs text-danger-text" data-slot="save-blocked">
            {blockedReasons.join("；")}
          </span>
        ) : null}
        <DirtySaveButton
          dirty={dirty.isDirty}
          pending={saving}
          disabled={controlsDisabled || formErrors.length > 0}
          onClick={onSave}
        >
          保存
        </DirtySaveButton>
      </DirtyFooter>
    </div>
  );
}
