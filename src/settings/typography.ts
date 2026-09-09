// 排版设置：字体/字号覆盖 + 主题模式（多主题一期）+ 持久化 + 跨窗口广播
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { setKeymapOverrides } from "../commands";
import {
  swapThemeClasses,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme-classes";

export interface Settings {
  version: number | null;
  editor: EditorSettings;
}

/** 排版覆盖（对齐 Obsidian appearance.json），null/undefined = 跟随主题 */
export interface EditorSettings {
  /** 自动保存：null/true = 开启，false = 关闭（与 Rust Option<bool> 对齐，None = 默认开） */
  auto_save?: boolean | null;
  text_font?: string | null;
  mono_font?: string | null;
  interface_font?: string | null;
  base_font_size?: number | null;
  /** 当前行底色（null/true = 显示） */
  show_active_block?: boolean | null;
  /** 代码自动换行（null/false = 不换行，CM 默认横向滚动） */
  code_block_wrap?: boolean | null;
  /** 起始页署名显示（null/true = 显示） */
  show_author?: boolean | null;
  /** 窗口材质效果：⚠️ 2026-09 暂停使用（上游 #183 在 25H2 失效），字段保留待复活，前端不应用 */
  window_effect?: string | null;
  /** 键位覆盖（4.4）：命令 id → 组合串；null = 全部默认 */
  keymap?: Record<string, string> | null;
  /** 另存目标文件夹（批次 7.1）：填到目标目录；null = 未配置 */
  vault_dir?: string | null;
  /** 起始页"新建 Markdown 笔记"落盘目录：null/空 = 桌面（启动时 get_desktop_dir 兜底） */
  new_note_dir?: string | null;
  /** 多窗口编辑（批次 7.3）：null/false = 单窗口多 tab 模式（默认）；true = 每文件一窗口 */
  allow_multi_window?: boolean | null;
  /** 过渡动画（原启动遮罩）：null/false = 关（默认）；true = 开。仅启动时由 main.ts 读取 */
  transition_animation?: boolean | null;
  /** 悬浮 TOC：null/true = 显示（默认）；false = 隐藏（body.ob-toc-hidden 门控） */
  toc?: boolean | null;
  /** 主题模式（多主题一期）：null/"dark" = 深色（默认）；"light" = 浅色；"system" = 跟随系统 */
  theme_mode?: ThemeMode | null;
  /** 主题身份（多主题二期）：null/"anuppuccin" = AnuPpuccin（默认）；其余见 theme-classes.ts 注册表 */
  theme_id?: string | null;
}

export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export async function saveSettings(s: Settings): Promise<void> {
  await invoke("save_settings", { settings: s });
}

/** 当前生效的编辑器设置缓存（applyTypography 时刷新）——
 *  供编辑器侧读行为项（自动保存开关等），不必每次 invoke */
let current: EditorSettings = { auto_save: true };

export function currentEditorSettings(): EditorSettings {
  return current;
}

/** 排版硬默认（用户未覆盖时生效，替代原"跟随主题"的透传策略） */
const TYPO_DEFAULTS = {
  text_font: "霞鹜臻楷 GB",
  mono_font: "JetBrainsMonoNL NF",
  interface_font: "华文中宋",
  base_font_size: 17,
};

/** 解析主题模式：null/dark → dark；light → light；system → 跟系统（代码库首处 matchMedia） */
export function resolveTheme(mode: ThemeMode | null | undefined): ResolvedTheme {
  if (mode === "light") return "light";
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
}

/** 应用主题：swap body 类集（主题身份 × 明暗模式）+ 写 localStorage 镜像（splash-early/main.ts 防闪），返回解析值 */
export function applyTheme(
  mode: ThemeMode | null | undefined,
  themeId?: string | null
): ResolvedTheme {
  const resolved = resolveTheme(mode);
  swapThemeClasses(themeId ?? null, resolved);
  return resolved;
}

/** 应用排版覆盖：body + #app 双内联（用户 > 硬默认 > 主题兜底），对齐 Ob 语义 */
export function applyTypography(e: EditorSettings) {
  current = e;
  // 主题应用（Mica 已暂时下架——上游 window-vibrancy#183 在 Win11 24H2/25H2 失效，
  // 待上游修复后复活：此处需恢复 ob-vibrancy 类切换 + set_window_effect 带 dark 参数）
  applyTheme(e.theme_mode, e.theme_id);
  // 防御：旧会话若残留 vibrancy 类，摘掉
  document.body.classList.remove("ob-vibrancy");
  const targets = [document.body, document.getElementById("app")].filter(
    (t): t is HTMLElement => t !== null
  );
  // 用户覆盖优先，未填则取硬默认（不再透传主题 CSS fallback）
  const textFont = e.text_font || TYPO_DEFAULTS.text_font;
  const monoFont = e.mono_font || TYPO_DEFAULTS.mono_font;
  const interfaceFont = e.interface_font || TYPO_DEFAULTS.interface_font;
  const fontSize = e.base_font_size ?? TYPO_DEFAULTS.base_font_size;
  const set = (k: string, v: string) => {
    for (const t of targets) t.style.setProperty(k, v);
  };
  set("--font-text", textFont);
  set("--font-monospace", monoFont);
  set("--font-interface", interfaceFont);
  set("--font-text-size", `${fontSize}px`);
  // 字号直接内联（Obsidian baseFontSize 同款做法）：不经过 --ob-font-size 变量链，
  // 避免主题在深层作用域重定义变量导致覆盖失效；em 尺寸（标题等）随之等比缩放
  for (const t of targets) {
    t.style.fontSize = `${fontSize}px`;
  }
  // 当前行底色（默认显示，显式 false 才隐藏）
  document.body.classList.toggle("anp-current-line", e.show_active_block !== false);
  // 代码块软换行开关（body 类 + CSS；CM 行高缓存下一次渲染周期自愈）
  document.body.classList.toggle("ob-code-wrap", e.code_block_wrap === true);
  // 起始页版本与署名显示开关（默认显示，显式 false 才隐藏）
  document.body.classList.toggle("ob-hide-author", e.show_author === false);
  // 悬浮 TOC 开关（默认显示，显式 false 才隐藏；CSS 门控，TOC 插件零接线）
  document.body.classList.toggle("ob-toc-hidden", e.toc === false);
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

  // system 模式跟随：系统明暗切换时重应用主题（含 Mica dark 参数重放）
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (current.theme_mode === "system") applyTypography(current);
    });

  const s = await getSettings();
  setKeymapOverrides(s.editor.keymap);
  applyTypography(s.editor);
}
