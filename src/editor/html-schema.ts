// HTML 的 ProseMirror schema / mdast 序列化 / 源码事务接口。
// 只描述“模型长什么样、怎么往返”，DOM 渲染在 html-render.ts，视图在 html-views.ts。
import type { Ctx } from "@milkdown/ctx";
import { remarkStringifyOptionsCtx } from "@milkdown/core";
import type { Handle } from "mdast-util-to-markdown";
import { $markSchema, $nodeSchema } from "@milkdown/utils";
import type { Node as PMNode, Mark as PMMark } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import {
  ALLOWED_ATTR_SET,
  HTML_INLINE_MAX_DEPTH,
  INLINE_ATOM_TAGS,
  INLINE_MARK_TAGS,
  parseSingleTag,
  type HtmlInlineMarkTag,
} from "./html-lexer";
import { renderInlineElement } from "./html-render";
import { parseSummaryOnly, type MdNode } from "./html-transform";

export const stringAttr = (value: unknown) => (typeof value === "string" ? value : "");
const stringArrayAttr = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export function hasOpenAttribute(open: string): boolean {
  const token = parseSingleTag(open);
  if (!token) return false;
  const body = token.raw.slice(1, -1).replace(/^details/i, "");
  return /(?:^|\s)open(?:\s*=|\s*$|\/\s*$)/i.test(body.trim());
}

export const htmlBlockSchema = $nodeSchema("html_block", () => ({
  atom: true,
  group: "block",
  selectable: true,
  attrs: { value: { default: "", validate: "string" } },
  parseDOM: [
    {
      tag: "pre[data-type='html-block']",
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }),
    },
  ],
  toDOM: (node) => [
    "pre",
    { "data-type": "html-block", "data-value": node.attrs.value },
    node.attrs.value,
  ],
  parseMarkdown: {
    match: (node) => node.type === "html_block",
    runner: (state, node, type) => {
      state.addNode(type, { value: stringAttr(node.value) });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "html_block",
    runner: (state, node) => {
      state.addNode("html_block", undefined, stringAttr(node.attrs.value));
    },
  },
}));

const detailsAttrs = (node: MdNode) => ({
  open: stringAttr(node.open),
  summaryGap: stringAttr(node.summaryGap),
  summary: stringAttr(node.summary),
  bodyGap: stringAttr(node.bodyGap),
  closeGap: stringAttr(node.closeGap),
  close: stringAttr(node.close),
  separators: stringArrayAttr(node.separators),
});

export const htmlDetailsSchema = $nodeSchema("html_details", () => ({
  content: "block*",
  group: "block",
  defining: true,
  isolating: true,
  attrs: {
    open: { default: "<details>", validate: "string" },
    summaryGap: { default: "\n", validate: "string" },
    summary: { default: "", validate: "string" },
    bodyGap: { default: "\n\n", validate: "string" },
    closeGap: { default: "\n", validate: "string" },
    close: { default: "</details>", validate: "string" },
    separators: { default: [] },
  },
  parseDOM: [{ tag: "div[data-type='html-details']" }],
  toDOM: (node) => [
    "div",
    { "data-type": "html-details" },
    ["details", { open: hasOpenAttribute(node.attrs.open) ? "" : null }],
    ["summary", {}, stringAttr(node.attrs.summary)],
    ["div", { class: "ob-html-details-content" }, 0],
  ],
  parseMarkdown: {
    match: (node) => node.type === "html_details",
    runner: (state, node, type) => {
      state.openNode(type, detailsAttrs(node)).next(node.children).closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "html_details",
    runner: (state, node) => {
      state
        .openNode("html_details", undefined, {
          open: stringAttr(node.attrs.open),
          summaryGap: stringAttr(node.attrs.summaryGap),
          summary: stringAttr(node.attrs.summary),
          bodyGap: stringAttr(node.attrs.bodyGap),
          closeGap: stringAttr(node.attrs.closeGap),
          close: stringAttr(node.attrs.close),
          separators: stringArrayAttr(node.attrs.separators),
        })
        .next(node.content)
        .closeNode();
    },
  },
}));

export const htmlInlineAtomSchema = $nodeSchema("html_inline_atom", () => ({
  atom: true,
  group: "inline",
  inline: true,
  selectable: true,
  attrs: {
    tag: { default: "br", validate: "string" },
    value: { default: "<br>", validate: "string" },
  },
  parseDOM: [
    {
      tag: "span[data-type='html-inline-atom']",
      getAttrs: (dom) => ({
        tag: (dom as HTMLElement).dataset.tag ?? "br",
        value: (dom as HTMLElement).dataset.value ?? "",
      }),
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-type": "html-inline-atom",
      "data-tag": node.attrs.tag,
      "data-value": node.attrs.value,
    },
    stringAttr(node.attrs.value),
  ],
  parseMarkdown: {
    match: (node) => node.type === "html_inline_atom",
    runner: (state, node, type) => {
      state.addNode(type, {
        tag: stringAttr(node.tag),
        value: stringAttr(node.value),
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "html_inline_atom",
    runner: (state, node) => {
      state.addNode("html_inline_atom", undefined, stringAttr(node.attrs.value), {
        tag: stringAttr(node.attrs.tag),
      });
    },
  },
}));

function inlineMarkDom(
  mark: PMMark
): [string, Record<string, string>, 0] | ["span", Record<string, string>, 0] {
  const tag = stringAttr(mark.attrs.tag);
  const attrs: Record<string, string> = { class: "ob-html-inline" };
  const element = renderInlineElement(stringAttr(mark.attrs.open), stringAttr(mark.attrs.close), tag);
  if (element) {
    for (const attr of Array.from(element.attributes)) {
      if (ALLOWED_ATTR_SET.has(attr.name) || attr.name === "rel" || attr.name === "data-ob-html-link")
        attrs[attr.name] = attr.value;
    }
    return [tag, attrs, 0];
  }
  attrs["data-ob-html-source"] = stringAttr(mark.attrs.open);
  return ["span", attrs, 0];
}

function makeInlineMarkSchema(tag: HtmlInlineMarkTag, depth: number, insideMarkdown: boolean) {
  const id = insideMarkdown
    ? `html_inline_md_${depth}_${tag}`
    : depth === 0
      ? `html_inline_${tag}`
      : `html_inline_${depth}_${tag}`;
  return $markSchema(id, () => ({
    inclusive: false,
    // PM mark 是无序集合。深度保证 HTML 外先内后；两个区间隔开原生
    // Markdown mark 的 50，保证 HTML→Markdown 与 Markdown→HTML 都不换序。
    priority: (insideMarkdown ? 60 : 40) + depth,
    attrs: {
      tag: { default: tag, validate: "string" },
      depth: { default: depth },
      markdown: { default: insideMarkdown },
      open: { default: `<${tag}>`, validate: "string" },
      close: { default: `</${tag}>`, validate: "string" },
    },
    parseDOM: [{ tag: `${tag}.ob-html-inline` }],
    toDOM: inlineMarkDom,
    parseMarkdown: {
      match: (node) =>
        node.type === "html_inline" &&
        node.tag === tag &&
        Number(node.depth ?? 0) === depth &&
        Boolean(node.markdown) === insideMarkdown,
      runner: (state, node, markType) => {
        state.openMark(markType, {
          tag,
          depth,
          markdown: insideMarkdown,
          open: stringAttr(node.open),
          close: stringAttr(node.close),
        });
        state.next(node.children);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === id,
      runner: (state, mark) => {
        state.withMark(mark, "html_inline", undefined, {
          tag,
          depth,
          markdown: insideMarkdown,
          open: stringAttr(mark.attrs.open),
          close: stringAttr(mark.attrs.close),
        });
      },
    },
  }));
}

export const htmlInlineMarkSchemas = Object.fromEntries(
  INLINE_MARK_TAGS.map((tag) => [tag, makeInlineMarkSchema(tag, 0, false)])
) as Record<HtmlInlineMarkTag, ReturnType<typeof makeInlineMarkSchema>>;

export const htmlInlineNestedMarkSchemas = Array.from(
  { length: HTML_INLINE_MAX_DEPTH - 1 },
  (_, index) => index + 1
).flatMap((depth) =>
  INLINE_MARK_TAGS.map((tag) => ({
    tag,
    depth,
    schema: makeInlineMarkSchema(tag, depth, false),
  }))
);

export const htmlInlineMarkdownMarkSchemas = Array.from(
  { length: HTML_INLINE_MAX_DEPTH },
  (_, depth) => depth
).flatMap((depth) =>
  INLINE_MARK_TAGS.map((tag) => ({
    tag,
    depth,
    schema: makeInlineMarkSchema(tag, depth, true),
  }))
);

export const allHtmlInlineMarkSchemas = [
  ...INLINE_MARK_TAGS.map((tag) => ({ tag, depth: 0, schema: htmlInlineMarkSchemas[tag] })),
  ...htmlInlineNestedMarkSchemas,
  ...htmlInlineMarkdownMarkSchemas,
];

const rawValueHandler: Handle = (node) => stringAttr(node.value);

const htmlInlineHandler: Handle = (node, _parent, state, info) => {
  const exit = state.enter("phrasing");
  const value = state.containerPhrasing(node, info);
  exit();
  return `${stringAttr(node.open)}${value}${stringAttr(node.close)}`;
};

/** 与 containerFlow 相同地维护 tracker/indexStack，但使用原文保存的子节点间隔。 */
const htmlDetailsHandler: Handle = (node, _parent, state, info) => {
  const children = node.children ?? [];
  const separators = stringArrayAttr(node.separators);
  const tracker = state.createTracker(info);
  const results: string[] = [];
  const header = `${stringAttr(node.open)}${stringAttr(node.summaryGap)}${stringAttr(node.summary)}`;
  results.push(tracker.move(header));
  if (children.length) {
    results.push(tracker.move(stringAttr(node.bodyGap) || "\n\n"));
    state.indexStack.push(-1);
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      state.indexStack[state.indexStack.length - 1] = index;
      results.push(
        tracker.move(
          state.handle(child, node, state, {
            before: "\n",
            after: "\n",
            ...tracker.current(),
          })
        )
      );
      if (child.type !== "list") state.bulletLastUsed = undefined;
      if (index < children.length - 1)
        results.push(tracker.move(separators[index] ?? "\n\n"));
    }
    state.indexStack.pop();
  }
  results.push(tracker.move(`${stringAttr(node.closeGap)}${stringAttr(node.close)}`));
  return results.join("");
};

/** 在 Crepe create 前的 config 阶段调用，可与 tuneSerialization 任意顺序组合。 */
export function configureHtml(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    handlers: {
      ...prev.handlers,
      html_block: rawValueHandler,
      html_details: htmlDetailsHandler,
      html_inline: htmlInlineHandler,
      html_inline_atom: rawValueHandler,
    },
  }));
}

export const tuneHtmlSerialization = configureHtml;

// ---- 源码编辑事务接口 ----

export interface HtmlDetailsSource {
  open: string;
  summary: string;
  close: string;
}

function nodeAt(view: EditorView, pos: number, type: string): PMNode | null {
  const node = view.state.doc.nodeAt(pos);
  return node?.type.name === type ? node : null;
}

export function updateHtmlBlockSource(view: EditorView, pos: number, value: string): boolean {
  if (!view.editable || !nodeAt(view, pos, "html_block")) return false;
  view.dispatch(view.state.tr.setNodeAttribute(pos, "value", value));
  return true;
}

function validDetailsSource(source: HtmlDetailsSource): boolean {
  const open = parseSingleTag(source.open);
  const close = parseSingleTag(source.close);
  const summary = source.summary ? parseSummaryOnly(source.summary) : { summary: "", tail: "" };
  return !!(
    open &&
    open.name === "details" &&
    !open.closing &&
    !open.selfClosing &&
    close &&
    close.name === "details" &&
    close.closing &&
    summary &&
    summary.tail === "" &&
    (!source.summary || summary.summary === source.summary)
  );
}

/** open/summary/close 在同一 PM 事务提交，body 与空白 attrs 不动，可一次 Ctrl+Z 撤销。 */
export function updateHtmlDetailsSource(
  view: EditorView,
  pos: number,
  source: HtmlDetailsSource
): boolean {
  if (!view.editable || !nodeAt(view, pos, "html_details") || !validDetailsSource(source))
    return false;
  const tr = view.state.tr;
  tr.setNodeAttribute(pos, "open", source.open);
  tr.setNodeAttribute(pos, "summary", source.summary);
  tr.setNodeAttribute(pos, "close", source.close);
  view.dispatch(tr);
  return true;
}

export interface HtmlInlineSource {
  open?: string;
  close?: string;
  value?: string;
}

interface HtmlInlineRange {
  mark: PMMark;
  from: number;
  to: number;
}

function htmlMarkAt(view: EditorView, pos: number): PMMark | null {
  const safePos = Math.max(0, Math.min(pos, view.state.doc.content.size));
  const resolved = view.state.doc.resolve(safePos);
  const marks = [
    ...resolved.marks(),
    ...(view.state.doc.nodeAt(safePos)?.marks ?? []),
    ...(safePos > 0 ? view.state.doc.nodeAt(safePos - 1)?.marks ?? [] : []),
  ];
  return marks.find((mark) => mark.type.name.startsWith("html_inline_")) ?? null;
}

function htmlMarkRange(view: EditorView, pos: number, mark: PMMark): HtmlInlineRange | null {
  const resolved = view.state.doc.resolve(Math.max(1, Math.min(pos, view.state.doc.content.size - 1)));
  if (!resolved.parent.isTextblock) return null;
  const parentStart = resolved.start();
  const segments: HtmlInlineRange[] = [];
  resolved.parent.forEach((child, offset) => {
    const own = child.marks.find((item) => item.eq(mark));
    if (own) segments.push({ mark: own, from: parentStart + offset, to: parentStart + offset + child.nodeSize });
  });
  if (!segments.length) return null;
  let selected = segments.find((segment) => pos >= segment.from && pos <= segment.to);
  if (!selected) return null;
  let from = selected.from;
  let to = selected.to;
  let index = segments.indexOf(selected);
  while (index > 0 && segments[index - 1].to === from) from = segments[--index].from;
  index = segments.indexOf(selected);
  while (index < segments.length - 1 && segments[index + 1].from === to) to = segments[++index].to;
  selected = { mark, from, to };
  return selected;
}

export function getHtmlInlineSource(view: EditorView, pos: number): HtmlInlineSource | null {
  const atom = view.state.doc.nodeAt(pos);
  if (atom?.type.name === "html_inline_atom") return { value: stringAttr(atom.attrs.value) };
  const mark = htmlMarkAt(view, pos);
  return mark ? { open: stringAttr(mark.attrs.open), close: stringAttr(mark.attrs.close) } : null;
}

/**
 * 行内标签源码编辑接口。atom 传 value，mark 传 open/close。
 * mark 的标签名保持不变，属性可改；所有改动在一个事务中完成。
 */
export function updateHtmlInlineSource(
  view: EditorView,
  pos: number,
  source: HtmlInlineSource
): boolean {
  if (!view.editable) return false;
  const atom = view.state.doc.nodeAt(pos);
  if (atom?.type.name === "html_inline_atom") {
    if (typeof source.value !== "string") return false;
    const token = parseSingleTag(source.value);
    if (!token || token.closing || !INLINE_ATOM_TAGS.has(token.name)) return false;
    view.dispatch(
      view.state.tr
        .setNodeAttribute(pos, "value", source.value)
        .setNodeAttribute(pos, "tag", token.name)
    );
    return true;
  }
  const mark = htmlMarkAt(view, pos);
  if (!mark) return false;
  const range = htmlMarkRange(view, pos, mark);
  if (!range) return false;
  const open = source.open ?? stringAttr(mark.attrs.open);
  const close = source.close ?? stringAttr(mark.attrs.close);
  const openToken = parseSingleTag(open);
  const closeToken = parseSingleTag(close);
  const tag = stringAttr(mark.attrs.tag);
  if (
    !openToken ||
    !closeToken ||
    openToken.name !== tag ||
    closeToken.name !== tag ||
    openToken.closing ||
    openToken.selfClosing ||
    !closeToken.closing
  )
    return false;
  const tr = view.state.tr.removeMark(range.from, range.to, mark.type);
  tr.addMark(range.from, range.to, mark.type.create({ tag, open, close }));
  view.dispatch(tr);
  return true;
}
