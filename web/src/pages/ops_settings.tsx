import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, ScrollText, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { toast } from "@/lib/notify";

import { fmtMs } from "@/lib/format";
import { ErrorState, SectionCard } from "@/components/governance/panel";
import {
  RUN_INFO_KEYS,
  inferField,
  isRunInfoKey,
  normalizeSettings,
  type SettingFieldDef,
  type SettingGroupDef,
  type SettingsItem,
} from "@/components/governance/settings-schema";
import { SettingsGrid, SettingsTile } from "@/components/settings/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DirtyField, DirtyFooter, DirtySaveButton } from "@/components/ui/dirty-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { controlPlane } from "@/lib/control-plane";
import { ACTION_ICONS } from "@/lib/icons";
import { usePermissions } from "@/lib/permissions";
import { useDirtyFields } from "@/lib/use-dirty-fields";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { CONNECTION_QUERY_KEY, useConnection, validateBaseUrl } from "@/lib/settings-ia";
import { dataPlanePortCopy, defaultBaseUrl, effectiveBaseUrl, isDataPlaneEnabled } from "@/lib/url";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";

const SETTINGS_KEY = ["settings"] as const;
const SETTINGS_SCHEMA_KEY = ["settings", "schema"] as const;
type SectionKey = "connection" | "system" | "runtime";

const SECTIONS: Array<{ key: SectionKey; label: string; hint: string; icon: typeof Link2 }> = [
  { key: "connection", label: "连接地址", hint: "所有用户共用的统一接入地址", icon: Link2 },
  { key: "system", label: "系统参数", hint: "计量、时区、留存与默认限流", icon: Settings2 },
  { key: "runtime", label: "运行信息", hint: "环境变量型配置，只读", icon: ScrollText },
];

function validateField(field: SettingFieldDef, raw: string): string | null {
  if (raw.trim().length === 0) return "不能为空";
  if (field.kind === "number") {
    if (!/^\d+$/.test(raw.trim())) return "请输入非负整数";
    const numeric = Number(raw);
    if (field.min !== null && numeric < field.min) return "不能小于 " + field.min;
    if (field.max !== null && numeric > field.max) return "不能大于 " + field.max;
  }
  return null;
}

/** 个别设置键的 UI 说明文案（覆盖 schema 通用描述）；键 absent 时不影响其它字段。 */
const FIELD_DESCRIPTION_OVERRIDES: Record<string, string> = {
  // ADR-021：正文记录开关的说明基调——磁盘线性增长 + 敏感内容合规提示。
  ag_access_log_llm:
    "开启后记录请求/响应正文（prompt 与 completion），磁盘随流量线性增长并随日志保留期清理；正文含用户敏感内容，开启前请评估合规要求。",
};

/** 单个设置字段卡：只读值 ⇄ 编辑控件，保存时只 PUT 这一个键。 */
function FieldTile({ field, value, missing, canWrite }: {
  field: SettingFieldDef;
  value: string;
  missing: boolean;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: string) => controlPlane.settings.saveSettings({ [field.key]: next }),
    onSuccess: () => {
      toast.success(field.label + " 已保存");
      setEditing(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const start = () => {
    setDraft(value);
    setError(null);
    setEditing(true);
  };

  const commit = () => {
    const nextError = validateField(field, draft);
    setError(nextError);
    if (nextError) return;
    if (draft.trim() === value) {
      setEditing(false);
      return;
    }
    save.mutate(draft.trim());
  };

  const selectValue = (editing ? draft : value) || (field.options?.[0]?.value ?? "");

  return (
    <SettingsTile
      title={field.label}
      hint={
        <>
          {field.description}
          {field.key && <span className="ml-1 break-all font-mono text-2xs text-faint">{field.key}</span>}
          {missing && <Badge tone="warning" className="ml-1">后端未下发 · 默认值</Badge>}
        </>
      }
      action={
        canWrite && !editing ? (
          <Button variant="outline" size="sm" onClick={start}>
            <ACTION_ICONS.edit className="h-3.5 w-3.5" /> 编辑
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <>
          {field.kind === "select" ? (
            <Select value={selectValue} onValueChange={setDraft}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="选择值" />
              </SelectTrigger>
              <SelectContent>
                {(field.options ?? []).map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-1.5">
              <Input
                className={cn("h-8 tnum", field.kind === "text" && "font-mono")}
                aria-label={field.label}
                value={draft}
                inputMode={field.kind === "number" ? "numeric" : "text"}
                onChange={(event) => setDraft(event.target.value)}
              />
              {field.unit !== undefined && <span className="whitespace-nowrap text-2xs text-faint">{field.unit}</span>}
            </div>
          )}
          {error !== null && <p className="text-2xs text-danger-text">{error}</p>}
          <div className="flex gap-1.5">
            <Button variant="primary" size="sm" disabled={save.isPending} onClick={commit}>
              <ACTION_ICONS.save className="h-3.5 w-3.5" /> {save.isPending ? "保存中…" : "保存"}
            </Button>
            <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => setEditing(false)}>取消</Button>
          </div>
        </>
      ) : (
        <p className={cn("break-all text-sm font-medium text-title", field.kind === "text" && "font-mono text-2sm")}>
          {value}
          {field.unit !== undefined && <span className="ml-1 text-2xs font-normal text-faint">{field.unit}</span>}
        </p>
      )}
    </SettingsTile>
  );
}

/** 运营设置·连接地址：默认浏览器 host + 当前部署提供的数据面端口，可改公网地址，所有用户共用。 */
function ConnectionSection({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const connection = useConnection();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: string) => controlPlane.settings.saveSettings({ gateway_base_url: next }),
    onSuccess: () => {
      toast.success("连接地址已保存", { description: "所有用户的连接密钥页与概览会读取同一地址" });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: CONNECTION_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  useEffect(() => {
    if (connection.data) setValue(connection.data.base_url);
  }, [connection.data]);

  const address = effectiveBaseUrl(connection.data);
  // baseline = 服务端当前值；保存成功 invalidate 后 fetch 回填，脏标记自然清零。
  const baseline = connection.data !== undefined ? { baseUrl: connection.data.base_url } : null;
  const { dirtyCount, isDirty, isDirtyField } = useDirtyFields(baseline, { baseUrl: value });
  const clientError = validateBaseUrl(value);
  // W4-G：连接地址改了没保存就点左侧子导航/侧栏离开 → 出确认框。
  const leaveGuard = useDirtyGuard(isDirty);

  const resetField = () => {
    if (!baseline) return;
    setValue(baseline.baseUrl);
    setError(null);
  };

  return (
    <>
    <SettingsGrid>
      <SettingsTile title="当前生效地址" hint="客户只能读，不能改。" className="md:col-span-3 xl:col-span-2">
        <p className="break-all font-mono text-2sm text-title">{connection.isPending ? "读取中…" : address}</p>
        <p className="text-2xs text-faint">
          {connection.isPending
            ? "读取连接设置…"
            : connection.data?.configured
              ? "来源：运营设置显式配置"
              : isDataPlaneEnabled(connection.data)
                ? dataPlanePortCopy("source-default", connection.data?.default_port)
                : dataPlanePortCopy("source-disabled")}
        </p>
        {connection.data?.updated_at && (
          <p className="text-2xs text-faint">更新于 {fmtMs(Date.parse(connection.data.updated_at))}</p>
        )}
      </SettingsTile>
      <SettingsTile
        title="公网连接地址"
        hint={dataPlanePortCopy("base-url-hint")}
        action={<Badge tone={connection.data?.configured ? "success" : "neutral"}>{connection.data?.configured ? "已配置" : "自动"}</Badge>}
        className="md:col-span-3 xl:col-span-3"
      >
        {connection.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : connection.isError ? (
          <p className="text-2xs text-danger-text">连接设置加载失败：{connection.error.message}</p>
        ) : (
          <>
            <DirtyField dirty={isDirtyField("baseUrl")} onReset={resetField} resetLabel="恢复连接地址">
              <div className="space-y-1.5">
                <Input
                  className="h-8 font-mono"
                  placeholder={
                    isDataPlaneEnabled(connection.data)
                      ? defaultBaseUrl(connection.data?.default_port)
                      : "https://gateway.example.com"
                  }
                  value={value}
                  disabled={!canWrite}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError(null);
                  }}
                />
                {clientError !== null && <p className="text-2xs text-danger-text">{clientError}</p>}
                {error !== null && <p className="text-2xs text-danger-text">保存失败：{error}</p>}
              </div>
            </DirtyField>
            {canWrite ? (
              <DirtyFooter count={dirtyCount} onResetAll={resetField} saving={save.isPending}>
                <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate("")}>
                  <ACTION_ICONS.restore className="h-3.5 w-3.5" /> 恢复默认
                </Button>
                <DirtySaveButton
                  dirty={isDirty}
                  pending={save.isPending}
                  onClick={() => save.mutate(value.trim())}
                  disabled={clientError !== null}
                >
                  保存
                </DirtySaveButton>
              </DirtyFooter>
            ) : (
              <p className="text-2xs text-faint">只读（缺少 settings:write）</p>
            )}
          </>
        )}
      </SettingsTile>
      <SettingsTile
        title="端口约定"
        hint={dataPlanePortCopy("port-hint")}
        className="md:col-span-3 xl:col-span-6"
      >
        <p className="text-2xs text-faint">
          默认值不落库：控制面只在显式配置公网地址时写入 gateway_base_url。{dataPlanePortCopy("reset-note")}
          端口为 0 或缺失表示数据面未启用（外部数据面），页面不会生成 host:0。
          同一份设置被连接密钥页、概览页与客户端配置示例统一读取。
        </p>
      </SettingsTile>
    </SettingsGrid>
    {leaveGuard}
    </>
  );
}

/** 运营设置·系统参数：沿用既有 settings-schema，字段卡一行最多 6 栏。 */
function SystemSection({ canWrite, items, groups }: {
  canWrite: boolean;
  items: SettingsItem[];
  groups: SettingGroupDef[];
}) {
  const serverValues = new Map(items.map((item) => [item.key, item.value]));
  const knownKeys = new Set(groups.flatMap((group) => group.fields.map((field) => field.key)));
  const unknownItems = items.filter((item) => !knownKeys.has(item.key) && !isRunInfoKey(item.key));
  const unknownGroup: SettingGroupDef | null =
    unknownItems.length === 0
      ? null
      : {
          key: "other",
          title: "其它设置",
          description: "控制面下发、但 schema 未登记说明的设置键；仍然可以编辑并保存。",
          fields: unknownItems.map(inferField),
        };
  const allGroups: SettingGroupDef[] = unknownGroup ? [...groups, unknownGroup] : groups;

  return (
    <div className="space-y-3">
      {/* 系统参数是 7 张窄卡：默认 6 栏在 1440 宽下每卡约 145px，标题会碎成竖排；此处降到 4 栏。 */}
      <SettingsGrid className="xl:grid-cols-4">
        {allGroups.flatMap((group) =>
          group.fields.map((field) => (
            <FieldTile
              key={field.key}
              field={{
                ...field,
                description:
                  FIELD_DESCRIPTION_OVERRIDES[field.key] ?? group.title + " · " + field.description,
              }}
              value={serverValues.get(field.key) ?? field.default}
              missing={!serverValues.has(field.key)}
              canWrite={canWrite}
            />
          )),
        )}
      </SettingsGrid>
      <p className="text-2xs text-faint">
        设置项以控制面为唯一权威：读取 GET /admin/settings，保存 PUT /admin/settings（values 只带改动的键）。
        保存失败保留页面原值并显示后端错误，不做静默本地覆盖。
      </p>
    </div>
  );
}

/** 运营设置·运行信息：环境变量型配置，只读。 */
function RuntimeSection({ items }: { items: SettingsItem[] }) {
  const runInfo = items.filter((item) => isRunInfoKey(item.key));
  return (
    <SectionCard
      title="运行信息（只读）"
      description="来自控制面环境变量（SLIPSTREAM_*），界面上不可修改；变更需要改部署配置后重启。"
    >
      {runInfo.length === 0 ? (
        <p className="text-2xs text-faint">
          控制面未下发运行信息键（gateway_artifact_path / usage_poll_interval_s / client_key_length / price_version）。
        </p>
      ) : (
        <TableWrap className="rounded-md border border-border">
          <Table>
            <THead>
              <tr>
                <TH>配置项</TH>
                <TH>值</TH>
                <TH className="text-right">更新时间</TH>
              </tr>
            </THead>
            <tbody>
              {runInfo.map((item) => {
                const known = RUN_INFO_KEYS.find((entry) => entry.key === item.key);
                return (
                  <TR key={item.key}>
                    <TD>
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="text-title">{known?.label ?? item.label ?? item.key}</span>
                        <span className="font-mono text-2xs text-faint">{item.key}</span>
                      </div>
                    </TD>
                    <TD className="tnum">{item.value}</TD>
                    <TD className="tnum text-right text-2xs text-faint">
                      {item.updated_at ? fmtMs(Date.parse(item.updated_at)) : "-"}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </SectionCard>
  );
}

/** 运营设置：左侧子导航 + 连接地址 / 系统参数 / 运行信息（ticket 16）。 */
export function OpsSettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const active = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0]!;
  const { can } = usePermissions();
  const canWrite = can("settings:write");
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => controlPlane.settings.getSettings(),
  });
  const schema = useQuery({
    queryKey: SETTINGS_SCHEMA_KEY,
    queryFn: () => controlPlane.settings.getSettingsSchema(),
    staleTime: 5 * 60_000,
  });
  const items = normalizeSettings(settings.data);
  // 连接地址有独立的读写交互（/admin/connection），系统参数只渲染其余分组。
  const allSchemaGroups = schema.data?.groups ?? [];
  const schemaGroups = allSchemaGroups.filter((group) => group.key !== "connection");
  const connectionKeys = new Set(
    allSchemaGroups
      .filter((group) => group.key === "connection")
      .flatMap((group) => group.fields.map((field) => field.key)),
  );
  const systemItems = items.filter((item) => !connectionKeys.has(item.key));

  return (
    <div className="space-y-3">
      <PageHeader
        title="运营设置"
        description="控制面级配置：左侧为页面内子导航；这里的改动影响所有控制台用户。"
      />
      <div className="flex flex-col gap-4 lg:flex-row">
        <nav aria-label="运营设置子导航" className="shrink-0 space-y-0.5 lg:w-44 lg:border-r lg:border-border lg:pr-3">
          {SECTIONS.map((item) => (
            <NavLink
              key={item.key}
              to={"/ops-settings/" + item.key}
              className={({ isActive }) =>
                cn(
                  "group flex items-start gap-2 rounded-control px-2.5 py-2 text-left transition-colors",
                  isActive || active.key === item.key
                    ? "bg-primary-soft text-primary"
                    : "text-body hover:bg-surface-2 hover:text-title",
                )
              }
            >
              <item.icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0">
                <span className="block text-2sm font-medium">{item.label}</span>
                <span className="hidden text-2xs text-faint group-hover:block group-focus-visible:block">
                  {item.hint}
                </span>
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {active.key === "connection" && <ConnectionSection canWrite={canWrite && settings.isSuccess} />}
          {active.key === "system" &&
            (settings.isPending || schema.isPending ? (
              <SettingsGrid>
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-28 w-full" />
                ))}
              </SettingsGrid>
            ) : settings.isError || schema.isError ? (
              <ErrorState
                title="系统参数加载失败"
                description={(settings.error ?? schema.error)?.message ?? "未知错误"}
                onRetry={() => {
                  void settings.refetch();
                  void schema.refetch();
                }}
                retrying={settings.isFetching || schema.isFetching}
              />
            ) : (
              <SystemSection canWrite={canWrite} items={systemItems} groups={schemaGroups} />
            ))}
          {active.key === "runtime" &&
            (settings.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : settings.isError ? (
              <ErrorState
                title="运行信息加载失败"
                description={settings.error.message}
                onRetry={() => void settings.refetch()}
                retrying={settings.isFetching}
              />
            ) : (
              <RuntimeSection items={items} />
            ))}
        </div>
      </div>
    </div>
  );
}
