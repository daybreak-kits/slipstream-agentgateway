import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import type { LogQuerySyntaxOut } from "@/generated/contract";
import { api, ENDPOINTS } from "@/lib/api";

export function QuerySyntaxHelp() {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<LogQuerySyntaxOut["tokens"]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api
      .get<LogQuerySyntaxOut>(ENDPOINTS.logQuerySyntax)
      .then((payload) => {
        if (!cancelled) setTokens(payload.tokens);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <BookOpen className="h-3.5 w-3.5" />
        查询语法
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>日志查询语法</DialogTitle>
            <DialogDescription>
              空格分隔的关键词之间是 AND；不带前缀的词按自由关键词匹配请求 id、模型、用户、密钥与原始记录。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="overflow-hidden rounded-md border border-border">
              <Table className="text-left text-xs">
                <THead className="bg-surface-2 text-2xs text-faint">
                  <TR className="border-t-0 hover:bg-transparent">
                    <TH className="h-auto px-3 py-2 font-medium">写法</TH>
                    <TH className="h-auto px-3 py-2 font-medium">含义</TH>
                  </TR>
                </THead>
                <tbody>
                  {loading ? (
                    <TR>
                      <TD className="px-3 py-3 text-faint" colSpan={2}>
                        加载中…
                      </TD>
                    </TR>
                  ) : failed ? (
                    <TR>
                      <TD className="px-3 py-3 text-faint" colSpan={2}>
                        无法加载查询语法，请稍后再试。
                      </TD>
                    </TR>
                  ) : (
                    tokens.map((item) => (
                      <TR key={item.token} className="align-top">
                        <TD className="whitespace-nowrap px-3 py-2 font-mono text-2xs text-title">
                          {item.token}
                        </TD>
                        <TD className="px-3 py-2 text-body">{item.meaning}</TD>
                      </TR>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-body">
              <p className="font-medium text-title">示例</p>
              <p className="mt-1 font-mono text-2xs">user:alice stream:true cache&gt;30</p>
              <p className="mt-1 font-mono text-2xs">model:glm status:5xx latency&gt;1000</p>
              <p className="mt-1 text-faint">
                多个条件同时满足才会返回；status 只接受 3 位状态码或 1xx 至 5xx，latency / ttft 后必须是毫秒整数，
                cache 后是 0 至 100 的百分比。语法写错时后端返回 422 并指出具体位置。
              </p>
            </div>
            <p className="text-xs text-faint">
              查询为空表示不限定关键词；时间范围、公开模型、上游渠道、用户、状态由筛选行拼成对应查询条件，「全部错误 / 全部成功」走独立的 has_error 参数；
              排序由点击表头切换（sort + order 参数）。密钥没有独立筛选框，直接用 key: 过滤即可；无花费权限时费用列不可排序。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
