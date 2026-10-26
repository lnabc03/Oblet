// HTML 词法与安全策略：不碰 DOM，只回答“这是什么标签 / 这个 URL 能不能放行”。
// 独立成模块，便于直接单测边界；渲染和 Milkdown schema 层只消费这里的结果。
import { ABS_PATH_RE } from "./image-paths";

export const INLINE_MARK_TAGS = [
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
export const INLINE_MARK_TAG_SET = new Set<string>(INLINE_MARK_TAGS);
export const INLINE_ATOM_TAGS = new Set(["img", "br", "wbr"]);
export const HTML_INLINE_MAX_DEPTH = 4;
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

export const ALLOWED_TAGS = [
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

export const ALLOWED_ATTR = [
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
export const ALLOWED_ATTR_SET = new Set(ALLOWED_ATTR);
export const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS);

export interface HtmlTagToken {
  raw: string;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  end: number;
}

/** 只读标签边界，不构建 DOM，也不修补未闭合引号或标签。 */
export function readTagAt(source: string, start: number): HtmlTagToken | null {
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

export function parseSingleTag(source: string): HtmlTagToken | null {
  const token = readTagAt(source, 0);
  return token && token.end === source.length ? token : null;
}

/** 控制字符和空白不能用来混淆协议判定。 */
export function compactUrlForCheck(raw: string): string {
  return raw.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
}

export type HtmlLinkTarget =
  | { kind: "external"; url: string }
  | { kind: "path"; path: string };

export function classifyLink(raw: string): HtmlLinkTarget | null {
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

export function classifyImageSource(raw: string): string | null {
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
