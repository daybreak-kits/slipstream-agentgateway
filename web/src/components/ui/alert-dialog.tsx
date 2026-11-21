"use client"

import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { DialogOpenerProvider, useDialogOpener, useDialogOpenerRestore } from "@/lib/dialog-opener-focus"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const AlertDialog = ({ open, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>) => {
  // A 类受控行为：记录"打开那一刻"的焦点，关闭时由 AlertDialogContent 归还（见 lib/dialog-opener-focus）。
  const openerRef = useDialogOpener(open)
  return (
    <DialogOpenerProvider value={openerRef}>
      <AlertDialogPrimitive.Root open={open} {...props} />
    </DialogOpenerProvider>
  )
}
AlertDialog.displayName = "AlertDialog"

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-[var(--z-modal)] bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
    /** 打开后的落焦点：cancel=取消（危险确认的默认），action=确认，auto=沿用基元。 */
    initialFocus?: "cancel" | "action" | "auto"
  }
>(({ className, onCloseAutoFocus, onOpenAutoFocus, initialFocus = "cancel", ...props }, ref) => {
  // A 类受控行为：受控打开（没有 AlertDialogTrigger）时，关闭后由基元把焦点还给打开它的控件。
  const handleCloseAutoFocus = useDialogOpenerRestore(onCloseAutoFocus)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const setContentRef = React.useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }, [ref])

  // 危险确认默认落在「取消」：误按 Enter 不会直接执行删除。
  const handleOpenAutoFocus = React.useCallback((event: Event) => {
    onOpenAutoFocus?.(event)
    if (event.defaultPrevented) return
    if (initialFocus === "auto") return
    event.preventDefault()
    const root = contentRef.current
    if (!root) return
    const selector =
      initialFocus === "action"
        ? '[data-slot="alert-dialog-action"]'
        : '[data-slot="alert-dialog-cancel"]'
    const target = root.querySelector<HTMLElement>(selector)
    if (target) target.focus({ preventScroll: true })
    else root.focus({ preventScroll: true })
  }, [initialFocus, onOpenAutoFocus])

  return (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={setContentRef}
      aria-modal="true"
      onCloseAutoFocus={handleCloseAutoFocus}
      onOpenAutoFocus={handleOpenAutoFocus}
      className={cn(
        "fixed left-[50%] top-[50%] z-[var(--z-modal)] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-surface p-6 shadow-pop duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-card",
        className
      )}
      {...props}
    />
  </AlertDialogPortal>
  )
})
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-faint", className)}
    {...props}
  />
))
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    data-slot="alert-dialog-action"
    className={cn(buttonVariants(), className)}
    {...props}
  />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    data-slot="alert-dialog-cancel"
    className={cn(
      buttonVariants({ variant: "outline" }),
      "mt-2 sm:mt-0",
      className
    )}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
