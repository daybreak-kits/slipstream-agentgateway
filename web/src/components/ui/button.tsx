import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // 旧系统的默认按钮就是主色；default 作为 primary 的别名保留
        default: "bg-primary text-primary-on shadow-xs hover:bg-primary-hover active:bg-primary-active",
        primary: "bg-primary text-primary-on shadow-xs hover:bg-primary-hover active:bg-primary-active",
        secondary: "bg-surface-2 text-title hover:bg-[var(--border)] active:bg-[var(--border-strong)]",
        outline: "border border-border-strong bg-surface text-title hover:bg-surface-2 active:bg-[var(--surface-2)]",
        ghost: "text-body hover:bg-surface-2 hover:text-title active:bg-[var(--border)]",
        danger: "bg-danger text-white shadow-xs hover:brightness-95",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // 控件高度阶梯：28 dense / 32 sm / 36 md / 40 default / 44 lg
      size: {
        dense: "h-7 rounded-control px-2 text-[13px]",
        sm: "h-8 rounded-control px-3 text-sm",
        md: "h-9 rounded-control px-3.5 text-sm",
        default: "h-10 px-4",
        lg: "h-11 px-6",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** 渲染为子元素（Radix Slot），用于 DropdownMenuTrigger 等组合 */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { className, variant, size, type = "button", asChild = false, ...rest } = props;
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size }), className)} {...rest} />;
});
