// 主题类集常量（多主题一期）——main.ts 启动前置与 typography.ts 运行时切换共用，
// 抽成独立小模块避免 main.ts → typography.ts → commands.ts 的深层依赖
// anp-* 定制类明暗共用，静态留在 index.html body 上；这里只管随明暗 swap 的类

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

/** 各主题模式的 body 类集（浅色依 oblet-theme.json 的既有定制：rosepine-light + flamingo accent） */
export const THEME_CLASSES: Record<ResolvedTheme, string[]> = {
  dark: ["theme-dark", "ctp-mocha-old", "ctp-accent-mauve"],
  light: ["theme-light", "ctp-rosepine-light", "ctp-accent-light-flamingo"],
};

/** 全部主题类（swap 时先整体摘除再挂目标集） */
export const ALL_THEME_CLASSES: string[] = [
  ...THEME_CLASSES.dark,
  ...THEME_CLASSES.light,
];

/** localStorage 镜像键：splash-early.js / main.ts 首帧前同步读它防闪 */
export const THEME_MIRROR_KEY = "oblet.theme";

/** 仅 swap body 类集（不写镜像）——打印临时切浅色等瞬态场景用 */
export function applyThemeClasses(resolved: ResolvedTheme): void {
  document.body.classList.remove(...ALL_THEME_CLASSES);
  document.body.classList.add(...THEME_CLASSES[resolved]);
}

/** 解析后的主题写入 body 类集 + localStorage 镜像，返回解析值 */
export function swapThemeClasses(resolved: ResolvedTheme): void {
  applyThemeClasses(resolved);
  try {
    localStorage.setItem(THEME_MIRROR_KEY, resolved);
  } catch {
    /* localStorage 不可用时跳过镜像，主链路不受影响 */
  }
}

/** 首帧前同步用：从镜像读解析后主题并 swap body 类（main.ts 模块顶层调用） */
export function applyThemeFromMirror(): void {
  try {
    const m = localStorage.getItem(THEME_MIRROR_KEY);
    if (m === "light" || m === "dark") swapThemeClasses(m);
  } catch {
    /* 忽略 */
  }
}
