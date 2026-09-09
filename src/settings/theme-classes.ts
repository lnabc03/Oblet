// 主题注册表与类集常量（多主题一期创建、二期扩展为主题身份维度）——
// main.ts 启动前置、typography.ts 运行时切换、ui.ts 设置面板共用，
// 抽成独立小模块避免 main.ts → typography.ts → commands.ts 的深层依赖。
// 结构：主题（ob-t-<id> 门控类 + 主题自带 flavor 类）× 模式（theme-dark/light）正交组合；
// anp-* 定制类是 AnuPpuccin 专属，静态留在 index.html body 上（其他主题下因
// ob-t-anuppuccin 门控不匹配而自动失效，无需摘除）。

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export interface ThemeDef {
  id: string;
  /** 设置面板显示名 */
  name: string;
  /** 深色模式 body 类集（含 ob-t-<id> 门控类） */
  dark: string[];
  /** 浅色模式 body 类集 */
  light: string[];
  /** 启动遮罩底色（= 蒸馏产物的 --ob-bg，index.html 内联 splash 样式与之同步） */
  splash: Record<ResolvedTheme, string>;
}

/** 默认主题（theme_id 为 null 时） */
export const DEFAULT_THEME_ID = "anuppuccin";

/**
 * 白名单固化主题注册表（顺序 = 设置面板下拉顺序）。
 * splash 色取自各主题蒸馏产物的 --ob-bg；新增主题时同步 index.html 内联样式。
 */
export const THEMES: ThemeDef[] = [
  {
    id: "anuppuccin",
    name: "AnuPpuccin",
    // 浅色依 oblet-theme.json 的既有定制：rosepine-light + flamingo accent
    dark: ["theme-dark", "ctp-mocha-old", "ctp-accent-mauve", "ob-t-anuppuccin"],
    light: ["theme-light", "ctp-rosepine-light", "ctp-accent-light-flamingo", "ob-t-anuppuccin"],
    splash: { dark: "#1e1e2e", light: "#eee6dd" },
  },
  {
    id: "atom",
    name: "Atom",
    dark: ["theme-dark", "ob-t-atom"],
    light: ["theme-light", "ob-t-atom"],
    splash: { dark: "#272b34", light: "#fafafa" },
  },
  {
    id: "github",
    name: "GitHub",
    dark: ["theme-dark", "ob-t-github"],
    light: ["theme-light", "ob-t-github"],
    splash: { dark: "#0d1117", light: "#ffffff" },
  },
  {
    id: "minimal",
    name: "Minimal",
    dark: ["theme-dark", "ob-t-minimal"],
    light: ["theme-light", "ob-t-minimal"],
    splash: { dark: "#262626", light: "#ffffff" },
  },
  {
    id: "nord",
    name: "Nord",
    dark: ["theme-dark", "ob-t-nord"],
    light: ["theme-light", "ob-t-nord"],
    splash: { dark: "#2e3440", light: "#ffffff" },
  },
  {
    id: "things",
    name: "Things",
    dark: ["theme-dark", "ob-t-things"],
    light: ["theme-light", "ob-t-things"],
    splash: { dark: "#1c2127", light: "#ffffff" },
  },
];

/** 全部主题相关类（swap 时先整体摘除再挂目标集） */
export const ALL_THEME_CLASSES: string[] = [
  ...new Set(THEMES.flatMap((t) => [...t.dark, ...t.light])),
];

/** localStorage 镜像键：splash-early.js / main.ts 首帧前同步读它们防闪 */
export const THEME_MIRROR_KEY = "oblet.theme";
export const THEME_ID_MIRROR_KEY = "oblet.themeId";

/** 解析主题 id：null/未注册 → 默认主题（设置文件写坏/主题下架时优雅落回） */
export function resolveThemeId(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

/** 仅 swap body 类集（不写镜像）——打印临时切浅色等瞬态场景用 */
export function applyThemeClasses(themeId: string | null | undefined, resolved: ResolvedTheme): void {
  document.body.classList.remove(...ALL_THEME_CLASSES);
  document.body.classList.add(...resolveThemeId(themeId)[resolved]);
}

/** 主题+模式写入 body 类集 + localStorage 双镜像 */
export function swapThemeClasses(themeId: string | null | undefined, resolved: ResolvedTheme): void {
  const def = resolveThemeId(themeId);
  applyThemeClasses(def.id, resolved);
  try {
    localStorage.setItem(THEME_MIRROR_KEY, resolved);
    localStorage.setItem(THEME_ID_MIRROR_KEY, def.id);
  } catch {
    /* localStorage 不可用时跳过镜像，主链路不受影响 */
  }
}

/** 首帧前同步用：从镜像读主题+模式并 swap body 类（main.ts 模块顶层调用） */
export function applyThemeFromMirror(): void {
  try {
    const id = localStorage.getItem(THEME_ID_MIRROR_KEY) ?? DEFAULT_THEME_ID;
    const m = localStorage.getItem(THEME_MIRROR_KEY);
    if (m === "light" || m === "dark") swapThemeClasses(id, m);
    else applyThemeClasses(id, "dark");
  } catch {
    /* 忽略 */
  }
}
