import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  loadRecentPlaygroundModels,
  rememberPlaygroundModel,
  THINKING_MODE_LABELS,
  type PlaygroundModel,
  type ThinkingMode,
} from "@/lib/playground";
import { cn } from "@/lib/utils";

const ROUTING_LABELS: Record<PlaygroundModel["routingMode"], string> = {
  failover: "故障转移",
  weighted: "加权",
  conditional: "条件",
};

const ROUTING_ORDER: Array<PlaygroundModel["routingMode"]> = [
  "failover",
  "weighted",
  "conditional",
];

/** 对话框底部只放控制面真正支持的档位，避免选了不生效的旧档。 */
const THINKING_LEVELS: Array<{ value: ThinkingMode; label: string }> = [
  { value: "off", label: "不指定" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
];

export interface ModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: PlaygroundModel[] | undefined;
  pending: boolean;
  failed: boolean;
  onRetry: () => void;
  value: string;
  onSelect: (name: string) => void;
  thinkingMode: ThinkingMode;
  onThinkingModeChange: (mode: ThinkingMode) => void;
}

export function ModelDialog({
  open,
  onOpenChange,
  models,
  pending,
  failed,
  onRetry,
  value,
  onSelect,
  thinkingMode,
  onThinkingModeChange,
}: ModelDialogProps) {
  const [recent, setRecent] = useState<string[]>([]);
  const list = useMemo(() => models ?? [], [models]);

  useEffect(() => {
    if (open) setRecent(loadRecentPlaygroundModels());
  }, [open]);

  const selected = list.find((model) => model.name === value);
  const thinkingLabel =
    THINKING_LEVELS.find((level) => level.value === thinkingMode)?.label ??
    THINKING_MODE_LABELS[thinkingMode];

  const recentModels = useMemo(
    () =>
      recent
        .map((name) => list.find((model) => model.name === name))
        .filter((model): model is PlaygroundModel => model !== undefined),
    [list, recent],
  );

  const groups = useMemo(() => {
    const used = new Set(recentModels.map((model) => model.name));
    const result: Array<{ mode: PlaygroundModel["routingMode"]; models: PlaygroundModel[] }> = [];
    for (const mode of ROUTING_ORDER) {
      const rows = list.filter((model) => model.routingMode === mode && !used.has(model.name));
      if (rows.length) result.push({ mode, models: rows });
    }
    return result;
  }, [list, recentModels]);

  const choose = (name: string) => {
    setRecent(rememberPlaygroundModel(name));
    onSelect(name);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(30rem,calc(100vw-2rem))] gap-0 p-0">
        <DialogHeader className="border-b border-border px-4 py-3 pr-10 text-left">
          <DialogTitle className="text-sm">选择公开模型</DialogTitle>
          <DialogDescription className="text-2xs leading-relaxed">
            按路由模式分组，最近使用置顶；支持搜索模型名。
          </DialogDescription>
        </DialogHeader>

        <Command className="bg-transparent">
          <CommandInput
            placeholder="搜索模型名或路由模式…"
            autoFocus
            disabled={pending || failed}
          />
          <CommandList className="max-h-[min(50vh,360px)]">
            {pending ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-faint">
                <Spinner size="sm" />
                加载模型清单…
              </div>
            ) : failed ? (
              <div className="space-y-2 py-8 text-center text-xs text-faint">
                <p>模型清单加载失败。</p>
                <Button variant="outline" size="sm" onClick={onRetry}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试
                </Button>
              </div>
            ) : (
              <>
                <CommandEmpty className="py-8 text-center text-xs text-faint">
                  {list.length === 0 ? (
                    <span className="flex flex-col items-center gap-2">
                      <span>还没有启用的公开模型。</span>
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/models?tab=public" onClick={() => onOpenChange(false)}>
                          去创建公开模型
                        </Link>
                      </Button>
                    </span>
                  ) : (
                    "没有匹配的模型，换个关键词试试。"
                  )}
                </CommandEmpty>

                {recentModels.length > 0 ? (
                  <CommandGroup heading="最近使用">
                    {recentModels.map((model) => (
                      <ModelRow
                        key={"recent-" + model.name}
                        model={model}
                        active={model.name === value}
                        onSelect={() => choose(model.name)}
                      />
                    ))}
                  </CommandGroup>
                ) : null}

                {recentModels.length > 0 && groups.length > 0 ? <CommandSeparator /> : null}

                {groups.map((group) => (
                  <CommandGroup
                    key={group.mode}
                    heading={ROUTING_LABELS[group.mode] + " · " + group.models.length}
                  >
                    {group.models.map((model) => (
                      <ModelRow
                        key={model.name}
                        model={model}
                        active={model.name === value}
                        onSelect={() => choose(model.name)}
                      />
                    ))}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
        </Command>

        <div className="space-y-2 border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-2xs text-faint">思考等级</span>
            {THINKING_LEVELS.map((level) => (
              <Button
                key={level.value}
                size="sm"
                variant={thinkingMode === level.value ? "primary" : "outline"}
                className="h-7 px-2 text-2xs"
                onClick={() => onThinkingModeChange(level.value)}
              >
                {level.label}
              </Button>
            ))}
            <Badge tone="neutral" className="ml-auto tnum">
              {selected ? selected.targetCount + " 个目标" : "未选择"}
            </Badge>
          </div>
          <p className="text-2xs leading-relaxed text-faint">
            当前 {value || "未选择模型"} · 思考 {thinkingLabel}。控制面只透传
            low / medium / high；其余档位在右侧「高级」分组里，选中后会保留但不会发送。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelRow({
  model,
  active,
  onSelect,
}: {
  model: PlaygroundModel;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={model.name}
      keywords={[ROUTING_LABELS[model.routingMode], "模型"]}
      onSelect={onSelect}
      className={cn("gap-2", active && "bg-primary-soft text-primary")}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate">{model.name}</span>
        {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
      </span>
      <span className="text-2xs text-faint tnum">{model.targetCount} 目标</span>
    </CommandItem>
  );
}
