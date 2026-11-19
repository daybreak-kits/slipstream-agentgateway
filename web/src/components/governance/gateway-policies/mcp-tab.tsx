import { useState } from "react";
import { toast } from "sonner";

import { DirtyHint, TransportBadgeNote } from "./shared";
import { type McpDraftDocument } from "./helpers";
import { RawJsonEditor } from "@/components/governance/raw-json-editor";
import { PageToolbar, SectionCard } from "@/components/governance/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  linesToList,
  listToLines,
  parseJsonDocument,
  type McpServerConfig,
  type McpServersResponse,
} from "@/lib/policies";

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
  return <span className="font-mono text-2xs text-body">{target || "未填写目标"}</span>;
}

/**
 * 网关策略·MCP Tab：server 列表 + 单服务器表单 + 原始 JSON，全部只改草稿；
 * 校验与保存统一走页级动作条（PUT /admin/mcp-servers 整份文档 + apply）。
 * http 传输被 pinned AG 1.7 拒收：下拉里禁用并注明。
 */
export function McpTab({ data, draft, onDraftChange, canWrite, dirtyCount }: {
  data: McpServersResponse;
  draft: McpDraftDocument | null;
  onDraftChange: (draft: McpDraftDocument | null) => void;
  canWrite: boolean;
  dirtyCount: number;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | undefined>(undefined);
  // 单服务器子表单：formIndex=null 表示新增，否则是草稿里该下标的编辑。
  const [form, setForm] = useState<McpServerConfig | null>(null);
  const [formIndex, setFormIndex] = useState<number | null>(null);
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const servers = draft?.servers ?? data.servers;
  const editing = draft !== null;

  const startEdit = () => {
    onDraftChange({ servers: structuredClone(data.servers), port: data.port });
    setRawError(undefined);
  };

  const startRaw = () => {
    setRawText(JSON.stringify(draft ?? { servers: data.servers, port: data.port }, null, 2));
    setRawError(undefined);
    setRawOpen(true);
  };

  const cancel = () => {
    onDraftChange(null);
    setRawOpen(false);
    setForm(null);
    setFormIndex(null);
    setFormError(null);
    setRawError(undefined);
  };

  const updateDraft = (mutate: (doc: McpDraftDocument) => void) => {
    if (draft === null) return;
    const next = structuredClone(draft);
    mutate(next);
    onDraftChange(next);
  };

  const openNewForm = () => {
    setForm(newServer());
    setFormIndex(null);
    setArgsText("");
    setEnvText("");
    setFormError(null);
  };

  const openEditForm = (index: number) => {
    const server = structuredClone(servers[index]);
    if (server === undefined) return;
    setForm(server);
    setFormIndex(index);
    setArgsText(listToLines(server.args));
    setEnvText(envToLines(server.env));
    setFormError(null);
  };

  const closeForm = () => {
    setForm(null);
    setFormIndex(null);
    setFormError(null);
  };

  const updateForm = (mutate: (server: McpServerConfig) => void) => {
    if (form === null) return;
    const next = structuredClone(form);
    mutate(next);
    setForm(next);
  };

  const confirmForm = () => {
    if (form === null) return;
    if (form.name.trim().length === 0) {
      setFormError("名称不能为空");
      return;
    }
    const name = form.name.trim();
    const duplicate =
      formIndex === null
        ? servers.some((server) => server.name === name)
        : servers.some((server, index) => index !== formIndex && server.name === name);
    if (duplicate) {
      setFormError("名称已存在：server 名称是唯一键");
      return;
    }
    let server: McpServerConfig;
    try {
      server = {
        ...form,
        name,
        args: linesToList(argsText),
        env: form.transport === "stdio" ? linesToEnv(envText) : {},
        port: form.transport === "sse" ? form.port : null,
      };
    } catch (error) {
      setFormError((error as Error).message);
      return;
    }
    updateDraft((doc) => {
      if (formIndex === null) doc.servers.push(server);
      else doc.servers[formIndex] = server;
    });
    closeForm();
  };

  const removeServer = (index: number) => {
    updateDraft((doc) => {
      doc.servers.splice(index, 1);
    });
  };

  const applyRaw = () => {
    try {
      const parsed = parseJsonDocument<McpDraftDocument>(rawText);
      if (!Array.isArray(parsed.servers)) throw new Error("servers 必须是数组");
      setRawError(undefined);
      onDraftChange({ servers: parsed.servers, port: parsed.port ?? null });
      setRawOpen(false);
      toast.success("JSON 已应用到草稿", { description: "确认无误后用页级动作条校验/保存" });
    } catch (error) {
      setRawError((error as Error).message);
    }
  };

  const transportBadge = (transport: McpServerConfig["transport"]) => {
    const cap = data.transports[transport];
    if (!cap.supported) return <Badge tone="neutral">AG 1.7 拒收</Badge>;
    return cap.verified ? <Badge tone="success">已验证</Badge> : <Badge tone="warning">未实测</Badge>;
  };

  return (
    <div className="space-y-3">
      <PageToolbar>
        <span className="text-2sm text-faint">
          MCP 服务器落库为顶层 mcp.targets；页级「保存并下发」整份提交并自动 apply。
          sse/stdio 已用 pinned AG 1.7 --validate-only 验证，http 与 url 字段会被后端显式拒绝。
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {!editing && canWrite ? (
            <>
              <Button variant="outline" size="sm" onClick={startRaw}>原始 JSON</Button>
              <Button variant="primary" size="sm" onClick={startEdit}>编辑</Button>
            </>
          ) : editing ? (
            <Button variant="ghost" size="sm" onClick={cancel}>取消</Button>
          ) : null}
        </div>
      </PageToolbar>

      <DirtyHint count={dirtyCount} />

      {rawOpen ? (
        <SectionCard
          title="原始 JSON 高级编辑"
          description="整份 MCP 文档 {servers, port}；「应用 JSON 更改」先写回草稿，再由页级动作条校验与保存。port 是 mcp.port。"
          actions={
            <Button variant="primary" size="sm" onClick={applyRaw} disabled={rawError !== undefined}>
              应用 JSON 更改
            </Button>
          }
        >
          <RawJsonEditor value={rawText} onChange={setRawText} error={rawError} />
        </SectionCard>
      ) : (
        <>
          <SectionCard
            title="服务器"
            description={data.note}
            actions={
              editing ? (
                <Button variant="outline" size="sm" onClick={openNewForm}>新增服务器</Button>
              ) : (
                <TransportBadgeNote supported={data.supported} />
              )
            }
          >
            {servers.length === 0 ? (
              <p className="text-2xs text-faint">
                尚未注册服务器；{editing ? "点击「新增服务器」。" : "点击「编辑」后新增。"}
              </p>
            ) : (
              <TableWrap className="rounded-md border border-border">
                <Table>
                  <THead>
                    <tr>
                      <TH>名称</TH>
                      <TH>传输</TH>
                      <TH>目标</TH>
                      <TH>参数 / 环境变量</TH>
                      {editing && <TH className="text-right">操作</TH>}
                    </tr>
                  </THead>
                  <tbody>
                    {servers.map((server, index) => (
                      <TR key={server.name + "-" + index}>
                        <TD className="font-mono text-2xs text-title">{server.name}</TD>
                        <TD>
                          <div className="flex items-center gap-1.5">
                            <Badge tone={data.transports[server.transport]?.supported ? "success" : "neutral"}>
                              {server.transport}
                            </Badge>
                            {!data.transports[server.transport]?.supported && (
                              <span className="text-2xs text-warning-text">AG 1.7 拒收该传输</span>
                            )}
                          </div>
                        </TD>
                        <TD><ServerSummary server={server} /></TD>
                        <TD className="text-2xs text-faint">
                          {server.transport === "stdio"
                            ? [
                                (server.args ?? []).length > 0 ? (server.args ?? []).join(" ") : "",
                                Object.keys(server.env ?? {}).length > 0 ? Object.keys(server.env ?? {}).join(", ") : "",
                              ].filter((item) => item.length > 0).join(" · ") || "—"
                            : "—"}
                        </TD>
                        {editing && (
                          <TD className="text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button variant="outline" size="sm" onClick={() => openEditForm(index)}>
                                编辑
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => removeServer(index)}>
                                移除
                              </Button>
                            </div>
                          </TD>
                        )}
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
            {editing && (
              <p className="mt-2 text-2xs text-faint">
                编辑/移除只改草稿；点页级「保存并下发」后才写库并 apply。取消可撤销全部改动。
              </p>
            )}
          </SectionCard>

          {form !== null && (
            <SectionCard
              title={formIndex === null ? "新增 MCP 服务器" : "编辑 MCP 服务器 · " + servers[formIndex]?.name}
              description="sse 使用 host（AG 1.7 没有 url 字段）；stdio 使用 cmd/args/env。"
              actions={transportBadge(form.transport)}
            >
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-2xs text-body">名称</Label>
                    <Input
                      value={form.name}
                      onChange={(event) => updateForm((next) => { next.name = event.target.value; })}
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
                          http（AG 1.7 拒收）
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-2xs text-body">能力</Label>
                    <p className="text-2xs text-faint">
                      supported={String(data.transports[form.transport].supported)} ·
                      verified={String(data.transports[form.transport].verified)}
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
                  <Button variant="primary" size="sm" onClick={confirmForm}>
                    写入草稿
                  </Button>
                  <Button variant="ghost" size="sm" onClick={closeForm}>
                    取消
                  </Button>
                </div>
              </div>
            </SectionCard>
          )}

          <SectionCard
            title="传输能力"
            description="来自适配器能力矩阵；表单会禁用不支持项（http 被 AG 1.7 拒收），后端仍会兜底拒绝。"
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {(["sse", "stdio", "http"] as const).map((transport) => (
                <div key={transport} className="rounded-md border border-border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-2xs text-title">{transport}</span>
                    {transportBadge(transport)}
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
