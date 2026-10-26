// TXT 纯文本组件自测。用法：node scripts/test-plaintext.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});

for (const key of [
  "Node", "Element", "HTMLElement", "SVGElement", "Text", "Comment",
  "DocumentFragment", "Range", "DOMRect", "MutationObserver", "Event",
  "CustomEvent", "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent",
  "CompositionEvent", "ClipboardEvent", "DragEvent", "WheelEvent", "UIEvent",
]) {
  if (dom.window[key]) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  }
}

globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub;
dom.window.ResizeObserver = ResizeObserverStub;

// jsdom 没有布局引擎，补 CM 测量路径需要的 Range 几何接口。
const emptyRect = () => new dom.window.DOMRect(0, 0, 0, 0);
dom.window.Range.prototype.getBoundingClientRect = emptyRect;
dom.window.Range.prototype.getClientRects = function () {
  const rects = [emptyRect()];
  rects.item = (index) => rects[index] ?? null;
  return rects;
};
if (!dom.window.HTMLElement.prototype.scrollIntoView) {
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
}

// 通过项目现有 Vite 加载真实 TS；CM 依赖走 Node ESM，保持模块实例一致。
const { createServer } = await import("vite");
const vite = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true },
});
const { createPlainTextEditor } = await vite.ssrLoadModule("/src/editor/plaintext.ts");

const { EditorView } = await import("@codemirror/view");
const { undo, redo } = await import("@codemirror/commands");

const activeEditors = [];
const tests = [];
const test = (name, run) => tests.push({ name, run });

function mount(content = "", options = {}) {
  const host = document.createElement("div");
  let outerScroller = null;
  if (options.externalScroller) {
    outerScroller = document.createElement("div");
    outerScroller.className = "markdown-rendered";
    outerScroller.append(host);
    document.body.append(outerScroller);
  } else {
    document.body.append(host);
  }

  const editor = createPlainTextEditor(
    host,
    content,
    options.readonly ?? false,
    options.onUserEdit,
  );
  activeEditors.push(editor);
  const view = EditorView.findFromDOM(editor.dom);
  assert.ok(view, "应能从返回的 dom 找到真实 EditorView");
  return { editor, host, view, outerScroller };
}

function searchBar() {
  return document.querySelector(".search-bar:not(.hidden)");
}

test("API、软换行与纯文本原文保真", () => {
  const original = "  # 标题不是节点\t<b>原文</b>  \n\n- 列表仍是文本\t \n汉字🙂   \n\n";
  const { editor, host, view } = mount(original);

  for (const method of [
    "getContent", "replaceContent", "insertText", "setReadonly", "getSelection",
    "restoreSelection", "selectAll", "focus", "openSearch", "closeSearch",
    "isSearchOpen", "destroy",
  ]) assert.equal(typeof editor[method], "function", `${method} 应为函数`);

  assert.equal(editor.getContent(), original);
  assert.equal(editor.dom.parentElement, host);
  assert.ok(host.classList.contains("ob-plaintext-host"));
  assert.ok(view.contentDOM.classList.contains("cm-lineWrapping"));
  assert.equal(view.contentDOM.getAttribute("aria-label"), "TXT 纯文本编辑器");
  assert.equal(view.contentDOM.getAttribute("inputmode"), "text");
  assert.equal(view.state.readOnly, false);
  assert.equal(view.contentDOM.getAttribute("contenteditable"), "true");
});

test("replaceContent 无回调，真实文档事务才标脏", () => {
  let edits = 0;
  const { editor, view } = mount("alpha\n", { onUserEdit: () => edits++ });
  const replacement = "\t# raw  \n\n连续空行\n\n";

  editor.replaceContent(replacement);
  assert.equal(editor.getContent(), replacement);
  assert.equal(edits, 0);

  view.dispatch({ changes: { from: 0, insert: "用户🙂" }, userEvent: "input" });
  assert.equal(editor.getContent(), `用户🙂${replacement}`);
  assert.equal(edits, 1);

  view.dispatch({ selection: { anchor: 2 } });
  editor.openSearch();
  assert.equal(edits, 1, "选区和搜索不得触发编辑回调");
});

test("撤销重做可用，程序化替换重置旧历史", () => {
  let edits = 0;
  const { editor, view } = mount("old", { onUserEdit: () => edits++ });
  editor.replaceContent("base");
  view.dispatch({ changes: { from: 4, insert: "!" }, userEvent: "input" });
  assert.equal(editor.getContent(), "base!");
  assert.equal(edits, 1);

  assert.equal(undo(view), true);
  assert.equal(editor.getContent(), "base");
  assert.equal(edits, 2);
  assert.equal(redo(view), true);
  assert.equal(editor.getContent(), "base!");
  assert.equal(edits, 3);

  editor.replaceContent("external\t\n");
  const afterReplace = edits;
  assert.equal(undo(view), false);
  assert.equal(redo(view), false);
  assert.equal(editor.getContent(), "external\t\n");
  assert.equal(edits, afterReplace);
});

test("只读禁 DOM 编辑与事务变更，程序化重载仍可用", () => {
  let edits = 0;
  const { editor, view } = mount("encoded readonly", {
    readonly: true,
    onUserEdit: () => edits++,
  });

  assert.equal(view.state.readOnly, true);
  assert.equal(view.contentDOM.getAttribute("contenteditable"), "false");
  assert.equal(view.contentDOM.getAttribute("aria-readonly"), "true");

  view.dispatch({ changes: { from: 0, insert: "禁止" }, userEvent: "input" });
  assert.equal(editor.getContent(), "encoded readonly");
  assert.equal(edits, 0);

  editor.openSearch();
  assert.ok(searchBar(), "只读仍允许搜索");
  assert.equal(searchBar().querySelector(".replace-one").disabled, true);
  assert.equal(edits, 0);

  editor.replaceContent("fresh\t\n");
  assert.equal(editor.getContent(), "fresh\t\n");
  assert.equal(view.state.readOnly, true);
  assert.equal(view.contentDOM.getAttribute("contenteditable"), "false");
  assert.equal(edits, 0);

  editor.setReadonly(false);
  assert.equal(view.state.readOnly, false);
  assert.equal(view.contentDOM.getAttribute("contenteditable"), "true");
  view.dispatch({ changes: { from: 0, insert: "可写" }, userEvent: "input" });
  assert.equal(editor.getContent(), "可写fresh\t\n");
  assert.equal(edits, 1);

  editor.setReadonly(true);
  view.dispatch({ changes: { from: 0, insert: "再次禁止" }, userEvent: "input" });
  assert.equal(editor.getContent(), "可写fresh\t\n");
  assert.equal(edits, 1);
});

test("选区、部分恢复、偏移钳制与独立滚动", () => {
  let edits = 0;
  const { editor, view } = mount("0123456789", { onUserEdit: () => edits++ });

  editor.restoreSelection({ from: 2, to: 7, scrollTop: 91 });
  assert.deepEqual(editor.getSelection(), { from: 2, to: 7, scrollTop: 91 });
  assert.equal(view.scrollDOM.scrollTop, 91);

  editor.restoreSelection({ from: 4 });
  assert.deepEqual(editor.getSelection(), { from: 4, to: 4, scrollTop: 91 });

  editor.restoreSelection({ from: -9, to: 500, scrollTop: -3 });
  assert.deepEqual(editor.getSelection(), { from: 0, to: 10, scrollTop: 0 });

  editor.restoreSelection({ scrollTop: 22 });
  assert.deepEqual(editor.getSelection(), { from: 0, to: 10, scrollTop: 22 });
  assert.equal(edits, 0);
});

test("markdown-rendered 宿主接管滚动，重载保留位置", () => {
  const { editor, view, outerScroller } = mount("abc\ndef", { externalScroller: true });
  assert.ok(outerScroller);

  editor.restoreSelection({ from: 1, to: 4, scrollTop: 143 });
  assert.equal(outerScroller.scrollTop, 143);
  assert.equal(view.scrollDOM.scrollTop, 0);
  assert.deepEqual(editor.getSelection(), { from: 1, to: 4, scrollTop: 143 });

  editor.replaceContent("abc\ndef\nnew");
  assert.deepEqual(editor.getSelection(), { from: 1, to: 4, scrollTop: 143 });
});

test("openSearch 复用 Markdown 自绘检索浮条，查询/跳转/替换一致", () => {
  let edits = 0;
  const { editor, view } = mount("find me\nfind me again", {
    onUserEdit: () => edits++,
  });

  assert.equal(editor.openSearch(), undefined);
  assert.equal(editor.isSearchOpen(), true);
  assert.ok(searchBar());
  assert.ok(document.querySelector(".search-row .search-query"));
  assert.ok(document.querySelector(".search-row .search-count"));
  editor.openSearch();
  assert.equal(document.querySelectorAll(".search-bar").length, 1);

  const query = searchBar().querySelector(".search-query");
  query.value = "find me";
  query.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(view.dom.querySelectorAll(".ob-search-match").length, 2);
  assert.equal(searchBar().querySelector(".search-count").textContent, "1/2");

  searchBar().querySelector(".search-next").click();
  assert.deepEqual(editor.getSelection(), { from: 8, to: 15, scrollTop: 0 });
  assert.equal(searchBar().querySelector(".search-count").textContent, "2/2");

  const replace = searchBar().querySelector(".search-replace");
  replace.value = "found";
  searchBar().querySelector(".replace-one").click();
  assert.equal(editor.getContent(), "find me\nfound again");
  assert.equal(edits, 1, "替换是真实编辑");
  searchBar().querySelector(".replace-all").click();
  assert.equal(editor.getContent(), "found\nfound again");
  assert.equal(edits, 2);

  query.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  }));
  assert.equal(editor.isSearchOpen(), false);
  assert.equal(searchBar(), null);
  assert.equal(document.activeElement, view.contentDOM);
});

test("菜单插入、全选与关闭搜索", () => {
  let edits = 0;
  const { editor } = mount("abcdef", { onUserEdit: () => edits++ });

  editor.restoreSelection({ from: 2, to: 4 });
  editor.insertText("X\t");
  assert.equal(editor.getContent(), "abX\tef");
  assert.equal(edits, 1);
  assert.deepEqual(editor.getSelection(), { from: 4, to: 4, scrollTop: 0 });

  editor.selectAll();
  assert.deepEqual(editor.getSelection(), {
    from: 0,
    to: editor.getContent().length,
    scrollTop: 0,
  });
  assert.equal(edits, 1);

  editor.insertText("替换\n");
  assert.equal(editor.getContent(), "替换\n");
  assert.equal(edits, 2);

  editor.openSearch();
  assert.ok(searchBar());
  assert.equal(editor.closeSearch(), undefined);
  assert.equal(searchBar(), null);

  editor.setReadonly(true);
  editor.insertText("禁止");
  assert.equal(editor.getContent(), "替换\n");
  assert.equal(edits, 2);
  editor.selectAll();
  assert.equal(editor.getSelection().to, editor.getContent().length);
});

test("focus 可调用，destroy 清理且幂等", () => {
  let edits = 0;
  const { editor, host, view } = mount("done", { onUserEdit: () => edits++ });
  editor.focus();
  assert.equal(document.activeElement, view.contentDOM);

  const root = editor.dom;
  editor.destroy();
  assert.equal(root.isConnected, false);
  assert.equal(host.classList.contains("ob-plaintext-host"), false);
  assert.equal(editor.getContent(), "done");

  assert.doesNotThrow(() => {
    editor.destroy();
    editor.focus();
    editor.openSearch();
    editor.closeSearch();
    editor.restoreSelection({ from: 2, scrollTop: 10 });
    editor.replaceContent("ignored");
    editor.setReadonly(true);
  });
  assert.equal(editor.getContent(), "done");
  assert.equal(edits, 0);
});

test("样式覆盖主题变量、外部滚动与打印空白", () => {
  const css = readFileSync(new URL("../src/styles/plaintext.css", import.meta.url), "utf8");
  for (const token of [
    "var(--ob-text)", "var(--ob-selection)",
    "var(--ob-accent)", "var(--ob-bg)", "var(--ob-hover)", ".cm-activeLine",
    "color-mix(in srgb, var(--ob-accent) 26%, var(--ob-bg))",
    "body.anp-current-line .ob-plaintext-editor .cm-activeLine",
    ".cm-selectionLayer .cm-selectionBackground",
    ".ob-plaintext-host .ob-plaintext-editor.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground",
    ".markdown-rendered .ob-plaintext-host",
    "@media print", "white-space: break-spaces", "overflow: visible !important",
  ]) assert.ok(css.includes(token), `plaintext.css 缺少 ${token}`);
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}`);
    console.error(error?.stack ?? error);
  } finally {
    for (const editor of activeEditors.splice(0)) editor.destroy();
    document.body.replaceChildren();
  }
}

console.log(`\n${tests.length - failures}/${tests.length} 项通过`);
await vite.close();
dom.window.close();
process.exit(failures ? 1 : 0);
