// 排版设置：字体/字号覆盖 + 持久化 + 跨窗口广播
// （主题已固化为 AnuPpuccin 深色单主题，这里只剩排版覆盖）
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { setKeymapOverrides } from "../commands";

export interface Settings {
  version: number | null;
  editor: EditorSettings;
}

/** 排版覆盖（对齐 Obsidian appearance.json），null/undefined = 跟随主题 */
export interface EditorSettings {
  auto_save: boolean;
  auto_save_delay_ms: number;
  text_font?: string | null;
  mono_font?: string | null;
  interface_font?: string | null;
  base_font_size?: number | null;
  /** 标题字体（--h1-font） */
  title_font?: string | null;
  /** 行高倍数（默认 1.75） */
  line_height?: number | null;
  /** 段间距 em（默认 0.4） */
  paragraph_gap?: number | null;
  /** 标题字号缩放倍数（默认 1） */
  heading_scale?: number | null;
  /** 光标所在块底色（null/true = 显示） */
  show_active_block?: boolean | null;
  /** 当前块底色强度 alpha（默认 0.045） */
  active_block_alpha?: number | null;
  /** 底部留白 px（默认 280） */
  bottom_padding?: number | null;
  /** 正文颜色 #rrggbb（--text-normal） */
  text_color?: string | null;
  /** 强调色 #rrggbb（--interactive-accent） */
  accent_color?: string | null;
  /** 代码块软换行（null/false = 不换行，CM 默认横向滚动） */
  code_block_wrap?: boolean | null;
  /** 起始页署名显示（null/true = 显示） */
  show_author?: boolean | null;
  /** 窗口材质效果：null/"none" = 关；"mica" | "acrylic" */
  window_effect?: string | null;
  /** 键位覆盖（4.4）：命令 id → 组合串；null = 全部默认 */
  keymap?: Record<string, string> | null;
}

export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export async function saveSettings(s: Settings): Promise<void> {
  await invoke("save_settings", { settings: s });
}

/** 当前生效的编辑器设置缓存（applyTypography 时刷新）——
 *  供编辑器侧读行为项（自动保存开关/延迟等），不必每次 invoke */
let current: EditorSettings = { auto_save: true, auto_save_delay_ms: 1000 };

export function currentEditorSettings(): EditorSettings {
  return current;
}

/** 应用排版覆盖：body + #app 双内联（用户 > 主题 > 兜底），对齐 Ob 语义 */
export function applyTypography(e: EditorSettings) {
  current = e;
  const targets = [document.body, document.getElementById("app")].filter(
    (t): t is HTMLElement => t !== null
  );
  const set = (k: string, v: string | null | undefined) => {
    for (const t of targets) {
      if (v) t.style.setProperty(k, v);
      else t.style.removeProperty(k);
    }
  };
  set("--font-text", e.text_font);
  set("--font-monospace", e.mono_font);
  set("--font-interface", e.interface_font);
  set("--font-text-size", e.base_font_size ? `${e.base_font_size}px` : null);
  // 十轮扩充项：行高（无单位倍数）/段间距（em）/标题缩放（倍数）/底部留白（px）/当前块强度（alpha）
  set("--h1-font", e.title_font);
  set("--ob-line-height", e.line_height != null ? String(e.line_height) : null);
  set("--ob-para-gap", e.paragraph_gap != null ? `${e.paragraph_gap}em` : null);
  set("--ob-heading-scale", e.heading_scale != null ? String(e.heading_scale) : null);
  set("--ob-bottom-padding", e.bottom_padding != null ? `${e.bottom_padding}px` : null);
  set("--ob-active-alpha", e.active_block_alpha != null ? String(e.active_block_alpha) : null);
  // 颜色覆盖：主题变量定义在 body.theme-dark 类规则上，body 内联样式优先级更高
  set("--text-normal", e.text_color);
  set("--interactive-accent", e.accent_color);
  // 字号直接内联（Obsidian baseFontSize 同款做法）：不经过 --ob-font-size 变量链，
  // 避免主题在深层作用域重定义变量导致覆盖失效；em 尺寸（标题等）随之等比缩放
  for (const t of targets) {
    t.style.fontSize = e.base_font_size ? `${e.base_font_size}px` : "";
  }
  // 光标所在块底色（默认显示，显式 false 才隐藏）：替代 main.ts 的常驻加类
  document.body.classList.toggle("anp-current-line", e.show_active_block !== false);
  // 代码块软换行开关（body 类 + CSS；CM 行高缓存下一次渲染周期自愈）
  document.body.classList.toggle("ob-code-wrap", e.code_block_wrap === true);
  // 起始页署名显示开关（默认显示，显式 false 才隐藏）
  document.body.classList.toggle("ob-hide-author", e.show_author === false);
  // 窗口材质效果（4.1 毛玻璃）：默认关；开启时 body 类驱动 CSS 透明链路
  const effect =
    e.window_effect && e.window_effect !== "none" ? e.window_effect : null;
  document.body.classList.toggle("ob-vibrancy", effect !== null);
  void invoke("set_window_effect", { effect }).catch(() => {});
}

/** 保存排版设置并广播到所有窗口 */
export async function switchTypography(patch: Partial<EditorSettings>) {
  const s = await getSettings();
  Object.assign(s.editor, patch);
  await saveSettings(s);
  applyTypography(s.editor);
  await emit("oblet-typography-changed", {});
}

/** 保存键位覆盖（4.4）：combo 为 null = 恢复默认；空表归一为 null */
export async function setKeybinding(id: string, combo: string | null) {
  const s = await getSettings();
  const map = { ...(s.editor.keymap ?? {}) };
  if (combo) map[id] = combo;
  else delete map[id];
  s.editor.keymap = Object.keys(map).length ? map : null;
  await saveSettings(s);
  setKeymapOverrides(s.editor.keymap);
  await emit("oblet-typography-changed", {});
}

/** 启动时初始化：读 settings 应用排版；监听其他窗口的排版广播 */
export async function initTypography(): Promise<void> {
  await listen("oblet-typography-changed", async () => {
    const fresh = await getSettings();
    setKeymapOverrides(fresh.editor.keymap);
    applyTypography(fresh.editor);
  });

  const s = await getSettings();
  setKeymapOverrides(s.editor.keymap);
  applyTypography(s.editor);
}
