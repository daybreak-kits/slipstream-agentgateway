import { BookOpen } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";

const TOKENS = [
  { token: "model:glm", meaning: "匹配公开模型或上游模型名", example: "model:glm-5.3" },
  { token: "upstream:zai", meaning: "匹配上游标识（provider）或上游模型名", example: "upstream:zai" },
  { token: "user:alice", meaning: "匹配用户 ID 或用户名称", example: "user:alice" },
  { token: "key:WXYZ", meaning: "匹配密钥后缀（列表里的 sk-...WXYZ）或密钥 ID", example: "key:WXYZ" },
  { token: "status:200", meaning: "精确 HTTP 状态码", example: "status:200" },
  { token: "status:5xx", meaning: "按状态码段筛选（1xx–5xx）", example: "status:5xx" },
  { token: "latency>500", meaning: "总耗时大于 N 毫秒", example: "latency>500" },
  { token: "latency<200", meaning: "总耗时小于 N 毫秒（0 耗时不匹配）", example: "latency<200" },
  { token: "ttft>300", meaning: "首字时间大于 N 毫秒", example: "ttft>300" },
  { token: "cache>30", meaning: "缓存命中比例大于 N%（0–100）", example: "cache>30" },
  { token: "stream:true", meaning: "只看流式（true）或非流式（false）请求", example: "stream:true" },
];

export function QuerySyntaxHelp() {
  const [open, setOpen] = useState(false);
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
                  {TOKENS.map((item) => (
                    <TR key={item.token} className="align-top">
                      <TD className="whitespace-nowrap px-3 py-2 font-mono text-2xs text-title">{item.token}</TD>
                      <TD className="px-3 py-2 text-body">{item.meaning}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-body">
              <p className="font-medium text-title">示例</p>
              <p className="mt-1 font-mono text-2xs">user:alice stream:true cache&gt;30</p>
              <p className="mt-1 font-mono text-2xs">model:glm status:5xx latency&gt;1000</p>
              <p className="mt-1 text-faint">
                多个条件同时满足才会返回；status 只接受 3 位状态码或 1xx–5xx，latency / ttft 后必须是毫秒整数，
                cache 后是 0–100 的百分比。语法写错时后端返回 422 并指出具体位置。
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
