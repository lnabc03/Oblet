// CodeMirror 代码块高亮主题（多主题一期 1C）
// 关键设计：全部颜色写 CSS 变量引用（--ctp-* 调色板 / --ob-* 语义色），
// CM 把 theme/HighlightStyle 注入为 CSS 文本，var() 在使用点解析——
// 主题切换（body 类 swap）时零重配置自动跟随，无需 Compartment 热替换。
// fallback 取 mocha 深色字面值（变量就绪前的首帧兜底）。
// 注：@codemirror/* 与 @lezer/highlight 为 @milkdown/crepe 的传递依赖（已提升到根 node_modules）
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/** ctp 调色板引用（fallback = mocha 字面值） */
const c = (name: string, fallback: string) => `var(--ctp-${name}, ${fallback})`;

// 编辑器外壳配色：只定颜色，布局交给 Crepe 的 code-mirror.css（--crepe-* 已桥接）
const chrome = EditorView.theme({
  "&": {
    backgroundColor: "transparent", // 外壳底色由 code-mirror.css 的 --crepe-color-surface-low 提供
    color: c("text", "#cdd6f4"),
  },
  ".cm-content": {
    caretColor: c("text", "#cdd6f4"),
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: c("text", "#cdd6f4"),
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--ob-selection, rgba(123, 108, 217, 0.35))",
  },
  ".cm-selectionMatch": {
    backgroundColor: `rgba(var(--ctp-sapphire, 116, 199, 236), 0.25)`,
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: c("overlay1", "#7f849c"),
  },
  // 当前行底色交给外壳机制（anp-current-line 门控的是 PM 正文块，CM 内不叠）
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-matchingBracket": {
    backgroundColor: `rgba(var(--ctp-surface2, 88, 91, 112), 0.4)`,
    outline: "none",
  },
});

// 语法高亮：Catppuccin 语义映射（对齐 AnuPpuccin 阅读视图配色惯例）
const highlight = HighlightStyle.define([
  // 关键字族 → mauve
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: c("mauve", "#cba6f7") },
  // 字符串/字符 → green
  { tag: [t.string, t.character, t.docString], color: c("green", "#a6e3a1") },
  // 数字/布尔/null/原子值 → peach
  { tag: [t.number, t.bool, t.null, t.atom], color: c("peach", "#fab387") },
  // 注释 → overlay1 斜体
  { tag: [t.comment, t.blockComment, t.lineComment], color: c("overlay1", "#7f849c"), fontStyle: "italic" },
  // 函数调用 → blue
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: c("blue", "#89b4fa") },
  // 属性/字段 → sky
  { tag: t.propertyName, color: c("sky", "#89dceb") },
  // 类型/类/命名空间 → yellow
  { tag: [t.typeName, t.className, t.namespace, t.typeOperator], color: c("yellow", "#f9e2af") },
  // 运算符 → sky
  { tag: t.operator, color: c("sky", "#89dceb") },
  // 标点/括号 → overlay2
  { tag: [t.punctuation, t.paren, t.brace, t.bracket, t.separator], color: c("overlay2", "#9399b2") },
  // 标签（HTML/XML）→ mauve；属性名 → yellow
  { tag: t.tagName, color: c("mauve", "#cba6f7") },
  { tag: t.attributeName, color: c("yellow", "#f9e2af") },
  // 正则/转义/特殊字符串 → pink
  { tag: [t.regexp, t.escape, t.special(t.string)], color: c("pink", "#f5c2e7") },
  // 普通变量 → 正文色
  { tag: [t.variableName, t.definition(t.variableName)], color: c("text", "#cdd6f4") },
  // 链接/URL → blue
  { tag: [t.link, t.url], color: c("blue", "#89b4fa") },
  // 强调结构（markdown in code 等场景）
  { tag: t.heading, color: c("blue", "#89b4fa"), fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  // meta/预处理 → overlay1
  { tag: [t.meta, t.processingInstruction], color: c("overlay1", "#7f849c") },
  // diff 语义（代码块内嵌 diff 语言时）
  { tag: t.inserted, color: c("green", "#a6e3a1") },
  { tag: t.deleted, color: c("red", "#f38ba8") },
  { tag: t.changed, color: c("yellow", "#f9e2af") },
  // 非法/错误 → red
  { tag: t.invalid, color: c("red", "#f38ba8") },
]);

/** Oblet CM 主题扩展：传给 Crepe featureConfigs[CodeMirror].theme 覆盖默认 oneDark */
export const obletCmTheme: Extension = [chrome, syntaxHighlighting(highlight)];
