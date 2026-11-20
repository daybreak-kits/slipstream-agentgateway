import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  maxOutputTokensFor,
  paramHintText,
  summarizeChatParams,
  THINKING_MODE_LABELS,
  validateChatParams,
  type ParamHintKey,
  type ThinkingMode,
} from "@/lib/playground";
import { fmtInt } from "@/lib/format";
import type { PlaygroundParamsState } from "@/lib/playground-params";
import { cn } from "@/lib/utils";
import type { MyModelOut } from "@/types";

const THINKING_OPTIONS: ThinkingMode[] = [
  "off",
  "none",
  "low",
  "medium",
  "high",
  "max",
  "thinking",
  "enable_thinking",
];

export interface ParamsPanelProps {
  value: PlaygroundParamsState;
  onChange: (next: PlaygroundParamsState) => void;
  disabled: boolean;
  mockMode: boolean;
  onOpenModels: () => void;
  /** W4-H：当前选中公开模型的参数合集（GET /admin/my/models，登录即可）；无数据时整块隐藏。 */
  modelInfo?: MyModelOut | null;
}

function ParamLabel({
  htmlFor,
  hintKey,
  range,
  children,
}: {
  htmlFor: string;
  hintKey: ParamHintKey;
  range?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Label
          htmlFor={htmlFor}
          className="w-full cursor-help truncate border-b border-dotted border-border-strong pb-0.5 text-2xs font-normal leading-tight text-body"
        >
          {children}
        </Label>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-64">
        {paramHintText(hintKey, range)}
      </TooltipContent>
    </Tooltip>
  );
}

function ParamField({
  id,
  label,
  hintKey,
  range,
  className,
  children,
}: {
  id: string;
  label: string;
  hintKey: ParamHintKey;
  range?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <ParamLabel htmlFor={id} hintKey={hintKey} range={range}>
        {label}
      </ParamLabel>
      {children}
    </div>
  );
}

function ParamGroup({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1 text-left text-2xs font-medium text-faint transition-colors hover:text-body">
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !open && "-rotate-90")}
        />
        <span>{title}</span>
        <span className="ml-auto font-normal tnum">{count} 项</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-1 pl-5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

const inputClass = "h-7 px-1.5 text-2xs tnum";

const CAPABILITY_LABELS: Array<[keyof MyModelOut["parameters"], string]> = [
  ["tool_call", "工具调用"],
  ["reasoning", "推理"],
  ["attachment", "附件"],
  ["structured_output", "结构化输出"],
];

/** W4-H：当前模型的登记参数（控制面只读元数据，不参与请求改写）。 */
function ModelInfoBlock({ modelInfo }: { modelInfo: MyModelOut }) {
  const p = modelInfo.parameters;
  const capabilities = CAPABILITY_LABELS.filter(([key]) => p[key] === true).map(([, label]) => label);
  return (
    <ParamGroup title="模型参数" count={4}>
      <div className="space-y-1.5 text-2xs leading-relaxed">
        <div className="tnum">
          上下文窗口 {p.max_input_tokens > 0 ? fmtInt(p.max_input_tokens) : "未声明"}
          <span className="mx-1.5 text-faint">·</span>
          最大输出 {p.max_output_tokens > 0 ? fmtInt(p.max_output_tokens) : "未声明"}
        </div>
        <div>
          输入 {p.input_types.join(" / ")}
          <span className="mx-1.5 text-faint">→</span>
          输出 {p.output_types.join(" / ")}
          {p.reasoning_level ? (
            <>
              <span className="mx-1.5 text-faint">·</span>
              推理档位 {p.reasoning_level}
            </>
          ) : null}
        </div>
        {capabilities.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {capabilities.map((label) => (
              <Badge key={label} tone="info" className="text-2xs">
                {label}
              </Badge>
            ))}
          </div>
        ) : null}
        {modelInfo.sources.length > 1 ? (
          <p className="text-faint">成员参数合集：{modelInfo.sources.join("、")}</p>
        ) : null}
        <p className="text-faint">
          来自控制面「{modelInfo.model_type}」模型登记（models.dev / 手动维护），不改动请求。
        </p>
      </div>
    </ParamGroup>
  );
}

export function ParamsPanel({
  value,
  onChange,
  disabled,
  mockMode,
  onOpenModels,
  modelInfo,
}: ParamsPanelProps) {
  const patch = (next: Partial<PlaygroundParamsState>) => onChange({ ...value, ...next });
  const limit = maxOutputTokensFor(null);
  const validation = validateChatParams(value, { maxOutputTokens: limit });
  const unsupportedThinking = !["off", "low", "medium", "high"].includes(value.thinkingMode);

  return (
    <TooltipProvider delayDuration={0}>
      <Card className="flex h-full min-h-0 flex-col">
        <CardHeader className="flex-row items-center gap-2 pb-2">
          <CardTitle className="text-sm">参数</CardTitle>
          {mockMode ? <Badge tone="warning">Mock 演示</Badge> : null}
          <Badge tone={value.streaming ? "primary" : "neutral"} className="ml-auto">
            {value.streaming ? "流式" : "整段"}
          </Badge>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-0">
          {modelInfo ? <ModelInfoBlock modelInfo={modelInfo} /> : null}
          <ParamGroup title="系统" count={4}>
            <ParamField id="playground-system" label="system prompt" hintKey="systemPrompt">
              <Textarea
                id="playground-system"
                rows={3}
                placeholder="可选：给模型的系统指令"
                value={value.systemPrompt}
                disabled={disabled}
                onChange={(event) => patch({ systemPrompt: event.target.value })}
                className="min-h-[60px] resize-y text-2xs"
              />
            </ParamField>

            <div className="grid grid-cols-3 gap-2">
              <ParamField
                id="playground-api-key"
                label="API 密钥"
                hintKey="apiKey"
                className="col-span-2"
              >
                <Input
                  id="playground-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder="留空用登录态"
                  value={value.apiKey}
                  disabled={disabled}
                  onChange={(event) => patch({ apiKey: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
              <ParamField id="playground-streaming" label="流式" hintKey="streamMode">
                <div className="flex h-7 items-center justify-between gap-2">
                  <span className="text-2xs text-faint">{value.streaming ? "开" : "关"}</span>
                  <Switch
                    id="playground-streaming"
                    checked={value.streaming}
                    onCheckedChange={(checked) => patch({ streaming: checked })}
                    disabled={disabled}
                  />
                </div>
              </ParamField>
            </div>

            <div className="flex items-center gap-2 py-0.5">
              <div className="min-w-0 flex-1">
                <ParamLabel htmlFor="playground-reasoning-level" hintKey="reasoningLevel">
                  思考等级（只读）
                </ParamLabel>
                <p id="playground-reasoning-level" className="truncate text-2xs text-faint">
                  {THINKING_MODE_LABELS[value.thinkingMode]}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-2xs"
                onClick={onOpenModels}
                disabled={disabled}
              >
                调整
              </Button>
            </div>
          </ParamGroup>

          <ParamGroup title="采样" count={6}>
            <div className="grid grid-cols-3 gap-2">
              <ParamField id="playground-temperature" label="temperature" hintKey="temperature">
                <Input
                  id="playground-temperature"
                  inputMode="decimal"
                  placeholder="默认"
                  value={value.temperature}
                  disabled={disabled}
                  onChange={(event) => patch({ temperature: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
              <ParamField id="playground-topp" label="top_p" hintKey="topP">
                <Input
                  id="playground-topp"
                  inputMode="decimal"
                  placeholder="默认"
                  value={value.topP}
                  disabled={disabled}
                  onChange={(event) => patch({ topP: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
              <ParamField id="playground-topk" label="top_k" hintKey="topK">
                <Input
                  id="playground-topk"
                  inputMode="numeric"
                  placeholder="默认"
                  value={value.topK}
                  disabled={disabled}
                  onChange={(event) => patch({ topK: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
              <ParamField id="playground-seed" label="seed" hintKey="seed">
                <Input
                  id="playground-seed"
                  inputMode="numeric"
                  placeholder="默认"
                  value={value.seed}
                  disabled={disabled}
                  onChange={(event) => patch({ seed: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
              <ParamField
                id="playground-frequency-penalty"
                label="frequency_penalty"
                hintKey="frequencyPenalty"
              >
                <Input
                  id="playground-frequency-penalty"
                  inputMode="decimal"
                  placeholder="默认"
                  value={value.frequencyPenalty}
                  disabled={disabled}
                  onChange={(event) => patch({ frequencyPenalty: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
              <ParamField
                id="playground-presence-penalty"
                label="presence_penalty"
                hintKey="presencePenalty"
              >
                <Input
                  id="playground-presence-penalty"
                  inputMode="decimal"
                  placeholder="默认"
                  value={value.presencePenalty}
                  disabled={disabled}
                  onChange={(event) => patch({ presencePenalty: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
            </div>
          </ParamGroup>

          <ParamGroup title="输出" count={5}>
            <div className="grid grid-cols-3 gap-2">
              <ParamField
                id="playground-max-tokens"
                label="max_tokens"
                hintKey="maxTokens"
                range={"1–" + limit}
              >
                <Input
                  id="playground-max-tokens"
                  inputMode="numeric"
                  placeholder="默认"
                  value={value.maxTokens}
                  disabled={disabled}
                  onChange={(event) => patch({ maxTokens: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
              <ParamField
                id="playground-max-completion-tokens"
                label="max_completion_tokens"
                hintKey="maxCompletionTokens"
                range={"1–" + limit}
              >
                <Input
                  id="playground-max-completion-tokens"
                  inputMode="numeric"
                  placeholder="默认"
                  value={value.maxCompletionTokens}
                  disabled={disabled}
                  onChange={(event) => patch({ maxCompletionTokens: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
              <ParamField id="playground-n" label="n" hintKey="n">
                <Input
                  id="playground-n"
                  inputMode="numeric"
                  placeholder="默认"
                  value={value.n}
                  disabled={disabled}
                  onChange={(event) => patch({ n: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <ParamField
                id="playground-response-format"
                label="response_format"
                hintKey="responseFormat"
              >
                <Select
                  value={value.responseFormat}
                  onValueChange={(next) =>
                    patch({ responseFormat: next === "json_object" ? "json_object" : "text" })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger id="playground-response-format" className="h-7 px-1.5 text-2xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">text</SelectItem>
                    <SelectItem value="json_object">json_object</SelectItem>
                  </SelectContent>
                </Select>
              </ParamField>
              <ParamField
                id="playground-stop"
                label="stop"
                hintKey="stop"
                className="col-span-2"
              >
                <Textarea
                  id="playground-stop"
                  rows={2}
                  placeholder={"每行一条，最多 4 条"}
                  value={value.stop}
                  disabled={disabled}
                  onChange={(event) => patch({ stop: event.target.value })}
                  className="min-h-[28px] resize-y px-1.5 py-1 text-2xs"
                />
              </ParamField>
            </div>
          </ParamGroup>

          <ParamGroup title="高级" count={5} defaultOpen={false}>
            <div className="grid grid-cols-3 gap-2">
              <ParamField id="playground-logprobs" label="logprobs" hintKey="logprobs">
                <div className="flex h-7 items-center gap-2">
                  <Checkbox
                    id="playground-logprobs"
                    checked={value.logprobs}
                    onCheckedChange={(checked) =>
                      patch({
                        logprobs: checked === true,
                        ...(checked === true ? {} : { topLogprobs: "" }),
                      })
                    }
                    disabled={disabled}
                  />
                  <span className="text-2xs text-faint">{value.logprobs ? "开" : "关"}</span>
                </div>
              </ParamField>
              <ParamField id="playground-top-logprobs" label="top_logprobs" hintKey="topLogprobs">
                <Input
                  id="playground-top-logprobs"
                  inputMode="numeric"
                  placeholder="0–20"
                  value={value.topLogprobs}
                  disabled={disabled || !value.logprobs}
                  onChange={(event) => patch({ topLogprobs: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
              <ParamField id="playground-user" label="user" hintKey="user">
                <Input
                  id="playground-user"
                  placeholder="≤256 字符"
                  value={value.user}
                  disabled={disabled}
                  onChange={(event) => patch({ user: event.target.value })}
                  className={inputClass}
                />
              </ParamField>
            </div>

            <ParamField id="playground-thinking" label="思考档位" hintKey="thinkingMode">
              <Select
                value={value.thinkingMode}
                onValueChange={(next) => patch({ thinkingMode: next as ThinkingMode })}
                disabled={disabled}
              >
                <SelectTrigger id="playground-thinking" className="h-7 px-1.5 text-2xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_OPTIONS.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {THINKING_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ParamField>
            {unsupportedThinking ? (
              <p className="rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-2xs text-warning-text">
                当前控制面只透传 low / medium / high，这一档会保留在表单里但不会发送。
              </p>
            ) : null}

            <ParamField id="playground-extra" label="额外请求字段（JSON）" hintKey="extraFields">
              <Textarea
                id="playground-extra"
                rows={3}
                placeholder={'{"vendor_field": "value"}'}
                value={value.extraFields}
                disabled={disabled}
                onChange={(event) => patch({ extraFields: event.target.value })}
                className="min-h-[52px] resize-y px-1.5 py-1 font-mono text-2xs"
              />
            </ParamField>
          </ParamGroup>

          <div className="space-y-1.5">
            <p className="text-2xs text-faint">请求摘要</p>
            <p className="break-words text-2xs leading-relaxed text-body">
              {summarizeChatParams(value)}
            </p>
            {validation.valid ? (
              <p className="text-2xs text-success-text">参数校验通过</p>
            ) : (
              <p className="rounded-md border border-danger/40 bg-danger-soft px-2 py-1 text-2xs text-danger-text">
                {validation.message ?? "参数不合法。"}
              </p>
            )}
            <p className="rounded-md bg-surface-2 px-2 py-1.5 text-2xs leading-relaxed text-faint">
              控制面当前透传 temperature · top_p · max_tokens ·
              reasoning_effort(low/medium/high)；其余字段按 OpenAI 形状发送，待数据面支持后生效。
            </p>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
