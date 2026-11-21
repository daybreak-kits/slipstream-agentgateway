"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { DialogOpenerProvider, useDialogOpener, useDialogOpenerRestore } from "@/lib/dialog-opener-focus"
import { findFirstInput, isComposingEvent, isSelfActivatingTarget } from "@/lib/dialog-keyboard"
import { cn } from "@/lib/utils"

const Dialog = ({ open, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) => {
  // A 类受控行为：记录"打开那一刻"的焦点，关闭时由 DialogContent 归还（见 lib/dialog-opener-focus）。
  const openerRef = useDialogOpener(open)
  return (
    <DialogOpenerProvider value={openerRef}>
      <DialogPrimitive.Root open={open} {...props} />
    </DialogOpenerProvider>
  )
}
Dialog.displayName = "Dialog"

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[var(--z-modal)] bg-overlay  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Set false when the dialog renders its own close control. */
    showCloseButton?: boolean
    /** Enter 触发的主操作（表单型弹框）；输入法组合中不触发。 */
    onSubmit?: () => void
    /** 主操作当前不可用（提交中/校验未过）：Enter 不再发起。 */
    submitDisabled?: boolean
    /** 打开后的落焦点：first-input=第一个输入框（默认），auto=第一个可聚焦元素。 */
    initialFocus?: "first-input" | "auto"
  }
>(({ className, children, showCloseButton = true, onCloseAutoFocus, onOpenAutoFocus, onKeyDown, onSubmit, submitDisabled = false, initialFocus = "first-input", ...props }, ref) => {
  // A 类受控行为：受控打开（没有 DialogTrigger）时，关闭后由基元把焦点还给打开它的控件。
  const handleCloseAutoFocus = useDialogOpenerRestore(onCloseAutoFocus)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  // 输入法组合状态：组合中的 Enter 只用于选词，不能触发主操作。
  const composingRef = React.useRef(false)

  const setContentRef = React.useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }, [ref])

  // 表单型弹框默认落在第一个输入框；没有输入框时沿用基元（第一个可聚焦元素）。
  const handleOpenAutoFocus = React.useCallback((event: Event) => {
    onOpenAutoFocus?.(event)
    if (event.defaultPrevented) return
    if (initialFocus !== "first-input") return
    const target = findFirstInput(contentRef.current)
    if (!target) return
    event.preventDefault()
    target.focus({ preventScroll: true })
  }, [initialFocus, onOpenAutoFocus])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.key !== "Enter" || !onSubmit) return
    if (composingRef.current || isComposingEvent(event)) return
    const target = event.target as HTMLElement | null
    if (!target) return
    // 多行输入里 Enter 只换行；按钮/链接自己被 Enter 激活，都不重复触发主操作。
    if (target.closest("textarea")) return
    if (isSelfActivatingTarget(target)) return
    if (submitDisabled) return
    event.preventDefault()
    onSubmit()
  }, [onKeyDown, onSubmit, submitDisabled])

  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={setContentRef}
      aria-modal="true"
      onCloseAutoFocus={handleCloseAutoFocus}
      onOpenAutoFocus={handleOpenAutoFocus}
      onKeyDown={handleKeyDown}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
      className={cn(
        // 移动端左右各留 16px；高度受视口约束并由内容区滚动，避免短视口/横屏裁掉提交按钮。
        "fixed left-[50%] top-[50%] z-[var(--z-modal)] grid max-h-[min(calc(100dvh-2rem),48rem)] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain border bg-surface p-6 shadow-pop duration-200 sm:w-full data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-card",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-faint">
        <X className="h-4 w-4" />
        <span className="sr-only">关闭</span>
      </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-footer"
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-faint", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
