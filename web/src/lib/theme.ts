import { useCallback, useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "slipstream.theme";
const STORAGE_KEY = THEME_STORAGE_KEY;
/** 同一页面里多个组件各自 useTheme 时，切主题要互相通知（顶栏 / 用户设置）。 */
const THEME_EVENT = "slipstream:theme";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStored(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** system 跟随操作系统；light / dark 是用户的显式选择，不再跟随系统。 */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

/** 把主题落到 <html class="dark"> 上；无 DOM 环境（测试）直接跳过。 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

export function useTheme(): { theme: Theme; resolved: ResolvedTheme; setTheme: (next: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStored()));

  useEffect(() => {
    const next = resolveTheme(theme);
    setResolved(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(STORAGE_KEY, theme);

    // 只有「跟随系统」才需要监听；切回 light / dark 时立刻移除监听，不留悬挂回调。
    if (theme !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      const value: ResolvedTheme = event.matches ? "dark" : "light";
      setResolved(value);
      document.documentElement.classList.toggle("dark", value === "dark");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  // 其它组件改了主题（顶栏 / 用户设置页）→ 本实例跟随，避免图标与实际主题不一致。
  useEffect(() => {
    const listener = (event: Event) => {
      const next = (event as CustomEvent<Theme>).detail;
      if (next === "light" || next === "dark" || next === "system") setThemeState(next);
    };
    window.addEventListener(THEME_EVENT, listener);
    return () => window.removeEventListener(THEME_EVENT, listener);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
  }, []);
  return { theme, resolved, setTheme };
}