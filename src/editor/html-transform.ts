// mdast 保真转换：把 CommonMark 的 html 节点重组为可编辑模型。
// 纯树变换，不依赖 DOM/ProseMirror；原文切片只来自显式传入的 source。
import {
  HTML_INLINE_MAX_DEPTH,
  INLINE_ATOM_TAGS,
  INLINE_MARK_TAG_SET,
  parseSingleTag,
  readTagAt,
} from "./html-lexer";

interface MdPosition {
  start: { offset?: number };
  end: { offset?: number };
}

export interface MdNode {
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

export function parseSummaryOnly(source: string): { summary: string; tail: string } | null {
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
function buildDetailsAt(
  children: MdNode[],
  start: number,
  source: string
): DetailsBuild | null {
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
      summaryGap = head.tail + sourceGap(source, first, next);
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
      const bodyGap = firstBody ? headerTail + sourceGap(source, headerEnd, firstBody) : "";
      const closeGap = lastBody
        ? sourceGap(source, lastBody, closeNode)
        : headerTail + sourceGap(source, headerEnd, closeNode);
      const separators = bodySources
        .slice(0, -1)
        .map((node, i) => sourceGap(source, node, bodySources[i + 1]));
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
      const nested = buildDetailsAt(children, index, source);
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

/**
 * CommonMark 会把无空行的连续 </details> 合并进一个 html-flow 节点。
 * 仅在整串全是闭标签时按 position 切开，标签间空白仍由 sourceGap 取原文。
 */
function splitDetailsClosers(children: MdNode[]): MdNode[] {
  return children.flatMap((node) => {
    const value = blockHtmlValue(node);
    const base = node.position?.start.offset;
    if (value == null || base == null || !value.startsWith("</")) return [node];
    const tags: Array<{ raw: string; end: number }> = [];
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
    if (tags.length < 2 || cursor !== value.length) return [node];
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

function transformBlockSequence(children: MdNode[], source: string): MdNode[] {
  const out: MdNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    const value = blockHtmlValue(node);
    if (value != null) {
      const built = buildDetailsAt(children, i, source);
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
    node.children.forEach((child) => transformPhrasingNode(child));
    return;
  }
  const result = parseInlineSequence(node.children, 0, undefined, 0, insideMarkdown);
  node.children = result.ok ? result.nodes : node.children;
}

/** remark 入口：做块级 details 配对，再在段落等 phrasing 容器内配对行内标签。 */
export function transformHtmlTree(tree: MdNode, source: string) {
  if (tree.children) tree.children = transformBlockSequence(splitDetailsClosers(tree.children), source);
  transformPhrasingNode(tree);
}
