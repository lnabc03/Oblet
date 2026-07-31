// 快捷键系统（4.4）：命令注册表 + settings.json 键位覆盖 + window 捕获阶段统一派发
// 设计文档已定不依赖 vault/hotkeys.json；键位覆盖存 settings.json editor.keymap
// （命令 id → 组合串，如 "Ctrl+Shift+F"），未覆盖的命令用默认组合
import { getSettings } from "./settings/typography";

export interface Command {
  id: string;
  title: string;
  /** 默认组合（"Ctrl+S" 形）；覆盖见 settings editor.keymap */
  defaultCombo: string;
  run: () => void;
  /** false = 键位写死：设置列表不显示、keymap 覆盖不生效（默认 true） */
  remappable?: boolean;
}

const registry: Command[] = [];

export function registerCommand(cmd: Command) {
  // 重复注册（HMR 等）以新替旧
  const i = registry.findIndex((c) => c.id === cmd.id);
  if (i >= 0) registry.splice(i, 1, cmd);
  else registry.push(cmd);
}

export function listCommands(): readonly Command[] {
  return registry.filter((c) => c.remappable !== false);
}

// ---------------------------------------------------------------- 组合串规范化

const PUNCT: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
};
const NAMED = new Set([
  "Escape", "Enter", "Tab", "Backspace", "Delete", "Insert",
  "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
]);

/** KeyboardEvent → 规范化组合串（"Ctrl+Shift+A" 形）；纯修饰键返回 null。
 *  用 e.code 不用 e.key：中文输入法下字母/标点可能变全角（Ctrl+, 教训） */
export function comboOf(e: KeyboardEvent): string | null {
  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (PUNCT[code]) key = PUNCT[code];
  else if (NAMED.has(code) || /^F\d{1,2}$/.test(code)) key = code;
  if (!key) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

// ---------------------------------------------------------------- 覆盖缓存与派发

let overrides: Record<string, string> = {};

/** 同步键位覆盖缓存（typography 读设置/收广播时调用） */
export function setKeymapOverrides(map: Record<string, string> | null | undefined) {
  overrides = map ?? {};
}

/** 命令的当前生效组合（remappable=false 的命令忽略覆盖，默认写死） */
export function effectiveCombo(cmd: Command): string {
  return cmd.remappable === false
    ? cmd.defaultCombo
    : (overrides[cmd.id] ?? cmd.defaultCombo);
}

/** combo → command 反查表（覆盖优先；写死命令只挂默认组合） */
function comboMap(): Map<string, Command> {
  const map = new Map<string, Command>();
  for (const cmd of registry) map.set(cmd.defaultCombo, cmd);
  for (const cmd of registry) {
    if (cmd.remappable === false) continue;
    const ov = overrides[cmd.id];
    if (ov) {
      // 覆盖生效后，默认组合让位（除非它恰是另一命令的生效组合——罕见冲突，先到先得）
      if (map.get(cmd.defaultCombo) === cmd) map.delete(cmd.defaultCombo);
      map.set(ov, cmd);
    }
  }
  return map;
}

// 设置页"按下新组合"捕获模式：派发器静默，避免按 Ctrl+S 改键时触发保存
let captureActive = false;
export function setKeymapCaptureActive(on: boolean) {
  captureActive = on;
}

/** 初始化：读设置同步覆盖缓存 + 挂 window 捕获派发器（应用层调用一次） */
export async function initKeymap(): Promise<void> {
  const s = await getSettings();
  setKeymapOverrides(s.editor.keymap);

  window.addEventListener(
    "keydown",
    (e) => {
      if (captureActive) return;
      // 焦点在输入控件/浮层里时格式化类快捷键不穿透到后台文档
      // （搜索框里按 Ctrl+B 不应把正文加粗；十轮引入格式化命令后必须有这道防线）
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, select, .settings-overlay")
      )
        return;
      const combo = comboOf(e);
      if (!combo) return;
      const cmd = comboMap().get(combo);
      if (!cmd) return;
      e.preventDefault();
      e.stopPropagation();
      cmd.run();
    },
    true
  );
}
