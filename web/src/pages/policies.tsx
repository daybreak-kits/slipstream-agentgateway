import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/permissions";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState, SectionCard } from "@/components/governance/panel";
import { RawJsonEditor } from "@/components/governance/raw-json-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, ENDPOINTS } from "@/lib/api";
import {
  linesToList,
  listToLines,
  parseJsonDocument,
  saveAndApply,
  type CapabilityInfo,
  type PoliciesResponse,
  type PolicyConfig,
} from "@/lib/policies";

type Mode = "view" | "edit" | "raw";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const lines = error.errorLines();
    return lines.length > 0 ? error.message + "：" + lines.join("；") : error.message;
  }
  return (error as Error).message;
}

function CapabilityBadge({ capability }: { capability: CapabilityInfo }) {
  if (!capability.supported) return <Badge tone="neutral">AG 1.7 不支持</Badge>;
  return capability.verified ? <Badge tone="success">已验证</Badge> : <Badge tone="warning">未实测</Badge>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-2xs text-body">{label}</Label>
      {children}
      {hint !== undefined && <p className="text-2xs text-faint">{hint}</p>}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-2xs text-faint">{label}</div>
      <div className="text-2xs leading-relaxed text-body">{children}</div>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-faint">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-2xs">
          {item}
        </span>
      ))}
    </div>
  );
}

const EMPTY_RETRY = { attempts: 1, backoff: "", codes: [502, 503, 504], precondition: "", condition: "" };

export function PoliciesPage() {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["policies"],
    queryFn: () => api.get<PoliciesResponse>(ENDPOINTS.policies),
  });
  const [mode, setMode] = useState<Mode>("view");
  const { can } = usePermissions();
  const canWrite = can("policies:write");
  const [draft, setDraft] = useState<PolicyConfig | null>(null);
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (config: PolicyConfig) =>
      saveAndApply(() => api.put(ENDPOINTS.policies, { config }), "控制面策略编辑"),
    onSuccess: (revisionId) => {
      toast.success("策略已保存并下发", { description: "配置修订 " + revisionId });
      setMode("view");
      setDraft(null);
      setSaveError(null);
      void queryClient.invalidateQueries({ queryKey: ["policies"] });
      void queryClient.invalidateQueries({ queryKey: ["config-status"] });
    },
    onError: (error) => setSaveError(describeError(error)),
  });

  const reset = useMutation({
    mutationFn: () => saveAndApply(() => api.del<unknown>(ENDPOINTS.policies), "恢复默认策略"),
    onSuccess: (revisionId) => {
      toast.success("已恢复默认策略并下发", { description: "配置修订 " + revisionId });
      setMode("view");
      void queryClient.invalidateQueries({ queryKey: ["policies"] });
      void queryClient.invalidateQueries({ queryKey: ["config-status"] });
    },
    onError: (error) => setSaveError(describeError(error)),
  });

  const validate = useMutation({
    mutationFn: (config: PolicyConfig) =>
      api.post<{ ok: boolean; errors: string[]; warnings: string[] }>(ENDPOINTS.policiesValidate, {
        config,
      }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("配置通过 AG 1.7 校验", {
          description: result.warnings.length > 0 ? result.warnings.join("；") : "可以保存并下发",
        });
      } else {
        toast.error("配置未通过校验", { description: result.errors.join("；") });
      }
    },
    onError: (error) => toast.error("校验请求失败", { description: describeError(error) }),
  });

  if (q.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <ErrorState
        title="策略配置加载失败"
        description={q.error.message + "（GET /admin/policies）"}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    );
  }

  const data = q.data;
  if (data === undefined) {
    return <ErrorState title="策略配置为空" description="控制面返回了空响应。" />;
  }
  const caps = data.capabilities;
  const config = data.config;

  const startEdit = () => {
    setDraft(structuredClone(config));
    setMode("edit");
    setSaveError(null);
  };

  const startRaw = () => {
    setRawText(JSON.stringify(config, null, 2));
    setRawError(undefined);
    setMode("raw");
    setSaveError(null);
  };

  const cancel = () => {
    setMode("view");
    setDraft(null);
    setRawError(undefined);
    setSaveError(null);
  };

  const update = (mutate: (current: PolicyConfig) => void) => {
    if (draft === null) return;
    const next = structuredClone(draft);
    mutate(next);
    setDraft(next);
  };

  const submitForm = () => {
    if (draft === null) return;
    setSaveError(null);
    save.mutate(draft);
  };

  const submitRaw = () => {
    try {
      const parsed = parseJsonDocument<PolicyConfig>(rawText);
      setRawError(undefined);
      setSaveError(null);
      save.mutate(parsed);
    } catch (error) {
      setRawError((error as Error).message);
    }
  };

  const busy = save.isPending || reset.isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2sm text-faint">
          策略在这里编辑并落库；保存 = 写配置 + 走现有「渲染 → --validate-only → 下发」流程。
          AG 1.7 不支持的字段会被后端 422 拒绝，不会静默丢弃。
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          {mode === "view" && canWrite ? (
            <>
              <Button variant="outline" size="sm" onClick={startRaw}>
                原始 JSON
              </Button>
              <Button variant="outline" size="sm" onClick={() => reset.mutate()} disabled={busy}>
                恢复默认
              </Button>
              <Button variant="primary" size="sm" onClick={startEdit}>
                编辑
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
              取消
            </Button>
          )}
        </div>
      </div>

      {saveError !== null && (
        <div className="rounded-md border border-danger bg-danger-soft px-2.5 py-1.5 text-2xs text-danger-text">
          保存失败：{saveError}
        </div>
      )}

      {mode === "raw" ? (
        <SectionCard
          title="原始 JSON 高级编辑"
          description="整份策略文档；JSON 语法错误会阻止保存，服务端仍会做 IR/AG 1.7 校验。"
          actions={
            <Button variant="primary" size="sm" onClick={submitRaw} disabled={busy || rawError !== undefined}>
              {save.isPending ? "保存中…" : "保存并下发"}
            </Button>
          }
        >
          <RawJsonEditor value={rawText} onChange={setRawText} error={rawError} disabled={busy} />
        </SectionCard>
      ) : mode === "edit" && draft !== null ? (
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
              <Field label="启用客户端密钥校验">
                <Switch
                  aria-label="启用客户端密钥校验"
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
                {caps.retry.supported ? "支持" : "AG 1.7 暂不支持"}
              </Badge>
            }
          >
            <div className="space-y-2">
              <p className="text-2xs text-body">
                {caps.retry.supported
                  ? "AG 1.7 接受 llm.policies.retry，可编辑。"
                  : "pinned AG 1.7 的 llm.policies 拒绝 retry（unknown field），后端会 422 拒绝；表单不提供编辑，已有值可清空。"}
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
                <p className="text-2xs text-faint">
                  当前不渲染重试（保持 null 才能保存）。示例字段：{JSON.stringify(EMPTY_RETRY)}
                </p>
              )}
            </div>
          </SectionCard>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={submitForm} disabled={busy}>
              {save.isPending ? "保存并下发中…" : "保存并下发"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => draft !== null && validate.mutate(draft)}
              disabled={busy || validate.isPending}
            >
              {validate.isPending ? "校验中…" : "仅校验"}
            </Button>
            <span className="text-2xs text-faint">
              保存后自动调用 POST /admin/config/apply，配置修订会变化；下发失败会显示后端错误。
            </span>
          </div>
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
              <p className="text-2xs text-faint">未配置；AG 1.7 当前拒绝 llm.policies.retry。</p>
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
