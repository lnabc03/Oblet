// 冒烟验证：Crepe + featureConfigs.languages 传入后，codeBlockConfig 里的语言列表是否非空
// 用法：node scripts/verify-languages.mjs
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  "<!DOCTYPE html><html><body><div id='app'></div></body></html>",
  { pretendToBeVisual: true, url: "http://localhost/" }
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
// jsdom 构造器批量补全局（Vue/PM 运行时按名字取）
for (const k of [
  "SVGElement", "Element", "DocumentFragment", "Text", "Comment", "Range",
  "MutationObserver", "DOMRect", "FileReader", "Blob", "File", "DataTransfer",
  "TouchEvent", "PointerEvent", "InputEvent", "ClipboardEvent", "DragEvent",
  "CompositionEvent", "FocusEvent", "WheelEvent", "UIEvent", "Event",
  "XMLSerializer", "XPathResult", "DocumentType", "ProcessingInstruction",
]) {
  if (dom.window[k] && !globalThis[k]) globalThis[k] = dom.window[k];
}
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) {
    setTimeout(() => this.cb([{ target: el, contentRect: el.getBoundingClientRect() }], this), 0);
  }
  unobserve() {}
  disconnect() {}
};
// 代码块 NodeView 懒初始化：进入视口才挂 CM/Vue——polyfill 立即回调 intersecting
globalThis.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) {
    setTimeout(() => this.cb([{ isIntersecting: true, target: el }], this), 0);
  }
  unobserve() {}
  disconnect() {}
};
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
globalThis.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);

const { Crepe } = await import("@milkdown/crepe");
const { codeBlockConfig } = await import(
  "@milkdown/kit/component/code-block"
);
const { languages } = await import("@codemirror/language-data");

console.log("language-data 预设条数:", languages.length);

const crepe = new Crepe({
  root: document.getElementById("app"),
  defaultValue: "```js\nlet a = 1\n```\n",
  features: {
    [Crepe.Feature.AI]: false,
    [Crepe.Feature.TopBar]: false,
    [Crepe.Feature.Placeholder]: false,
  },
  featureConfigs: {
    [Crepe.Feature.CodeMirror]: {
      previewOnlyByDefault: true,
      languages,
    },
  },
});

await crepe.create();

const cfg = crepe.editor.ctx.get(codeBlockConfig.key);
console.log("codeBlockConfig.languages 条数:", cfg.languages.length);
console.log("首项:", cfg.languages[0]?.name, "| 末项:", cfg.languages.at(-1)?.name);

// 语言选择器的 LanguageLoader 视角：getAll() 需要的字段
const probe = cfg.languages[0];
console.log(
  "字段探测: name=%s alias=%j load=%s",
  probe?.name,
  probe?.alias,
  typeof probe?.load
);

console.log(
  cfg.languages.length > 0 ? "PASS: 语言列表已注入" : "FAIL: 语言列表为空"
);

// ---- 交互层：点击语言按钮，看浮层与列表项是否出现 ----
await new Promise((r) => setTimeout(r, 100)); // 等 NodeView/Vue 挂载
const btn = document.querySelector(".language-button");
console.log("语言按钮存在:", !!btn, "| 文案:", btn?.textContent?.trim());
if (btn) {
  btn.dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  await new Promise((r) => setTimeout(r, 100));
  const wrapper = document.querySelector(".list-wrapper");
  const items = document.querySelectorAll(".language-list-item");
  console.log("点击后浮层出现:", !!wrapper);
  console.log("列表项条数:", items.length);
  console.log(
    "前三项:",
    [...items].slice(0, 3).map((li) => li.textContent)
  );
  if (!wrapper || items.length === 0) {
    console.log("FAIL: 浮层未弹出或列表为空");
    process.exit(1);
  }
  console.log("PASS: 浮层弹出且列表非空");
}

process.exit(cfg.languages.length > 0 ? 0 : 1);
