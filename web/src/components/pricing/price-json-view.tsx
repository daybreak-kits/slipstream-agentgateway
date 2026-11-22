import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ACTION_ICONS } from "@/lib/icons";
import type { PriceDocumentIssue, PriceImportErrorRow } from "@/lib/pricing/document";

/** 逐行错误的展示上限：更长的列表用「另有 N 处」收尾，避免撑爆页内编辑区。 */
const MAX_VISIBLE = 8;

interface PriceJsonViewProps {
  /** 当前编辑中的价目 JSON 文本（与导出文件同形状）。 */
  text: string;
  /** 前端校验问题（逐行）；非空时保存按钮禁用。 */
  issues: PriceDocumentIssue[];
  /** 后端整批拒绝时的错误标题（ApiError.message）。 */
  serverMessage: string | null;
  /** 后端 422 details.errors 归一后的逐行错误。 */
  serverRows: PriceImportErrorRow[] | null;
  /** 当前 JSON 文档里的价目行数。 */
  rowCount: number;
  saving: boolean;
  /** null 表示可保存；否则是禁用原因（按钮 title 与页脚提示）。 */
  saveBlocker: string | null;
  onChange: (text: string) => void;
  onSave: () => void;
  onReload: () => void;
}

function issueLabel(issue: PriceDocumentIssue): string {
  const where = issue.index === undefined ? "" : "第 " + (issue.index + 1) + " 行：";
  return where + issue.message;
}

/**
 * 价目 JSON 页内编辑器（W8 ticket 07）：形状与「导出 JSON」一致，保存复用整批导入端点。
 * 纯展示组件——文本与校验状态由价目页持有，切换「表格 / JSON」不丢未保存草稿。
 */
export function PriceJsonView({
  text, issues, serverMessage, serverRows, rowCount, saving, saveBlocker,
  onChange, onSave, onReload,
}: PriceJsonViewProps) {
  const visibleIssues = issues.slice(0, MAX_VISIBLE);
  const visibleServerRows = (serverRows ?? []).slice(0, MAX_VISIBLE);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="text-2xs text-faint">
          整份价目文件 · <span className="tnum text-body">{rowCount}</span> 个上游模型
        </span>
        <span className="text-2xs text-faint">null / 空串 = 不改该字段</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReload}
            disabled={saving}
            title="用当前表格草稿重新生成 JSON（丢弃 JSON 里的手改）"
          >
            <ACTION_ICONS.restore className="h-3.5 w-3.5" /> 重新载入
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={saveBlocker !== null || saving}
            title={saveBlocker ?? "校验整批价目并保存"}
          >
            <ACTION_ICONS.save className="h-3.5 w-3.5" /> {saving ? "保存中…" : "保存 JSON"}
          </Button>
        </div>
      </div>

      <Textarea
        value={text}
        onChange={(event) => onChange(event.target.value)}
        aria-label="价目 JSON"
        spellCheck={false}
        rows={24}
        className="min-h-[30rem] font-mono text-2xs leading-5"
      />

      {saveBlocker !== null && issues.length === 0 && !saving ? (
        <p className="text-2xs text-faint">暂不可保存：{saveBlocker}</p>
      ) : null}

      {issues.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>JSON 校验未通过（{issues.length} 处）</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {visibleIssues.map((issue, position) => (
                <li key={position}>{issueLabel(issue)}</li>
              ))}
            </ul>
            {issues.length > visibleIssues.length ? (
              <p className="text-2xs">
                …另有 {issues.length - visibleIssues.length} 处，修正后才能保存。
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {serverMessage !== null || (serverRows !== null && serverRows.length > 0) ? (
        <Alert variant="destructive">
          <AlertTitle>{serverMessage ?? "价目 JSON 保存失败"}</AlertTitle>
          <AlertDescription>
            {serverRows !== null && serverRows.length > 0 ? (
              <>
                <ul className="list-disc space-y-0.5 pl-4">
                  {visibleServerRows.map((row) => (
                    <li key={row.index}>
                      第 {row.index + 1} 行
                      {row.id !== null ? "（" + row.id + (row.name !== null ? " · " + row.name : "") + "）" : row.name !== null ? "（" + row.name + "）" : ""}
                      ：{row.message}
                    </li>
                  ))}
                </ul>
                <p className="text-2xs">
                  共 {serverRows.length} 行有误，整批未生效，库里仍是原价目。
                </p>
              </>
            ) : (
              <p className="text-2xs">请稍后重试；若持续失败，把错误信息反馈给管理员。</p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-2xs text-faint">
        JSON 与「导出 JSON」同形状（schema_version=1，v1 不含缓存价）；保存复用整批导入端点，任一行校验失败整批不生效。
      </p>
    </div>
  );
}
