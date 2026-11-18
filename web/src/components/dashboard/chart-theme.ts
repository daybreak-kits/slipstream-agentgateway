import { useEffect, useRef, useState, type RefObject } from "react";

/** 图表 16 槽色板：与 index.css 的 --chart-1..16 一一对应，浅/深主题各一套。 */
export const SERIES_SLOT_COUNT = 16;

/** 单槽颜色的 CSS 变量引用：SVG 与 echarts 的 DOM 侧都能直接吃 var()。 */
export function seriesVar(index: number): string {
  const slot = ((index % SERIES_SLOT_COUNT) + SERIES_SLOT_COUNT) % SERIES_SLOT_COUNT;
  return `var(--chart-${slot + 1})`;
}

export interface ChartPalette {
  /** 16 槽序列色（与成员排序位置对应，隐藏成员不重排）。 */
  series: string[];
  grid: string;
  axis: string;
  text: string;
  faint: string;
  surface: string;
  border: string;
  primary: string;
  tooltipBg: string;
  tooltipFg: string;
  tooltipBorder: string;
}

/** SSR / 样式未就绪时的兜底：一律引用 CSS 变量，不写死颜色值。 */
function variablePalette(): ChartPalette {
  return {
    series: Array.from({ length: SERIES_SLOT_COUNT }, (_unused, index) => seriesVar(index)),
    grid: "var(--border)",
    axis: "var(--border-strong)",
    text: "var(--text-body)",
    faint: "var(--text-faint)",
    surface: "var(--surface)",
    border: "var(--border)",
    primary: "var(--primary)",
    tooltipBg: "var(--tooltip-bg)",
    tooltipFg: "var(--tooltip-fg)",
    tooltipBorder: "var(--tooltip-border)",
  };
}

/**
 * echarts 需要具体色值（canvas 里不能解析 var()），所以主题切换时从
 * documentElement 读一次计算值；recharts 侧继续用 var() 更省事。
 */
function readPalette(): ChartPalette {
  const base = variablePalette();
  if (typeof document === "undefined" || !document.documentElement) return base;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    ...base,
    series: base.series.map((fallback, index) => read(`--chart-${index + 1}`, fallback)),
    grid: read("--border", base.grid),
    axis: read("--border-strong", base.axis),
    text: read("--text-body", base.text),
    faint: read("--text-faint", base.faint),
    surface: read("--surface", base.surface),
    border: read("--border", base.border),
    primary: read("--primary", base.primary),
    tooltipBg: read("--tooltip-bg", base.tooltipBg),
    tooltipFg: read("--tooltip-fg", base.tooltipFg),
    tooltipBorder: read("--tooltip-border", base.tooltipBorder),
  };
}

/**
 * 图表配色跟随 <html class="dark">。主题开关在 AppShell 里改 documentElement 的 class，
 * 各自的 useTheme() 状态拿不到，所以组件这里直接观察 DOM。
 */
export function useChartPalette(): ChartPalette {
  const [palette, setPalette] = useState<ChartPalette>(variablePalette);

  useEffect(() => {
    setPalette(readPalette());
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return palette;
}

/** echarts 必须显式 init 尺寸：量容器真实宽高，容器缩放（侧栏折叠/窗口变化）时重设。 */
export function useMeasuredSize<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  width: number;
  height: number;
} {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        return prev.width === width && prev.height === height ? prev : { width, height };
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
