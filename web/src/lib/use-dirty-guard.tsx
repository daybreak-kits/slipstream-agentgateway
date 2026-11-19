import { useEffect, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * 页面级未保存守卫（W4-G，自 upstream_detail.tsx 抽取，全站铺开）。
 *
 * 应用用声明式 <BrowserRouter>，useBlocker 需要 data router（main.tsx 归骨架工位）；
 * 这里用两条兜底：① beforeunload 拦刷新/关闭；② 捕获阶段拦截应用内 <a> 点击
 * （侧栏 NavLink / 返回链接都是 <a href>）。用户在确认框里点「离开」后置位
 * leavingRef 放行两条拦截，再整页跳转——React 状态更新是异步的，location.assign
 * 同步触发 beforeunload，靠 ref 才能在事件回调里读到放行标记。
 *
 * 返回值是确认框节点（无未决离开时为 null），由调用方在页面内渲染。
 */
export function useDirtyGuard(dirty: boolean, description?: string): ReactNode {
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
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

  if (leaveHref === null) return null;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => { if (!open) setLeaveHref(null); }}
      title="有未保存修改，确定离开吗？"
      description={description ?? "离开页面将丢失未保存的修改。保存后再离开可保留配置。"}
      confirmLabel="离开"
      onConfirm={() => {
        leavingRef.current = true;
        window.location.assign(leaveHref);
      }}
    />
  );
}
