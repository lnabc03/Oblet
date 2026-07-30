// 主题加载/切换：注入 <style> + body 明暗类 + 跨窗口广播
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { sanitizeCss } from "./sanitize";

export interface ThemeInfo {
  name: string;
  author: string | null;
}

export interface Settings {
  version: number | null;
  theme: { active: string | null; mode: string | null; follow_system: boolean };
  editor: { auto_save: boolean; auto_save_delay_ms: number };
}

const STYLE_ID = "oblet-theme";
let current: { name: string | null; mode: string } = { name: null, mode: "light" };

export function getThemeState() {
  return current;
}

export async function applyTheme(name: string | null, mode: string) {
  current = { name, mode };

  // 明暗类：主题 CSS 内部的 .theme-dark/.theme-light 变量块随之生效
  document.body.classList.toggle("theme-dark", mode === "dark");
  document.body.classList.toggle("theme-light", mode !== "dark");

  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!name) {
    styleEl?.remove();
    return;
  }
  const css = sanitizeCss(await invoke<string>("read_theme", { name }));
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

export async function listThemes(): Promise<ThemeInfo[]> {
  return invoke<ThemeInfo[]>("list_themes");
}

export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export async function saveSettings(s: Settings): Promise<void> {
  await invoke("save_settings", { settings: s });
}

/** 切换主题并广播到所有窗口 */
export async function switchTheme(name: string | null, mode: string) {
  await applyTheme(name, mode);
  const s = await getSettings();
  s.theme.active = name;
  s.theme.mode = mode;
  await saveSettings(s);
  await emit("oblet-theme-changed", { name, mode });
}

/** 启动时初始化：读 settings 应用主题；监听其他窗口的换肤广播 */
export async function initTheme(): Promise<void> {
  const s = await getSettings();
  const mode = s.theme.mode ?? "light";
  if (s.theme.active) {
    try {
      await applyTheme(s.theme.active, mode);
      return;
    } catch (e) {
      console.warn("主题加载失败，回退默认:", e);
    }
  }
  await applyTheme(null, mode);

  await listen<{ name: string | null; mode: string }>(
    "oblet-theme-changed",
    (e) => void applyTheme(e.payload.name, e.payload.mode)
  );
}
