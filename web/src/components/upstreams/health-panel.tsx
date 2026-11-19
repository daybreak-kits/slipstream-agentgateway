import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ENDPOINTS } from "@/lib/api";
import { formatDateTime, useTimezone } from "@/lib/time";
import type { Upstream, UpstreamProbe, UpstreamProbeResult } from "@/types";

const STATUS_LABEL: Record<UpstreamProbe["status"], string> = {
  ok: "连通",
  error: "失败",
  timeout: "超时",
};

const STATUS_TONE: Record<UpstreamProbe["status"], "success" | "danger" | "warning"> = {
  ok: "success",
  error: "danger",
  timeout: "warning",
};

function ProbeRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <span className="w-24 shrink-0 text-2xs text-faint">{label}</span>
      <div className="text-2sm text-body">{children}</div>
    </div>
  );
}

export function UpstreamHealthPanel({ upstream }: { upstream: Upstream }) {
  const qc = useQueryClient();
  const { mode: timezone } = useTimezone();
  const [tested, setTested] = useState<UpstreamProbeResult | null>(null);
  const probe = tested ?? upstream.last_probe ?? null;
  // 后端历史探测记录可能没有 models 字段（旧数据或旧版本写库），不能直接 .length
  const probeModels = Array.isArray(probe?.models) ? probe.models : [];

  const test = useMutation({
    mutationFn: () => api.post<UpstreamProbeResult>(ENDPOINTS.upstreamTest(upstream.id)),
    onSuccess: (result) => {
      setTested(result);
      void qc.invalidateQueries({ queryKey: ["upstream", upstream.id] });
      void qc.invalidateQueries({ queryKey: ["upstreams"] });
      if (result.status === "ok") {
        toast.success("连通性测试通过", {
          description:
            result.model_count + " 个模型 · " + result.latency_ms + " ms",
        });
      } else {
        toast.error("连通性测试未通过", { description: result.message });
      }
    },
    onError: (e: Error) => toast.error("连通性测试失败", { description: e.message }),
  });

  return (
    <div className="space-y-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-2sm">连通性</CardTitle>
          <Button size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
            <Activity className="h-3.5 w-3.5" />
            {test.isPending ? "测试中…" : "开始测试"}
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-2 text-2xs text-faint">
            测试与「发现模型」请求同一个地址：<span className="font-mono">{upstream.base_url}</span>
            （<span className="font-mono">{"<base_url>/models"}</span>，用其中一把密钥鉴权）。结果写库并作为列表与详情的历史状态。
          </p>
          {probe ? (
            <>
              <ProbeRow label="状态">
                <Badge tone={STATUS_TONE[probe.status]}>{STATUS_LABEL[probe.status]}</Badge>
                <span className="ml-2 text-2xs text-faint">
                  {probe.kind === "test" ? "连通性测试" : "发现模型"}
                </span>
              </ProbeRow>
              <ProbeRow label="HTTP">
                <span className="tnum">{probe.http_status || "—"}</span>
              </ProbeRow>
              <ProbeRow label="延迟">
                <span className="tnum">{probe.latency_ms} ms</span>
              </ProbeRow>
              <ProbeRow label="模型数">
                <span className="tnum">{probe.model_count}</span>
              </ProbeRow>
              <ProbeRow label="测试时间">
                <span className="tnum">{formatDateTime(probe.tested_at_ms, timezone)}</span>
              </ProbeRow>
              {probe.message ? (
                <ProbeRow label="消息">
                  <span className="text-danger-text">{probe.message}</span>
                </ProbeRow>
              ) : null}
            </>
          ) : (
            <p className="py-6 text-center text-2sm text-faint">
              还没有探测记录，点「开始测试」验证上游可用性。
            </p>
          )}
        </CardContent>
      </Card>
      {probeModels.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-2sm">
              最近一次发现的模型
              <Badge tone="neutral">{probeModels.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1 pt-0">
            {probeModels.map((name) => (
              <span
                key={name}
                className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-body"
              >
                {name}
              </span>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
