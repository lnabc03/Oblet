// GitHub README 安全渲染兼容：HTML 原文是事实源，DOM 只是单向只读投影。
// 支持根级块、同 phrasing 父节点内的行内标记/原子，以及根级 details 容器。
// 不做浏览器式 HTML 纠错，不支持的结构保留源码；```html 围栏仍走原代码块。
import type { Ctx, MilkdownPlugin } from "@milkdown/ctx";
import { InitReady, remarkPluginsCtx, remarkStringifyOptionsCtx } from "@milkdown/core";
import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import type { Handle } from "mdast-util-to-markdown";
import { $markSchema, $nodeSchema, $prose, $remark, $view } from "@milkdown/utils";
import type { Node as PMNode, Mark as PMMark } from "@milkdown/prose/model";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { EditorView, NodeView } from "@milkdown/prose/view";
import { ABS_PATH_RE, resolveLocalAbs } from "./image-paths";

// ---- 公共集成接口 ----

export type HtmlDocPathGetter = () => string;
export type HtmlToDomUrl = (src: string) => string;
export type HtmlOpenPath = (path: string) => void | Promise<void>;
export type HtmlOpenUrl = (url: string) => void | Promise<void>;

export interface HtmlRuntimeOptions {
  docPath?: HtmlDocPathGetter;
  toDomUrl?: HtmlToDomUrl;
  openPath?: HtmlOpenPath;
  openUrl?: HtmlOpenUrl;
}

let getDocPath: HtmlDocPathGetter = () => "";
let toDomUrl: HtmlToDomUrl = (src) => src;
let openPath: HtmlOpenPath = () => undefined;
let openUrl: HtmlOpenUrl = (url) => invoke("open_url", { url });

/** 文档路径必须传取值器，Tab 切换和重命名后才能实时跟随。 */
export function setHtmlDocPath(getter: HtmlDocPathGetter) {
  getDocPath = getter;
}

/** 与 Crepe ImageBlock.proxyDomURL 注入同一函数即可。 */
export function setHtmlToDomUrl(converter: HtmlToDomUrl) {
  toDomUrl = converter;
}

/** 相对 .md 链接的统一打开入口，通常接 setup.ts 的 openPathInTab。 */
export function setHtmlOpenPath(opener: HtmlOpenPath) {
  openPath = opener;
}

/** 默认经 Tauri open_url 打开系统浏览器；setter 便于宿主替换和自动化测试。 */
export function setHtmlOpenUrl(opener: HtmlOpenUrl) {
  openUrl = opener;
}

export function configureHtmlRuntime(options: HtmlRuntimeOptions) {
  if (options.docPath) setHtmlDocPath(options.docPath);
  if (options.toDomUrl) setHtmlToDomUrl(options.toDomUrl);
  if (options.openPath) setHtmlOpenPath(options.openPath);
  if (options.openUrl) setHtmlOpenUrl(options.openUrl);
}

// ---- 受限 HTML 词法和消毒 ----

const INLINE_MARK_TAGS = [
  "a",
  "strong",
  "b",
  "em",
  "i",
  "sub",
  "sup",
  "kbd",
  "code",
  "span",
  "s",
  "del",
  "ins",
  "q",
  "samp",
  "var",
  "small",
  "u",
] as const;

export type HtmlInlineMarkTag = (typeof INLINE_MARK_TAGS)[number];
const INLINE_MARK_TAG_SET = new Set<string>(INLINE_MARK_TAGS);
const INLINE_ATOM_TAGS = new Set(["img", "br", "wbr"]);
const HTML_INLINE_MAX_DEPTH = 4;
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ALLOWED_TAGS = [
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
];

const ALLOWED_ATTR = [
  "align",
  "alt",
  "cite",
  "colspan",
  "datetime",
  "dir",
  "height",
  "href",
  "lang",
  "open",
  "reversed",
  "rowspan",
  "span",
  "src",
  "start",
  "title",
  "type",
  "valign",
  "value",
  "width",
];
const ALLOWED_ATTR_SET = new Set(ALLOWED_ATTR);
const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS);

interface HtmlTagToken {
  raw: string;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  end: number;
}

/** 只读标签边界，不构建 DOM，也不修补未闭合引号或标签。 */
function readTagAt(source: string, start: number): HtmlTagToken | null {
  if (source[start] !== "<") return null;
  let i = start + 1;
  let closing = false;
  if (source[i] === "/") {
    closing = true;
    i++;
  }
  const nameStart = i;
  if (!/[A-Za-z]/.test(source[i] ?? "")) return null;
  while (/[A-Za-z0-9:-]/.test(source[i] ?? "")) i++;
  const name = source.slice(nameStart, i).toLowerCase();
  let quote = "";
  for (; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "<") return null;
    if (ch === ">") {
      const raw = source.slice(start, i + 1);
      if (closing && !new RegExp(`^</${name}\\s*>$`, "i").test(raw)) return null;
      return {
        raw,
        name,
        closing,
        selfClosing: /\/\s*>$/.test(raw) || VOID_TAGS.has(name),
        end: i + 1,
      };
    }
  }
  return null;
}

function parseSingleTag(source: string): HtmlTagToken | null {
  const token = readTagAt(source, 0);
  return token && token.end === source.length ? token : null;
}

function sanitizeFragment(source: string): DocumentFragment {
  return DOMPurify.sanitize(source, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "link",
      "meta",
      "base",
      "style",
      "svg",
      "math",
      "template",
    ],
    FORBID_ATTR: [
      "style",
      "class",
      "id",
      "target",
      "srcdoc",
      "srcset",
      "action",
      "formaction",
    ],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
}

/** 控制字符和空白不能用来混淆协议判定。 */
function compactUrlForCheck(raw: string): string {
  return raw.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
}

type HtmlLinkTarget =
  | { kind: "external"; url: string }
  | { kind: "path"; path: string };

function classifyLink(raw: string): HtmlLinkTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const compact = compactUrlForCheck(trimmed);
  if (!compact || compact.startsWith("//") || compact.startsWith("\\\\")) return null;
  if (/^https?:\/\//i.test(compact)) {
    try {
      const parsed = new URL(compact);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname)
        return { kind: "external", url: compact };
    } catch {
      return null;
    }
    return null;
  }
  // 仅相对 .md 可导航。其他本地资源、锚点和协议均不放开。
  if (ABS_PATH_RE.test(trimmed) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(compact)) return null;
  const path = trimmed.split(/[?#]/, 1)[0];
  if (!path || path.startsWith("#")) return null;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!/\.md$/i.test(decoded) || /[\u0000-\u001f\u007f]/.test(decoded)) return null;
  return { kind: "path", path };
}

function classifyImageSource(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const compact = compactUrlForCheck(trimmed);
  if (!compact || compact.startsWith("//")) return null;
  if (/^https?:\/\//i.test(compact)) {
    try {
      const parsed = new URL(compact);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? compact : null;
    } catch {
      return null;
    }
  }
  // Windows 盘符和 UNC 是本地路径，不是自定义 URL 协议。
  if (ABS_PATH_RE.test(trimmed)) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(compact)) return null;
  return trimmed;
}

function prepareRenderedTree(root: DocumentFragment | HTMLElement) {
  root.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    const raw = a.getAttribute("href") ?? "";
    const target = classifyLink(raw);
    a.removeAttribute("target");
    a.removeAttribute("rel");
    a.removeAttribute("data-ob-html-link");
    if (!target) {
      a.removeAttribute("href");
      return;
    }
    if (target.kind === "external") {
      a.href = target.url;
      a.setAttribute("href", target.url);
      a.rel = "noopener noreferrer nofollow";
      a.setAttribute("data-ob-html-link", "external");
    } else {
      a.setAttribute("href", target.path);
      a.setAttribute("data-ob-html-link", "path");
    }
  });
  root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const raw = img.getAttribute("src") ?? "";
    const safe = classifyImageSource(raw);
    if (!safe) {
      img.removeAttribute("src");
      return;
    }
    try {
      const converted = toDomUrl(safe);
      if (converted) img.setAttribute("src", converted);
      else img.removeAttribute("src");
    } catch {
      img.removeAttribute("src");
    }
  });
}

function hasUnsupportedMarkup(source: string): boolean {
  if (/<!--|<!DOCTYPE|<\?|<!\[CDATA/i.test(source)) return true;
  const stack: string[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "<") continue;
    const token = readTagAt(source, i);
    if (!token) continue;
    if (!ALLOWED_TAG_SET.has(token.name)) return true;
    if (token.closing) {
      if (stack.at(-1) !== token.name) return true;
      stack.pop();
    } else if (!token.selfClosing) {
      stack.push(token.name);
    }
    i = token.end - 1;
  }
  return stack.length > 0;
}

/** 渲染岛遇到未知容器时显示源码，危险属性仍由消毒层剥离。 */
function renderHtmlInto(container: HTMLElement, source: string) {
  container.replaceChildren();
  if (hasUnsupportedMarkup(source)) {
    const pre = document.createElement("pre");
    pre.className = "ob-html-source-fallback";
    pre.textContent = source;
    container.appendChild(pre);
    return;
  }
  const fragment = sanitizeFragment(source);
  prepareRenderedTree(fragment);
  container.appendChild(fragment);
}

function openRenderedLink(a: HTMLAnchorElement) {
  const kind = a.getAttribute("data-ob-html-link");
  const href = a.getAttribute("href") ?? "";
  if (kind === "external" && /^https?:\/\//i.test(href)) {
    void Promise.resolve(openUrl(href)).catch((error) => {
      console.error("[html] 打开外链失败:", error);
    });
    return;
  }
  if (kind === "path") {
    const absolute = resolveLocalAbs(href, getDocPath());
    if (absolute && /\.md$/i.test(absolute)) {
      void Promise.resolve(openPath(absolute)).catch((error) => {
        console.error("[html] 打开 Markdown 失败:", error);
      });
    }
  }
}

// ---- mdast 保真转换 ----

interface MdPosition {
  start: { offset?: number };
  end: { offset?: number };
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: MdPosition;
  [key: string]: unknown;
}

interface DetailsHead {
  open: string;
  summaryGap: string;
  summary: string;
  tail: string;
}

const normalizeLf = (value: string) => value.replace(/\r\n?/g, "\n");
const isWhitespace = (value: string) => /^[\s]*$/.test(value);

function blockHtmlValue(node: MdNode): string | null {
  if (node.type === "html" && typeof node.value === "string") return node.value;
  if (
    node.type === "paragraph" &&
    node.children?.length === 1 &&
    node.children[0].type === "html" &&
    typeof node.children[0].value === "string"
  )
    return node.children[0].value;
  return null;
}

function sourceGap(source: string, left: MdNode, right: MdNode): string {
  const start = left.position?.end.offset;
  const end = right.position?.start.offset;
  if (start == null || end == null || end < start) return "\n\n";
  return normalizeLf(source.slice(start, end));
}

function parseDetailsHead(source: string): DetailsHead | null {
  const open = readTagAt(source, 0);
  if (!open || open.name !== "details" || open.closing || open.selfClosing) return null;
  let cursor = open.end;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
  const between = source.slice(open.end, cursor);
  if (cursor >= source.length)
    return { open: open.raw, summaryGap: "", summary: "", tail: between };

  const summaryOpen = readTagAt(source, cursor);
  if (!summaryOpen || summaryOpen.name !== "summary" || summaryOpen.closing) {
    return isWhitespace(source.slice(open.end))
      ? { open: open.raw, summaryGap: "", summary: "", tail: source.slice(open.end) }
      : null;
  }
  const lower = source.toLowerCase();
  const closeStart = lower.indexOf("</summary", summaryOpen.end);
  if (closeStart < 0) return null;
  const summaryClose = readTagAt(source, closeStart);
  if (!summaryClose || summaryClose.name !== "summary" || !summaryClose.closing) return null;
  const tail = source.slice(summaryClose.end);
  if (!isWhitespace(tail)) return null;
  return {
    open: open.raw,
    summaryGap: between,
    summary: source.slice(cursor, summaryClose.end),
    tail,
  };
}

function parseSummaryOnly(source: string): { summary: string; tail: string } | null {
  let start = 0;
  while (start < source.length && /\s/.test(source[start])) start++;
  const open = readTagAt(source, start);
  if (!open || open.name !== "summary" || open.closing) return null;
  const closeStart = source.toLowerCase().indexOf("</summary", open.end);
  if (closeStart < 0) return null;
  const close = readTagAt(source, closeStart);
  if (!close || close.name !== "summary" || !close.closing) return null;
  const tail = source.slice(close.end);
  if (!isWhitespace(source.slice(0, start)) || !isWhitespace(tail)) return null;
  return { summary: source.slice(start, close.end), tail };
}

function parseDetailsClose(source: string): boolean {
  const token = parseSingleTag(source);
  return !!token && token.name === "details" && token.closing;
}

function emptyDetails(source: string): MdNode | null {
  const closeStart = source.toLowerCase().lastIndexOf("</details");
  if (closeStart < 0) return null;
  const close = readTagAt(source, closeStart);
  if (!close || close.name !== "details" || !close.closing || close.end !== source.length)
    return null;
  const headSource = source.slice(0, closeStart);
  const head = parseDetailsHead(headSource);
  if (!head) return null;
  return {
    type: "html_details",
    open: normalizeLf(head.open),
    summaryGap: normalizeLf(head.summaryGap),
    summary: normalizeLf(head.summary),
    bodyGap: "",
    closeGap: normalizeLf(head.tail),
    close: normalizeLf(close.raw),
    separators: [],
    children: [],
  };
}

function htmlBlock(node: MdNode, value: string): MdNode {
  return {
    type: "html_block",
    value: normalizeLf(value),
    position: node.position,
  };
}

interface DetailsBuild {
  node: MdNode;
  endIndex: number;
  headerEnd: MdNode;
  closeNode: MdNode;
  bodySources: MdNode[];
}

/** 从根级 opener 开始配对。遇到嵌套 details 先完整消费嵌套，绝不跨层抢 close。 */
function buildDetailsAt(children: MdNode[], start: number): DetailsBuild | null {
  const first = children[start];
  const firstValue = first ? blockHtmlValue(first) : null;
  if (!first || firstValue == null) return null;
  const head = parseDetailsHead(firstValue);
  if (!head) return null;

  let headerEnd = first;
  let summary = head.summary;
  let summaryGap = head.summaryGap;
  let headerTail = head.tail;
  let bodyStart = start + 1;
  if (!summary) {
    const next = children[bodyStart];
    const nextValue = next ? blockHtmlValue(next) : null;
    const separate = nextValue == null ? null : parseSummaryOnly(nextValue);
    if (next && nextValue != null && separate) {
      summaryGap = head.tail + sourceGap(currentSource, first, next);
      summary = separate.summary;
      headerTail = separate.tail;
      headerEnd = next;
      bodyStart++;
    }
  }

  const body: MdNode[] = [];
  const bodySources: MdNode[] = [];
  let index = bodyStart;
  while (index < children.length) {
    const candidate = children[index];
    const value = blockHtmlValue(candidate);
    if (value != null && parseDetailsClose(value)) {
      const closeNode = candidate;
      const firstBody = bodySources[0];
      const lastBody = bodySources[bodySources.length - 1];
      const bodyGap = firstBody
        ? headerTail + sourceGap(currentSource, headerEnd, firstBody)
        : "";
      const closeGap = lastBody
        ? sourceGap(currentSource, lastBody, closeNode)
        : headerTail + sourceGap(currentSource, headerEnd, closeNode);
      const separators = bodySources.slice(0, -1).map((node, i) =>
        sourceGap(currentSource, node, bodySources[i + 1])
      );
      return {
        node: {
          type: "html_details",
          open: normalizeLf(head.open),
          summaryGap: normalizeLf(summaryGap),
          summary: normalizeLf(summary),
          bodyGap: normalizeLf(bodyGap),
          closeGap: normalizeLf(closeGap),
          close: normalizeLf(value),
          separators,
          children: body,
          position: { start: first.position?.start ?? {}, end: closeNode.position?.end ?? {} },
        },
        endIndex: index,
        headerEnd,
        closeNode,
        bodySources,
      };
    }
    if (value != null && parseDetailsHead(value)) {
      const nested = buildDetailsAt(children, index);
      if (nested) {
        body.push(nested.node);
        bodySources.push(nested.node);
        index = nested.endIndex + 1;
        continue;
      }
      // 有 opener 但无法配对的嵌套结构让外层也降级，避免把内层 close 错认成外层。
      return null;
    }
    if (value != null) {
      const empty = emptyDetails(value);
      body.push(empty ?? htmlBlock(candidate, value));
    } else {
      body.push(candidate);
    }
    bodySources.push(candidate);
    index++;
  }
  return null;
}

// buildDetailsAt 的递归只服务同一次 transform，source 在入口固定，避免每层重复传参。
let currentSource = "";

/**
 * CommonMark 会把无空行的连续 </details> 合并进一个 html-flow 节点。
 * 仅在整串全是闭标签时按 position 切开，标签间空白仍由 sourceGap 取原文。
 */
function splitDetailsClosers(children: MdNode[]): MdNode[] {
  return children.flatMap((node) => {
    const value = blockHtmlValue(node);
    const base = node.position?.start.offset;
    if (value == null || base == null || !value.startsWith("</")) return [node];
    const tags: HtmlTagToken[] = [];
    let cursor = 0;
    while (cursor < value.length) {
      const token = readTagAt(value, cursor);
      if (!token || token.name !== "details" || !token.closing) return [node];
      tags.push(token);
      cursor = token.end;
      if (cursor < value.length) {
        const next = value.slice(cursor).search(/\S/);
        if (next < 0) return [node];
        cursor += next;
      }
    }
    if (tags.length < 2 || tags[0].end == null || cursor !== value.length) return [node];
    return tags.map((tag, index) => {
      const start = index === 0 ? 0 : value.indexOf(tag.raw, tags[index - 1].end);
      const position: MdPosition = {
        start: { offset: base + start },
        end: { offset: base + tag.end },
      };
      return { type: "html", value: tag.raw, position };
    });
  });
}

function transformBlockSequence(children: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    const value = blockHtmlValue(node);
    if (value != null) {
      const built = buildDetailsAt(children, i);
      if (built) {
        out.push(built.node);
        i = built.endIndex;
        continue;
      }
      const empty = emptyDetails(value);
      out.push(empty ?? htmlBlock(node, value));
    } else {
      out.push(node);
    }
  }
  return out;
}

interface InlineSequenceResult {
  nodes: MdNode[];
  closingIndex: number | null;
  ok: boolean;
}

const MARKDOWN_PHRASING_BARRIERS = new Set([
  "strong",
  "emphasis",
  "delete",
  "link",
  "linkReference",
]);

/** 只在同一个 children 数组内配对，不跨 Markdown emphasis/link 等 phrasing 边界。 */
function parseInlineSequence(
  input: MdNode[],
  start: number,
  expectedClose?: string,
  depth = 0,
  insideMarkdown = false
): InlineSequenceResult {
  const out: MdNode[] = [];
  let i = start;
  while (i < input.length) {
    const node = input[i];
    if (node.type !== "html" || typeof node.value !== "string") {
      if (node.children)
        transformPhrasingNode(
          node,
          insideMarkdown || MARKDOWN_PHRASING_BARRIERS.has(node.type)
        );
      out.push(node);
      i++;
      continue;
    }
    const token = parseSingleTag(node.value);
    if (!token) {
      out.push(node);
      i++;
      continue;
    }
    if (expectedClose && token.closing && token.name === expectedClose) {
      return { nodes: out, closingIndex: i, ok: true };
    }
    if (token.closing) {
      out.push(node);
      i++;
      continue;
    }
    if (INLINE_ATOM_TAGS.has(token.name) && token.selfClosing) {
      out.push({
        type: "html_inline_atom",
        tag: token.name,
        value: normalizeLf(node.value),
      });
      i++;
      continue;
    }
    if (
      !INLINE_MARK_TAG_SET.has(token.name) ||
      token.selfClosing ||
      token.name === expectedClose ||
      depth >= HTML_INLINE_MAX_DEPTH
    ) {
      out.push(node);
      i++;
      continue;
    }
    const nested = parseInlineSequence(input, i + 1, token.name, depth + 1, insideMarkdown);
    if (!nested.ok || nested.closingIndex == null) {
      out.push(node);
      i++;
      continue;
    }
    const close = input[nested.closingIndex];
    out.push({
      type: "html_inline",
      tag: token.name,
      depth,
      markdown: insideMarkdown,
      open: normalizeLf(node.value),
      close: normalizeLf(close.value ?? `</${token.name}>`),
      children: nested.nodes,
    });
    i = nested.closingIndex + 1;
  }
  return { nodes: out, closingIndex: null, ok: expectedClose == null };
}

function transformPhrasingNode(node: MdNode, insideMarkdown = false) {
  if (!node.children || node.type === "html_block" || node.type === "html_inline_atom") return;
  if (node.type === "html_details") {
    node.children.forEach((child) => {
      if (child.type === "html_details") transformPhrasingNode(child);
      else transformPhrasingNode(child);
    });
    return;
  }
  const result = parseInlineSequence(node.children, 0, undefined, 0, insideMarkdown);
  node.children = result.ok ? result.nodes : node.children;
}

function transformHtmlTree(tree: MdNode, source: string) {
  currentSource = source;
  if (tree.children) tree.children = transformBlockSequence(splitDetailsClosers(tree.children));
  transformPhrasingNode(tree);
  currentSource = "";
}

const htmlRemarkAttacher = () => {
  const transform = (tree: MdNode, file: { value?: unknown }) => {
    const source = typeof file.value === "string" ? file.value : String(file.value ?? "");
    transformHtmlTree(tree, source);
  };
  return transform as unknown as (tree: import("mdast").Root) => void;
};

export const htmlRemark = $remark("oblet-html-fidelity", () => htmlRemarkAttacher);

/** 必须抢在上游 html 包裹和 <br> 空行清理之前，注册顺序不等于 transformer 顺序。 */
export const htmlRemarkPriority: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(InitReady);
  ctx.update(remarkPluginsCtx, (entries) => {
    const index = entries.findIndex((entry) => entry.plugin === htmlRemarkAttacher);
    if (index <= 0) return entries;
    const next = [...entries];
    const [entry] = next.splice(index, 1);
    next.unshift(entry);
    return next;
  });
};

// ---- ProseMirror schema 与 mdast stringify handlers ----

const stringAttr = (value: unknown) => (typeof value === "string" ? value : "");
const stringArrayAttr = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

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

function inlineElement(open: string, close: string, tag: string): HTMLElement | null {
  const fragment = sanitizeFragment(`${open}${close}`);
  prepareRenderedTree(fragment);
  const element = fragment.querySelector<HTMLElement>(tag);
  return element;
}

function inlineMarkDom(mark: PMMark): [string, Record<string, string>, 0] | ["span", Record<string, string>, 0] {
  const tag = stringAttr(mark.attrs.tag);
  const attrs: Record<string, string> = { class: "ob-html-inline" };
  const element = inlineElement(stringAttr(mark.attrs.open), stringAttr(mark.attrs.close), tag);
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

const allHtmlInlineMarkSchemas = [
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
  tr.addMark(
    range.from,
    range.to,
    mark.type.create({ tag, open, close })
  );
  view.dispatch(tr);
  return true;
}

// ---- NodeView 渲染岛与源码面板 ----

let activeSourceCancel: (() => void) | null = null;

export const htmlSourceEscGuard = $prose(
  () =>
    new Plugin({
      key: new PluginKey("oblet-html-source-esc-guard"),
      view() {
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "Escape" && activeSourceCancel) {
            event.stopImmediatePropagation();
            event.preventDefault();
            activeSourceCancel();
          }
        };
        window.addEventListener("keydown", onKey, true);
        return {
          destroy() {
            window.removeEventListener("keydown", onKey, true);
          },
        };
      },
    })
);

function hasOpenAttribute(open: string): boolean {
  const token = parseSingleTag(open);
  if (!token) return false;
  const body = token.raw.slice(1, -1).replace(/^details/i, "");
  return /(?:^|\s)open(?:\s*=|\s*$|\/\s*$)/i.test(body.trim());
}

function sourceButton(label = "源码"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ob-html-source-button";
  button.textContent = label;
  button.title = "查看 / 编辑 HTML 源码";
  return button;
}

function sourceArea(value: string, label: string): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.className = "ob-html-source-input";
  textarea.value = value;
  textarea.spellcheck = false;
  textarea.setAttribute("aria-label", label);
  return textarea;
}

function wireSourceArea(
  area: HTMLTextAreaElement,
  panel: HTMLElement,
  commit: () => boolean,
  cancel: () => void
) {
  area.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (commit()) area.focus();
    }
  });
  area.addEventListener("focusout", (event) => {
    const next = event.relatedTarget as globalThis.Node | null;
    if (next && panel.contains(next)) return;
    commit();
  });
  area.addEventListener("input", () => area.removeAttribute("aria-invalid"));
}

export const htmlBlockView = $view(htmlBlockSchema.node, () => {
  return (initialNode, view, getPos): NodeView => {
    let node = initialNode;
    const dom = document.createElement("div");
    dom.className = "ob-html-node ob-html-block";
    dom.contentEditable = "false";
    const toolbar = document.createElement("div");
    toolbar.className = "ob-html-toolbar";
    const button = sourceButton();
    toolbar.appendChild(button);
    const render = document.createElement("div");
    render.className = "ob-html-render";
    const panel = document.createElement("div");
    panel.className = "ob-html-source";
    panel.hidden = true;
    const area = sourceArea(stringAttr(node.attrs.value), "HTML 块源码");
    panel.appendChild(area);
    dom.append(toolbar, render, panel);
    let panelOpen = false;

    const close = () => {
      panelOpen = false;
      panel.hidden = true;
      area.value = stringAttr(node.attrs.value);
      area.removeAttribute("aria-invalid");
      if (activeSourceCancel === close) activeSourceCancel = null;
    };
    const commit = (): boolean => {
      if (!panelOpen) return false;
      const pos = typeof getPos === "function" ? getPos() : undefined;
      const value = area.value;
      if (pos == null || value === stringAttr(node.attrs.value)) {
        close();
        return true;
      }
      if (!updateHtmlBlockSource(view, pos, value)) {
        area.setAttribute("aria-invalid", "true");
        return false;
      }
      close();
      return true;
    };
    const open = () => {
      if (!view.editable) return;
      activeSourceCancel?.();
      panelOpen = true;
      panel.hidden = false;
      area.value = stringAttr(node.attrs.value);
      activeSourceCancel = close;
      area.focus();
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (panelOpen) commit();
      else open();
    });
    wireSourceArea(area, panel, commit, close);
    renderHtmlInto(render, stringAttr(node.attrs.value));
    dom.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const a = target.closest<HTMLAnchorElement>("a[data-ob-html-link]");
      if (!a || !render.contains(a)) return;
      event.preventDefault();
      event.stopPropagation();
      openRenderedLink(a);
    });

    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        const changed = next.attrs.value !== node.attrs.value;
        node = next;
        if (changed) {
          close();
          renderHtmlInto(render, stringAttr(node.attrs.value));
        }
        return true;
      },
      stopEvent: (event) => event.target instanceof globalThis.Node && dom.contains(event.target),
      ignoreMutation: () => true,
      selectNode: () => dom.classList.add("selected"),
      deselectNode: () => dom.classList.remove("selected"),
      destroy() {
        if (activeSourceCancel === close) activeSourceCancel = null;
        dom.remove();
      },
    };
  };
});

export const htmlInlineAtomView = $view(htmlInlineAtomSchema.node, () => {
  return (initialNode, view, getPos): NodeView => {
    let node = initialNode;
    const dom = document.createElement("span");
    dom.className = "ob-html-node ob-html-inline-atom";
    dom.contentEditable = "false";
    const render = document.createElement("span");
    render.className = "ob-html-render ob-html-inline-render";
    dom.appendChild(render);
    renderHtmlInto(render, stringAttr(node.attrs.value));
    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        const changed = next.attrs.value !== node.attrs.value;
        node = next;
        if (changed) renderHtmlInto(render, stringAttr(node.attrs.value));
        return true;
      },
      stopEvent: (event) => event.target instanceof globalThis.Node && dom.contains(event.target),
      ignoreMutation: () => true,
      selectNode: () => dom.classList.add("selected"),
      deselectNode: () => dom.classList.remove("selected"),
      destroy: () => dom.remove(),
    };
  };
});

export const htmlDetailsView = $view(htmlDetailsSchema.node, () => {
  return (initialNode, view, getPos): NodeView => {
    let node = initialNode;
    const dom = document.createElement("div");
    dom.className = "ob-html-node ob-html-details";
    const toolbar = document.createElement("div");
    toolbar.className = "ob-html-toolbar";
    const button = sourceButton();
    toolbar.appendChild(button);
    const details = document.createElement("details");
    details.className = "ob-html-details-native";
    details.open = hasOpenAttribute(stringAttr(node.attrs.open));
    const summary = document.createElement("summary");
    summary.className = "ob-html-summary ob-html-render";
    const contentDOM = document.createElement("div");
    contentDOM.className = "ob-html-details-content";
    details.append(summary, contentDOM);
    const panel = document.createElement("div");
    panel.className = "ob-html-source ob-html-details-source";
    panel.hidden = true;
    const openArea = sourceArea(stringAttr(node.attrs.open), "details 开标签");
    const summaryArea = sourceArea(stringAttr(node.attrs.summary), "summary 源码");
    const closeArea = sourceArea(stringAttr(node.attrs.close), "details 闭标签");
    panel.append(openArea, summaryArea, closeArea);
    dom.append(toolbar, details, panel);
    let panelOpen = false;

    const renderSummary = () => {
      if (!stringAttr(node.attrs.summary)) {
        summary.textContent = "详情";
        return;
      }
      renderHtmlInto(summary, stringAttr(node.attrs.summary));
    };
    const syncAreas = () => {
      openArea.value = stringAttr(node.attrs.open);
      summaryArea.value = stringAttr(node.attrs.summary);
      closeArea.value = stringAttr(node.attrs.close);
      for (const area of [openArea, summaryArea, closeArea]) area.removeAttribute("aria-invalid");
    };
    const close = () => {
      panelOpen = false;
      panel.hidden = true;
      syncAreas();
      if (activeSourceCancel === close) activeSourceCancel = null;
    };
    const commit = (): boolean => {
      if (!panelOpen) return false;
      const pos = typeof getPos === "function" ? getPos() : undefined;
      const next = {
        open: openArea.value,
        summary: summaryArea.value,
        close: closeArea.value,
      };
      if (
        pos == null ||
        (next.open === node.attrs.open &&
          next.summary === node.attrs.summary &&
          next.close === node.attrs.close)
      ) {
        close();
        return true;
      }
      if (!updateHtmlDetailsSource(view, pos, next)) {
        for (const area of [openArea, summaryArea, closeArea]) area.setAttribute("aria-invalid", "true");
        return false;
      }
      close();
      return true;
    };
    const open = () => {
      if (!view.editable) return;
      activeSourceCancel?.();
      panelOpen = true;
      panel.hidden = false;
      syncAreas();
      activeSourceCancel = close;
      openArea.focus();
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (panelOpen) commit();
      else open();
    });
    for (const area of [openArea, summaryArea, closeArea]) wireSourceArea(area, panel, commit, close);
    renderSummary();
    dom.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const a = target.closest<HTMLAnchorElement>("a[data-ob-html-link]");
      if (!a || !summary.contains(a)) return;
      event.preventDefault();
      event.stopPropagation();
      openRenderedLink(a);
    });

    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== node.type) return false;
        const openChanged = next.attrs.open !== node.attrs.open;
        const summaryChanged = next.attrs.summary !== node.attrs.summary;
        const closeChanged = next.attrs.close !== node.attrs.close;
        node = next;
        if (openChanged) details.open = hasOpenAttribute(stringAttr(node.attrs.open));
        if (summaryChanged) renderSummary();
        if (openChanged || summaryChanged || closeChanged) close();
        return true;
      },
      stopEvent: (event) => {
        if (!(event.target instanceof globalThis.Node)) return false;
        return !contentDOM.contains(event.target);
      },
      ignoreMutation: (mutation) => !contentDOM.contains(mutation.target),
      destroy() {
        if (activeSourceCancel === close) activeSourceCancel = null;
        dom.remove();
      },
    };
  };
});

/** 正文 inline mark 仅在 Ctrl/Cmd+click 时导航，普通点击保留编辑光标行为。 */
export const htmlInteractionPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("oblet-html-interactions"),
      view(editorView) {
        const onClick = (event: MouseEvent) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const a = target.closest<HTMLAnchorElement>("a.ob-html-inline[data-ob-html-link]");
          if (!a || !editorView.dom.contains(a)) return;
          // 即使无修饰键也阻止浏览器默认导航，但不阻止 PM 的编辑事件链。
          event.preventDefault();
          if (!event.ctrlKey && !event.metaKey) return;
          event.stopPropagation();
          openRenderedLink(a);
        };
        editorView.dom.addEventListener("click", onClick, true);
        return {
          destroy() {
            editorView.dom.removeEventListener("click", onClick, true);
          },
        };
      },
    })
);

/** 主协调者在 Crepe addFeature 中一次性注册；必须在 commonmark/Crepe 特性之后。 */
export const htmlPlugins: MilkdownPlugin[] = [
  htmlBlockSchema.ctx,
  htmlBlockSchema.node,
  htmlDetailsSchema.ctx,
  htmlDetailsSchema.node,
  htmlInlineAtomSchema.ctx,
  htmlInlineAtomSchema.node,
  ...allHtmlInlineMarkSchemas.flatMap(({ schema }) => [schema.ctx, schema.mark]),
  htmlBlockView,
  htmlDetailsView,
  htmlInlineAtomView,
  htmlRemark.options,
  htmlRemark.plugin,
  htmlRemarkPriority,
  htmlSourceEscGuard,
  htmlInteractionPlugin,
];

export const htmlPlugin = htmlPlugins;
