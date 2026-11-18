import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card"
      className={cn("rounded-card border border-border bg-surface text-body shadow-card", className)}
      {...rest}
    />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 p-6 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...rest}
    />
  );
});

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function CardTitle(
  { className, ...rest },
  ref,
) {
  return <h3 ref={ref} data-slot="card-title" className={cn("text-base font-semibold leading-none text-title", className)} {...rest} />;
});

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...rest }, ref) {
    return <p ref={ref} data-slot="card-description" className={cn("text-[13px] text-muted-foreground", className)} {...rest} />;
  },
);

export const CardAction = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardAction(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...rest} />;
});

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardContent(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} data-slot="card-content" className={cn("p-6 pt-0", className)} {...rest} />;
});

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardFooter(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} data-slot="card-footer" className={cn("flex items-center p-6 pt-0", className)} {...rest} />;
});
