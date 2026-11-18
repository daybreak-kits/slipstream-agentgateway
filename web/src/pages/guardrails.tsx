import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/permissions";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState, SectionCard } from "@/components/governance/panel";
import { RawJsonEditor } from "@/components/governance/raw-json-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { api, ApiError, ENDPOINTS } from "@/lib/api";
import {
  parseJsonDocument,
  saveAndApply,
  type CapabilityInfo,
  type GuardConfig,
  type GuardrailsResponse,
  type GuardrailConfig,
} from "@/lib/policies";

type Mode = "view" | "edit" | "raw";
type Phase = "request" | "response";

const BUILTINS = [
  { value: "ssn", label: "ssn 社会安全号" },
  { value: "creditCard", label: "creditCard 信用卡号" },
  { value: "phoneNumber", label: "phoneNumber 电话号码" },
  { value: "email", label: "email 邮箱" },
  { value: "caSin", label: "caSin 加拿大 SIN" },
];
const SCOPES = [
  { value: "systemPrompt", label: "systemPrompt" },
  { value: "messages", label: "messages" },
  { value: "toolInput", label: "toolInput" },
  { value: "toolOutput", label: "toolOutput" },
];
const REGEX_ACTIONS = ["mask", "reject", "audit"];
const WEBHOOK_ACTIONS = ["reject", "audit"];

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

function newRegexGuard(): GuardConfig {
  return {
    kind: "regex",
    action: "mask",
    rules: [{ pattern: "", builtin: "ssn" }],
    scope: ["messages"],
    rejection_status: 0,
    rejection_body: "",
    webhook_target: "",
    failure_mode: "failClosed",
  };
}

function newWebhookGuard(): GuardConfig {
  return {
    kind: "webhook",
    action: "reject",
    rules: [],
    scope: [],
    rejection_status: 0,
    rejection_body: "",
    webhook_target: "",
    failure_mode: "failClosed",
  };
}

export function GuardrailsPage() {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["guardrails"],
    queryFn: () => api.get<GuardrailsResponse>(ENDPOINTS.guardrails),
  });
  const [mode, setMode] = useState<Mode>("view");
  const { can } = usePermissions();
  const canWrite = can("policies:write");
  const [draft, setDraft] = useState<GuardrailConfig | null>(null);
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (config: GuardrailConfig) =>
      saveAndApply(() => api.put(ENDPOINTS.guardrails, { config }), "控制面护栏编辑"),
    onSuccess: (revisionId) => {
      toast.success("护栏已保存并下发", { description: "配置修订 " + revisionId });
      setMode("view");
      setDraft(null);
      setSaveError(null);
      void queryClient.invalidateQueries({ queryKey: ["guardrails"] });
      void queryClient.invalidateQueries({ queryKey: ["config-status"] });
    },
    onError: (error) => setSaveError(describeError(error)),
  });

  const reset = useMutation({
    mutationFn: () => saveAndApply(() => api.del<unknown>(ENDPOINTS.guardrails), "恢复默认护栏"),
    onSuccess: (revisionId) => {
      toast.success("已恢复默认护栏并下发", { description: "配置修订 " + revisionId });
      setMode("view");
      void queryClient.invalidateQueries({ queryKey: ["guardrails"] });
      void queryClient.invalidateQueries({ queryKey: ["config-status"] });
    },
    onError: (error) => setSaveError(describeError(error)),
  });

  const validate = useMutation({
    mutationFn: (config: GuardrailConfig) =>
      api.post<{ ok: boolean; errors: string[]; warnings: string[] }>(
        ENDPOINTS.guardrailsValidate,
        { config },
      ),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("护栏配置通过 AG 1.7 校验", {
          description: result.warnings.length > 0 ? result.warnings.join("；") : "可以保存并下发",
        });
      } else {
        toast.error("护栏配置未通过校验", { description: result.errors.join("；") });
      }
    },
    onError: (error) => toast.error("校验请求失败", { description: describeError(error) }),
  });

  if (q.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <ErrorState
        title="护栏配置加载失败"
        description={q.error.message + "（GET /admin/guardrails）"}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    );
  }

  const data = q.data;
  if (data === undefined) {
    return <ErrorState title="护栏配置为空" description="控制面返回了空响应。" />;
  }
  const config = data.config;
  const caps = data.capabilities;

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

  const update = (mutate: (current: GuardrailConfig) => void) => {
    if (draft === null) return;
    const next = structuredClone(draft);
    mutate(next);
    setDraft(next);
  };

  const updateGuard = (phase: Phase, index: number, mutate: (guard: GuardConfig) => void) => {
    update((next) => {
      const guard = next[phase][index];
      if (guard !== undefined) mutate(guard);
    });
  };

  const setGuardKind = (phase: Phase, index: number, kind: "regex" | "webhook") => {
    update((next) => {
      const guard = next[phase][index];
      if (guard === undefined) return;
      if (kind === "webhook") {
        guard.kind = "webhook";
        guard.action = guard.action === "mask" ? "reject" : guard.action;
        guard.rules = [];
        guard.scope = [];
      } else {
        guard.kind = "regex";
        guard.action = guard.action === "length" ? "mask" : guard.action;
        if (guard.rules.length === 0) guard.rules = [{ pattern: "", builtin: "ssn" }];
      }
    });
  };

  const submitForm = () => {
    if (draft === null) return;
    setSaveError(null);
    save.mutate(draft);
  };

  const submitRaw = () => {
    try {
      const parsed = parseJsonDocument<GuardrailConfig>(rawText);
      setRawError(undefined);
      setSaveError(null);
      save.mutate(parsed);
    } catch (error) {
      setRawError((error as Error).message);
    }
  };

  const busy = save.isPending || reset.isPending;

  const renderGuardEditor = (phase: Phase, guard: GuardConfig, index: number) => {
    const actions = guard.kind === "webhook" ? WEBHOOK_ACTIONS : REGEX_ACTIONS;
    return (
      <div key={phase + "-" + index} className="space-y-2 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={guard.kind === "webhook" ? "info" : "neutral"}>
            {phase === "request" ? "request" : "response"}[{index}]
          </Badge>
          <Select
            value={guard.kind}
            onValueChange={(value) => setGuardKind(phase, index, value as "regex" | "webhook")}
          >
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="regex">regex 正则</SelectItem>
              <SelectItem value="webhook">webhook</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={guard.action}
            onValueChange={(value) =>
              updateGuard(phase, index, (item) => {
                item.action = value;
              })
            }
          >
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {actions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() =>
              update((next) => {
                next[phase].splice(index, 1);
              })
            }
          >
            删除护栏
          </Button>
        </div>

        {guard.kind === "webhook" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-2xs text-body">审核服务 host（不能带路径）</Label>
              <Input
                value={guard.webhook_target}
                placeholder="https://audit.example"
                onChange={(event) =>
                  updateGuard(phase, index, (item) => {
                    item.webhook_target = event.target.value;
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-2xs text-body">失败模式</Label>
              <Select
                value={guard.failure_mode}
                onValueChange={(value) =>
                  updateGuard(phase, index, (item) => {
                    item.failure_mode = value as "failClosed" | "failOpen";
                  })
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="failClosed">failClosed 审核失败即拒绝</SelectItem>
                  <SelectItem value="failOpen">failOpen 审核失败放行</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-2xs text-faint sm:col-span-2">
              AG 1.7 webhook 固定检查 systemPrompt + messages，不支持 scope；target 只接受 host。
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-2xs text-body">规则（内置敏感信息或自定义正则）</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateGuard(phase, index, (item) => {
                      item.rules.push({ pattern: "", builtin: "ssn" });
                    })
                  }
                >
                  添加规则
                </Button>
              </div>
              {guard.rules.length === 0 && (
                <p className="text-2xs text-danger-text">regex 护栏至少需要一条规则。</p>
              )}
              {guard.rules.map((rule, ruleIndex) => {
                const builtinMode = rule.builtin !== "";
                return (
                  <div key={ruleIndex} className="flex flex-wrap items-center gap-1.5">
                    <Select
                      value={builtinMode ? "builtin" : "pattern"}
                      onValueChange={(value) =>
                        updateGuard(phase, index, (item) => {
                          item.rules[ruleIndex] =
                            value === "builtin"
                              ? { pattern: "", builtin: "ssn" }
                              : { pattern: "", builtin: "" };
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="builtin">内置敏感信息</SelectItem>
                        <SelectItem value="pattern">自定义正则</SelectItem>
                      </SelectContent>
                    </Select>
                    {builtinMode ? (
                      <Select
                        value={rule.builtin}
                        onValueChange={(value) =>
                          updateGuard(phase, index, (item) => {
                            item.rules[ruleIndex] = { pattern: "", builtin: value };
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BUILTINS.map((builtin) => (
                            <SelectItem key={builtin.value} value={builtin.value}>
                              {builtin.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={rule.pattern}
                        placeholder="secret-[0-9]+"
                        className="h-8 max-w-xs font-mono text-xs"
                        onChange={(event) =>
                          updateGuard(phase, index, (item) => {
                            item.rules[ruleIndex] = { pattern: event.target.value, builtin: "" };
                          })
                        }
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        updateGuard(phase, index, (item) => {
                          item.rules.splice(ruleIndex, 1);
                        })
                      }
                    >
                      移除
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label className="text-2xs text-body">检查范围 scope</Label>
              <div className="flex flex-wrap gap-3">
                {SCOPES.map((scope) => {
                  const checked = guard.scope.includes(scope.value);
                  return (
                    <label key={scope.value} className="flex items-center gap-1.5 text-2xs text-body">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          updateGuard(phase, index, (item) => {
                            item.scope =
                              value === true
                                ? [...item.scope, scope.value]
                                : item.scope.filter((entry) => entry !== scope.value);
                          })
                        }
                      />
                      <span className="font-mono">{scope.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-2xs text-body">拒绝状态码（可选，4xx/5xx）</Label>
            <Input
              value={guard.rejection_status === 0 ? "" : String(guard.rejection_status)}
              inputMode="numeric"
              placeholder="403"
              onChange={(event) =>
                updateGuard(phase, index, (item) => {
                  item.rejection_status =
                    event.target.value === "" ? 0 : Number(event.target.value);
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-2xs text-body">拒绝响应体（可选）</Label>
            <Input
              value={guard.rejection_body}
              placeholder="blocked by policy"
              onChange={(event) =>
                updateGuard(phase, index, (item) => {
                  item.rejection_body = event.target.value;
                })
              }
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2sm text-faint">
          护栏支持 regex（内置敏感信息 + 自定义正则）与 webhook 审核的安全子集；保存后自动走
          apply 流程，不支持的能力由后端显式拒绝。
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
          description="整份护栏文档；JSON 语法错误会阻止保存。"
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
            title="流式检查"
            description="streaming 开关；AG 1.7 支持 Disabled / Enabled。"
            actions={<CapabilityBadge capability={caps.regex} />}
          >
            <div className="flex items-center gap-2">
              <Switch
                aria-label="流式响应也做护栏检查"
                checked={draft.streaming === "Enabled"}
                onCheckedChange={(checked) =>
                  update((next) => {
                    next.streaming = checked ? "Enabled" : "Disabled";
                  })
                }
                disabled={!caps.regex.supported}
              />
              <span className="text-2xs text-body">
                {draft.streaming === "Enabled" ? "流式响应也做护栏检查" : "仅检查完整消息"}
              </span>
            </div>
          </SectionCard>

          {(["request", "response"] as Phase[]).map((phase) => (
            <SectionCard
              key={phase}
              title={phase === "request" ? "请求护栏 request" : "响应护栏 response"}
              description={
                phase === "request"
                  ? "在发往模型前检查；scope 决定检查哪些对话字段。"
                  : "在返回客户端前检查；webhook 审核同样可用。"
              }
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update((next) => {
                      next[phase].push(phase === "request" ? newRegexGuard() : newRegexGuard());
                    })
                  }
                >
                  添加护栏
                </Button>
              }
            >
              {draft[phase].length === 0 ? (
                <p className="text-2xs text-faint">尚未配置 {phase} 护栏。</p>
              ) : (
                <div className="space-y-2">
                  {draft[phase].map((guard, index) => renderGuardEditor(phase, guard, index))}
                </div>
              )}
              <div className="mt-2 flex gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update((next) => {
                      next[phase].push(newWebhookGuard());
                    })
                  }
                >
                  添加 webhook 审核
                </Button>
              </div>
            </SectionCard>
          ))}

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
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {(["request", "response"] as Phase[]).map((phase) => (
              <SectionCard
                key={phase}
                title={phase === "request" ? "请求护栏 request" : "响应护栏 response"}
                description={phase === "request" ? "发往模型前检查" : "返回客户端前检查"}
                actions={<Badge tone="info">{config[phase].length} 条</Badge>}
              >
                {config[phase].length === 0 ? (
                  <p className="text-2xs text-faint">未配置；点击「编辑」添加。</p>
                ) : (
                  <div className="space-y-2">
                    {config[phase].map((guard, index) => (
                      <div key={index} className="rounded-md border border-border p-2 text-2xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-body">{guard.kind}</span>
                          <Badge tone="neutral">{guard.action}</Badge>
                          {guard.kind === "webhook" && <Badge tone="info">{guard.failure_mode}</Badge>}
                          {guard.rejection_status !== 0 && (
                            <Badge tone="warning">reject {guard.rejection_status}</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-faint">
                          {guard.kind === "webhook"
                            ? guard.webhook_target || "未填写审核地址"
                            : guard.rules
                                .map((rule) => rule.builtin || rule.pattern)
                                .join("、") || "无规则"}
                        </div>
                        {guard.kind === "regex" && guard.scope.length > 0 && (
                          <div className="mt-0.5 font-mono text-2xs text-faint">
                            scope: {guard.scope.join(", ")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            ))}
            <SectionCard
              title="流式检查"
              description="streaming 开关"
              actions={<CapabilityBadge capability={caps.regex} />}
            >
              <p className="text-2xs text-body">
                {config.streaming === "Enabled" ? "已启用流式检查" : "未启用（仅检查完整消息）"}
              </p>
            </SectionCard>
          </div>

          <SectionCard
            title={`能力矩阵 · ${data.adapter}`}
            description="数据面声明；不支持项在表单中已禁用，后端也会 422 拒绝。"
            actions={<CapabilityBadge capability={caps.webhook} />}
          >
            <TableWrap className="rounded-md border border-border">
              <Table>
                <THead>
                  <tr>
                    <TH>能力键</TH>
                    <TH>支持</TH>
                    <TH>起始版本</TH>
                    <TH>已验证</TH>
                    <TH>说明</TH>
                  </tr>
                </THead>
                <tbody>
                  {data.items.map((item) => (
                    <TR key={item.key}>
                      <TD className="font-mono text-2xs">{item.key}</TD>
                      <TD>
                        {item.supported ? <Badge tone="success">支持</Badge> : <Badge tone="neutral">不支持</Badge>}
                      </TD>
                      <TD className="tnum text-2xs">{item.since_version || "—"}</TD>
                      <TD>
                        {item.verified ? <Badge tone="success">已验证</Badge> : <Badge tone="neutral">未验证</Badge>}
                      </TD>
                      <TD className="text-2xs text-body">{item.note}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <p className="mt-2 text-2xs text-faint">{data.note}</p>
          </SectionCard>
        </>
      )}
    </div>
  );
}
