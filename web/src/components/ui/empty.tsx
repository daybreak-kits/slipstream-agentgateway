import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const emptyMediaVariants = cva("flex shrink-0 items-center justify-center", {
  variants: {
    variant: {
      default: "bg-transparent",
      icon: "size-12 rounded-full bg-primary-soft text-primary [&_svg:not([class*='size-'])]:size-5",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface EmptyProps extends Omit<ComponentProps<"div">, "title"> {
  icon?: LucideIcon;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** 兼容旧页面的 <Empty text="…" /> 调用，等价于 title */
  text?: string;
}

export function Empty({ icon: Icon, title, description, action, text, children, className, ...rest }: EmptyProps) {
  const heading = title ?? text;
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center text-balance",
        className,
      )}
      {...rest}
    >
      {Icon ? (
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
      ) : null}
      {heading != null || description != null ? (
        <EmptyHeader>
          {heading != null ? <EmptyTitle>{heading}</EmptyTitle> : null}
          {description != null ? <EmptyDescription>{description}</EmptyDescription> : null}
        </EmptyHeader>
      ) : null}
      {children}
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </div>
  );
}

export function EmptyHeader({ className, ...rest }: ComponentProps<"div">) {
  return <div data-slot="empty-header" className={cn("flex max-w-md flex-col items-center gap-1.5 text-center", className)} {...rest} />;
}

export function EmptyMedia({ className, variant, ...rest }: ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return <div data-slot="empty-icon" data-variant={variant} className={cn(emptyMediaVariants({ variant }), className)} {...rest} />;
}

export function EmptyTitle({ className, ...rest }: ComponentProps<"h3">) {
  return <h3 data-slot="empty-title" className={cn("text-base font-semibold tracking-tight text-title", className)} {...rest} />;
}

export function EmptyDescription({ className, ...rest }: ComponentProps<"p">) {
  return <p data-slot="empty-description" className={cn("max-w-md text-sm leading-relaxed text-muted-foreground", className)} {...rest} />;
}

export function EmptyContent({ className, ...rest }: ComponentProps<"div">) {
  return <div data-slot="empty-content" className={cn("flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm", className)} {...rest} />;
}
