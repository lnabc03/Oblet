// CodeMirror 代码块高亮主题（多主题一期 1C 创建；二期改为 --ob-hl-* 语义变量驱动）
// 关键设计：全部颜色写 CSS 变量引用，CM 把 theme/HighlightStyle 注入为 CSS 文本，
// var() 在使用点解析——主题切换（body 类 swap）时零重配置自动跟随。
// 变量链：--ob-hl-*（主题语义色，二期新增，各主题文件直供字面值）
//   → fallback rgb(var(--ctp-*))（AnuPpuccin 的 ctp 调色板，一期现状）
//   → 兜底 mocha 深色三元组。
// ⚠️ --ctp-* 变量是 RGB 三元组（"203, 166, 247"）而非颜色值，
//    必须用 rgb(var(--ctp-x, 三元组)) 包裹——裸 var() 会得到 "color: 203, 166, 247"
//    无效声明被整体丢弃（曾导致高亮全灭）。--ob-hl-* 是完整颜色值，直接 var() 即可。
// 注：@codemirror/* 与 @lezer/highlight 为 @milkdown/crepe 的传递依赖（已提升到根 node_modules）
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/** 高亮语义色引用：--ob-hl-<name>（主题文件直供）→ fallback ctp 调色板三元组 */
const h = (name: string, ctpName: string, fallbackTriplet: string) =>
  `var(--ob-hl-${name}, rgb(var(--ctp-${ctpName}, ${fallbackTriplet})))`;
/** 同 h，但默认值需要带透明度（selectionMatch / matchingBracket） */
const ha = (name: string, ctpName: string, fallbackTriplet: string, alpha: number) =>
  `var(--ob-hl-${name}, rgba(var(--ctp-${ctpName}, ${fallbackTriplet}), ${alpha}))`;

// 编辑器外壳配色：只定颜色，布局交给 Crepe 的 code-mirror.css（--crepe-* 已桥接）
const chrome = EditorView.theme({
  "&": {
    backgroundColor: "transparent", // 外壳底色由 code-mirror.css 的 --crepe-color-surface-low 提供
    color: h("text", "text", "205, 214, 244"),
  },
  ".cm-content": {
    caretColor: h("text", "text", "205, 214, 244"),
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: h("text", "text", "205, 214, 244"),
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--ob-selection, rgba(123, 108, 217, 0.35))",
  },
  ".cm-selectionMatch": {
    backgroundColor: ha("match", "sapphire", "116, 199, 236", 0.25),
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: h("comment", "overlay1", "127, 132, 156"),
  },
  // 当前行底色交给外壳机制（anp-current-line 门控的是 PM 正文块，CM 内不叠）
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-matchingBracket": {
    backgroundColor: ha("bracket", "surface2", "88, 91, 112", 0.4),
    outline: "none",
  },
});

// 语法高亮：语义映射（AnuPpuccin 走 ctp fallback = Catppuccin 惯例；新主题由 --ob-hl-* 直供）
const highlight = HighlightStyle.define([
  // 关键字族
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: h("keyword", "mauve", "203, 166, 247") },
  // 字符串/字符
  { tag: [t.string, t.character, t.docString], color: h("string", "green", "166, 227, 161") },
  // 数字/布尔/null/原子值
  { tag: [t.number, t.bool, t.null, t.atom], color: h("number", "peach", "250, 179, 135") },
  // 注释 → 弱化斜体
  { tag: [t.comment, t.blockComment, t.lineComment], color: h("comment", "overlay1", "127, 132, 156"), fontStyle: "italic" },
  // 函数调用
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: h("function", "blue", "137, 180, 250") },
  // 属性/字段
  { tag: t.propertyName, color: h("property", "sky", "137, 220, 235") },
  // 类型/类/命名空间
  { tag: [t.typeName, t.className, t.namespace, t.typeOperator], color: h("type", "yellow", "249, 226, 175") },
  // 运算符
  { tag: t.operator, color: h("operator", "sky", "137, 220, 235") },
  // 标点/括号
  { tag: [t.punctuation, t.paren, t.brace, t.bracket, t.separator], color: h("punctuation", "overlay2", "147, 153, 178") },
  // 标签（HTML/XML）；属性名
  { tag: t.tagName, color: h("tag", "mauve", "203, 166, 247") },
  { tag: t.attributeName, color: h("attr", "yellow", "249, 226, 175") },
  // 正则/转义/特殊字符串
  { tag: [t.regexp, t.escape, t.special(t.string)], color: h("regexp", "pink", "245, 194, 231") },
  // 普通变量 → 正文色
  { tag: [t.variableName, t.definition(t.variableName)], color: h("text", "text", "205, 214, 244") },
  // 链接/URL
  { tag: [t.link, t.url], color: h("link", "blue", "137, 180, 250") },
  // 强调结构（markdown in code 等场景）
  { tag: t.heading, color: h("heading", "blue", "137, 180, 250"), fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  // meta/预处理 → 弱化
  { tag: [t.meta, t.processingInstruction], color: h("comment", "overlay1", "127, 132, 156") },
  // diff 语义（代码块内嵌 diff 语言时）
  { tag: t.inserted, color: h("inserted", "green", "166, 227, 161") },
  { tag: t.deleted, color: h("deleted", "red", "243, 139, 168") },
  { tag: t.changed, color: h("changed", "yellow", "249, 226, 175") },
  // 非法/错误
  { tag: t.invalid, color: h("invalid", "red", "243, 139, 168") },
]);

/** Oblet CM 主题扩展：传给 Crepe featureConfigs[CodeMirror].theme 覆盖默认 oneDark */
export const obletCmTheme: Extension = [chrome, syntaxHighlighting(highlight)];
