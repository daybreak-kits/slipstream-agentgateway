"use client"

import * as React from "react";
import { createPortal } from "react-dom";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

/**
 * 统一悬浮详情（HoverInfo）：鼠标 hover、键盘 Tab 聚焦、触屏轻点三路打开同一份内容。
 *
 * 为什么不用原生 title：原生 title 只有鼠标能用，键盘与触屏读不到；而且它不受控、
 * 不能做视口碰撞、还会在长页面上飘到屏幕外。这里统一成一个可访问、可定位的原语：
 *   - 触发元素：单个元素（Slot 合并 props，原有 class/事件不被覆盖）；
 *   - 浮层：portal 到 document.body，不被卡片/表格/侧栏裁切；
 *   - 定位：视口碰撞自动翻到另一侧，仍放不下时限高收拢并保证留在视口内；
 *   - 可访问：显式 label 变成触发元素的 aria-label，浮层是 role=tooltip，
 *     打开时用 aria-describedby 关联；Escape 关闭后焦点回到触发元素。
 *
 * 触发元素上写的是 data-hover-info（不是 data-slot）：触发元素是调用方自己的元素，
 * 原语不能覆盖调用方的 data-slot 标记；浮层是本原语自己的元素，用 data-slot 标记。
 */

/** hover 打开延时（毫秒）：扫过一行表格不至于误触发，又不用干等。 */
export const HOVER_INFO_DELAY_MS = 250;
/** 关闭延时（毫秒）：鼠标从触发元素移向浮层的缓冲，避免"路过即消失"。 */
const CLOSE_DELAY_MS = 120;
/** 浮层与视口边缘的最小间距。 */
const VIEWPORT_MARGIN = 8;
/** 浮层与触发元素的间距。 */
const TRIGGER_GAP = 8;
/** 视口再矮也要给浮层留的最小高度（低于这个值就滚动）。 */
const MIN_PANEL_HEIGHT = 120;

export type HoverInfoSide = "top" | "bottom" | "left" | "right";
export type HoverInfoAlign = "start" | "center" | "end";

export interface HoverInfoProps {
  /** 触发元素：单个元素（button / span / 图标…）。 */
  children: React.ReactNode;
  /** 浮层内容。空内容等于没有详情可展示 → 按不可用处理（不浮层、不加焦点落点）。 */
  content: React.ReactNode;
  /** 触发元素的可访问名称（图标类触发元素必填；纯文本触发元素可省略）。 */
  label?: string;
  /** 首选浮层方位；空间不足时自动翻到对侧。 */
  side?: HoverInfoSide;
  /** 与触发元素的对齐方式。 */
  align?: HoverInfoAlign;
  /** hover 打开延时，默认 250ms。 */
  delay?: number;
  /** 禁用：不再打开浮层，触发元素标记 aria-disabled。 */
  disabled?: boolean;
  /** 触发元素附加类名（与调用方自己的 className 合并）。 */
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** 键盘聚焦才打开浮层：鼠标点击聚焦不算"想读详情"的意图。 */
function isKeyboardFocus(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.matches !== "function") return false;
  try {
    return element.matches(":focus-visible");
  } catch {
    // 极老浏览器不支持 :focus-visible：退回"有焦点就打开"，宁可多开也不读不到。
    return true;
  }
}

/** SSR 没有布局，用 useEffect 代替 useLayoutEffect，避免渲染期告警。 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export function HoverInfo({
  children,
  content,
  label,
  side = "top",
  align = "center",
  delay = HOVER_INFO_DELAY_MS,
  disabled = false,
  className,
}: HoverInfoProps) {
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const openTimer = React.useRef<number | null>(null);
  const closeTimer = React.useRef<number | null>(null);
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const panelId = React.useId();

  React.useEffect(() => setMounted(true), []);

  const hasContent = content !== null && content !== undefined && content !== "" && content !== false;
  /** 禁用或没有详情可展示：稳定态——不浮层、不抢焦点落点。 */
  const inert = disabled || !hasContent;

  const clearTimers = React.useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openPanel = React.useCallback(() => {
    clearTimers();
    setOpen(true);
  }, [clearTimers]);

  const closePanel = React.useCallback(
    (restoreFocus: boolean) => {
      clearTimers();
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [clearTimers],
  );

  React.useEffect(() => () => clearTimers(), [clearTimers]);

  /* ---------------- 浮层定位：视口碰撞翻转 + 限高收拢 ---------------- */
  const place = React.useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = trigger.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const maxHeight = Math.max(MIN_PANEL_HEIGHT, viewportHeight - VIEWPORT_MARGIN * 2);
    const panelHeight = Math.min(panel.offsetHeight, maxHeight);

    const space = {
      top: rect.top - VIEWPORT_MARGIN,
      bottom: viewportHeight - rect.bottom - VIEWPORT_MARGIN,
      left: rect.left - VIEWPORT_MARGIN,
      right: viewportWidth - rect.right - VIEWPORT_MARGIN,
    };
    const vertical = side === "top" || side === "bottom";
    const needed = (vertical ? panelHeight : panelWidth) + TRIGGER_GAP;
    const opposite: Record<HoverInfoSide, HoverInfoSide> = {
      top: "bottom",
      bottom: "top",
      left: "right",
      right: "left",
    };
    let resolved = side;
    if (space[resolved] < needed) {
      const alternative = opposite[resolved];
      // 对侧放得下就翻过去；两侧都不够时选空间更大的一侧，交给限高收拢。
      resolved = space[alternative] >= needed ? alternative : space[alternative] > space[resolved] ? alternative : resolved;
    }

    let top = 0;
    let left = 0;
    if (vertical) {
      top = resolved === "top" ? rect.top - TRIGGER_GAP - panelHeight : rect.bottom + TRIGGER_GAP;
      left =
        align === "start"
          ? rect.left
          : align === "end"
            ? rect.right - panelWidth
            : rect.left + (rect.width - panelWidth) / 2;
    } else {
      left = resolved === "left" ? rect.left - TRIGGER_GAP - panelWidth : rect.right + TRIGGER_GAP;
      top =
        align === "start"
          ? rect.top
          : align === "end"
            ? rect.bottom - panelHeight
            : rect.top + (rect.height - panelHeight) / 2;
    }
    left = clamp(left, VIEWPORT_MARGIN, viewportWidth - panelWidth - VIEWPORT_MARGIN);
    top = clamp(top, VIEWPORT_MARGIN, viewportHeight - panelHeight - VIEWPORT_MARGIN);

    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.maxHeight = `${Math.round(maxHeight)}px`;
    panel.style.visibility = "visible";
    panel.dataset.side = resolved;
  }, [align, side]);

  // 布局期定位：首帧就摆到正确位置（不会出现从左上角飞过来的那一帧）。
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    place();
  });

  React.useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, place]);

  // 点到别处就收起（触屏轻点打开后，点别处即关）。
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closePanel(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, closePanel]);

  /* ---------------- 触发元素交互 ---------------- */
  const handlePointerEnter = (event: React.PointerEvent<HTMLElement>) => {
    if (inert || event.pointerType === "touch") return;
    clearTimers();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, delay);
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLElement>) => {
    if (inert || event.pointerType === "touch") return;
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (inert || event.pointerType === "mouse") return;
    // 触屏/笔没有 hover：轻点开合。
    clearTimers();
    setOpen((previous) => !previous);
  };

  const handleFocus = (event: React.FocusEvent<HTMLElement>) => {
    if (inert) return;
    if (!isKeyboardFocus(event.target)) return;
    openPanel();
  };

  const handleBlur = () => {
    if (!open) return;
    closePanel(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !open) return;
    closePanel(true);
  };

  const child = React.isValidElement(children) ? children : <span>{children}</span>;
  const childTabIndex = React.isValidElement(children)
    ? (children.props as { tabIndex?: number | string }).tabIndex
    : undefined;

  const trigger = (
    <Slot
      ref={triggerRef}
      className={cn(
        "cursor-help focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className,
      )}
      tabIndex={inert || childTabIndex !== undefined ? undefined : 0}
      aria-label={label}
      aria-describedby={open ? panelId : undefined}
      aria-disabled={disabled ? true : undefined}
      data-hover-info="trigger"
      data-state={open ? "open" : "closed"}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {child}
    </Slot>
  );

  if (!mounted || !hasContent) return trigger;

  const panel = (
    <div
      ref={panelRef}
      id={panelId}
      role="tooltip"
      data-slot="hover-info-panel"
      data-state="open"
      style={{ position: "fixed", top: 0, left: 0, visibility: "hidden" }}
      className="fixed z-[var(--z-popover)] max-w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-card border bg-popover px-3 py-2 text-2xs leading-snug text-popover-foreground shadow-pop animate-in fade-in-0 zoom-in-95"
      onPointerEnter={() => {
        if (closeTimer.current !== null) {
          window.clearTimeout(closeTimer.current);
          closeTimer.current = null;
        }
      }}
      onPointerLeave={handlePointerLeave}
    >
      {content}
    </div>
  );

  return (
    <>
      {trigger}
      {open ? createPortal(panel, document.body) : null}
    </>
  );
}
