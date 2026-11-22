import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "@/lib/notify";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { controlPlane } from "@/lib/control-plane";
import { errorMessage } from "@/lib/control-plane/errors";
import { ACTION_ICONS } from "@/lib/icons";
import {
  CONDITION_MODES,
  TRANSFORM_OPS,
  TRANSFORM_SECTIONS,
  documentIssues,
  emptyTransformRule,
  formatTransformsJson,
  isBlankRule,
  isProtectedHeader,
  parseTransformsJson,
  ruleValidation,
  transformOpLabel,
  withoutBlankRules,
  type TransformIssue,
  type TransformSectionMeta,
} from "@/lib/transforms/document";
import { formatSampleValue, parseHeaderLines, parseJsonSample } from "@/lib/transforms/sample";
import { cn } from "@/lib/utils";
import type {
  ConditionMode,
  RewriteCondition,
  TransformOp,
  TransformPreviewResult,
  TransformRule,
  TransformSampleInput,
  TransformSamplePhase,
  TransformSampleResult,
  TransformSection,
  UpstreamTransforms,
} from "@/types";

/**
 * 改写规则编辑器（W8 t05 重做）。
 *
 * 一份规则文档（UpstreamTransforms，wire 形状由 lib/transforms/document 定义）同时驱动
 * 可视化与 JSON 两个视图：JSON 合法时立即回写同一份 draft，非法时保留文本与错误但不覆盖
 * draft；切换视图不丢未保存状态。空白占位行只是编辑辅助，预览/保存前由同一模块过滤，
 * 因此新增一行不会让既有规则变成「无效」。样例测试把粘贴的请求/响应交给后端内存回放
 * （POST /transforms/sample），前端只做输入解析与 before/after diff 展示，不访问上游。
 */

/** 四段全空的规则文档：加载完成前用它承载 draft 编辑。 */
const EMPTY_DOCUMENT: UpstreamTransforms = {
  request_headers: [],
  request_body: [],
  response_headers: [],
  response_body: [],
};

/** 只读的「系统默认行为」说明块：让管理用户分清哪些改写不是自己写的。 */
function ReadOnlyBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Card className="border-border bg-surface-2/40">
      <CardHeader className="p-3">
        <CardTitle className="flex items-center gap-2 text-2sm">
          {title}
          <Badge tone="neutral">只读</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 p-3 pt-0">
        {lines.map((line) => (
          <div key={line} className="text-2xs text-body">
            · {line}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** 行摘要（仅展示）：目标是头名 / 路径；copy 行体规则目标是 target_path。 */
function displayTarget(rule: TransformRule, kind: "header" | "body"): string {
  if (kind === "header") return rule.name ?? "";
  return rule.op === "copy" ? (rule.target_path ?? "") : (rule.path ?? "");
}

function displayDetail(rule: TransformRule, kind: "header" | "body"): string {
  if (rule.op === "copy") {
    const source = kind === "header" ? (rule.source_name ?? "") : (rule.source_path ?? "");
    return source.trim() + " → " + displayTarget(rule, kind).trim();
  }
  if (rule.op === "regex_replace") return (rule.regex ?? "").trim() + " → " + (rule.replacement ?? "");
  if (rule.op === "delete" || rule.op === "to_upper" || rule.op === "to_lower") return "";
  return (rule.value ?? "").trim();
}

interface SectionEditorProps {
  config: TransformSectionMeta;
  rules: TransformRule[];
  onChange: (rules: TransformRule[]) => void;
}

/**
 * 单段规则编辑器：折叠行只显示摘要，展开才编辑；条件逐条就地校验（role=alert），
 * 空白占位行不标无效。行内动作下拉的展示标签是中文，wire 值仍是英文枚举。
 */
function SectionEditor({ config, rules, onChange }: SectionEditorProps) {
  const kind = config.kind;
  const [renameSrc, setRenameSrc] = useState("");
  const [renameDst, setRenameDst] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const update = (index: number, patch: Partial<TransformRule>) => {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };
  const toggleRow = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const moveRow = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    const moved = next.splice(index, 1)[0];
    if (!moved) return;
    next.splice(target, 0, moved);
    onChange(next);
    setExpanded((prev) => {
      const remapped = new Set<number>();
      for (const i of prev) {
        if (i === index) remapped.add(target);
        else if (i === target) remapped.add(index);
        else remapped.add(i);
      }
      return remapped;
    });
  };
  const removeRow = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
    setExpanded((prev) => {
      const remapped = new Set<number>();
      for (const i of prev) {
        if (i < index) remapped.add(i);
        else if (i > index) remapped.add(i - 1);
      }
      return remapped;
    });
  };
  const addRule = () => {
    onChange([...rules, emptyTransformRule(kind)]);
    setExpanded(new Set([rules.length]));
  };

  /** 重命名不是独立动作：一键生成 copy + delete 两行，wire 字段按段 canonical。 */
  const renameValid =
    renameSrc.trim().length > 0 &&
    renameDst.trim().length > 0 &&
    renameSrc.trim() !== renameDst.trim() &&
    !(kind === "header" && isProtectedHeader(renameSrc));
  const addRename = () => {
    if (!renameValid) return;
    const src = renameSrc.trim();
    const dst = renameDst.trim();
    const copyRow: TransformRule =
      kind === "header"
        ? { op: "copy", name: dst, source_name: src, conditions: [] }
        : { op: "copy", source_path: src, target_path: dst, conditions: [] };
    const deleteRow: TransformRule =
      kind === "header" ? { op: "delete", name: src, conditions: [] } : { op: "delete", path: src, conditions: [] };
    onChange([...rules, copyRow, deleteRow]);
    setExpanded(new Set([rules.length, rules.length + 1]));
    setRenameSrc("");
    setRenameDst("");
  };

  const invalidCount = rules.filter((rule) => {
    const validation = ruleValidation(rule, config.section);
    return validation.message !== "" || validation.conditionMessages.some((message) => message !== null);
  }).length;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-2sm">
          {config.title}
          <span className="tnum ml-2 text-2xs font-normal text-faint">
            {String(rules.length)} 行{invalidCount > 0 ? " · " + String(invalidCount) + " 行无效" : ""}
          </span>
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
            placeholder={kind === "header" ? "源头名" : "源路径"}
            aria-label="重命名的源"
            className="h-7 max-w-40 font-mono text-2xs"
          />
          <span className="text-2xs text-faint">改为</span>
          <Input
            value={renameDst}
            onChange={(e) => setRenameDst(e.target.value)}
            placeholder={kind === "header" ? "新头名" : "新路径"}
            aria-label="重命名的目标"
            className="h-7 max-w-40 font-mono text-2xs"
          />
          <Button variant="outline" size="dense" disabled={!renameValid} onClick={addRename}>
            生成两行
          </Button>
        </div>
        {rules.length === 0 && <div className="py-6 text-center text-2xs text-faint">本段暂无规则，点击下方「添加规则」</div>}
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {rules.map((rule, index) => {
            const blank = isBlankRule(rule);
            const validation = ruleValidation(rule, config.section);
            const invalid = !blank && (validation.message !== "" || validation.conditionMessages.some((message) => message !== null));
            const reason = validation.message || validation.conditionMessages.find((message) => message) || "";
            const open = expanded.has(index);
            return (
              <div
                key={index}
                className={cn("rounded-md border", invalid ? "border-danger bg-danger-soft/40" : "border-border")}
              >
                <div className="flex items-center gap-2 p-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={open}
                    aria-label={(open ? "收起" : "展开") + "第 " + String(index + 1) + " 行规则"}
                    onClick={() => toggleRow(index)}
                  >
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} />
                    <Badge tone="neutral" className="shrink-0">
                      {transformOpLabel(rule.op)}
                    </Badge>
                    {blank ? (
                      <span className="min-w-0 flex-1 truncate text-2xs text-faint">空白占位行（不参与校验/保存）</span>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-mono text-2xs text-title">
                        {displayTarget(rule, kind) || <span className="text-danger-text">（未填目标）</span>}
                      </span>
                    )}
                    {!blank && (
                      <span className="hidden max-w-48 truncate text-2xs text-faint md:block">{displayDetail(rule, kind)}</span>
                    )}
                    {!blank && (
                      <span className="shrink-0 text-2xs text-faint">
                        {rule.conditions.length > 0 ? String(rule.conditions.length) + " 条件" : "无条件"}
                      </span>
                    )}
                    {invalid && (
                      <Badge tone="danger" className="shrink-0" title={reason}>
                        无效
                      </Badge>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="dense" title="上移" aria-label="上移" disabled={index === 0} onClick={() => moveRow(index, -1)}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="dense" title="下移" aria-label="下移" disabled={index === rules.length - 1} onClick={() => moveRow(index, 1)}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="dense" title="删除本行" aria-label="删除本行" onClick={() => removeRow(index)}>
                      <ACTION_ICONS.delete className="h-3.5 w-3.5 text-danger-text" />
                    </Button>
                  </div>
                </div>

                {open && (
                  <div className="border-t border-border p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={rule.op} onValueChange={(next) => update(index, { op: next as TransformOp })}>
                        <SelectTrigger aria-label="动作" className="h-7 w-auto min-w-24 gap-1 rounded-md border-border bg-surface px-1.5 py-0 text-2xs text-body">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRANSFORM_OPS.map((op) => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-2xs text-faint">{TRANSFORM_OPS.find((op) => op.value === rule.op)?.hint}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {kind === "header" ? (
                        <>
                          <Input
                            value={rule.name ?? ""}
                            onChange={(e) => update(index, { name: e.target.value })}
                            placeholder="头名称"
                            aria-label="头名称"
                            className="max-w-52 font-mono"
                          />
                          {rule.op === "copy" && (
                            <Input
                              value={rule.source_name ?? ""}
                              onChange={(e) => update(index, { source_name: e.target.value })}
                              placeholder="源头名"
                              aria-label="源头名"
                              className="max-w-52 font-mono"
                            />
                          )}
                          {isProtectedHeader(rule.name ?? "") && (
                            <Badge tone="danger" title="保护头禁止改写（契约不变量 1）">
                              保护头，禁止改写
                            </Badge>
                          )}
                        </>
                      ) : rule.op === "copy" ? (
                        <>
                          <Input
                            value={rule.source_path ?? ""}
                            onChange={(e) => update(index, { source_path: e.target.value })}
                            placeholder="源路径"
                            aria-label="源路径"
                            className="max-w-52 font-mono"
                          />
                          <span className="text-2xs text-faint">→</span>
                          <Input
                            value={rule.target_path ?? ""}
                            onChange={(e) => update(index, { target_path: e.target.value })}
                            placeholder="目标路径 a.b.0.c"
                            aria-label="目标路径"
                            className="max-w-52 font-mono"
                          />
                        </>
                      ) : (
                        <>
                          <Input
                            value={rule.path ?? ""}
                            onChange={(e) => update(index, { path: e.target.value })}
                            placeholder="目标路径 a.b.0.c"
                            aria-label="目标路径"
                            className="max-w-52 font-mono"
                          />
                          {["model", "stream"].includes((rule.path ?? "").trim().toLowerCase()) && (
                            <span className="text-2xs text-warning-text">
                              该路径影响{rule.path?.trim().toLowerCase() === "model" ? "后续选路" : "SSE 流式帧"}，风险由管理用户承担
                            </span>
                          )}
                        </>
                      )}
                      {rule.op === "regex_replace" ? (
                        <>
                          <Input
                            value={rule.regex ?? ""}
                            onChange={(e) => update(index, { regex: e.target.value })}
                            placeholder="正则"
                            aria-label="正则"
                            className="max-w-52 font-mono"
                          />
                          <Input
                            value={rule.replacement ?? ""}
                            onChange={(e) => update(index, { replacement: e.target.value })}
                            placeholder="替换文本（留空=删除匹配）"
                            aria-label="替换文本"
                            className="max-w-52"
                          />
                        </>
                      ) : (
                        !(rule.op === "delete" || rule.op === "to_upper" || rule.op === "to_lower") && (
                          <Input
                            value={rule.value ?? ""}
                            onChange={(e) => update(index, { value: e.target.value })}
                            placeholder="值"
                            aria-label="值"
                            className="max-w-72"
                          />
                        )
                      )}
                    </div>

                    <div className="mt-2 space-y-1.5">
                      {rule.conditions.map((condition, conditionIndex) => {
                        const conditionMessage = validation.conditionMessages[conditionIndex] ?? null;
                        return (
                          <div key={conditionIndex} className="space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-2xs text-faint">当</span>
                              <Input
                                value={condition.field}
                                onChange={(e) => {
                                  const conditions = rule.conditions.map((item, i) =>
                                    i === conditionIndex ? { ...item, field: e.target.value } : item,
                                  );
                                  update(index, { conditions });
                                }}
                                placeholder={kind === "header" ? "头名称（如 x-route）" : "字段（如 model）"}
                                aria-label="条件字段"
                                aria-invalid={conditionMessage ? true : undefined}
                                className={cn("h-7 max-w-48 text-2xs", conditionMessage ? "border-danger" : "")}
                              />
                              <Select
                                value={condition.mode}
                                onValueChange={(next) => {
                                  const conditions = rule.conditions.map((item, i) =>
                                    i === conditionIndex ? { ...item, mode: next as ConditionMode } : item,
                                  );
                                  update(index, { conditions });
                                }}
                              >
                                <SelectTrigger aria-label="条件模式" className="h-7 w-auto min-w-20 gap-1 rounded-md border-border bg-surface px-1.5 py-0 text-2xs text-body">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {CONDITION_MODES.map((mode) => (
                                    <SelectItem key={mode.value} value={mode.value}>
                                      {mode.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                value={condition.value}
                                onChange={(e) => {
                                  const conditions = rule.conditions.map((item, i) =>
                                    i === conditionIndex ? { ...item, value: e.target.value } : item,
                                  );
                                  update(index, { conditions });
                                }}
                                placeholder="值"
                                aria-label="条件值"
                                aria-invalid={conditionMessage ? true : undefined}
                                className={cn("h-7 max-w-48 text-2xs", conditionMessage ? "border-danger" : "")}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => update(index, { conditions: rule.conditions.filter((_, i) => i !== conditionIndex) })}
                              >
                                移除条件
                              </Button>
                            </div>
                            {conditionMessage && (
                              <div role="alert" className="text-2xs text-danger-text">
                                {conditionMessage}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          update(index, {
                            conditions: [...rule.conditions, { field: "", mode: "full", value: "" } as RewriteCondition],
                          })
                        }
                      >
                        <ACTION_ICONS.add className="h-3 w-3" /> 加条件
                      </Button>
                    </div>
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
          <span className="text-2xs text-faint">空白占位行不参与预览/保存校验；同段顺序即生效顺序，无条件行必须排在末位。</span>
        </div>
      </CardContent>
    </Card>
  );
}

interface SampleFormState {
  requestHeaders: string;
  requestBody: string;
  responseHeaders: string;
  responseBody: string;
}

const DEFAULT_SAMPLE: SampleFormState = {
  requestHeaders: "content-type: application/json\nx-trace: demo",
  requestBody: JSON.stringify(
    {
      model: "glm-5.3",
      temperature: 0.7,
      messages: [{ role: "user", content: "你好" }],
    },
    null,
    2,
  ),
  responseHeaders: "content-type: application/json",
  responseBody: JSON.stringify(
    {
      id: "chatcmpl-demo",
      model: "glm-5.3",
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    },
    null,
    2,
  ),
};

function sectionTitle(section: TransformSection): string {
  return TRANSFORM_SECTIONS.find((meta) => meta.section === section)?.title ?? section;
}

function issueLabel(issue: TransformIssue): string {
  if (!issue.section) return issue.message;
  const title = sectionTitle(issue.section);
  if (issue.index === undefined) return title + "：" + issue.message;
  return title + " 第 " + String(issue.index + 1) + " 行：" + issue.message;
}

function SampleTextarea({
  label,
  value,
  rows,
  onChange,
}: {
  label: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-2xs text-faint">{label}</span>
      <Textarea
        aria-label={label}
        spellCheck={false}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono text-2xs"
      />
    </label>
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
      const data = await controlPlane.upstreams.getTransforms(upstreamId);
      return data.transforms ?? EMPTY_DOCUMENT;
    },
  });

  const [draft, setDraft] = useState<UpstreamTransforms | null>(null);
  const [activeSection, setActiveSection] = useState<TransformSection>("request_headers");
  const [view, setView] = useState<"visual" | "json">("visual");
  const [jsonText, setJsonText] = useState("");
  const [jsonIssues, setJsonIssues] = useState<TransformIssue[]>([]);
  const [preview, setPreview] = useState<TransformPreviewResult | null>(null);
  const [sampleForm, setSampleForm] = useState<SampleFormState>(DEFAULT_SAMPLE);
  const [sampleErrors, setSampleErrors] = useState<string[]>([]);
  const [sampleResult, setSampleResult] = useState<TransformSampleResult | null>(null);

  const value = draft ?? loaded.data ?? null;
  /** 预览/保存实际提交的文档：空白占位行只存在于本地草稿。 */
  const filtered = useMemo(() => (value ? withoutBlankRules(value) : null), [value]);
  const issues = useMemo(() => (value ? documentIssues(value) : []), [value]);
  /** dirty 按过滤后文档比较：新增空白占位行不算未保存修改。 */
  const dirty = useMemo(() => {
    if (!value || !loaded.data) return false;
    return JSON.stringify(withoutBlankRules(value)) !== JSON.stringify(withoutBlankRules(loaded.data));
  }, [value, loaded.data]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // 卸载时复位上抛的 dirty：切页签/保存成功后页面级状态不留脏标记。
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // 只有当前视图的问题阻塞操作：可视化视图下，JSON 面板里尚未应用的非法文本不可见，
  // 不能因此永久禁用预览/保存（W8 复审 B1）。JSON 视图的问题仍然阻塞并在面板内提示。
  const blocked = issues.length > 0 || (view === "json" && jsonIssues.length > 0);

  const previewMut = useMutation({
    mutationFn: (input: UpstreamTransforms) => controlPlane.upstreams.previewTransforms(upstreamId, input),
    onSuccess: (result) => setPreview(result),
    onError: (error) => toast.error("预览编译失败", { description: errorMessage(error) }),
  });

  const saveMut = useMutation({
    mutationFn: (input: UpstreamTransforms) => controlPlane.upstreams.saveTransforms(upstreamId, input),
    onSuccess: () => {
      toast.success("改写规则已保存");
      setDraft(null);
      setJsonText("");
      setJsonIssues([]);
      setPreview(null);
      setSampleResult(null);
      void queryClient.invalidateQueries({ queryKey: ["upstream-transforms", upstreamId] });
    },
    onError: (error) => toast.error("保存失败", { description: errorMessage(error) }),
  });

  const sampleMut = useMutation({
    mutationFn: (input: TransformSampleInput) => controlPlane.upstreams.sampleTransforms(upstreamId, input),
    onSuccess: (result) => setSampleResult(result),
    onError: (error) => setSampleErrors([errorMessage(error)]),
  });

  if (loaded.isPending) return <Skeleton className="h-64 w-full" />;
  if (loaded.isError || !value) return <div className="text-2sm text-danger-text">改写规则加载失败</div>;

  const document = value;
  const activeCfg = TRANSFORM_SECTIONS.find((meta) => meta.section === activeSection) ?? TRANSFORM_SECTIONS[0]!;

  const setSection = (section: TransformSection, rules: TransformRule[]) => {
    setDraft({ ...(draft ?? loaded.data ?? EMPTY_DOCUMENT), [section]: rules });
  };

  /** 视图切换：可视化 → JSON 时从当前文档重新序列化；JSON 有错则保留用户文本便于修正。 */
  const changeView = (next: "visual" | "json") => {
    if (next === view) return;
    if (next === "json" && jsonIssues.length === 0) {
      setJsonText(formatTransformsJson(document));
      setJsonIssues([]);
    }
    setView(next);
  };

  /** JSON 编辑：合法即回写同一份 draft；非法只记录问题，绝不覆盖已加载的合法文档。 */
  const handleJsonChange = (text: string) => {
    setJsonText(text);
    const parsed = parseTransformsJson(text);
    setJsonIssues(parsed.issues);
    if (parsed.document) setDraft(parsed.document);
  };

  const formatJson = () => {
    const parsed = parseTransformsJson(jsonText);
    setJsonIssues(parsed.issues);
    if (parsed.document) {
      setDraft(parsed.document);
      setJsonText(formatTransformsJson(parsed.document));
    }
  };

  /** 重新载入：放弃 JSON 面板里的手改，用当前规则文档重建文本并清掉未应用的问题（W8 复审 B1）。 */
  const reloadJsonFromDocument = () => {
    setJsonText(formatTransformsJson(document));
    setJsonIssues([]);
  };

  const runPreview = () => {
    if (!filtered) return;
    previewMut.mutate(filtered);
  };

  /** 样例测试：先在前端校验粘贴格式，再交给后端同一 codec 在内存中回放。 */
  const runSample = () => {
    const requestHeaders = parseHeaderLines(sampleForm.requestHeaders);
    const requestBody = parseJsonSample(sampleForm.requestBody, "请求体");
    const responseHeaders = parseHeaderLines(sampleForm.responseHeaders);
    const responseBody = parseJsonSample(sampleForm.responseBody, "响应体");
    const errors = [requestHeaders.error, requestBody.error, responseHeaders.error, responseBody.error].filter(
      (item): item is string => Boolean(item),
    );
    setSampleErrors(errors);
    setSampleResult(null);
    if (errors.length > 0 || !filtered) return;
    sampleMut.mutate({
      transforms: filtered,
      request: {
        headers: requestHeaders.headers,
        body: requestBody.value,
      } satisfies TransformSamplePhase,
      response: {
        headers: responseHeaders.headers,
        body: responseBody.value,
      } satisfies TransformSamplePhase,
    });
  };

  const saveBlockedReason = blocked
    ? "先修正校验问题再保存"
    : !dirty
      ? "没有未保存的修改"
      : "保存全部规则（空白占位行不保存）";

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

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <p className="max-w-3xl text-2xs text-faint">
            四段改写共用同一套动作词表（ADR-009），动作值仍是英文 wire 枚举，界面只做中文展示。同段顺序即生效顺序；
            无条件规则必须排在末位。空白占位行不参与预览/保存校验，保存前自动过滤。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(next) => {
                if (next === "visual" || next === "json") changeView(next);
              }}
              aria-label="编辑方式"
            >
              <ToggleGroupItem value="visual" aria-label="可视化编辑">
                可视化
              </ToggleGroupItem>
              <ToggleGroupItem value="json" aria-label="JSON 编辑">
                JSON
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="text-2xs text-faint">
              {view === "json"
                ? "JSON 合法时立即同步到同一份规则文档；非法只提示，不覆盖已加载文档。"
                : "可视化与 JSON 共用同一份规则文档，切换视图不丢未保存状态。"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={blocked || previewMut.isPending}
            title={blocked ? "先修正校验问题再预览" : "编译预览下发内容，不落库"}
            onClick={runPreview}
          >
            <ACTION_ICONS.dryRun className="h-3.5 w-3.5" /> 预览编译
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || blocked || saveMut.isPending}
            title={saveBlockedReason}
            onClick={() => {
              if (filtered) saveMut.mutate(filtered);
            }}
          >
            <ACTION_ICONS.save className="h-3.5 w-3.5" /> 保存全部
          </Button>
        </div>
      </div>

      {issues.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <div className="font-medium">有 {String(issues.length)} 处校验问题，预览与保存已禁用</div>
            <div className="mt-1 space-y-0.5">
              {issues.slice(0, 5).map((issue, index) => (
                <div key={index} className="text-2xs">
                  {issueLabel(issue)}
                </div>
              ))}
              {issues.length > 5 && <div className="text-2xs">…另有 {String(issues.length - 5)} 处，展开对应行查看</div>}
            </div>
          </AlertDescription>
        </Alert>
      )}
      {view === "visual" && jsonIssues.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                JSON 视图里还有 {String(jsonIssues.length)} 处未应用的问题；当前按可视化规则预览/保存，未应用的 JSON 文本不会写入。
              </span>
              <Button variant="outline" size="dense" onClick={reloadJsonFromDocument}>
                重新载入 JSON
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {view === "json" ? (
        <Card>
          <CardContent className="space-y-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-2xs text-faint">规则 JSON（wire 形状）；保存/预览前按 schema 校验，非法内容不会写库。</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="dense"
                  onClick={reloadJsonFromDocument}
                  title="放弃 JSON 面板里的手改，按当前规则文档重新生成"
                >
                  重新载入
                </Button>
                <Button variant="outline" size="dense" onClick={formatJson} disabled={jsonText.trim().length === 0}>
                  格式化
                </Button>
              </div>
            </div>
            <Textarea
              aria-label="改写规则 JSON"
              spellCheck={false}
              rows={22}
              value={jsonText}
              onChange={(event) => handleJsonChange(event.target.value)}
              className="font-mono text-2xs"
            />
            {jsonIssues.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <div className="font-medium">JSON 校验未通过（{String(jsonIssues.length)} 处）</div>
                  <div className="mt-1 space-y-0.5">
                    {jsonIssues.slice(0, 8).map((issue, index) => (
                      <div key={index} className="text-2xs">
                        {issueLabel(issue)}
                      </div>
                    ))}
                    {jsonIssues.length > 8 && <div className="text-2xs">…另有 {String(jsonIssues.length - 8)} 处</div>}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="改写段落导航" className="flex flex-row gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {TRANSFORM_SECTIONS.map((meta) => {
              const active = meta.section === activeSection;
              const count = document[meta.section].length;
              return (
                <button
                  key={meta.section}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setActiveSection(meta.section)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-control px-2.5 py-2 text-left transition-colors lg:w-full",
                    active ? "bg-primary-soft text-primary" : "text-body hover:bg-surface-2 hover:text-title",
                  )}
                >
                  <span className="min-w-0 flex-1 text-2sm font-medium">{meta.title}</span>
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
            rules={document[activeCfg.section]}
            onChange={(rules) => setSection(activeCfg.section, rules)}
          />
        </div>
      )}

      {preview && (
        <Card>
          <CardHeader className="flex items-center justify-between p-3">
            <CardTitle className="text-2sm">编译预览</CardTitle>
            <Badge tone="info">不落库</Badge>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            <div className="text-2xs text-faint">下发前的规则文档（已过滤空白行）：</div>
            <pre className="max-h-48 overflow-auto rounded-md bg-surface-2/60 p-2 font-mono text-2xs text-body">
              {JSON.stringify(preview.before, null, 2)}
            </pre>
            <div className="text-2xs text-faint">编译后的 transformations：</div>
            <pre className="max-h-64 overflow-auto rounded-md bg-surface-2/60 p-2 font-mono text-2xs text-body">
              {JSON.stringify(preview.after, null, 2)}
            </pre>
            {preview.skipped.length > 0 && (
              <div className="text-2xs text-warning-text">跳过：{preview.skipped.join("；")}</div>
            )}
            {preview.notes.length > 0 && (
              <div className="space-y-0.5 text-2xs text-faint">
                {preview.notes.map((note) => (
                  <div key={note}>· {note}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between p-3">
          <CardTitle className="text-2sm">样例测试</CardTitle>
          <Badge tone="neutral">不访问上游 · 不落库</Badge>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-0">
          <p className="text-2xs text-faint">
            粘贴请求/响应 headers 与 JSON body，用当前规则在内存中回放，列出字段修改前后 diff；不会调用真实上游，也不会保存。
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-2xs font-medium text-body">请求样例</div>
              <SampleTextarea
                label="请求头（每行 Name: Value）"
                rows={3}
                value={sampleForm.requestHeaders}
                onChange={(next) => setSampleForm((prev) => ({ ...prev, requestHeaders: next }))}
              />
              <SampleTextarea
                label="请求体（JSON，留空表示没有 body）"
                rows={6}
                value={sampleForm.requestBody}
                onChange={(next) => setSampleForm((prev) => ({ ...prev, requestBody: next }))}
              />
            </div>
            <div className="space-y-2">
              <div className="text-2xs font-medium text-body">响应样例</div>
              <SampleTextarea
                label="响应头（每行 Name: Value）"
                rows={3}
                value={sampleForm.responseHeaders}
                onChange={(next) => setSampleForm((prev) => ({ ...prev, responseHeaders: next }))}
              />
              <SampleTextarea
                label="响应体（JSON，留空表示没有 body）"
                rows={6}
                value={sampleForm.responseBody}
                onChange={(next) => setSampleForm((prev) => ({ ...prev, responseBody: next }))}
              />
            </div>
          </div>

          {sampleErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <div className="font-medium">样例格式有误，未执行回放</div>
                <div className="mt-1 space-y-0.5">
                  {sampleErrors.map((message) => (
                    <div key={message} className="text-2xs">
                      {message}
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={sampleMut.isPending || blocked}
              title={blocked ? "先修正校验问题再运行样例" : "用当前规则回放粘贴的样例"}
              onClick={runSample}
            >
              <ACTION_ICONS.dryRun className="h-3.5 w-3.5" /> {sampleMut.isPending ? "回放中…" : "运行样例"}
            </Button>
            <span className="text-2xs text-faint">使用当前编辑中的规则（空白占位行不参与），不需要先保存。</span>
          </div>

          {sampleResult && (
            <div className="space-y-2 rounded-md border border-border bg-surface-2/40 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-2xs font-medium text-body">字段差异</span>
                <span className="text-2xs text-faint">共 {String(sampleResult.diff.length)} 处</span>
              </div>
              {sampleResult.diff.length === 0 ? (
                <div className="text-2xs text-faint">样例中没有字段被这套规则改写（before 与 after 相同）。</div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="grid min-w-[36rem] grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-border pb-1 text-2xs text-faint">
                    <span>段落</span>
                    <span>字段</span>
                    <span>修改前</span>
                    <span>修改后</span>
                  </div>
                  {sampleResult.diff.map((item, index) => (
                    <div
                      key={index}
                      className="grid min-w-[36rem] grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-border/50 py-1 text-2xs"
                    >
                      <span className="text-body">{sectionTitle(item.segment)}</span>
                      <span className="truncate font-mono text-title" title={item.path}>
                        {item.path}
                      </span>
                      <span className="break-all font-mono text-faint">{formatSampleValue(item.before)}</span>
                      <span className="break-all font-mono text-success-text">{formatSampleValue(item.after)}</span>
                    </div>
                  ))}
                </div>
              )}
              <details className="text-2xs text-faint">
                <summary className="cursor-pointer">查看回放后的完整快照</summary>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-surface-2/60 p-2 font-mono text-2xs text-body">
                  {JSON.stringify(sampleResult.after, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

