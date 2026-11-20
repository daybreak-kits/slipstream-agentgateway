import { forwardRef } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { ACTION_ICONS, ACTION_TONES, type ActionIconKey } from "@/lib/icons";
import { toneText } from "@/lib/semantic-tone";
import { cn } from "@/lib/utils";

export interface ActionButtonProps extends Omit<ButtonProps, "variant" | "size"> {
  /** 动作动词：图标与语义色都由 lib/icons 的单一来源决定。 */
  action: ActionIconKey;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  iconClassName?: string;
}

/**
 * 行内语义动作按钮（spec §7）：启用=绿、关闭/冷却=琥珀、解除=绿、测试=蓝、删除=红、编辑=中性。
 * 始终「图标 + 文字」双编码，不只靠颜色；图标与色 tone 来自 lib/icons 单一来源，页面不再自拼。
 */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { action, variant = "ghost", size = "sm", className, iconClassName = "h-3.5 w-3.5", children, ...rest },
  ref,
) {
  const Icon = ACTION_ICONS[action];
  return (
    <Button ref={ref} variant={variant} size={size} className={cn(toneText(ACTION_TONES[action]), className)} {...rest}>
      <Icon aria-hidden="true" className={iconClassName} />
      {children}
    </Button>
  );
});
