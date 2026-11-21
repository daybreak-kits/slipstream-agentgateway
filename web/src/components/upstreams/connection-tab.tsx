import type { ReactNode } from "react";

import { PendingKeysPanel, UpstreamKeysPanel } from "./keys-panel";
import { UpstreamStatusPanel } from "./status-panel";
import {
  API_STYLE_LABELS, API_STYLE_OPTIONS, chatUrlFor, modelsUrlFor,
  type KeyTestResult, type PendingKey, type ProbeResultView, type UpstreamDraft, type UpstreamRow,
} from "./shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Vendor } from "@/types";

function ReadOnlyValue({ children }: { children: ReactNode }) {
  return <div className="min-h-9 px-3 py-2 text-2sm text-body">{children}</div>;
}

/** Tab1 连接与模型：左卡「连接信息」（宽）+ 右列「连接状态」与「模型」（窄）。 */
export function ConnectionTab({
  isNew,
  upstream,
  draft,
  onDraftChange,
  vendors,
  pendingKeys,
  onPendingKeysChange,
  probe,
  keyTests,
  modelCount,
  onGoModels,
}: {
  isNew: boolean;
  upstream: UpstreamRow | null;
  draft: UpstreamDraft;
  onDraftChange: (patch: Partial<UpstreamDraft>) => void;
  vendors: Vendor[];
  pendingKeys: PendingKey[];
  onPendingKeysChange: (keys: PendingKey[]) => void;
  probe: ProbeResultView | null;
  keyTests: KeyTestResult | null;
  modelCount: number;
  onGoModels: () => void;
}) {
  const styleOption = API_STYLE_OPTIONS.find((option) => option.value === draft.apiStyle);
  const vendorName = vendors.find((vendor) => vendor.id === draft.vendorId)?.name ?? "未分组";
  const baseUrl = draft.baseUrl.trim();

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-2sm">连接信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <Field>
            <FieldLabel htmlFor="up-name">名称</FieldLabel>
            <Input
              id="up-name"
              value={draft.name}
              onChange={(e) => onDraftChange({ name: e.target.value })}
              placeholder={isNew ? "留空则按连接地址自动生成（如 www-abc-com-8080）" : ""}
            />
            <FieldDescription>
              {isNew
                ? "可自由填写或留空：无厂商时按 host:port 生成，指定厂商时按 {厂商代号}-NN 编号。"
                : "名称可修改，保存时随配置一起提交；与其他上游重名会被 422 拒绝。"}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="up-base-url">连接地址</FieldLabel>
            <Input
              id="up-base-url"
              value={draft.baseUrl}
              onChange={(e) => onDraftChange({ baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
              className="font-mono"
            />
            <FieldDescription>上游服务的基准地址；末尾加 # 表示精确端点，不再拼接任何路径。</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>最终请求地址</FieldLabel>
            <div className="space-y-1 rounded-md bg-surface-2/60 px-3 py-2">
              <div className="flex items-start gap-2 text-2xs">
                <span className="w-16 shrink-0 pt-0.5 text-faint">对话补全</span>
                <span className="tnum min-w-0 flex-1 break-all font-mono text-body">
                  {baseUrl === "" ? "-" : chatUrlFor(baseUrl, draft.apiStyle)}
                </span>
              </div>
              <div className="flex items-start gap-2 text-2xs">
                <span className="w-16 shrink-0 pt-0.5 text-faint">模型列表</span>
                <span className="tnum min-w-0 flex-1 break-all font-mono text-body">
                  {baseUrl === "" ? "-" : modelsUrlFor(baseUrl, draft.apiStyle)}
                </span>
              </div>
            </div>
            <FieldDescription>由连接地址与协议风格推导的预览；实际拼接以服务端探测为准。</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>厂商</FieldLabel>
            {isNew ? (
              <Select value={draft.vendorId} onValueChange={(value) => onDraftChange({ vendorId: value })}>
                <SelectTrigger aria-label="厂商">
                  <SelectValue placeholder="选择厂商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">未分组</SelectItem>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <ReadOnlyValue>{vendorName}</ReadOnlyValue>
            )}
            <FieldDescription>
              厂商仅作展示分组；{isNew ? "可选，未分组时名称按连接地址生成。" : "创建后不支持修改。"}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>协议风格</FieldLabel>
            <Select value={draft.apiStyle} onValueChange={(value) => onDraftChange({ apiStyle: value })}>
              <SelectTrigger aria-label="协议风格">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_STYLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.apiStyle === "auto" ? (
              <FieldDescription>保存 / 探测时自动识别 OpenAI · Responses · Anthropic · Gemini，命中后落为具体风格。</FieldDescription>
            ) : (
              <FieldDescription>{styleOption?.hint ?? "按所选协议风格拼接请求路径与鉴权头。"}</FieldDescription>
            )}
            {!isNew && upstream ? (
              <FieldDescription>
                当前生效风格：{API_STYLE_LABELS[upstream.api_style] ?? upstream.api_style}
                {upstream.api_style_source === "auto" ? "（自动探测）" : "（手动指定）"}
              </FieldDescription>
            ) : null}
          </Field>

          <Field>
            <FieldLabel>源密钥</FieldLabel>
            {isNew ? (
              <PendingKeysPanel keys={pendingKeys} onChange={onPendingKeysChange} />
            ) : upstream ? (
              <UpstreamKeysPanel upstreamId={upstream.id} />
            ) : null}
            <FieldDescription>
              每把密钥=一个独立 AG 上游，平权分流；失效密钥标红。每上游最多 20 把。
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <UpstreamStatusPanel
          upstream={upstream}
          probe={probe}
          keyTests={keyTests}
          showDraftHint={!isNew && baseUrl !== (upstream?.base_url ?? "")}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-2sm">模型</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2sm text-body">
                已接入 <span className="tnum font-medium text-title">{modelCount}</span> 个模型
              </span>
              <Badge tone={modelCount > 0 ? "success" : "neutral"}>
                {modelCount > 0 ? "可路由" : "暂无可路由模型"}
              </Badge>
            </div>
            <button
              type="button"
              onClick={onGoModels}
              className="mt-2 text-2sm text-primary transition-colors hover:underline"
            >
              前往路由与模型
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
