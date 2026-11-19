import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { CapabilityBadge, Chips, DirtyHint, Fact, Field } from "./shared";
import { describeError } from "./helpers";
import { RawJsonEditor } from "@/components/governance/raw-json-editor";
import { PageToolbar, SectionCard } from "@/components/governance/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ENDPOINTS } from "@/lib/api";
import {
  linesToList,
  listToLines,
  parseJsonDocument,
  saveAndApply,
  type PolicyConfig,
  type PoliciesResponse,
} from "@/lib/policies";

/**
 * 网关策略·流量策略 Tab：表单/原始 JSON 都只改草稿；校验与保存统一走页级动作条
 * （validate → 保存 → apply → 配置版本留档）。恢复默认是既有直接下发动作，不走草稿。
 */
export function PoliciesTab({ data, draft, onDraftChange, canWrite, dirtyCount }: {
  data: PoliciesResponse;
  draft: PolicyConfig | null;
  onDraftChange: (draft: PolicyConfig | null) => void;
  canWrite: boolean;
  dirtyCount: number;
}) {
  const queryClient = useQueryClient();
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | undefined>(undefined);

  const reset = useMutation({
    mutationFn: () => saveAndApply(() => api.del<unknown>(ENDPOINTS.policies), "恢复默认策略"),
    onSuccess: (revisionId) => {
      toast.success("已恢复默认策略并下发", { description: "配置修订 " + revisionId });
      void queryClient.invalidateQueries({ queryKey: ["policies"] });
      void queryClient.invalidateQueries({ queryKey: ["config-status"] });
    },
    onError: (error) => toast.error("恢复默认失败", { description: describeError(error) }),
  });

  const config = data.config;
  const caps = data.capabilities;
  const editing = draft !== null;

  const startEdit = () => {
    onDraftChange(structuredClone(config));
    setRawError(undefined);
  };

  const startRaw = () => {
    setRawText(JSON.stringify(draft ?? config, null, 2));
    setRawError(undefined);
    setRawOpen(true);
  };

  const cancel = () => {
    onDraftChange(null);
    setRawOpen(false);
    setRawError(undefined);
  };

  const update = (mutate: (current: PolicyConfig) => void) => {
    if (draft === null) return;
    const next = structuredClone(draft);
    mutate(next);
    onDraftChange(next);
  };

  const applyRaw = () => {
    try {
      const parsed = parseJsonDocument<PolicyConfig>(rawText);
      setRawError(undefined);
      onDraftChange(parsed);
      setRawOpen(false);
      toast.success("JSON 已应用到草稿", { description: "确认无误后用页级动作条校验/保存" });
    } catch (error) {
      setRawError((error as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <PageToolbar>
        <span className="text-2sm text-faint">
          策略在这里编辑并落库；页级「保存并下发」= 写配置 + 渲染校验 + 下发 + 配置版本留档。
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {!editing && canWrite ? (
            <>
              <Button variant="outline" size="sm" onClick={startRaw}>原始 JSON</Button>
              <Button variant="outline" size="sm" onClick={() => reset.mutate()} disabled={reset.isPending}>
                恢复默认
              </Button>
              <Button variant="primary" size="sm" onClick={startEdit}>编辑</Button>
            </>
          ) : editing ? (
            <Button variant="ghost" size="sm" onClick={cancel} disabled={reset.isPending}>取消</Button>
          ) : null}
        </div>
      </PageToolbar>

      <DirtyHint count={dirtyCount} />

      {rawOpen ? (
        <SectionCard
          title="原始 JSON 高级编辑"
          description="整份策略文档；「应用 JSON 更改」先写回草稿，再由页级动作条校验与保存。"
          actions={
            <Button variant="primary" size="sm" onClick={applyRaw} disabled={rawError !== undefined}>
              应用 JSON 更改
            </Button>
          }
        >
          <RawJsonEditor value={rawText} onChange={setRawText} error={rawError} />
        </SectionCard>
      ) : editing && draft !== null ? (
        <>
          <SectionCard
            title="跨域 CORS"
            description={data.notes.cors}
            actions={<CapabilityBadge capability={caps.cors} />}
          >
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="flex items-center justify-between gap-2">
                <Field label="启用数据面 CORS（llm.policies.cors）">
                  <Switch
                    aria-label="启用数据面 CORS"
                    checked={draft.cors.enabled}
                    onCheckedChange={(checked) => update((next) => { next.cors.enabled = checked; })}
                    disabled={!caps.cors.supported}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-faint">允许携带凭证</span>
                  <Switch
                    aria-label="允许携带凭证"
                    checked={draft.cors.allow_credentials}
                    onCheckedChange={(checked) => update((next) => { next.cors.allow_credentials = checked; })}
                    disabled={!caps.cors.supported || !draft.cors.enabled}
                  />
                </div>
              </div>
              <Field label="允许来源（每行一个）">
                <Textarea
                  value={listToLines(draft.cors.allow_origins)}
                  onChange={(event) => update((next) => { next.cors.allow_origins = linesToList(event.target.value); })}
                  className="min-h-[72px] font-mono text-xs"
                  disabled={!caps.cors.supported || !draft.cors.enabled}
                />
              </Field>
              <Field label="暴露响应头（每行一个）">
                <Textarea
                  value={listToLines(draft.cors.expose_headers)}
                  onChange={(event) => update((next) => { next.cors.expose_headers = linesToList(event.target.value); })}
                  className="min-h-[56px] font-mono text-xs"
                  disabled={!caps.cors.supported || !draft.cors.enabled}
                />
              </Field>
              <Field label="预检缓存 maxAge（秒，留空不渲染）">
                <Input
                  aria-label="预检缓存 maxAge（秒）"
                  value={draft.cors.max_age ?? ""}
                  inputMode="numeric"
                  onChange={(event) => update((next) => {
                    // 非数字不落库：避免 NaN 进入受控 value（React 会告警并显示 NaN）。
                    const parsed = Number(event.target.value);
                    next.cors.max_age =
                      event.target.value === "" ? null : Number.isFinite(parsed) ? parsed : next.cors.max_age;
                  })}
                  disabled={!caps.cors.supported || !draft.cors.enabled}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title="密钥鉴权"
            description={data.notes.api_key}
            actions={<CapabilityBadge capability={caps.api_key} />}
          >
            <div className="flex flex-wrap items-end gap-4">
              <Field label="启用连接密钥校验">
                <Switch
                  aria-label="启用连接密钥校验"
                  checked={draft.api_key.enabled}
                  onCheckedChange={(checked) => update((next) => { next.api_key.enabled = checked; })}
                  disabled={!caps.api_key.supported}
                />
              </Field>
              <Field label="模式（AG 1.7 仅支持 strict）">
                <Select
                  value={draft.api_key.mode}
                  onValueChange={(value) => update((next) => { next.api_key.mode = value as "strict"; })}
                  disabled={!caps.api_key.supported}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">strict</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <p className="text-2xs text-faint">
                关闭后数据面匿名放行；台账里的密钥不会删除。
              </p>
            </div>
          </SectionCard>

          <SectionCard
            title="本地限流"
            description={data.notes.rate_limit}
            actions={<CapabilityBadge capability={caps.local_rate_limit} />}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="每分钟请求数（留空 = 不渲染）">
                <Input
                  aria-label="每分钟请求数"
                  value={draft.local_rate_limit.requests_per_minute ?? ""}
                  inputMode="numeric"
                  onChange={(event) => update((next) => {
                    const parsed = Number(event.target.value);
                    next.local_rate_limit.requests_per_minute =
                      event.target.value === "" ? null : Number.isFinite(parsed) ? parsed : next.local_rate_limit.requests_per_minute;
                  })}
                  disabled={!caps.local_rate_limit.supported}
                />
              </Field>
              <Field label="每分钟令牌数（留空 = 不渲染）">
                <Input
                  aria-label="每分钟令牌数"
                  value={draft.local_rate_limit.tokens_per_minute ?? ""}
                  inputMode="numeric"
                  onChange={(event) => update((next) => {
                    const parsed = Number(event.target.value);
                    next.local_rate_limit.tokens_per_minute =
                      event.target.value === "" ? null : Number.isFinite(parsed) ? parsed : next.local_rate_limit.tokens_per_minute;
                  })}
                  disabled={!caps.local_rate_limit.supported}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title="超时"
            description={data.notes.timeout}
            actions={<CapabilityBadge capability={caps.timeout} />}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="请求超时 requestTimeout">
                <Input
                  value={draft.timeout.request_timeout}
                  placeholder="60s"
                  onChange={(event) => update((next) => { next.timeout.request_timeout = event.target.value; })}
                  disabled={!caps.timeout.supported}
                />
              </Field>
              <Field label="后端超时 backendRequestTimeout">
                <Input
                  value={draft.timeout.backend_request_timeout}
                  placeholder="55s"
                  onChange={(event) => update((next) => { next.timeout.backend_request_timeout = event.target.value; })}
                  disabled={!caps.timeout.supported}
                />
              </Field>
              <Field label="空闲超时 responseIdleTimeout">
                <Input
                  value={draft.timeout.response_idle_timeout}
                  placeholder="30s"
                  onChange={(event) => update((next) => { next.timeout.response_idle_timeout = event.target.value; })}
                  disabled={!caps.timeout.supported}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title="默认改写动作"
            description={data.notes.transformations}
            actions={<CapabilityBadge capability={caps.transformations} />}
          >
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="默认删除响应头（每行一个）">
                <Textarea
                  value={listToLines(draft.transformations.default_response_header_deletes)}
                  onChange={(event) => update((next) => {
                    next.transformations.default_response_header_deletes = linesToList(event.target.value);
                  })}
                  className="min-h-[72px] font-mono text-xs"
                  disabled={!caps.transformations.supported}
                />
              </Field>
              <Field label="受保护请求头（每行一个）">
                <Textarea
                  value={listToLines(draft.transformations.protected_request_headers)}
                  onChange={(event) => update((next) => {
                    next.transformations.protected_request_headers = linesToList(event.target.value);
                  })}
                  className="min-h-[72px] font-mono text-xs"
                  disabled={!caps.transformations.supported}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title="请求级重试"
            description={data.notes.retry}
            actions={
              <Badge tone={caps.retry.supported ? "success" : "warning"}>
                {caps.retry.supported ? "支持" : "AG 1.7 不支持请求内重试"}
              </Badge>
            }
          >
            <div className="space-y-2">
              <p className="text-2xs text-body">
                {caps.retry.supported
                  ? "AG 1.7 接受 llm.policies.retry，可编辑。"
                  : "AG 1.7 不支持请求内重试：pinned AG 1.7 的 llm.policies 拒绝 retry（unknown field），后端会 422 拒绝；表单不提供编辑，已有值可清空。"}
              </p>
              {draft.retry !== null && (
                <div className="space-y-2 rounded-md border border-warning bg-warning-soft p-2">
                  <pre className="overflow-x-auto font-mono text-2xs text-warning-text">
                    {JSON.stringify(draft.retry, null, 2)}
                  </pre>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => update((next) => { next.retry = null; })}
                  >
                    清空重试配置
                  </Button>
                </div>
              )}
              {draft.retry === null && (
                <p className="text-2xs text-faint">当前不渲染重试（保持 null 才能保存）。</p>
              )}
            </div>
          </SectionCard>
        </>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <SectionCard
            title="跨域 CORS"
            description={data.notes.cors}
            actions={<CapabilityBadge capability={caps.cors} />}
          >
            <div className="space-y-2">
              <Fact label="数据面渲染">
                {config.cors.enabled ? <Badge tone="success">已启用</Badge> : <Badge tone="neutral">未启用（不渲染）</Badge>}
              </Fact>
              <Fact label="允许来源">
                <Chips items={config.cors.allow_origins} />
              </Fact>
              <Fact label="允许凭证">
                {config.cors.allow_credentials ? "是" : "否"}
              </Fact>
            </div>
          </SectionCard>

          <SectionCard
            title="密钥鉴权"
            description={data.notes.api_key}
            actions={<CapabilityBadge capability={caps.api_key} />}
          >
            <div className="space-y-2">
              <Fact label="数据面校验">
                {config.api_key.enabled ? <Badge tone="success">启用 strict</Badge> : <Badge tone="warning">匿名放行</Badge>}
              </Fact>
              <Fact label="存储与失败响应">
                {data.effective.key_auth.storage}；{data.effective.key_auth.failure}
              </Fact>
            </div>
          </SectionCard>

          <SectionCard
            title="本地限流"
            description={data.notes.rate_limit}
            actions={<CapabilityBadge capability={caps.local_rate_limit} />}
          >
            <div className="space-y-2">
              <Fact label="每分钟请求数">
                <span className="tnum">{config.local_rate_limit.requests_per_minute ?? "未设置"}</span>
              </Fact>
              <Fact label="每分钟令牌数">
                <span className="tnum">{config.local_rate_limit.tokens_per_minute ?? "未设置"}</span>
              </Fact>
              <Fact label="桶语义">{data.effective.local_rate_limit.semantics}</Fact>
            </div>
          </SectionCard>

          <SectionCard
            title="超时"
            description={data.notes.timeout}
            actions={<CapabilityBadge capability={caps.timeout} />}
          >
            {data.effective.timeout === null ? (
              <p className="text-2xs text-faint">未配置超时（AG 默认）。</p>
            ) : (
              <div className="space-y-2">
                <Fact label="requestTimeout">{data.effective.timeout.request_timeout || "—"}</Fact>
                <Fact label="backendRequestTimeout">{data.effective.timeout.backend_request_timeout || "—"}</Fact>
                <Fact label="responseIdleTimeout">{data.effective.timeout.response_idle_timeout || "—"}</Fact>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="默认改写动作"
            description={data.notes.transformations}
            actions={<CapabilityBadge capability={caps.transformations} />}
          >
            <div className="space-y-2">
              <Fact label="默认删除响应头">
                <Chips items={config.transformations.default_response_header_deletes} />
              </Fact>
              <Fact label="受保护请求头">
                <Chips items={config.transformations.protected_request_headers} />
              </Fact>
              <Fact label="允许改写的 body 路径">
                <span className="font-mono">{data.effective.transforms_defaults.body_editable_paths}</span>
              </Fact>
            </div>
          </SectionCard>

          <SectionCard
            title="请求级重试"
            description={data.notes.retry}
            actions={<CapabilityBadge capability={caps.retry} />}
          >
            {config.retry === null ? (
              <p className="text-2xs text-faint">AG 1.7 不支持请求内重试：不渲染 retry（保持 null）。</p>
            ) : (
              <pre className="overflow-x-auto font-mono text-2xs text-danger-text">
                {JSON.stringify(config.retry, null, 2)}
              </pre>
            )}
          </SectionCard>

          <SectionCard title="配置规模" description="当前控制面行数，仅供策略页参考。">
            <div className="grid grid-cols-2 gap-2 text-2xs text-body sm:grid-cols-4">
              <div>上游 <span className="tnum">{data.counts.upstreams}</span></div>
              <div>公开模型 <span className="tnum">{data.counts.public_models}</span></div>
              <div>活跃密钥 <span className="tnum">{data.counts.api_keys_active}</span></div>
              <div>用户 <span className="tnum">{data.counts.users}</span></div>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
