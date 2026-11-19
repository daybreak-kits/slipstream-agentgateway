import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TabItem {
  key: string;
  label: string;
  content: ReactNode;
}

/** 页签触发器：下划线高亮；键盘 ←/→、Home/End 与 roving tabindex 由 Radix Tabs 提供。 */
const TRIGGER_CLASS =
  "-mb-px h-9 border-b-2 border-transparent px-3 text-2sm text-body transition-colors hover:text-title data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-primary";

/** 内部状态版页签：页签头 + 内容区，选中项由组件自己托管。 */
export function Tabs({ items, initialKey }: { items: TabItem[]; initialKey?: string }) {
  const [active, setActive] = useState(initialKey ?? items[0]?.key ?? "");
  return (
    <TabsPrimitive.Root value={active} onValueChange={setActive} className="space-y-3">
      <TabsPrimitive.List className="flex gap-1 border-b border-border">
        {items.map((item) => (
          <TabsPrimitive.Trigger key={item.key} value={item.key} className={TRIGGER_CLASS}>
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content key={item.key} value={item.key}>
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

/**
 * 受控页签头（不含内容区）：看板三种图型要在卡片头部切换并把 ?tab= 写进 URL，
 * 内部状态版的 <Tabs> 做不到，所以单独给一个可受控的 tablist。
 */
export function TabBar({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: {
  /** dot=true 时在 label 旁渲染 2px 琥珀圆点（未保存状态提示，title 说明）。 */
  items: Array<{ key: string; label: string; dot?: boolean }>;
  value: string;
  onValueChange: (key: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className="contents">
      <TabsPrimitive.List aria-label={ariaLabel} className={cn("flex gap-1 border-b border-border", className)}>
        {items.map((item) => (
          <TabsPrimitive.Trigger key={item.key} value={item.key} className={TRIGGER_CLASS}>
            {item.label}
            {item.dot ? (
              <span
                aria-hidden
                title="该页签有未保存修改"
                className="ml-1 inline-block h-0.5 w-0.5 rounded-full bg-warning"
              />
            ) : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
