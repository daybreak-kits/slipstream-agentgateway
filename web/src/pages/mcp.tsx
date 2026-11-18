import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/lib/permissions";
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
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, ENDPOINTS } from "@/lib/api";
import {
  linesToList,
  listToLines,
  parseJsonDocument,
  type CapabilityInfo,
  type McpServerConfig,
  type McpServersResponse,
} from "@/lib/policies";

type Mode = "view" | "edit" | "raw";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const lines = error.errorLines();
    return lines.length > 0 ? error.message + "：" + lines.join("；") : error.message;
  }
  return (error as Error).message;
}

function TransportBadge({ capability }: { capability: CapabilityInfo }) {
  if (!capability.supported) return <Badge tone="neutral">AG 1.7 拒绝</Badge>;
  return capability.verified ? <Badge tone="success">已验证</Badge> : <Badge tone="warning">未实测</Badge>;
}

function newServer(): McpServerConfig {
  return {
    name: "",
    transport: "stdio",
    host: "",
    url: "",
    port: null,
    path: "",
    cmd: "",
    args: [],
    env: {},
  };
}

function envToLines(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => key + "=" + value)
    .join("\n");
}

function linesToEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of linesToList(text)) {
    const index = line.indexOf("=");
    if (index <= 0) throw new Error("环境变量必须是 KEY=VALUE：" + line);
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return env;
}

function ServerSummary({ server }: { server: McpServerConfig }) {
  const target =
    server.transport === "stdio"
      ? [server.cmd, ...(server.args ?? [])].filter((item) => item.length > 0).join(" ")
      : server.host + (server.path ? ":" + server.port + server.path : "");
  return (
    <span className="font-mono text-2xs text-body">{target || "未填写目标"}</span>
  );
}

export function McpPage() {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => api.get<McpServersResponse>(ENDPOINTS.mcpServers),
  });
  const [mode, setMode] = useState<Mode>("view");
  const { can } = usePermissions();
  const canWrite = can("policies:write");
  const [form, setForm] = useState<McpServerConfig | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    void queryClient.invalidateQueries({ queryKey: ["config-status"] });
  };

  const saveServer = useMutation({
    mutationFn: async (server: McpServerConfig) => {
      if (editingName === null) {
        await api.post(ENDPOINTS.mcpServers, server);
      } else {
        await api.put(ENDPOINTS.mcpServer(editingName), server);
      }
      return api.post<{ id: string }>(ENDPOINTS.configApply, { reason: "控制面 MCP 编辑" });
    },
    onSuccess: (revision) => {
      toast.success("MCP 服务器已保存并下发", { description: "配置修订 " + revision.id });
      setMode("view");
      setForm(null);
      setEditingName(null);
      setSaveError(null);
      refresh();
    },
    onError: (error) => setSaveError(describeError(error)),
  });

  const deleteServer = useMutation({
    mutationFn: async (name: string) => {
      await api.del<unknown>(ENDPOINTS.mcpServer(name));
      return api.post<{ id: string }>(ENDPOINTS.configApply, { reason: "删除 MCP 服务器" });
    },
    onSuccess: (revision) => {
      toast.success("MCP 服务器已删除并下发", { description: "配置修订 " + revision.id });
      refresh();
    },
    onError: (error) => toast.error("删除失败", { description: describeError(error) }),
  });

  const saveRaw = useMutation({
    mutationFn: async (document: { servers: McpServerConfig[]; port: number | null }) => {
      await api.put(ENDPOINTS.mcpServers, document);
      return api.post<{ id: string }>(ENDPOINTS.configApply, { reason: "控制面 MCP JSON 编辑" });
    },
    onSuccess: (revision) => {
      toast.success("MCP 配置已保存并下发", { description: "配置修订 " + revision.id });
      setMode("view");
      setSaveError(null);
      refresh();
    },
    onError: (error) => setSaveError(describeError(error)),
  });

  const validate = useMutation({
    mutationFn: (document: { servers: McpServerConfig[]; port: number | null }) =>
      api.post<{ ok: boolean; errors: string[]; warnings: string[] }>(ENDPOINTS.mcpValidate, document),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("MCP 配置通过 AG 1.7 校验");
      } else {
        toast.error("MCP 配置未通过校验", { description: result.errors.join("；") });
      }
    },
    onError: (error) => toast.error("校验请求失败", { description: describeError(error) }),
  });

  if (q.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <ErrorState
        title="MCP 配置加载失败"
        description={q.error.message + "（GET /admin/mcp-servers）"}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    );
  }

  const data = q.data;
  if (data === undefined) {
    return <ErrorState title="MCP 配置为空" description="控制面返回了空响应。" />;
  }

  const startNew = () => {
    const server = newServer();
    setForm(server);
    setArgsText("");
    setEnvText("");
    setEditingName(null);
    setFormError(null);
    setSaveError(null);
    setMode("edit");
  };

  const startEdit = (server: McpServerConfig) => {
    const copy = structuredClone(server);
    setForm(copy);
    setArgsText(listToLines(copy.args));
    setEnvText(envToLines(copy.env));
    setEditingName(server.name);
    setFormError(null);
    setSaveError(null);
    setMode("edit");
  };

  const startRaw = () => {
    setRawText(JSON.stringify({ servers: data.servers, port: data.port }, null, 2));
    setRawError(undefined);
    setSaveError(null);
    setMode("raw");
  };

  const cancel = () => {
    setMode("view");
    setForm(null);
    setEditingName(null);
    setFormError(null);
    setRawError(undefined);
    setSaveError(null);
  };

  const updateForm = (mutate: (server: McpServerConfig) => void) => {
    if (form === null) return;
    const next = structuredClone(form);
    mutate(next);
    setForm(next);
  };

  const submitForm = () => {
    if (form === null) return;
    if (form.name.trim().length === 0) {
      setFormError("名称不能为空");
      return;
    }
    let server: McpServerConfig;
    try {
      server = {
        ...form,
        name: form.name.trim(),
        args: linesToList(argsText),
        env: form.transport === "stdio" ? linesToEnv(envText) : {},
        port: form.transport === "sse" ? form.port : null,
      };
    } catch (error) {
      setFormError((error as Error).message);
      return;
    }
    setFormError(null);
    setSaveError(null);
    saveServer.mutate(server);
  };

  const submitRaw = () => {
    try {
      const parsed = parseJsonDocument<{ servers: McpServerConfig[]; port: number | null }>(rawText);
      if (!Array.isArray(parsed.servers)) throw new Error("servers 必须是数组");
      setRawError(undefined);
      setSaveError(null);
      saveRaw.mutate({ servers: parsed.servers, port: parsed.port ?? null });
    } catch (error) {
      setRawError((error as Error).message);
    }
  };

  const busy = saveServer.isPending || saveRaw.isPending || deleteServer.isPending;

  const renderForm = () => {
    if (form === null) return null;
    const transportCap = data.transports[form.transport];
    return (
      <SectionCard
        title={editingName === null ? "新增 MCP 服务器" : "编辑 MCP 服务器 · " + editingName}
        description="sse 使用 host（AG 1.7 没有 url 字段）；stdio 使用 cmd/args/env。http 变体被 pinned 1.7 拒绝。"
        actions={<TransportBadge capability={transportCap} />}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-2xs text-body">名称</Label>
              <Input
                value={form.name}
                onChange={(event) => updateForm((next) => { next.name = event.target.value; })}
                disabled={editingName !== null}
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-2xs text-body">传输</Label>
              <Select
                value={form.transport}
                onValueChange={(value) =>
                  updateForm((next) => {
                    next.transport = value as McpServerConfig["transport"];
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sse">sse</SelectItem>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="http" disabled>
                    http（AG 1.7 拒绝）
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-2xs text-body">能力</Label>
              <p className="text-2xs text-faint">
                supported={String(transportCap.supported)} · verified={String(transportCap.verified)}
              </p>
            </div>
          </div>

          {form.transport === "stdio" ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-2xs text-body">命令 cmd</Label>
                <Input
                  value={form.cmd}
                  placeholder="npx"
                  onChange={(event) => updateForm((next) => { next.cmd = event.target.value; })}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-2xs text-body">参数 args（每行一个）</Label>
                <Textarea
                  value={argsText}
                  onChange={(event) => setArgsText(event.target.value)}
                  className="min-h-[72px] font-mono text-xs"
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem"}
                />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-2xs text-body">环境变量 env（每行 KEY=VALUE）</Label>
                <Textarea
                  value={envText}
                  onChange={(event) => setEnvText(event.target.value)}
                  className="min-h-[72px] font-mono text-xs"
                  placeholder="TOKEN=..."
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-2xs text-body">host（AG 1.7 sse 字段）</Label>
                <Input
                  value={form.host}
                  placeholder="https://mcp.example"
                  onChange={(event) => updateForm((next) => { next.host = event.target.value; })}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-2xs text-body">port（与 path 成对）</Label>
                <Input
                  value={form.port ?? ""}
                  inputMode="numeric"
                  aria-label="MCP 服务器端口"
                  onChange={(event) => {
                    const raw = event.target.value;
                    const parsed = Number(raw);
                    updateForm((next) => {
                      // 非数字输入不落库：避免 NaN 进入受控 value（React 会告警且输入框显示 NaN）。
                      next.port = raw === "" ? null : Number.isFinite(parsed) ? parsed : next.port;
                    });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-2xs text-body">path（与 port 成对）</Label>
                <Input
                  value={form.path}
                  placeholder="/sse"
                  onChange={(event) => updateForm((next) => { next.path = event.target.value; })}
                  className="font-mono"
                />
              </div>
            </div>
          )}

          {formError !== null && <p className="text-2xs text-danger-text">{formError}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={submitForm} disabled={busy}>
              {saveServer.isPending ? "保存并下发中…" : "保存并下发"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => validate.mutate({ servers: [form], port: data.port })}
              disabled={busy || validate.isPending}
            >
              仅校验当前服务器
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
              取消
            </Button>
          </div>
        </div>
      </SectionCard>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2sm text-faint">
          MCP 服务器落库为顶层 mcp.targets；保存后自动 apply。sse/stdio 已用 pinned AG 1.7
          --validate-only 验证，http 与 url 字段会被后端显式拒绝。
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          {mode === "view" && canWrite ? (
            <>
              <Button variant="outline" size="sm" onClick={startRaw}>
                原始 JSON
              </Button>
              <Button variant="primary" size="sm" onClick={startNew}>
                新增服务器
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
          description="整份 MCP 文档 {servers, port}；JSON 语法错误会阻止保存。"
          actions={
            <Button variant="primary" size="sm" onClick={submitRaw} disabled={busy || rawError !== undefined}>
              {saveRaw.isPending ? "保存中…" : "保存并下发"}
            </Button>
          }
        >
          <RawJsonEditor value={rawText} onChange={setRawText} error={rawError} disabled={busy} />
        </SectionCard>
      ) : mode === "edit" ? (
        renderForm()
      ) : (
        <>
          <SectionCard
            title="服务器"
            description={data.note}
            actions={<Badge tone={data.supported ? "success" : "warning"}>{data.supported ? "MCP 已启用" : "MCP 不支持"}</Badge>}
          >
            {data.servers.length === 0 ? (
              <p className="text-2xs text-faint">尚未注册服务器；点击「新增服务器」。</p>
            ) : (
              <TableWrap className="rounded-md border border-border">
                <Table>
                  <THead>
                    <tr>
                      <TH>名称</TH>
                      <TH>传输</TH>
                      <TH>目标</TH>
                      <TH>参数 / 环境变量</TH>
                      <TH className="text-right">操作</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {data.servers.map((server) => (
                      <TR key={server.name}>
                        <TD className="font-mono text-2xs text-title">{server.name}</TD>
                        <TD>
                          <Badge tone={data.transports[server.transport]?.supported ? "success" : "neutral"}>
                            {server.transport}
                          </Badge>
                        </TD>
                        <TD><ServerSummary server={server} /></TD>
                        <TD className="text-2xs text-faint">
                          {server.transport === "stdio"
                            ? [(server.args ?? []).length > 0 ? (server.args ?? []).join(" ") : "", Object.keys(server.env ?? {}).length > 0 ? Object.keys(server.env ?? {}).join(", ") : ""].filter((item) => item.length > 0).join(" · ") || "—"
                            : "—"}
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => startEdit(server)}>
                              编辑
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (window.confirm("删除 MCP 服务器 " + server.name + "？")) {
                                  deleteServer.mutate(server.name);
                                }
                              }}
                              disabled={busy}
                            >
                              删除
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </SectionCard>

          <SectionCard
            title="传输能力"
            description="来自适配器能力矩阵；表单会禁用不支持项，后端仍会兜底拒绝。"
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {(["sse", "stdio", "http"] as const).map((transport) => (
                <div key={transport} className="rounded-md border border-border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-2xs text-title">{transport}</span>
                    <TransportBadge capability={data.transports[transport]} />
                  </div>
                  <p className="mt-1 text-2xs text-faint">{data.transports[transport].note}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-2xs text-faint">
              原始 JSON 中 port 是 mcp.port；target 的 port/path 必须成对出现。
            </p>
          </SectionCard>
        </>
      )}
    </div>
  );
}
