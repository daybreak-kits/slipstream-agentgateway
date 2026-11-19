import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { CapabilityBadge, Chips, DirtyHint, Fact, Field } from "./shared";
import {
  BACKOFF_OPTIONS,
  HEALTH_EXPRESSION_PRESETS,
  RETRY_CODE_PRESETS,
  describeError,
  policyDraftProblem,
} from "./helpers";
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
  const draftProblem = policyDraftProblem(draft);

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
              <Field label="每分钟词元数（留空 = 不渲染）">
                <Input
                  aria-label="每分钟词元数"
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
            title="请求内重试与健康驱逐"
            description={data.notes.retry}
            actions={<CapabilityBadge capability={caps.retry} />}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Field
                  label="启用请求内重试（默认关 = 当前行为）"
                  hint="渲染为顶层 policies[] 的 route 级 retry（target internal/llm:request），不写入 llm.policies。"
                >
                  <Switch
                    aria-label="启用请求内重试"
                    checked={draft.retry !== null}
                    onCheckedChange={(checked) =>
                      update((next) => {
                        next.retry = checked
                          ? { attempts: 2, backoff: "200ms", codes: [500, 502, 503, 504], precondition: "", condition: "" }
                          : null;
                      })
                    }
                    disabled={!caps.retry.supported}
                  />
                </Field>
                <Field
                  label="启用健康标记与驱逐（llm.models[].health）"
                  hint="表达式单独配置不会驱逐主层；E16/E17：必须带 consecutive_failures。"
                >
                  <Switch
                    aria-label="启用健康标记与驱逐"
                    checked={draft.health !== null}
                    onCheckedChange={(checked) =>
                      update((next) => {
                        next.health = checked
                          ? { unhealthy_expression: "response.code >= 500", consecutive_failures: 3, duration: "", restore_health: 0 }
                          : null;
                      })
                    }
                    disabled={!caps.health.supported}
                  />
                </Field>
              </div>

              {draft.retry !== null && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label="attempts（首次之后的尝试次数，1-10）"
                    hint="E16：attempts=2 即最多 3 次上游尝试；跨层切换发生在驱逐标记后的下一次尝试。"
                  >
                    <Input
                      aria-label="attempts"
                      inputMode="numeric"
                      value={draft.retry.attempts}
                      onChange={(event) => update((next) => {
                        if (next.retry === null) return;
                        const parsed = Number(event.target.value);
                        next.retry.attempts =
                          event.target.value === "" ? next.retry.attempts : Number.isFinite(parsed) ? parsed : next.retry.attempts;
                      })}
                      disabled={!caps.retry.supported}
                    />
                  </Field>
                  <Field label="backoff（重试间隔）">
                    <Select
                      value={BACKOFF_OPTIONS.includes(draft.retry.backoff as (typeof BACKOFF_OPTIONS)[number]) ? draft.retry.backoff : "custom"}
                      onValueChange={(value) => update((next) => {
                        if (next.retry === null || value === "custom") return;
                        next.retry.backoff = value;
                      })}
                      disabled={!caps.retry.supported}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BACKOFF_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                        <SelectItem value="custom">自定义…</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="backoff 自定义（覆盖下拉值）" hint="humantime，如 150ms / 3s">
                    <Input
                      aria-label="backoff 自定义"
                      value={draft.retry.backoff}
                      onChange={(event) => update((next) => { if (next.retry === null) return; next.retry.backoff = event.target.value; })}
                      disabled={!caps.retry.supported}
                    />
                  </Field>
                </div>
              )}

              {draft.retry !== null && (
                <Field
                  label="重试状态码（400-599 档位勾选）"
                  hint="返回这些状态码时按 attempts 重试；含 4xx 时必须同时启用健康组，否则不能保存（ADR-024 成对规则）。"
                >
                  <div className="flex flex-wrap gap-1">
                    {RETRY_CODE_PRESETS.map((code) => {
                      const active = draft.retry !== null && draft.retry.codes.includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          aria-pressed={active}
                          onClick={() => update((next) => {
                            if (next.retry === null) return;
                            const codes = new Set(next.retry.codes);
                            if (codes.has(code)) codes.delete(code);
                            else codes.add(code);
                            next.retry.codes = [...codes].sort((a, b) => a - b);
                          })}
                          className={
                            "rounded border px-2 py-1 font-mono text-2xs " +
                            (active
                              ? "border-primary bg-primary-soft text-primary-text"
                              : "border-border bg-surface-2 text-faint hover:text-body")
                          }
                        >
                          {code}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}

              {draft.health !== null && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="unhealthy_expression（预设）" hint="判定上游不健康的表达式。">
                    <Select
                      value={
                        HEALTH_EXPRESSION_PRESETS.includes(draft.health.unhealthy_expression as (typeof HEALTH_EXPRESSION_PRESETS)[number])
                          ? draft.health.unhealthy_expression
                          : "custom"
                      }
                      onValueChange={(value) => update((next) => {
                        if (next.health === null || value === "custom") {
                          if (next.health !== null) next.health.unhealthy_expression = "";
                          return;
                        }
                        next.health.unhealthy_expression = value;
                      })}
                      disabled={!caps.health.supported}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="response.code >= 500">response.code &gt;= 500</SelectItem>
                        <SelectItem value="response.code >= 400">response.code &gt;= 400</SelectItem>
                        <SelectItem value="custom">自定义…</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="表达式（可自定义 CEL）">
                    <Input
                      aria-label="unhealthy_expression"
                      value={draft.health.unhealthy_expression}
                      onChange={(event) => update((next) => { if (next.health === null) return; next.health.unhealthy_expression = event.target.value; })}
                      disabled={!caps.health.supported}
                    />
                  </Field>
                  <Field label="consecutive_failures（>=1）" hint="连续失败几次后驱逐；E16/E17：表达式单独配置不会换组。">
                    <Input
                      aria-label="consecutive_failures"
                      inputMode="numeric"
                      value={draft.health.consecutive_failures}
                      onChange={(event) => update((next) => {
                        if (next.health === null) return;
                        const parsed = Number(event.target.value);
                        next.health.consecutive_failures =
                          event.target.value === "" ? next.health.consecutive_failures : Number.isFinite(parsed) ? parsed : next.health.consecutive_failures;
                      })}
                      disabled={!caps.health.supported}
                    />
                  </Field>
                  <Field label="duration / restore_health" hint="驱逐时长（可空）与恢复阈值。">
                    <div className="flex gap-1.5">
                      <Input
                        aria-label="health duration"
                        placeholder="60s"
                        value={draft.health.duration}
                        onChange={(event) => update((next) => { if (next.health === null) return; next.health.duration = event.target.value; })}
                        disabled={!caps.health.supported}
                      />
                      <Input
                        aria-label="restore_health"
                        inputMode="numeric"
                        className="w-20"
                        value={draft.health.restore_health}
                        onChange={(event) => update((next) => {
                          if (next.health === null) return;
                          const parsed = Number(event.target.value);
                          next.health.restore_health =
                            event.target.value === "" ? next.health.restore_health : Number.isFinite(parsed) ? parsed : next.health.restore_health;
                        })}
                        disabled={!caps.health.supported}
                      />
                    </div>
                  </Field>
                </div>
              )}

              {draftProblem !== null && (
                <p className="rounded-md border border-warning bg-warning-soft px-2.5 py-1.5 text-2xs text-warning-text">
                  无法保存：{draftProblem}
                </p>
              )}

              <ul className="space-y-0.5 text-2xs text-faint">
                <li>· 同层组内切换为 P2C 概率性，不保证切到指定目标。</li>
                <li>· 流式响应首字节之后中断不会切换目标，客户端会收到截断流。</li>
                <li>· 每次请求仍只记一条日志。</li>
              </ul>
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
              <Fact label="每分钟词元数">
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
            title="请求内重试与健康驱逐"
            description={data.notes.retry}
            actions={<CapabilityBadge capability={caps.retry} />}
          >
            {config.retry === null && config.health === null ? (
              <p className="text-2xs text-faint">未启用（默认关闭，保持当前行为：不重试、不做健康驱逐）。</p>
            ) : (
              <div className="space-y-2">
                <Fact label="请求内重试">
                  {config.retry === null
                    ? "未启用"
                    : "attempts " + config.retry.attempts + " · codes " + config.retry.codes.join("/") + " · backoff " + (config.retry.backoff || "—")}
                </Fact>
                <Fact label="健康标记与驱逐">
                  {config.health === null
                    ? "未启用"
                    : config.health.unhealthy_expression + " · 连续 " + config.health.consecutive_failures + " 次 · duration " + (config.health.duration || "—") + " · restore " + config.health.restore_health}
                </Fact>
                <ul className="space-y-0.5 text-2xs text-faint">
                  <li>· 同层组内切换为 P2C 概率性，不保证切到指定目标。</li>
                  <li>· 流式响应首字节之后中断不会切换目标，客户端会收到截断流。</li>
                  <li>· 每次请求仍只记一条日志。</li>
                </ul>
              </div>
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
