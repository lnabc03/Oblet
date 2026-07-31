// 排版设置：字体/字号覆盖 + 持久化 + 跨窗口广播
// （主题已固化为 AnuPpuccin 深色单主题，这里只剩排版覆盖）
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

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
  /** 代码块软换行（null/false = 不换行，CM 默认横向滚动） */
  code_block_wrap?: boolean | null;
  /** 起始页署名显示（null/true = 显示） */
  show_author?: boolean | null;
}

export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export async function saveSettings(s: Settings): Promise<void> {
  await invoke("save_settings", { settings: s });
}

/** 应用排版覆盖：body + #app 双内联（用户 > 主题 > 兜底），对齐 Ob 语义 */
export function applyTypography(e: EditorSettings) {
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
  // 字号直接内联（Obsidian baseFontSize 同款做法）：不经过 --ob-font-size 变量链，
  // 避免主题在深层作用域重定义变量导致覆盖失效；em 尺寸（标题等）随之等比缩放
  for (const t of targets) {
    t.style.fontSize = e.base_font_size ? `${e.base_font_size}px` : "";
  }
  // 代码块软换行开关（body 类 + CSS；CM 行高缓存下一次渲染周期自愈）
  document.body.classList.toggle("ob-code-wrap", e.code_block_wrap === true);
  // 起始页署名显示开关（默认显示，显式 false 才隐藏）
  document.body.classList.toggle("ob-hide-author", e.show_author === false);
}

/** 保存排版设置并广播到所有窗口 */
export async function switchTypography(patch: Partial<EditorSettings>) {
  const s = await getSettings();
  Object.assign(s.editor, patch);
  await saveSettings(s);
  applyTypography(s.editor);
  await emit("oblet-typography-changed", {});
}

/** 启动时初始化：读 settings 应用排版；监听其他窗口的排版广播 */
export async function initTypography(): Promise<void> {
  await listen("oblet-typography-changed", async () => {
    const fresh = await getSettings();
    applyTypography(fresh.editor);
  });

  const s = await getSettings();
  applyTypography(s.editor);
}
