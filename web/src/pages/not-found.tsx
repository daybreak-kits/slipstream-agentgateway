import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="space-y-2 text-center">
        <p className="text-metric font-semibold text-title">404</p>
        <p className="text-2sm text-body">没有这个页面</p>
        <p className="break-all font-mono text-2xs text-faint">{location.pathname}</p>
        <p className="text-2xs text-faint">地址可能写错，或该页面尚未上线。</p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button asChild size="sm">
            <Link to="/">返回概览</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard">查看看板</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}