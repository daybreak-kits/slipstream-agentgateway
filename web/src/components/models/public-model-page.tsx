import type { ReactNode } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";

import { SectionCard } from "@/components/governance/panel";
import { availabilityText, availabilityTone } from "@/components/models/availability";
import { Field } from "@/components/models/field";
import { conditionalFallback, memberLabeler } from "@/components/models/member-chip";
import { MemberChipFlow } from "@/components/models/member-chip-flow";
import { type MemberDraft, validateMembers } from "@/components/models/member-drafts";
import { ROUTING_LABELS, toInt } from "@/components/models/model-vocab";
import {
  PERMISSION_SCOPE,
  validateForm,
  type PublicModelForm,
} from "@/components/models/public-model-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DirtyField, DirtySaveButton, DirtySummary } from "@/components/ui/dirty-field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatDateTime, useTimezone } from "@/lib/time";
import type { DirtyFieldsState } from "@/lib/use-dirty-fields";
import type { PublicModel, RoutingMode, UpstreamModel } from "@/types";

/**
 * 公开模型单页编辑器的展示层（ticket 13 落地，W6 ticket 14 紧凑化重排）：
 * 保存、状态、未保存数量固定在 sticky 页头（不必滚到底）；基本信息三列
 * （名称/备注/启用）、策略三张横向卡片；只读摘要折叠（details）不占主编辑区；
 * 成员编排是左 6 右 6 的两栏容器（内部滚动，见 MemberChipFlow）。
 *
 * 容器（public-model-editor.tsx）负责取数、草稿与单 PATCH 提交；这里只接收
 * props 渲染用户能看到的 DOM，SSR 门禁直接断言这份 DOM，不进入组件内部状态。
 */
export interface PublicModelPageViewProps {
  model: PublicModel;
  form: PublicModelForm;
  upstreamModels: UpstreamModel[];
  /** 服务端 targets 的 id → 名称兜底（上游模型列表不含已被删除的引用行时仍可显示）。 */
  fallbackNames: Map<string, string>;
  dirty: DirtyFieldsState<PublicModelForm>;
  /** W9：成员草稿相对 baseline 的差异条数（页头公开模型名旁展示）。 */
  memberDiffCount: number;
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

export function PublicModelPageView({
  model,
  form,
  upstreamModels,
  fallbackNames,
  dirty,
  memberDiffCount,
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

  const labelOf = memberLabeler(upstreamModels, fallbackNames);
  const fallback = conditionalFallback(form.members, labelOf, form.routing_mode);
  const fallbackLabel = fallback === null ? null : fallback.label;
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

      {/* sticky 页头：保存/状态/未保存数量固定在这里，长页不必滚到底（main 是滚动容器）。 */}
      <header
        data-slot="page-head"
        className="sticky top-0 z-[var(--z-sticky)] -mx-4 border-b border-border bg-surface px-4 pb-3 pt-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-end justify-between gap-x-3" data-slot="page-head-row">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <h1
                className="min-w-0 truncate text-h1 font-semibold tracking-tight text-title"
                title={form.name.trim() || model.name}
              >
                {form.name.trim() || model.name}
              </h1>
              {/* W9：成员差异条数紧挨公开模型名（不进页头右侧动作区）。 */}
              {memberDiffCount > 0 ? (
                <Badge
                  tone="warning"
                  className="tnum shrink-0"
                  data-slot="member-diff-count"
                  title="成员草稿相对已保存版本的差异条数"
                >
                  成员已修改 {memberDiffCount} 项
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2" data-slot="header-save">
              <Badge tone="primary">{routing.label}</Badge>
              <Badge tone={statusTone}>{statusText}</Badge>
              {/* W8 票06：未保存数量由摘要统一呈现（计数 + 恢复全部）；不再重复渲染计数徽章，
                  避免页头 actions 多一枚宽度随脏态变化的徽章。计数徽章固定槽只用于分组标题。 */}
              <DirtySummary count={dirty.dirtyCount} onResetAll={onResetAll} saving={saving} />
              {blockedReasons.length > 0 ? (
                <span className="text-2xs text-danger-text" data-slot="save-blocked" title={blockedReasons.join("；")}>
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
            </div>
          </div>
          <p className="max-w-[76ch] text-pretty text-sm leading-5 text-faint">
            公开模型 · 一次保存提交基本信息、策略、启用与成员；服务端单事务，失败整页回滚。
          </p>
        </div>
      </header>

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

      <SectionCard title="基本信息" description="名称、备注与启用三列并排；与策略、成员一起在同一个事务里提交。">
        <fieldset disabled={controlsDisabled} className="m-0 min-w-0 border-0 p-0">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-slot="basic-fields-grid">
            <div data-slot="field-name" className="min-w-0">
              <DirtyField dirty={dirty.isDirtyField("name")} onReset={() => onResetField("name")} resetLabel="恢复名称">
                <Field label="名称" hint="用户请求时使用的模型名">
                  <Input
                    value={form.name}
                    onChange={(event) => onFormChange({ name: event.target.value })}
                    placeholder="如 glm-5.3"
                  />
                </Field>
              </DirtyField>
            </div>
            <div data-slot="field-note" className="min-w-0">
              <DirtyField dirty={dirty.isDirtyField("note")} onReset={() => onResetField("note")} resetLabel="恢复备注">
                <Field label="备注">
                  <Input
                    value={form.note}
                    onChange={(event) => onFormChange({ note: event.target.value })}
                    placeholder="选填"
                  />
                </Field>
              </DirtyField>
            </div>
            <div data-slot="field-enabled" className="min-w-0">
              <DirtyField
                dirty={dirty.isDirtyField("enabled")}
                onReset={() => onResetField("enabled")}
                resetLabel="恢复启用状态"
              >
                <Field label="启用" hint="公开模型只有启用/关闭；可用性措施（冷却）挂在上游模型，不在此页（ADR-025）。">
                  <div className="flex h-8 items-center">
                    <Checkbox
                      checked={form.enabled}
                      aria-label="启用"
                      onCheckedChange={(checked) => onFormChange({ enabled: checked === true })}
                    />
                  </div>
                </Field>
              </DirtyField>
            </div>
          </div>
        </fieldset>
      </SectionCard>

      <SectionCard title="策略" description="三种路由模式横向对比；与基本信息、成员一起在同一个事务里提交。">
        <fieldset disabled={controlsDisabled} className="m-0 min-w-0 border-0 p-0">
          <DirtyField
            dirty={dirty.isDirtyField("routing_mode")}
            onReset={() => onResetField("routing_mode")}
            resetLabel="恢复策略"
          >
            <RadioGroup
              value={form.routing_mode}
              onValueChange={(value) => onFormChange({ routing_mode: value as RoutingMode })}
              // W9：三张策略卡等宽等高（grid items-stretch + 卡片 h-full），每张都带一句短说明。
              className="grid grid-cols-1 items-stretch gap-2 md:grid-cols-3"
              data-slot="strategy-cards"
            >
              {(Object.keys(ROUTING_LABELS) as RoutingMode[]).map((modeKey) => (
                <label
                  key={modeKey}
                  data-slot="strategy-card"
                  className="flex h-full items-start gap-2 rounded-md border border-border p-2.5 text-2sm"
                >
                  <RadioGroupItem value={modeKey} className="mt-0.5 shrink-0" />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="block font-medium text-body">{ROUTING_LABELS[modeKey].label}</span>
                    <span className="block text-2xs leading-4 text-faint">{ROUTING_LABELS[modeKey].desc}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </DirtyField>
        </fieldset>
      </SectionCard>

      <SectionCard title="成员编排" description="保存时按优先级整批替换；优先级数值小优先，同层 P2C 平权。">
        <DirtyField
          dirty={dirty.isDirtyField("members")}
          onReset={() => onResetField("members")}
          resetLabel="恢复成员编排"
        >
          <div className="space-y-3">
            <p className="text-2xs text-faint" data-slot="member-rules">
              规则：至少保留 1 个成员；成员不可重复；条件路由模式下只有末位成员可以留空条件（兜底）。
            </p>
            <fieldset disabled={controlsDisabled} className="m-0 min-w-0 border-0 p-0">
              <MemberChipFlow
                members={form.members}
                upstreamModels={upstreamModels}
                fallbackNames={fallbackNames}
                mode={form.routing_mode}
                onChange={onMembersChange}
              />
            </fieldset>
            {fallbackLabel !== null ? (
              <p className="text-2xs text-info-text" data-slot="conditional-fallback">
                条件路由末位兜底：{fallbackLabel}（条件留空，前面成员都不命中时使用）
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
        </DirtyField>
      </SectionCard>

      {/* 只读摘要折叠（details）：收起时不占主编辑区，展开才出现按草稿计算的渲染语义。 */}
      <details className="rounded-card border border-border bg-surface" data-slot="readonly-summary">
        <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="text-sm font-semibold text-title">只读摘要</span>
            <span className="ml-2 text-2xs font-normal text-faint">按当前草稿计算的渲染语义；保存后生效。</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-faint transition-transform [[open]>&]:rotate-180"
          />
        </summary>
        <div className="min-w-0 border-t border-border px-4 py-2" data-slot="public-model-summary">
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
              ? "；" + layerPriorities.length + " 个优先级层（" + layerPriorities.join(" / ") + "）"
              : ""}
            {form.routing_mode === "failover" ? "；按优先级数值小优先逐层尝试" : null}
          </SummaryRow>
          {form.routing_mode === "conditional" ? (
            <SummaryRow label="末位兜底">
              {fallbackLabel !== null ? fallbackLabel + "（条件留空）" : "缺少兜底：末位成员必须留空条件"}
            </SummaryRow>
          ) : null}
          <SummaryRow label="启用状态">
            {statusText}。公开模型只支持启用/关闭；可用性措施（冷却）挂在上游模型（ADR-025）。
          </SummaryRow>
          <SummaryRow label="创建时间">{formatDateTime(model.created_at_ms, mode)}</SummaryRow>
        </div>
      </details>
    </div>
  );
}
