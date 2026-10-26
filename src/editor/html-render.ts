// HTML 只读渲染岛：清洗、URL 改写与链接路由。
// 这里不感知 Milkdown/ProseMirror，只负责把“原文 HTML”变成可安全展示的 DOM。
import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { resolveLocalAbs } from "./image-paths";
import {
  ALLOWED_ATTR,
  ALLOWED_TAG_SET,
  ALLOWED_TAGS,
  classifyImageSource,
  classifyLink,
  readTagAt,
} from "./html-lexer";

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

/** 允许标签集合之外的容器、注释或未闭合标签一律降级为源码。 */
export function hasUnsupportedMarkup(source: string): boolean {
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
export function renderHtmlInto(container: HTMLElement, source: string) {
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

/** 行内 mark 只需要一个元素的属性投影，不渲染整段源码。 */
export function renderInlineElement(
  open: string,
  close: string,
  tag: string
): HTMLElement | null {
  const fragment = sanitizeFragment(`${open}${close}`);
  prepareRenderedTree(fragment);
  return fragment.querySelector<HTMLElement>(tag);
}

export function openRenderedLink(a: HTMLAnchorElement) {
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
