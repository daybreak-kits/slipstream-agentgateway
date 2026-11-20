import { Fragment } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

const STAGES = [
  { no: "01", title: "公开模型", caption: "对外别名", detail: "路由模式 · 故障转移 · 权重" },
  { no: "02", title: "上游渠道", caption: "供应商连接", detail: "密钥 · 地址 · 可用性" },
  { no: "03", title: "后端模型", caption: "真实调用", detail: "协议风格 · 参数 · 价格" },
];

/**
 * 产品签名瞬间：一条请求链路。三层寻址（公开模型 → 上游渠道 → 后端模型）画成
 * 三个带编号的节点 + 连接线；等宽编号 + tabular 数字，语气像控制台上的信号路径。
 */
export function RequestChain({ className }: { className?: string }) {
  return (
    <ol
      aria-label="请求链路：公开模型到上游渠道到后端模型"
      className={cn("grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch", className)}
    >
      {STAGES.map((stage, index) => (
        <Fragment key={stage.no}>
          <div className="rounded-card border border-border bg-surface px-3.5 py-3 shadow-card">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-2xs font-medium text-faint">{stage.no}</span>
              <span className="text-2xs text-faint">{stage.caption}</span>
            </div>
            <p className="mt-1.5 text-sm font-semibold text-title">{stage.title}</p>
            <p className="mt-0.5 text-2xs text-faint">{stage.detail}</p>
          </div>
          {index < STAGES.length - 1 ? (
            <li aria-hidden="true" className="hidden items-center justify-center sm:flex">
              <span className="h-px w-6 bg-border-strong" />
              <ArrowRight className="h-3.5 w-3.5 text-faint" strokeWidth={1.75} />
            </li>
          ) : null}
        </Fragment>
      ))}
    </ol>
  );
}
