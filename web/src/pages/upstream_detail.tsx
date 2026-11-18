import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { MetricCard } from "@/components/stat-card";
import { TransformsEditor } from "@/components/transforms/transforms-editor";
import { UpstreamHealthPanel } from "@/components/upstreams/health-panel";
import { UpstreamKeysPanel } from "@/components/upstreams/keys-panel";
import { UpstreamModelsPanel } from "@/components/upstreams/models-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { api, apiList, ENDPOINTS } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import { METRIC_ICONS } from "@/lib/metric-icons";
import type { Upstream, Vendor } from "@/types";

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <span className="w-24 shrink-0 text-2xs text-faint">{label}</span>
      <div className="text-2sm text-body">{children}</div>
    </div>
  );
}

export function UpstreamDetailPage() {
  const params = useParams();
  const id = params.id ?? "";
  const qc = useQueryClient();
  const navigate = useNavigate();

  const upstreamQ = useQuery({
    queryKey: ["upstream", id],
    queryFn: () => api.get<Upstream>(ENDPOINTS.upstreamDetail(id)),
    enabled: id !== "",
  });
  const vendorsQ = useQuery({
    queryKey: ["vendors"],
    queryFn: () => apiList<Vendor>(ENDPOINTS.vendors),
  });

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["upstream", id] });
    void qc.invalidateQueries({ queryKey: ["upstreams"] });
  };

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch<Upstream>(ENDPOINTS.upstreamDetail(id), { enabled }),
    onSuccess: (upstream) => {
      toast.success(upstream.enabled ? "上游已启用" : "上游已停用");
      invalidate();
    },
    onError: (e: Error) => toast.error("操作失败", { description: e.message }),
  });

  const del = useMutation({
    mutationFn: () => api.del<{ deleted: string }>(ENDPOINTS.upstreamDetail(id)),
    onSuccess: () => {
      toast.success("上游已删除");
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
      navigate("/upstreams");
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  if (upstreamQ.isPending) return <Skeleton className="h-64 w-full" />;
  if (upstreamQ.isError || !upstreamQ.data) {
    return (
      <div className="space-y-2 p-8 text-2sm text-danger-text">
        <p>上游不存在或加载失败：{(upstreamQ.error as Error | null)?.message ?? "NOT_FOUND"}</p>
        <Link to="/upstreams" className="text-primary-text hover:underline">
          返回上游列表
        </Link>
      </div>
    );
  }

  const upstream = upstreamQ.data;
  const vendorName =
    vendorsQ.data?.items.find((vendor) => vendor.id === upstream.vendor_id)?.name ??
    upstream.vendor_id;
  const keyCount = upstream.key_count ?? 0;
  const modelCount = upstream.model_count ?? 0;

  const info = (
    <Card>
      <CardContent className="pt-4">
        <InfoRow label="ID">
          <span className="tnum font-mono text-2xs">{upstream.id}</span>
        </InfoRow>
        <InfoRow label="名称">
          <span className="font-medium text-title">{upstream.name}</span>
        </InfoRow>
        <InfoRow label="厂商">{vendorName}</InfoRow>
        <InfoRow label="Base URL">
          <span className="tnum font-mono text-2xs">{upstream.base_url}</span>
        </InfoRow>
        <InfoRow label="接口风格">
          <Badge tone="info">{upstream.api_style}</Badge>
        </InfoRow>
        <InfoRow label="密钥数">
          <span className="tnum">{upstream.key_count ?? 0}</span>
          <span className="ml-2 text-2xs text-faint">在「密钥」页添加 / 切换主密钥</span>
        </InfoRow>
        <InfoRow label="模型数">
          <span className="tnum">{upstream.model_count ?? 0}</span>
        </InfoRow>
        <InfoRow label="状态">
          <Badge tone={upstream.enabled ? "success" : "neutral"}>
            {upstream.enabled ? "启用" : "停用"}
          </Badge>
        </InfoRow>
      </CardContent>
    </Card>
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
        <h1 className="text-lg font-semibold text-title">{upstream.name}</h1>
        <Badge tone={upstream.enabled ? "success" : "neutral"}>
          {upstream.enabled ? "启用" : "停用"}
        </Badge>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-2sm text-body">
            <Switch
              checked={upstream.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(value) => toggle.mutate(value)}
              aria-label="启用该上游"
            />
            {upstream.enabled ? "已启用" : "已停用"}
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-text"
            onClick={() => {
              setDeleteError("");
              setDeleting(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="密钥数"
          icon={METRIC_ICONS.models.icon}
          tone={METRIC_ICONS.models.tone}
          value={fmtInt(keyCount)}
          hint="该上游的 API 密钥数"
        />
        <MetricCard
          label="模型数"
          icon={METRIC_ICONS.models.icon}
          tone={METRIC_ICONS.models.tone}
          value={fmtInt(modelCount)}
          hint="绑定到该上游的模型数"
        />
        <MetricCard
          label="状态"
          icon={METRIC_ICONS.availability.icon}
          tone={upstream.enabled ? METRIC_ICONS.availability.tone : "neutral"}
          value={upstream.enabled ? "启用" : "停用"}
          hint="停用后数据面不再为它选路"
        />
        <MetricCard
          label="接口风格"
          icon={METRIC_ICONS.apiStyle.icon}
          tone={METRIC_ICONS.apiStyle.tone}
          value={upstream.api_style}
          hint="上游协议适配器"
        />
      </div>
      <Tabs
        initialKey="info"
        items={[
          { key: "info", label: "基本信息", content: info },
          { key: "keys", label: "密钥", content: <UpstreamKeysPanel upstreamId={upstream.id} /> },
          { key: "models", label: "模型", content: <UpstreamModelsPanel upstreamId={upstream.id} /> },
          {
            key: "transforms",
            label: "改写",
            content: <TransformsEditor upstreamId={upstream.id} />,
          },
          { key: "health", label: "健康", content: <UpstreamHealthPanel upstream={upstream} /> },
        ]}
      />

      <AlertDialog
        open={deleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(false);
            setDeleteError("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除上游 {upstream.name}？</AlertDialogTitle>
            <AlertDialogDescription>
              连带删除该上游的全部密钥、模型与探测记录；被对外模型目标引用的上游会被拒绝删除。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-2sm text-danger-text">删除失败：{deleteError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => del.mutate()}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
