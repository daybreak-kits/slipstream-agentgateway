import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { MetricCard } from "@/components/stat-card";
import { ConnectionTab } from "@/components/upstreams/connection-tab";
import { DiscoverModelsDialog } from "@/components/upstreams/discover-dialog";
import { LockedTabNotice, UpstreamModelsPanel } from "@/components/upstreams/models-panel";
import {
  API_STYLE_LABELS, probeKindLabel, probeStatusView, probeViewFromApiError,
  type PendingKey, type ProbeResultView, type UpstreamDraft, type UpstreamRow,
} from "@/components/upstreams/shared";
import { TransformsEditor } from "@/components/transforms/transforms-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TabBar } from "@/components/ui/tabs";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { formatDateTime, useTimezone } from "@/lib/time";
import { METRIC_ICONS } from "@/lib/metric-icons";
import { usePermissions } from "@/lib/permissions";
import type { Vendor } from "@/types";

/** 新建走同一条路由（/upstreams/new）；保存成功后 replace 成真实 id。 */
const NEW_UPSTREAM_ID = "new";

const TAB_ITEMS = [
  { key: "connection", label: "连接与模型" },
  { key: "models", label: "路由与映射" },
  { key: "transforms", label: "请求与响应" },
  { key: "settings", label: "其他设置" },
];

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
  const [activeTab, setActiveTab] = useState("connection");
  const [tabConfirm, setTabConfirm] = useState<string | null>(null);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResultView | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [anonConfirm, setAnonConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

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

  const dirty = !isNew && baseline !== null && !draftEquals(draft, baseline);

  // ── 未保存离开拦截 ──────────────────────────────────────────────
  // 应用用声明式 <BrowserRouter>，useBlocker 需要 data router（main.tsx 归骨架工位）；
  // 这里用两条兜底：① beforeunload 拦刷新/关闭；② 捕获阶段拦截应用内 <a> 点击（侧栏/返回链接）。
  // 用户在离开确认框里点「离开」后置位，beforeunload 与点击拦截同步让路（React 状态更新
  // 是异步的，location.assign 同步触发 beforeunload，靠 ref 才能在事件回调里读到放行标记）。
  const leavingRef = useRef(false);
  useEffect(() => {
    if (!dirty || leavingRef.current) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty || leavingRef.current) return;
    const onClick = (event: MouseEvent) => {
      if (leavingRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#") || href === "") return;
      event.preventDefault();
      event.stopPropagation();
      // 延后到本次点击事件派发结束再挂确认框：Radix AlertDialog 在打开它的那次
      // pointerdown 派发过程中同步挂载会被自己的 interactOutside 判定立即关掉。
      window.setTimeout(() => setLeaveHref(href), 0);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const onDraftChange = (patch: Partial<UpstreamDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const requestTab = (key: string) => {
    if (key === activeTab) return;
    if (dirty) setTabConfirm(key);
    else setActiveTab(key);
  };

  // ── 保存：只写配置，不触发探测（探测走页头「测试连接」/「获取上游模型」） ──
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
      });
      return { row, failedKeys: 0 };
    },
    onSuccess: ({ row, failedKeys }) => {
      if (isNew) {
        toast.success("上游渠道已创建", {
          description: failedKeys > 0
            ? "首把密钥已登记为主密钥；" + failedKeys + " 把备用密钥补录失败，可在源密钥面板重试。"
            : "首把密钥已登记为主密钥。",
        });
        void qc.invalidateQueries({ queryKey: ["upstreams"] });
        navigate("/upstreams/" + row.id, { replace: true });
        return;
      }
      toast.success("已保存", { description: "配置已写入；测试连接与获取模型使用页面最新填写的协议风格。" });
      setBaseline({ ...draft });
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

  // ── 测试连接：对已存上游发起；协议风格用页面当前值，地址用已保存值（草稿差异会有提示） ──
  const test = useMutation({
    mutationFn: () => api.post<ProbeResultView>(ENDPOINTS.upstreamTest(id), { api_style: draft.apiStyle }),
    onSuccess: (result) => {
      setProbe(result);
      if (result.status === "ok") {
        toast.success("连通性测试通过", { description: (result.model_count ?? 0) + " 个模型 · " + result.latency_ms + " ms" });
      } else {
        toast.error("连通性测试未通过", { description: result.message || undefined });
      }
      void qc.invalidateQueries({ queryKey: ["upstream", id] });
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
    },
    onError: (error) => {
      const view = probeViewFromApiError(error);
      if (view) setProbe(view);
    },
  });

  const requestTest = () => {
    if (isNew || !upstream) return;
    if (upstream.has_api_key === false) {
      setAnonConfirm(true);
      return;
    }
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
          <Button
            variant="outline"
            size="sm"
            disabled={isNew || !canWrite}
            title={isNew ? "先保存上游渠道，再获取模型" : undefined}
            onClick={() => setDiscoverOpen(true)}
          >
            获取上游模型
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isNew || !canWrite || test.isPending}
            title={isNew ? "先保存上游渠道，再测试连接" : undefined}
            onClick={requestTest}
          >
            {test.isPending ? "测试中…" : "测试连接"}
          </Button>
          <Button
            size="sm"
            disabled={!canSave || !canWrite}
            title="保存写入配置；测试连接与获取模型使用页面最新填写的协议风格"
            onClick={() => save.mutate()}
          >
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      <TabBar items={TAB_ITEMS} value={activeTab} onValueChange={requestTab} ariaLabel="上游渠道编辑器页签" />

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
          modelCount={modelCount}
          onGoModels={() => requestTab("models")}
        />
      ) : null}
      {activeTab === "models" ? (
        isNew || !upstream ? (
          <LockedTabNotice subject="路由与映射" />
        ) : (
          <UpstreamModelsPanel upstream={upstream} />
        )
      ) : null}
      {activeTab === "transforms" ? (
        isNew || !upstream ? <LockedTabNotice subject="请求与响应改写" /> : <TransformsEditor upstreamId={upstream.id} />
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
              hint="保存时第一把自动成为主密钥"
            />
          )}
        </div>
      ) : null}

      {discoverOpen && upstream ? (
        <DiscoverModelsDialog upstreamId={upstream.id} apiStyle={draft.apiStyle} onClose={() => setDiscoverOpen(false)} />
      ) : null}

      {/* 四个确认框都按需挂载：同时常挂多个（open=false）Radix AlertDialog 会叠多层
          DismissableLayer，长会话里出现过层栈残留导致页面输入被吞的迹象。 */}
      {tabConfirm !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setTabConfirm(null); }}
          title="有未保存修改，仍要切换标签页吗？"
          description="修改保留在本页草稿中；离开页面（侧栏导航或刷新）会丢失，请先保存。"
          confirmLabel="切换"
          onConfirm={() => {
            setActiveTab(tabConfirm);
            setTabConfirm(null);
          }}
        />
      ) : null}

      {leaveHref !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setLeaveHref(null); }}
          title="有未保存修改，确定离开吗？"
          description="离开页面将丢失未保存的修改。保存后再离开可保留配置。"
          confirmLabel="离开"
          onConfirm={() => {
            // 用户已确认放弃修改：同步放行 beforeunload / 点击拦截，再发起整页跳转。
            leavingRef.current = true;
            setBaseline({ ...draft });
            window.location.assign(leaveHref);
          }}
        />
      ) : null}

      {anonConfirm ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setAnonConfirm(false); }}
          title="尚无密钥，仍要匿名尝试？"
          description="该上游没有可用密钥；测试连接会以匿名请求探测，部分上游会返回 401。"
          confirmLabel="匿名尝试"
          onConfirm={() => test.mutate()}
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
