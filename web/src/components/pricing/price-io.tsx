import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { invalidatePricing } from "@/components/pricing/queries";
import { api, ENDPOINTS } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { formatDateTime, useTimezone } from "@/lib/time";

/**
 * ADR-020 价目 JSON 导入导出端点（l06_api/routers_pricing_io.py），路径见 lib/api.ts
 * ENDPOINTS.pricesExport/pricesImport。形状与后端对齐：导出 {schema_version,
 * exported_at_ms, meta, upstream_models[]}，导入成功 {changed, skipped}，失败 422
 * details.errors 逐行 {index, id, name, message}。
 */

interface PriceExportFile {
  schema_version?: number;
  exported_at_ms?: number;
  upstream_models: Array<Record<string, unknown>>;
}

interface ImportErrorRow {
  index: number;
  id: string | null;
  name: string | null;
  message: string;
}

function normalizeImportErrors(error: ApiError): ImportErrorRow[] {
  const raw = error.details.errors;
  if (!Array.isArray(raw)) return [];
  return raw.map((item, position) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      index: typeof row.index === "number" ? row.index : position,
      id: row.id === null || row.id === undefined ? null : String(row.id),
      name: row.name === null || row.name === undefined ? null : String(row.name),
      message: String(row.message ?? "未知错误"),
    };
  });
}

export function PriceIoActions({ canExport, canImport }: { canExport: boolean; canImport: boolean }) {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const exportMutation = useMutation({
    mutationFn: async () => {
      const file = await api.get<PriceExportFile>(ENDPOINTS.pricesExport);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "slipstream-prices-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return file;
    },
    onSuccess: (file) => {
      toast.success("价目已导出", {
        description: "共 " + file.upstream_models.length + " 个上游模型（v1 不含缓存价）",
      });
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={!canExport || exportMutation.isPending}
        onClick={() => exportMutation.mutate()}
      >
        <Download className="h-4 w-4" /> {exportMutation.isPending ? "导出中…" : "导出 JSON"}
      </Button>
      <Button variant="outline" disabled={!canImport} onClick={() => setImportOpen(true)}>
        <Upload className="h-4 w-4" /> 导入 JSON
      </Button>
      {importOpen ? <ImportDialog onClose={() => setImportOpen(false)} queryClient={queryClient} /> : null}
    </div>
  );
}

function ImportDialog({ onClose, queryClient }: { onClose: () => void; queryClient: ReturnType<typeof useQueryClient> }) {
  const { mode } = useTimezone();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<PriceExportFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<ImportErrorRow[] | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  function chooseFile(file: File) {
    setRowErrors(null);
    setServerMessage(null);
    setParseError(null);
    setParsed(null);
    setFileName(file.name);
    void file.text().then((text) => {
      setRawText(text);
      try {
        const body = JSON.parse(text) as PriceExportFile;
        if (!body || typeof body !== "object" || !Array.isArray(body.upstream_models)) {
          setParseError("文件缺少 upstream_models 数组，不是价目导出文件的形状");
          return;
        }
        if (body.upstream_models.length === 0) {
          setParseError("文件里没有价目条目（upstream_models 为空）");
          return;
        }
        setParsed(body);
      } catch {
        setParseError("不是合法的 JSON 文件");
      }
    });
  }

  const importMutation = useMutation({
    mutationFn: (body: PriceExportFile) => api.post<{ changed: number; skipped?: number }>(ENDPOINTS.pricesImport, body),
    onSuccess: async (result) => {
      toast.success("价目导入成功", {
        description: "已更新 " + result.changed + " 项" +
          (result.skipped ? "；跳过 " + result.skipped + " 项（无字段变更）" : ""),
      });
      await invalidatePricing(queryClient);
      onClose();
    },
    onError: (error) => {
      // 后端逐行校验全批拒绝（422）：不落库已由后端保证，这里展示逐行错误
      if (error instanceof ApiError) {
        setRowErrors(normalizeImportErrors(error));
        setServerMessage(error.message);
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入价目 JSON</DialogTitle>
        </DialogHeader>
        <p className="text-2xs text-faint">
          与导出文件同形状：逐行校验、全部通过才落库（任一行失败整批不生效）。v1 不含缓存价，缓存价在上方编辑。
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="选择价目 JSON 文件"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) chooseFile(file);
            event.target.value = "";
          }}
        />

        {!rawText ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 py-8">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              选择文件
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-faint">
              <span className="text-body">{fileName}</span>
              {parsed ? (
                <>
                  <span>条数：<span className="tnum text-body">{parsed.upstream_models.length}</span></span>
                  {typeof parsed.schema_version === "number" ? <span>schema v{parsed.schema_version}</span> : null}
                  {parsed.exported_at_ms ? <span>导出于 {formatDateTime(parsed.exported_at_ms, mode)}</span> : null}
                </>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                重新选择
              </Button>
            </div>
            <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-2xs leading-5 text-body">
              {rawText.length > 4000 ? rawText.slice(0, 4000) + "\n…" : rawText}
            </pre>
            {parseError ? <p className="text-2xs text-danger-text">{parseError}</p> : null}
          </div>
        )}

        {rowErrors && rowErrors.length > 0 ? (
          <div className="space-y-1">
            <p className="text-2xs text-danger-text">
              {serverMessage ? serverMessage : "价目导入校验失败"}
              （{rowErrors.length} 行有误，全部未生效）
            </p>
            <TableWrap className="max-h-48 overflow-y-auto rounded-lg border border-border">
              <Table>
                <THead>
                  <tr>
                    <TH className="w-12">行</TH>
                    <TH>模型 id</TH>
                    <TH>模型名</TH>
                    <TH>原因</TH>
                  </tr>
                </THead>
                <tbody>
                  {rowErrors.map((row) => (
                    <TR key={row.index}>
                      <TD className="py-1.5 tnum">{row.index + 1}</TD>
                      <TD className="py-1.5 font-mono text-2xs">{row.id ?? "—"}</TD>
                      <TD className="py-1.5">{row.name ?? "—"}</TD>
                      <TD className="py-1.5 text-danger-text">{row.message}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={() => parsed && importMutation.mutate(parsed)}
            disabled={!parsed || importMutation.isPending}
          >
            {importMutation.isPending ? "导入中…" : "开始导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
