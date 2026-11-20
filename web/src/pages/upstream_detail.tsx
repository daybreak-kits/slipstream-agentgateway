import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "@/lib/notify";

import { MetricCard } from "@/components/stat-card";
import { ConnectionTab } from "@/components/upstreams/connection-tab";
import { DiscoverModelsDialog } from "@/components/upstreams/discover-dialog";
import { LockedTabNotice, UpstreamModelsPanel } from "@/components/upstreams/models-panel";
import { useModelProbe } from "@/components/upstreams/model-probe";
import {
  API_STYLE_LABELS, UPSTREAM_TABS, probeKindLabel, probeStatusView, probeViewFromApiError, resolveUpstreamTab,
  type KeyTestResult, type PendingKey, type ProbeResultView, type UpstreamDraft, type UpstreamRow,
} from "@/components/upstreams/shared";
import { TransformsEditor } from "@/components/transforms/transforms-editor";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TabBar } from "@/components/ui/tabs";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { ACTION_ICONS } from "@/lib/icons";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { formatDateTime, useTimezone } from "@/lib/time";
import { METRIC_ICONS } from "@/lib/metric-icons";
import { usePermissions } from "@/lib/permissions";
import type { Vendor } from "@/types";

/** 新建走同一条路由（/upstreams/new）；保存成功后 replace 成真实 id。 */
const NEW_UPSTREAM_ID = "new";

function draftOf(row: UpstreamRow | null): UpstreamDraft {
  return {
    name: row?.name ?? "",
    vendorId: row?.vendor_id ?? "",
    baseUrl: row?.base_url ?? "",
    apiStyle: row?.api_style ?? "auto",
    enabled: row?.enabled ?? true,
  };
}

function draftEquals(a: UpstreamDraft, b: UpstreamDraft): boolean {
  return (
    a.name === b.name &&
    a.vendorId === b.vendorId &&
    a.baseUrl === b.baseUrl &&
    a.apiStyle === b.apiStyle &&
    a.enabled === b.enabled
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-2 last:border-b-0">
      <span className="w-24 shrink-0 pt-0.5 text-2xs text-faint">{label}</span>
      <div className="min-w-0 flex-1 text-2sm text-body">{children}</div>
    </div>
  );
}

export function UpstreamDetailPage() {
  const params = useParams();
  const rawId = params.id ?? "";
  const isNew = rawId === NEW_UPSTREAM_ID;
  const id = isNew ? "" : rawId;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canWrite = can("upstreams:write");
  const { mode: timezone } = useTimezone();

  const upstreamQ = useQuery({
    queryKey: ["upstream", id],
    queryFn: () => api.get<UpstreamRow>(ENDPOINTS.upstreamDetail(id)),
    enabled: id !== "",
  });
  const vendorsQ = useQuery({ queryKey: ["vendors"], queryFn: () => apiList<Vendor>(ENDPOINTS.vendors) });

  const [draft, setDraft] = useState<UpstreamDraft>(() => draftOf(null));
  const [baseline, setBaseline] = useState<UpstreamDraft | null>(isNew ? draftOf(null) : null);
  const [pendingKeys, setPendingKeys] = useState<PendingKey[]>([]);
  // W5 ticket 07：?tab=routing 由列表页「测试」快捷跳转带入；缺省/非法值回落「连接与模型」。
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(() => resolveUpstreamTab(searchParams.get("tab")));
  // W4-G：改写编辑器的 dirty 上抛到页面级——页签圆点、切页签确认与离页守卫都要吃到它。
  const [transformsDirty, setTransformsDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResultView | null>(null);
  const [keyTests, setKeyTests] = useState<KeyTestResult | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // 会话内模型探测（路由与模型 Tab）：状态挂在页面，切换页签不丢结果、不落库。
  const modelProbe = useModelProbe(id);

  const upstream = upstreamQ.data ?? null;

  // 首次载入（以及新建保存后 replace 到真实 id）时以服务端行为准重置草稿。
  const loadedId = upstream?.id;
  useEffect(() => {
    if (loadedId && !isNew) {
      setDraft(draftOf(upstreamQ.data ?? null));
      setBaseline(draftOf(upstreamQ.data ?? null));
      setPendingKeys([]);
    }
     
  }, [loadedId, isNew]);

  // 连接表单 dirty：编辑态对照基线；新建态基线恒空导致 dirty 恒 false 的漏洞由
  // newDraftDirty 补上（W4-G）：填了任何字段或挂了待保存密钥即视为未保存。
  const draftDirty = !isNew && baseline !== null && !draftEquals(draft, baseline);
  const newDraftDirty =
    isNew && (pendingKeys.length > 0 || !draftEquals(draft, draftOf(null)));
  const dirty = draftDirty || newDraftDirty || transformsDirty;

  // ── 未保存离开拦截（W4-G 抽到 lib/use-dirty-guard）────────────────
  const leaveGuard = useDirtyGuard(dirty);

  const onDraftChange = (patch: Partial<UpstreamDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  // 切页签：改写草稿挂在 TransformsEditor 组件状态里，切走即丢（W4-G 起 dirty 时先确认）。
  // 同时把页签写回 URL（?tab=）：列表页「测试」快捷跳转与分享链接都定位到同一页签。
  const switchTab = (key: string) => {
    setActiveTab(key);
    if (searchParams.get("tab") !== key) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", key);
      setSearchParams(next, { replace: true });
    }
  };
  const requestTab = (key: string) => {
    if (key === activeTab) return;
    if (activeTab === "transforms" && transformsDirty) {
      setPendingTab(key);
      return;
    }
    switchTab(key);
  };

  // 未保存页签琥珀圆点：连接与模型 Tab（草稿状态都挂在这个页签的表单上）与请求与响应 Tab。
  const tabItems = useMemo(
    () =>
      UPSTREAM_TABS.map((item) => {
        if (item.key === "connection") return { ...item, dot: draftDirty || newDraftDirty };
        if (item.key === "transforms") return { ...item, dot: transformsDirty };
        return item;
      }),
    [draftDirty, newDraftDirty, transformsDirty],
  );

  // ── 保存：只写配置，不触发探测（探测走页头「测试连接」与「路由与模型」的拉取/模型探测） ──
  const save = useMutation({
    mutationFn: async (): Promise<{ row: UpstreamRow; failedKeys: number }> => {
      if (isNew) {
        const created = await api.post<UpstreamRow>(ENDPOINTS.upstreamCreate, {
          ...(draft.name.trim() !== "" ? { name: draft.name.trim() } : {}),
          ...(draft.vendorId !== "" ? { vendor_id: draft.vendorId } : {}),
          base_url: draft.baseUrl.trim(),
          api_style: draft.apiStyle,
          api_key: pendingKeys[0]?.apiKey.trim() ?? "",
        });
        let failedKeys = 0;
        for (const key of pendingKeys.slice(1)) {
          try {
            await api.post(ENDPOINTS.upstreamKeys(created.id), { label: key.label, api_key: key.apiKey.trim() });
          } catch {
            failedKeys += 1;
          }
        }
        return { row: created, failedKeys };
      }
      const row = await api.patch<UpstreamRow>(ENDPOINTS.upstreamDetail(id), {
        base_url: draft.baseUrl.trim(),
        api_style: draft.apiStyle,
        enabled: draft.enabled,
        // ADR-023 #6 改名路径：名称已解锁，随配置一起提交（重名 422 由全局错误提示展示）。
        name: draft.name.trim(),
      });
      return { row, failedKeys: 0 };
    },
    onSuccess: ({ row, failedKeys }) => {
      if (isNew) {
        toast.success("上游渠道已创建", {
          description: failedKeys > 0
            ? "首把密钥已随创建提交；" + failedKeys + " 把备用密钥补录失败，可在源密钥面板重试。"
            : "首把密钥已随创建提交。",
        });
        void qc.invalidateQueries({ queryKey: ["upstreams"] });
        navigate("/upstreams/" + row.id, { replace: true });
        return;
      }
      toast.success("已保存", { description: "配置已写入；测试连接使用页面最新填写的协议风格。" });
      // 以服务端行为准：空白名称按后端语义保持原名，回填避免草稿与服务端漂移。
      setDraft(draftOf(row));
      setBaseline(draftOf(row));
      void qc.invalidateQueries({ queryKey: ["upstream", id] });
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
    },
    onError: (error) => {
      // 保存选 auto 时后端落库前探测；失败 422 带 probe_steps，右侧状态卡展示步骤。
      const view = probeViewFromApiError(error);
      if (view) {
        setProbe(view);
        toast.error("保存失败：自动探测未识别协议", { description: "查看右侧探测步骤，或改选具体协议风格后重试。" });
      }
    },
  });

  // ── 测试连接：逐把测（ADR-026 ③），每把密钥按 base_url 发最小鉴权请求 ──
  const test = useMutation({
    mutationFn: () => api.post<KeyTestResult>(ENDPOINTS.upstreamKeysTest(id), { api_style: draft.apiStyle }),
    onSuccess: (result) => {
      setKeyTests(result);
      const okCount = result.items.filter((item) => item.ok).length;
      const failCount = result.items.length - okCount;
      if (result.items.length === 0) {
        toast.info("没有可测试的密钥", { description: "请先在源密钥面板添加密钥。" });
      } else if (failCount === 0) {
        toast.success("全部密钥连通", { description: "成功 " + okCount + " 把 · 结果已标在密钥行与状态面板。" });
      } else {
        toast.warning("逐把测试完成", { description: "成功 " + okCount + " 把 · 失效 " + failCount + " 把（已标红）。" });
      }
      void qc.invalidateQueries({ queryKey: ["upstream-keys", id] });
    },
  });

  const requestTest = () => {
    if (isNew || !upstream) return;
    if (draft.baseUrl.trim() !== upstream.base_url) {
      toast.info("本次测试使用已保存的连接地址", { description: "连接地址有未保存修改；如需按新地址测试，请先保存。" });
    }
    test.mutate();
  };

  // ── 启用开关：已存上游立即写库（可逆不确认）；新建只改草稿 ──
  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) => api.patch<UpstreamRow>(ENDPOINTS.upstreamDetail(id), { enabled }),
    onSuccess: (row) => {
      toast.success(row.enabled ? "上游已启用" : "上游已关闭");
      setDraft((prev) => ({ ...prev, enabled: row.enabled }));
      setBaseline((prev) => (prev ? { ...prev, enabled: row.enabled } : prev));
      void qc.invalidateQueries({ queryKey: ["upstream", id] });
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
    },
  });

  const del = useMutation({
    mutationFn: () => api.del<{ deleted: string }>(ENDPOINTS.upstreamDetail(id)),
    onSuccess: () => {
      toast.success("上游渠道已删除");
      setDeleteConfirm(false);
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
      navigate("/upstreams");
    },
  });

  const canSave =
    draft.baseUrl.trim() !== "" && (!isNew || pendingKeys.length > 0) && !save.isPending;

  const probeView = probe ?? upstream?.last_probe ?? null;
  const headerBadge = useMemo(() => {
    if (isNew) return <Badge tone="warning">未保存</Badge>;
    if (dirty) return <Badge tone="warning">有未保存修改</Badge>;
    if (probeView) {
      const status = probeStatusView(probeView.status);
      return <Badge tone={status.tone}>{status.label}{probeView.status === "ok" ? " " + probeView.latency_ms + "ms" : ""}</Badge>;
    }
    return <Badge tone="neutral">未测试</Badge>;
  }, [isNew, dirty, probeView]);

  if (!isNew && upstreamQ.isPending) return <Skeleton className="h-64 w-full" />;
  if (!isNew && (upstreamQ.isError || !upstream)) {
    return (
      <div className="space-y-2 p-8 text-2sm text-danger-text">
        <p>上游不存在或加载失败：{(upstreamQ.error as Error | null)?.message ?? "NOT_FOUND"}</p>
        <Link to="/upstreams" className="text-primary-text hover:underline">返回上游渠道列表</Link>
      </div>
    );
  }

  const modelCount = upstream?.model_count ?? 0;
  const probeRow = probeView ? (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={probeStatusView(probeView.status).tone}>{probeStatusView(probeView.status).label}</Badge>
      <span className="text-2xs text-faint">
        {probeKindLabel(probeView.kind)}
        {probeView.status === "ok" ? " · " + probeView.latency_ms + " ms" : ""}
      </span>
      {probeView.tested_at_ms ? (
        <span className="tnum text-2xs text-faint">{formatDateTime(probeView.tested_at_ms, timezone)}</span>
      ) : null}
    </span>
  ) : (
    <span className="text-faint">—</span>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/upstreams"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-2sm font-medium text-body transition-colors hover:bg-surface-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回列表
        </Link>
        <h1 className="text-lg font-semibold text-title">
          {isNew ? (draft.name.trim() || "新建上游渠道") : (upstream?.name ?? "")}
        </h1>
        {headerBadge}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {!isNew ? (
            <label className="flex items-center gap-2 text-2sm text-body">
              <Switch
                checked={draft.enabled}
                disabled={toggleEnabled.isPending || !canWrite}
                onCheckedChange={(value) => toggleEnabled.mutate(value)}
                aria-label="启用该上游渠道"
              />
              {draft.enabled ? "已启用" : "已关闭"}
            </label>
          ) : (
            <label className="flex items-center gap-2 text-2sm text-body">
              <Switch
                checked={draft.enabled}
                disabled={!canWrite}
                onCheckedChange={(value) => onDraftChange({ enabled: value })}
                aria-label="启用该上游渠道"
              />
              {draft.enabled ? "保存后启用" : "保存后关闭"}
            </label>
          )}
          {/* 逐把密钥测试（旧 test-connection）留在页头/「连接与模型」；模型探测在「路由与模型」。 */}
          <ActionButton
            action="testConnection"
            variant="outline"
            disabled={isNew || !canWrite || test.isPending}
            title={isNew ? "先保存上游渠道，再测试连接" : "逐把测试密钥连通性（结果写库并展示在连接状态）"}
            onClick={requestTest}
          >
            {test.isPending ? "测试中…" : "测试连接"}
          </ActionButton>
          <Button
            size="sm"
            disabled={!canSave || !canWrite}
            title="保存写入配置；测试连接使用页面最新填写的协议风格"
            onClick={() => save.mutate()}
          >
            <ACTION_ICONS.save className="h-3.5 w-3.5" />
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      <TabBar items={tabItems} value={activeTab} onValueChange={requestTab} ariaLabel="上游渠道编辑器页签" />

      {activeTab === "connection" ? (
        <ConnectionTab
          isNew={isNew}
          upstream={upstream}
          draft={draft}
          onDraftChange={onDraftChange}
          vendors={vendorsQ.data?.items ?? []}
          pendingKeys={pendingKeys}
          onPendingKeysChange={setPendingKeys}
          probe={probe}
          keyTests={keyTests}
          modelCount={modelCount}
          onGoModels={() => requestTab("routing")}
        />
      ) : null}
      {activeTab === "routing" ? (
        isNew || !upstream ? (
          <LockedTabNotice subject="路由与模型" />
        ) : (
          <UpstreamModelsPanel
            upstream={upstream}
            probe={modelProbe}
            onFetchModels={() => setDiscoverOpen(true)}
          />
        )
      ) : null}
      {activeTab === "transforms" ? (
        isNew || !upstream ? (
          <LockedTabNotice subject="请求与响应改写" />
        ) : (
          <TransformsEditor upstreamId={upstream.id} onDirtyChange={setTransformsDirty} />
        )
      ) : null}
      {activeTab === "settings" ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-2sm">上游信息</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <InfoRow label="ID">
                <span className="tnum font-mono text-2xs">{upstream?.id ?? "保存后生成"}</span>
              </InfoRow>
              <InfoRow label="状态">
                {isNew ? (
                  <Badge tone="warning">草稿</Badge>
                ) : (
                  <Badge tone={upstream?.enabled ? "success" : "neutral"}>{upstream?.enabled ? "启用" : "关闭"}</Badge>
                )}
              </InfoRow>
              <InfoRow label="协议风格">
                {upstream ? (
                  <span className="flex items-center gap-2">
                    <Badge tone="info">{API_STYLE_LABELS[upstream.api_style] ?? upstream.api_style}</Badge>
                    {upstream.api_style_source === "auto" ? <Badge tone="neutral">自动探测</Badge> : null}
                  </span>
                ) : (
                  <span>{draft.apiStyle === "auto" ? "自动探测" : API_STYLE_LABELS[draft.apiStyle] ?? draft.apiStyle}（保存时生效）</span>
                )}
              </InfoRow>
              <InfoRow label="最近探测">{probeRow}</InfoRow>
              <InfoRow label="创建时间">
                {upstream?.created_at_ms ? (
                  <span className="tnum">{formatDateTime(upstream.created_at_ms, timezone)}</span>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </InfoRow>
              {!isNew ? (
                <div className="flex items-center justify-between gap-3 pt-2">
                  <span className="text-2sm text-body">启用开关</span>
                  <Switch
                    checked={draft.enabled}
                    disabled={toggleEnabled.isPending || !canWrite}
                    onCheckedChange={(value) => toggleEnabled.mutate(value)}
                    aria-label="启用该上游渠道（其他设置副本）"
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
          {!isNew ? (
            <Card className="border-danger/40">
              <CardHeader>
                <CardTitle className="text-2sm text-danger-text">危险区</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <p className="text-2xs text-faint">
                  删除会连带移除该上游的全部密钥、上游模型与探测记录，且不可撤销；被公开模型引用的上游会被拒绝删除。
                </p>
                <Button variant="danger" size="sm" disabled={!canWrite} onClick={() => setDeleteConfirm(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> 删除上游渠道
                </Button>
              </CardContent>
            </Card>
          ) : (
            <MetricCard
              label="密钥（草稿）"
              value={pendingKeys.length}
              icon={METRIC_ICONS.tokens.icon}
              tone="neutral"
              hint="保存时随创建提交，每把密钥展开为一个独立 AG 上游"
            />
          )}
        </div>
      ) : null}

      {discoverOpen && upstream ? (
        <DiscoverModelsDialog upstreamId={upstream.id} apiStyle={draft.apiStyle} onClose={() => setDiscoverOpen(false)} />
      ) : null}

      {/* 确认框按需挂载：同时常挂多个（open=false）Radix AlertDialog 会叠多层
          DismissableLayer，长会话里出现过层栈残留导致页面输入被吞的迹象。 */}
      {leaveGuard}

      {pendingTab !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setPendingTab(null); }}
          title="请求与响应改写有未保存修改"
          description="切换页签将丢弃改写草稿；可先「保存全部」再切换。"
          confirmLabel="放弃修改并切换"
          destructive
          onConfirm={() => {
            setTransformsDirty(false);
            switchTab(pendingTab);
            setPendingTab(null);
          }}
        />
      ) : null}

      {deleteConfirm ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setDeleteConfirm(false); }}
          title={"删除上游渠道 " + (upstream?.name ?? "") + "？"}
          description="连带删除该上游的全部密钥、上游模型与探测记录；被公开模型目标引用的上游会被拒绝删除。此操作不可逆。"
          confirmLabel="确认删除"
          destructive
          onConfirm={() => del.mutate()}
        />
      ) : null}
    </div>
  );
}
