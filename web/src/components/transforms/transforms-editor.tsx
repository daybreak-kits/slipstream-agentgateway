import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, ENDPOINTS } from "@/lib/api";
import { ACTION_ICONS } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type {
  ConditionMode,
  RewriteCondition,
  TransformOp,
  TransformPreviewResult,
  TransformRule,
  TransformSection,
  UpstreamTransforms,
  UpstreamTransformsResponse,
} from "@/types";

/** 契约 §4 不变量 1：保护头 UI 侧直接拦截，不等后端报错 */
const PROTECTED_HEADERS = new Set([
  "authorization", "api-key", "x-api-key", "cookie", "set-cookie",
  "content-type", "content-length", "host", "x-request-id",
]);

/** 契约 v2：头与体共用同一套动作词表，四段完全一致 */
const OPS: Array<{ value: TransformOp; label: string; hint: string }> = [
  { value: "create", label: "create", hint: "不存在才写，已存在保持不变" },
  { value: "update", label: "update", hint: "存在才覆盖，不存在保持不变" },
  { value: "delete", label: "delete", hint: "删除；不存在视为成功" },
  { value: "copy", label: "copy", hint: "从源复制到目标（头填源头名 / 体填源路径）" },
  { value: "prepend", label: "prepend", hint: "字符串开头插入" },
  { value: "append", label: "append", hint: "字符串结尾追加" },
  { value: "regex_replace", label: "regex_replace", hint: "按正则替换；填写正则与替换文本（CEL regexReplaceAll）" },
  { value: "to_upper", label: "to_upper", hint: "转大写" },
  { value: "to_lower", label: "to_lower", hint: "转小写" },
];

const CONDITION_MODES: Array<{ value: ConditionMode; label: string }> = [
  { value: "full", label: "等于" },
  { value: "regex", label: "正则匹配" },
  { value: "gt", label: "大于" },
  { value: "gte", label: "大于等于" },
  { value: "lt", label: "小于" },
  { value: "lte", label: "小于等于" },
];

interface SectionConfig {
  section: TransformSection;
  title: string;
  kind: "header" | "body";
  fixedNotice?: string;
}

const SECTIONS: SectionConfig[] = [
  { section: "request_headers", title: "请求头改写", kind: "header" },
  { section: "request_body", title: "请求体改写", kind: "body" },
  { section: "response_headers", title: "响应头改写", kind: "header" },
  {
    section: "response_body",
    title: "响应体改写",
    kind: "body",
    fixedNotice: "仅非流式生效：流式请求跳过改写并记录 rewrite_skipped=stream",
  },
];

function emptyRule(kind: "header" | "body"): TransformRule {
  return kind === "header"
    ? { op: "update", name: "", value: "", conditions: [] }
    : { op: "update", path: "", value: "", conditions: [] };
}

function isProtected(rule: TransformRule): boolean {
  return Boolean(rule.name && PROTECTED_HEADERS.has(rule.name.trim().toLowerCase()));
}

/** 行校验：目标必填；delete / to_upper / to_lower 无值；copy 需源；其余需值 */
function ruleValid(rule: TransformRule, kind: "header" | "body"): boolean {
  if (isProtected(rule)) return false;
  if (rule.mode === "custom_cel") return (rule.value ?? "").trim().length > 0;
  const target = (kind === "header" ? rule.name : rule.path) ?? "";
  if (!target.trim()) return false;
  if (rule.op === "delete" || rule.op === "to_upper" || rule.op === "to_lower") return true;
  if (rule.op === "copy") return Boolean((rule.source_path ?? "").trim());
  if (rule.op === "regex_replace") return Boolean((rule.regex ?? "").trim());
  return (rule.value ?? "").length > 0;
}

/** 折叠行摘要：目标（头名 / 路径，CEL 行显示 CEL） */
function ruleTarget(rule: TransformRule, kind: "header" | "body"): string {
  if (rule.mode === "custom_cel") return "CEL";
  return (kind === "header" ? rule.name : rule.path) ?? "";
}

/** 折叠行摘要：动作细节（copy 的源、regex 的正则与替换、其余的值） */
function ruleDetail(rule: TransformRule, kind: "header" | "body"): string {
  const target = (kind === "header" ? rule.name : rule.path) ?? "";
  const value = (rule.value ?? "").trim();
  if (rule.mode === "custom_cel") return value;
  if (rule.op === "copy") return (rule.source_path ?? "").trim() + " → " + target.trim();
  if (rule.op === "regex_replace") return (rule.regex ?? "").trim() + " → " + value;
  if (rule.op === "delete" || rule.op === "to_upper" || rule.op === "to_lower") return "";
  return value;
}

function invalidReason(rule: TransformRule, kind: "header" | "body"): string {
  if (isProtected(rule)) return "保护头禁止改写";
  if (rule.mode === "custom_cel") return "CEL 表达式为空";
  const target = (kind === "header" ? rule.name : rule.path) ?? "";
  if (!target.trim()) return kind === "header" ? "缺头名称" : "缺目标路径";
  if (rule.op === "copy" && !(rule.source_path ?? "").trim()) return "缺源";
  if (rule.op === "regex_replace" && !(rule.regex ?? "").trim()) return "缺正则";
  if (!(rule.op === "delete" || rule.op === "to_upper" || rule.op === "to_lower") && (rule.value ?? "").length === 0) {
    return "缺值";
  }
  return "";
}

interface SectionEditorProps {
  config: SectionConfig;
  rules: TransformRule[];
  /** 预览接口吃 4 段完整规则，本段用最新草稿覆盖 */
  allTransforms: UpstreamTransforms;
  onChange: (rules: TransformRule[]) => void;
  upstreamId: string;
}

/** 右栏：选中段的规则列表（折叠行=摘要，点击展开定位编辑）+ 段底部添加与试运行。 */
function SectionEditor({ config, rules, allTransforms, onChange, upstreamId }: SectionEditorProps) {
  const [preview, setPreview] = useState<TransformPreviewResult | null>(null);
  const [renameSrc, setRenameSrc] = useState("");
  const [renameDst, setRenameDst] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const allValid = rules.every((r) => ruleValid(r, config.kind));

  const previewMut = useMutation({
    mutationFn: () =>
      api.post<TransformPreviewResult>(ENDPOINTS.transformsPreview(upstreamId), {
        ...allTransforms,
        [config.section]: rules,
      }),
    onSuccess: (data) => {
      setPreview(data);
      toast.success("试运行完成");
    },
  });

  const update = (index: number, patch: Partial<TransformRule>) => {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const toggleRow = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    const moved = next.splice(index, 1)[0];
    next.splice(target, 0, moved as TransformRule);
    onChange(next);
    // 展开态跟着行走：被交换的两个下标互换。
    setExpanded((prev) => {
      const next2 = new Set<number>();
      for (const i of prev) {
        if (i === index) next2.add(target);
        else if (i === target) next2.add(index);
        else next2.add(i);
      }
      return next2;
    });
  };
  const removeRow = (index: number) => {
    onChange(rules.filter((_, idx) => idx !== index));
    setExpanded((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    });
  };
  const addRule = () => {
    onChange([...rules, emptyRule(config.kind)]);
    setExpanded(new Set([rules.length]));
  };

  /** 重命名不是动作：一键生成 copy + delete 两行（契约 v2） */
  const renameValid =
    renameSrc.trim().length > 0 &&
    renameDst.trim().length > 0 &&
    renameSrc.trim() !== renameDst.trim() &&
    !(config.kind === "header" && PROTECTED_HEADERS.has(renameSrc.trim().toLowerCase()));
  const addRename = () => {
    if (!renameValid) return;
    const src = renameSrc.trim();
    const dst = renameDst.trim();
    const copyRow: TransformRule =
      config.kind === "header"
        ? { op: "copy", name: dst, source_path: src, conditions: [] }
        : { op: "copy", path: dst, source_path: src, conditions: [] };
    const delRow: TransformRule =
      config.kind === "header"
        ? { op: "delete", name: src, conditions: [] }
        : { op: "delete", path: src, conditions: [] };
    onChange([...rules, copyRow, delRow]);
    setExpanded(new Set([rules.length, rules.length + 1]));
    setRenameSrc("");
    setRenameDst("");
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>
          {config.title}
          <span className="tnum ml-2 text-2xs font-normal text-faint">{rules.length} 条规则</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {config.fixedNotice && (
          <div className="rounded-md bg-warning-soft px-3 py-2 text-2xs text-warning-text">{config.fixedNotice}</div>
        )}
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2/50 p-2">
          <span className="text-2xs text-faint">重命名（生成 copy + delete 两行）：</span>
          <Input
            value={renameSrc}
            onChange={(e) => setRenameSrc(e.target.value)}
            placeholder={config.kind === "header" ? "源头名" : "源路径"}
            className="h-7 max-w-40 font-mono text-2xs"
          />
          <span className="text-2xs text-faint">改为</span>
          <Input
            value={renameDst}
            onChange={(e) => setRenameDst(e.target.value)}
            placeholder={config.kind === "header" ? "新头名" : "新路径"}
            className="h-7 max-w-40 font-mono text-2xs"
          />
          <Button variant="outline" size="sm" disabled={!renameValid} onClick={addRename}>
            生成两行
          </Button>
        </div>
        {rules.length === 0 && <div className="py-6 text-center text-2xs text-faint">本段暂无规则，点击下方「添加规则」</div>}
        {/* 规则多时右栏内部滚动；每行=动作摘要+条件摘要，点击展开定位编辑 */}
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {rules.map((rule, i) => {
            const invalid = !ruleValid(rule, config.kind);
            const reason = invalid ? invalidReason(rule, config.kind) : "";
            const open = expanded.has(i);
            return (
              <div
                key={i}
                className={cn("rounded-md border", invalid ? "border-danger bg-danger-soft/40" : "border-border")}
              >
                <div className="flex items-center gap-2 p-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={open}
                    aria-label={(open ? "收起" : "展开") + "第 " + (i + 1) + " 条规则"}
                    onClick={() => toggleRow(i)}
                  >
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")}
                    />
                    <Badge tone="neutral" className="shrink-0 font-mono">{rule.op}</Badge>
                    {rule.mode === "custom_cel" && <Badge tone="info" className="shrink-0">CEL</Badge>}
                    <span className="min-w-0 flex-1 truncate font-mono text-2xs text-title">
                      {ruleTarget(rule, config.kind) || <span className="text-danger-text">（未填目标）</span>}
                    </span>
                    <span className="hidden max-w-48 truncate text-2xs text-faint md:block">
                      {ruleDetail(rule, config.kind)}
                    </span>
                    <span className="shrink-0 text-2xs text-faint">
                      {rule.conditions.length > 0 ? rule.conditions.length + " 条件" : "无条件"}
                    </span>
                    {invalid && (
                      <Badge tone="danger" className="shrink-0" title={reason}>
                        无效
                      </Badge>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="icon" title="上移" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="下移"
                      disabled={i === rules.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" title="删除本条" onClick={() => removeRow(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {open && (
                  <div className="border-t border-border p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={rule.op} onValueChange={(value) => update(i, { op: value as TransformOp })}>
                        <SelectTrigger
                          aria-label="动作"
                          className="h-7 w-auto min-w-24 gap-1 rounded-md border-border bg-surface px-1.5 py-0 text-2sm text-body"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1 text-2xs text-body">
                        <Checkbox
                          aria-label="高级（直接写 CEL）"
                          checked={rule.mode === "custom_cel"}
                          onCheckedChange={(checked) => update(i, { mode: checked === true ? "custom_cel" : undefined })}
                        />
                        高级（直接写 CEL）
                      </label>
                      {OPS.find((o) => o.value === rule.op)?.hint && (
                        <span className="text-2xs text-faint">{OPS.find((o) => o.value === rule.op)?.hint}</span>
                      )}
                    </div>

                    {rule.mode === "custom_cel" ? (
                      <Textarea
                        value={rule.value ?? ""}
                        onChange={(e) => update(i, { value: e.target.value })}
                        rows={2}
                        placeholder="CEL 表达式（跳过结构化行，直接下发）"
                        className="mt-2 min-h-0 rounded-md border-border bg-surface px-2 py-1.5 font-mono text-2xs text-title md:text-2xs"
                      />
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {config.kind === "header" ? (
                          <>
                            <Input
                              value={rule.name ?? ""}
                              onChange={(e) => update(i, { name: e.target.value })}
                              placeholder="头名称"
                              className="max-w-52 font-mono"
                              title={
                                isProtected(rule)
                                  ? "保护头禁止改写：authorization / api-key / x-api-key / cookie / set-cookie / content-type / content-length / host / x-request-id"
                                  : undefined
                              }
                            />
                            {isProtected(rule) && (
                              <Badge tone="danger" title="保护头禁止改写（契约不变量 1），该行不会被保存">
                                保护头，禁止改写
                              </Badge>
                            )}
                          </>
                        ) : (
                          <>
                            <Input
                              value={rule.path ?? ""}
                              onChange={(e) => update(i, { path: e.target.value })}
                              placeholder="目标路径 a.b.0.c"
                              className="max-w-52 font-mono"
                            />
                            {["model", "stream"].includes((rule.path ?? "").trim().toLowerCase()) && (
                              <span className="text-2xs text-warning-text">
                                该路径影响{rule.path?.trim().toLowerCase() === "model" ? "后续选路" : "SSE 流式帧"}，风险由管理用户承担
                              </span>
                            )}
                          </>
                        )}
                        {rule.op === "copy" && (
                          <Input
                            value={rule.source_path ?? ""}
                            onChange={(e) => update(i, { source_path: e.target.value })}
                            placeholder={config.kind === "header" ? "源头名" : "源路径"}
                            className="max-w-52 font-mono"
                          />
                        )}
                        {rule.op === "regex_replace" ? (
                          <>
                            <Input
                              value={rule.regex ?? ""}
                              onChange={(e) => update(i, { regex: e.target.value })}
                              placeholder="正则"
                              className="max-w-52 font-mono"
                            />
                            <Input
                              value={rule.replacement ?? ""}
                              onChange={(e) => update(i, { replacement: e.target.value })}
                              placeholder="替换文本（留空=删除匹配）"
                              className="max-w-52"
                            />
                          </>
                        ) : (
                          !(rule.op === "delete" || rule.op === "to_upper" || rule.op === "to_lower") && (
                            <Input
                              value={rule.value ?? ""}
                              onChange={(e) => update(i, { value: e.target.value })}
                              placeholder="值"
                              className="max-w-72"
                            />
                          )
                        )}
                      </div>
                    )}

                    {rule.mode !== "custom_cel" && (
                      <div className="mt-2 space-y-1.5">
                        {rule.conditions.map((cond, ci) => (
                          <div key={ci} className="flex flex-wrap items-center gap-1.5">
                            <span className="text-2xs text-faint">当</span>
                            <Input
                              value={cond.field}
                              onChange={(e) => {
                                const conds = rule.conditions.map((c, k) => (k === ci ? { ...c, field: e.target.value } : c));
                                update(i, { conditions: conds });
                              }}
                              placeholder="字段（如 model）"
                              className="h-7 max-w-40 text-2xs"
                            />
                            <Select
                              value={cond.mode}
                              onValueChange={(value) => {
                                const conds = rule.conditions.map((c, k) =>
                                  k === ci ? { ...c, mode: value as ConditionMode } : c,
                                );
                                update(i, { conditions: conds });
                              }}
                            >
                              <SelectTrigger
                                aria-label="条件模式"
                                className="h-7 w-auto min-w-20 gap-1 rounded-md border-border bg-surface px-1.5 py-0 text-2xs text-body"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CONDITION_MODES.map((m) => (
                                  <SelectItem key={m.value} value={m.value}>
                                    {m.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              value={cond.value}
                              onChange={(e) => {
                                const conds = rule.conditions.map((c, k) => (k === ci ? { ...c, value: e.target.value } : c));
                                update(i, { conditions: conds });
                              }}
                              placeholder="值"
                              className="h-7 max-w-40 text-2xs"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => update(i, { conditions: rule.conditions.filter((_, k) => k !== ci) })}
                            >
                              移除条件
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            update(i, {
                              conditions: [...rule.conditions, { field: "", mode: "full", value: "" } as RewriteCondition],
                            })
                          }
                        >
                          <ACTION_ICONS.add className="h-3 w-3" /> 加条件
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <Button variant="outline" size="sm" onClick={addRule}>
            <ACTION_ICONS.add className="h-3.5 w-3.5" /> 添加规则
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!allValid || previewMut.isPending}
            onClick={() => previewMut.mutate()}
          >
            <ACTION_ICONS.dryRun className="h-3.5 w-3.5" /> 试运行本段
          </Button>
          {!allValid && <span className="text-2xs text-danger-text">存在无效或受保护的行，修正后才能试运行/保存</span>}
        </div>
        {preview && (
          <div className="space-y-1.5 rounded-md bg-surface-2/60 p-2.5">
            <div className="text-2xs font-medium text-body">试运行结果</div>
            {preview.skipped.map((reason) => (
              <Badge key={reason} tone="warning">
                跳过原因：{reason}
              </Badge>
            ))}
            {preview.notes.map((note) => (
              <div key={note} className="text-2xs text-warning-text">
                · {note}
              </div>
            ))}
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <div className="text-2xs text-faint">下发前（本段规则）</div>
                <pre className="tnum max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 font-mono text-2xs">
                  {JSON.stringify(allTransforms[config.section], null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-2xs text-faint">编译结果（transformations）</div>
                <pre className="tnum max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 font-mono text-2xs">
                  {JSON.stringify(preview.after, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 只读：系统默认改写行为（P0 结论要求在改写 tab 明示） */
function ReadOnlyBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2sm">
          {title}
          <Badge tone="neutral">只读</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {lines.map((line) => (
          <div key={line} className="text-2xs text-body">
            · {line}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function TransformsEditor({
  upstreamId,
  onDirtyChange,
}: {
  upstreamId: string;
  /** dirty 状态上抛给页面（upstream_detail）：页签圆点、切页签确认与离页守卫共用（W4-G）。 */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const loaded = useQuery({
    queryKey: ["upstream-transforms", upstreamId],
    queryFn: async (): Promise<UpstreamTransforms> => {
      const data = await api.get<UpstreamTransformsResponse>(ENDPOINTS.transforms(upstreamId));
      return (
        data.transforms ?? {
          request_headers: [],
          request_body: [],
          response_headers: [],
          response_body: [],
        }
      );
    },
  });
  const [draft, setDraft] = useState<UpstreamTransforms | null>(null);
  const [activeSection, setActiveSection] = useState<TransformSection>("request_headers");

  const value = draft ?? loaded.data ?? null;
  const dirty = useMemo(() => {
    if (!value || !loaded.data) return false;
    return JSON.stringify(value) !== JSON.stringify(loaded.data);
  }, [value, loaded.data]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // 卸载时复位上抛的 dirty：切页签/保存成功后页面级状态不留脏标记。
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const saveMut = useMutation({
    mutationFn: () => api.put<{ saved: boolean }>(ENDPOINTS.transforms(upstreamId), value),
    onSuccess: () => {
      toast.success("改写规则已保存");
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["upstream-transforms", upstreamId] });
    },
  });

  if (loaded.isPending) return <Skeleton className="h-64 w-full" />;
  if (loaded.isError || !value) return <div className="text-2sm text-danger-text">改写规则加载失败</div>;

  const setSection = (section: TransformSection, rules: TransformRule[]) => {
    const next = { ...value } as UpstreamTransforms;
    next[section] = rules;
    setDraft(next);
  };

  const activeCfg = SECTIONS.find((cfg) => cfg.section === activeSection) ?? SECTIONS[0]!;

  return (
    <div className="space-y-3">
      <ReadOnlyBlock
        title="系统默认规则"
        lines={["删除出站头 server 与 x-powered-by（代理指纹），对所有上游固定生效"]}
      />
      <ReadOnlyBlock
        title="响应改写默认条件：无"
        lines={[
          "控制面不再注入 response.code < 400 守卫，管理用户写的改写行原样生效",
          "要只改成功响应，请自行加一行 response.code < 400 条件；错误体是否改写由管理用户决定",
        ]}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs text-faint">
          四段改写共用同一套动作词表（ADR-009）。同段顺序即生效顺序；无条件规则必须排在末位。改写不会随页头「保存」提交，用本页「保存全部」单独写库；试运行只做编译预览，不落库。
        </p>
        <Button variant="primary" size="sm" disabled={!dirty || saveMut.isPending} onClick={() => saveMut.mutate()}>
          <ACTION_ICONS.save className="h-3.5 w-3.5" /> 保存全部
        </Button>
      </div>
      {/* 主从布局（W4-G）：左栏选段（计数徽章），右栏改该段规则（折叠行定位、展开编辑）。 */}
      <div className="grid items-start gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="改写段落导航" className="flex flex-row gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {SECTIONS.map((cfg) => {
            const active = cfg.section === activeSection;
            const count = value[cfg.section].length;
            return (
              <button
                key={cfg.section}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => setActiveSection(cfg.section)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-control px-2.5 py-2 text-left transition-colors lg:w-full",
                  active ? "bg-primary-soft text-primary" : "text-body hover:bg-surface-2 hover:text-title",
                )}
              >
                <span className="min-w-0 flex-1 text-2sm font-medium">{cfg.title}</span>
                <Badge tone={count > 0 ? "primary" : "neutral"} className="tnum shrink-0">
                  {count}
                </Badge>
              </button>
            );
          })}
        </nav>
        <SectionEditor
          key={activeCfg.section}
          config={activeCfg}
          rules={value[activeCfg.section]}
          allTransforms={value}
          onChange={(rules) => setSection(activeCfg.section, rules)}
          upstreamId={upstreamId}
        />
      </div>
    </div>
  );
}
