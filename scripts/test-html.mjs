// v0.9.0 HTML 插件真实 Milkdown Editor 回归：PM parse/serialize、NodeView、源码事务与 XSS。
// 运行：node scripts/test-html.mjs
// 可用 OBLET_README_CN 指定真实 README_CN.md；缺省寻找同目录项目的 ../ppt-master/README_CN.md。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const { window } = dom;
for (const key of ["window", "document", "navigator"]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
for (const key of [
  "Node",
  "Element",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLImageElement",
  "HTMLTextAreaElement",
  "DocumentFragment",
  "DOMParser",
  "MutationObserver",
  "KeyboardEvent",
  "MouseEvent",
  "Event",
  "CustomEvent",
  "getComputedStyle",
]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) {
    Object.defineProperty(globalThis, key, {
      value: window[key],
      configurable: true,
      writable: true,
    });
  }
}
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.removeEventListener = window.removeEventListener.bind(window);
globalThis.dispatchEvent = window.dispatchEvent.bind(window);
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
globalThis.ResizeObserver ??= ObserverStub;
globalThis.IntersectionObserver ??= ObserverStub;
if (window.Range && !window.Range.prototype.getBoundingClientRect) {
  window.Range.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    toJSON: () => ({}),
  });
  window.Range.prototype.getClientRects = () => [];
}

const vite = await createServer({
  root: process.cwd(),
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

let html;
let frontmatter;
let Editor;
let defaultValueCtx;
let rootCtx;
let editorViewCtx;
let serializerCtx;
let commonmark;
let gfm;
let replaceAll;
try {
  html = await vite.ssrLoadModule("/src/editor/html.ts");
  frontmatter = await vite.ssrLoadModule("/src/editor/frontmatter.ts");
  ({ Editor, defaultValueCtx, rootCtx, editorViewCtx, serializerCtx } = await import("@milkdown/core"));
  ({ commonmark } = await import("@milkdown/preset-commonmark"));
  ({ gfm } = await import("@milkdown/preset-gfm"));
  ({ replaceAll } = await import("@milkdown/utils"));
} catch (error) {
  await vite.close();
  throw error;
}

const openedUrls = [];
const openedPaths = [];
const convertedSources = [];
html.configureHtmlRuntime({
  docPath: () => "D:/notes/README_CN.md",
  toDomUrl: (src) => {
    convertedSources.push(src);
    return `asset:${src}`;
  },
  openUrl: (url) => { openedUrls.push(url); },
  openPath: (path) => { openedPaths.push(path); },
});

async function createEditor(markdown) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = Editor.make()
    .use(commonmark)
    .use(gfm)
    .use(html.htmlPlugins)
    .config(frontmatter.tuneSerialization)
    .config(html.configureHtml)
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, markdown);
    });
  await editor.create();
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  const getMarkdown = () => editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc));
  const findNode = (type) => {
    let found = null;
    view.state.doc.descendants((node, pos) => {
      if (!found && node.type.name === type) found = { node, pos };
      return !found;
    });
    return found;
  };
  const findText = (text) => {
    let found = null;
    view.state.doc.descendants((node, pos) => {
      if (found || !node.isText) return true;
      const offset = node.text.indexOf(text);
      if (offset >= 0) found = { node, pos: pos + offset };
      return !found;
    });
    return found;
  };
  return { editor, view, host, getMarkdown, findNode, findText };
}

async function withEditor(markdown, run) {
  const context = await createEditor(markdown);
  try {
    await run(context);
  } finally {
    await context.editor.destroy();
    context.host.remove();
  }
}

function firstDifference(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) return `L${i + 1}\n  原: ${JSON.stringify(a[i] ?? "<缺失>")}\n  新: ${JSON.stringify(b[i] ?? "<缺失>")}`;
  }
  return "无差异";
}

function click(element, options = {}) {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, ...options });
  element.dispatchEvent(event);
  return event;
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("根级 p/table/hr 原文与只读投影", async () => {
  const input = `<p align="center">\n  <a href="https://example.com" target="_blank"><img src="docs/a.png" alt="A" width="100"></a>\n</p>\n\n<hr>\n\n<table>\n<tr><td>A</td></tr>\n</table>\n`;
  await withEditor(input, async ({ host, getMarkdown, editor }) => {
    assert.equal(getMarkdown(), input, firstDifference(input, getMarkdown()));
    assert.equal(host.querySelectorAll(".ob-html-block").length, 3);
    assert.equal(host.querySelector("p").getAttribute("align"), "center");
    assert.equal(host.querySelector("a").hasAttribute("target"), false);
    assert.equal(host.querySelector("img").getAttribute("src"), "asset:docs/a.png");
    assert.ok(host.querySelector("table"));
    assert.ok(host.querySelector("hr"));
    assert.equal(host.querySelector("table").closest(".ob-html-block").contentEditable, "false");
    await editor.action(replaceAll(getMarkdown()));
    assert.equal(getMarkdown(), input);
  });
});

test("同段多个 inline mark/atom 与正文可编辑", async () => {
  const input = `前 <a href="https://example.com">链 <strong>接</strong></a> 与 <kbd>Ctrl</kbd>、<em>斜</em> <strong>粗</strong><sub>2</sub> <img src="assets/a.png" alt="x"> 尾<br>。\n`;
  await withEditor(input, async ({ host, getMarkdown, view }) => {
    assert.equal(getMarkdown(), input, firstDifference(input, getMarkdown()));
    assert.ok(host.querySelector("a.ob-html-inline"));
    assert.ok(host.querySelector("strong.ob-html-inline"));
    assert.ok(host.querySelector("kbd.ob-html-inline"));
    assert.equal(host.querySelectorAll(".ob-html-inline-atom").length, 2);
    assert.ok(view.state.schema.marks.html_inline_a);
    assert.ok(view.state.schema.marks.html_inline_strong);
    assert.equal(host.querySelector("a").hasAttribute("target"), false);
  });
});

test("反向嵌套 inline mark 不退化为源码", async () => {
  const input = `<strong><em>x</em></strong> / <em><strong>y</strong></em>\n`;
  await withEditor(input, async ({ host, getMarkdown }) => {
    assert.equal(getMarkdown(), input, firstDifference(input, getMarkdown()));
    assert.equal(host.querySelectorAll("strong.ob-html-inline").length, 2);
    assert.equal(host.querySelectorAll("em.ob-html-inline").length, 2);
  });
});

test("HTML 与 Markdown 行内标记混嵌不换序", async () => {
  const input = `<strong>**x**</strong> / **<em>y</em>** / <a href="https://example.com">**<strong>z</strong>**</a>\n`;
  await withEditor(input, async ({ host, getMarkdown }) => {
    assert.equal(getMarkdown(), input, firstDifference(input, getMarkdown()));
    assert.equal(host.querySelectorAll("a.ob-html-inline").length, 1);
    assert.ok(host.querySelector("strong.ob-html-inline"));
    assert.ok(host.querySelector("em.ob-html-inline"));
  });
});

test("details 与 summary 同块，内部 Markdown 和原始空白往返", async () => {
  const input = `<details open>\n<summary>摘要 <a href="https://example.com">链接</a></summary>\n\n第一段 **加粗**\n\n\n第二段\n</details>\n`;
  await withEditor(input, async ({ host, getMarkdown, findNode }) => {
    assert.equal(getMarkdown(), input, firstDifference(input, getMarkdown()));
    const model = findNode("html_details");
    assert.ok(model);
    assert.equal(model.node.childCount, 2);
    assert.deepEqual(model.node.attrs.separators, ["\n\n\n"]);
    const native = host.querySelector("details");
    assert.equal(native.open, true);
    assert.ok(host.querySelector(".ob-html-details-content strong"));
    native.open = false;
    assert.equal(getMarkdown(), input, "折叠状态不得写回 open 属性");
    assert.ok(host.querySelector(".ob-html-summary a[data-ob-html-link]"));
  });
});

test("GitHub summary 独立形式与 close 前单换行", async () => {
  const input = `<details>\n\n<summary><strong>独立摘要</strong></summary>\n\n- 甲\n- 乙\n</details>\n`;
  await withEditor(input, async ({ host, getMarkdown, findNode }) => {
    assert.equal(getMarkdown(), input, firstDifference(input, getMarkdown()));
    assert.equal(findNode("html_details").node.attrs.summary, "<summary><strong>独立摘要</strong></summary>");
    assert.equal(findNode("html_details").node.attrs.closeGap, "\n");
    assert.ok(host.querySelector(".ob-html-details-content li"));
    assert.equal(host.querySelector("details").open, false);
  });
});

test("空 details 的跨节点与同行形式", async () => {
  for (const input of [
    `<details>\n<summary>空</summary>\n\n</details>\n`,
    `<details><summary>空</summary></details>\n`,
    `<details></details>\n`,
  ]) {
    await withEditor(input, async ({ host, getMarkdown, findNode }) => {
      assert.equal(getMarkdown(), input, firstDifference(input, getMarkdown()));
      assert.equal(findNode("html_details").node.childCount, 0);
      assert.ok(host.querySelector("details"));
    });
  }
});

test("嵌套 details 不跨层抢 close", async () => {
  const input = `<details>\n<summary>外</summary>\n\n<details>\n<summary>内</summary>\n\n内容\n</details>\n</details>\n`;
  await withEditor(input, async ({ getMarkdown, findNode }) => {
    const outer = findNode("html_details");
    assert.ok(outer, "嵌套结构必须生成 html_details 容器");
    assert.equal(
      getMarkdown(),
      input,
      `${firstDifference(input, getMarkdown())}\n内层 attrs: ${JSON.stringify(outer.node.firstChild.attrs)}`
    );
    assert.equal(outer.node.firstChild.type.name, "html_details");
  });
});

test("CRLF HTML 进入 PM 后统一 LF 且原空白不丢", async () => {
  const lf = `<details open>\n<summary>摘要</summary>\n\n正文\n</details>\n\n<p>A</p>\n`;
  await withEditor(lf.replace(/\n/g, "\r\n"), async ({ getMarkdown }) => {
    assert.equal(getMarkdown(), lf, firstDifference(lf, getMarkdown()));
    assert.equal(getMarkdown().includes("\r"), false);
  });
});

test("块源码单事务更新 attrs 并重渲染", async () => {
  await withEditor(`<p>旧</p>\n`, async ({ view, host, getMarkdown, findNode }) => {
    const found = findNode("html_block");
    assert.equal(html.updateHtmlBlockSource(view, found.pos, `<p>新</p>`), true);
    assert.equal(getMarkdown(), `<p>新</p>\n`);
    assert.equal(host.querySelector(".ob-html-render p").textContent, "新");
  });
});

test("details 源码一次事务只改开闭与摘要", async () => {
  const input = `<details>\n<summary>旧</summary>\n\n正文\n</details>\n`;
  await withEditor(input, async ({ view, host, getMarkdown, findNode }) => {
    const found = findNode("html_details");
    assert.equal(html.updateHtmlDetailsSource(view, found.pos, {
      open: "<details open>",
      summary: "<summary>新</summary>",
      close: "</details>",
    }), true);
    const expected = input.replace("<details>", "<details open>").replace("旧", "新");
    assert.equal(getMarkdown(), expected, firstDifference(expected, getMarkdown()));
    assert.equal(host.querySelector("details").open, true);
    assert.equal(host.querySelector("summary").textContent, "新");
    assert.equal(findNode("html_details").node.textContent, "正文");
    assert.equal(html.updateHtmlDetailsSource(view, found.pos, {
      open: "<div>", summary: "", close: "</details>",
    }), false);
  });
});

test("inline 标签源码函数更新 mark 与 atom", async () => {
  const input = `<a href="https://example.com">链接</a> <img src="a.png">\n`;
  await withEditor(input, async ({ view, getMarkdown, findText, findNode }) => {
    const text = findText("链接");
    assert.deepEqual(html.getHtmlInlineSource(view, text.pos), {
      open: `<a href="https://example.com">`, close: "</a>",
    });
    assert.equal(html.updateHtmlInlineSource(view, text.pos, {
      open: `<a href="./docs/next.md" title="下一步">`,
    }), true);
    const atom = findNode("html_inline_atom");
    assert.equal(html.updateHtmlInlineSource(view, atom.pos, {
      value: `<img src="b.png" alt="B">`,
    }), true);
    const expected = `<a href="./docs/next.md" title="下一步">链接</a> <img src="b.png" alt="B">\n`;
    assert.equal(getMarkdown(), expected, firstDifference(expected, getMarkdown()));
    assert.equal(html.updateHtmlInlineSource(view, text.pos, { open: `<strong>` }), false);
  });
});

test("渲染岛普通点击打开外链和相对 md，危险链接不导航", async () => {
  openedUrls.length = 0;
  openedPaths.length = 0;
  const input = `<p><a href="https://example.com">外</a> <a href="./docs/guide.md">文</a> <a href="javascript:alert(1)">坏</a></p>\n`;
  await withEditor(input, async ({ host }) => {
    const external = host.querySelector(`a[data-ob-html-link="external"]`);
    const path = host.querySelector(`a[data-ob-html-link="path"]`);
    click(external);
    click(path);
    assert.deepEqual(openedUrls, ["https://example.com"]);
    assert.deepEqual(openedPaths, ["D:/notes/docs/guide.md"]);
    assert.equal(host.querySelectorAll("a").length, 3);
    assert.equal(host.querySelectorAll("a")[2].hasAttribute("href"), false);
    click(host.querySelectorAll("a")[2]);
    assert.equal(openedUrls.length, 1);
    assert.equal(openedPaths.length, 1);
  });
});

test("inline 普通点击不导航，Ctrl+click 导航", async () => {
  openedUrls.length = 0;
  await withEditor(`<a href="https://example.com">外链</a>\n`, async ({ host }) => {
    const a = host.querySelector("a.ob-html-inline");
    click(a);
    assert.deepEqual(openedUrls, []);
    click(a, { ctrlKey: true });
    assert.deepEqual(openedUrls, ["https://example.com"]);
  });
});

test("所有渲染图片经 toDomUrl，data 与协议相对 src 阻断", async () => {
  convertedSources.length = 0;
  const input = `远程 <img src="https://example.com/a.png"> 本地 <img src="assets/a.png"> 坏 <img src="data:text/html;base64,PGI+"> <img src="//evil.test/a.png">\n`;
  await withEditor(input, async ({ host }) => {
    const images = [...host.querySelectorAll(".ob-html-inline-atom img")];
    assert.equal(images.length, 4, images.map((img) => img.outerHTML).join("\n"));
    assert.deepEqual(convertedSources, ["https://example.com/a.png", "assets/a.png"]);
    assert.equal(images[2].hasAttribute("src"), false);
    assert.equal(images[3].hasAttribute("src"), false);
  });
});

test("XSS 无执行也无危险 DOM，白名单外属性不采用", async () => {
  const input = `<p id="raw-id" class="raw" style="color:red" onclick="window.__xss=1">ok<img src="x" onerror="window.__xss=2"><a href="javascript:window.__xss=3" target="_blank">bad</a></p>\n\n<script>window.__xss=4</script>\n\n<iframe srcdoc="<script>window.__xss=5</script>"></iframe>\n\n<form><input autofocus onfocus="window.__xss=6"></form>\n\n<style>body{display:none}</style>\n\n<svg onload="window.__xss=7"><circle></circle></svg>\n`;
  await withEditor(input, async ({ host }) => {
    assert.equal(window.__xss, undefined);
    assert.equal(host.querySelector("script, iframe, form, input, svg, style, object, embed"), null);
    for (const button of host.querySelectorAll("button"))
      assert.ok(button.classList.contains("ob-html-source-button"), "只允许插件自有源码按钮");
    assert.equal(host.querySelector("#raw-id"), null);
    assert.equal(host.querySelector(".raw"), null);
    assert.equal(host.querySelector("[style], [onclick], [onerror], [onload], [srcdoc], [target]"), null);
    assert.equal(host.querySelector(`a[href^="javascript:"], img[src^="data:"]`), null);
    for (const img of host.querySelectorAll("img")) {
      img.dispatchEvent(new window.Event("error"));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(window.__xss, undefined);
    assert.ok(host.querySelector(".ob-html-source-fallback"));
  });
});

test("混淆协议、file/tauri 与 data URL 全部阻断", async () => {
  const input = `<a href="jav&#x61;script:alert(1)">a</a> <a href="file:///tmp/x">f</a> <a href="tauri://localhost">t</a> <a href="//evil.test">p</a> <img src="data:image/png;base64,AAAA">\n`;
  await withEditor(input, async ({ host }) => {
    assert.equal(host.querySelector(`a[href], img[src]`), null);
    assert.equal(host.querySelector("[data-ob-html-link]"), null);
  });
});

test("未配对与交叉结构保留源码降级", async () => {
  const input = `<div><span>x</div></span>\n\n<details>\n<summary>未闭合\n`;
  await withEditor(input, async ({ host, getMarkdown }) => {
    assert.equal(getMarkdown(), input, firstDifference(input, getMarkdown()));
    assert.ok(host.querySelector(".ob-html-source-fallback"));
    assert.equal(host.querySelector("details"), null);
  });
});

test("```html 围栏内容不进入 HTML 渲染管线", async () => {
  const input = `\`\`\`html\n<img src="x" onerror="window.__xss=1">\n<details><summary>x</summary></details>\n\`\`\`\n`;
  await withEditor(input, async ({ host, getMarkdown, findNode }) => {
    assert.equal(getMarkdown(), input);
    assert.ok(findNode("code_block"));
    assert.equal(host.querySelector("img, details"), null);
    assert.equal(host.querySelector(".ob-html-node"), null);
  });
});

test("CSS 包含表格 auto、图片上限与打印控件隐藏", async () => {
  const css = readFileSync("src/styles/html.css", "utf8");
  assert.match(css, /table-layout:\s*auto\s*!important/);
  assert.match(css, /\.ob-html-render img\s*\{[\s\S]*?max-width:\s*100%/);
  assert.match(css, /@media print[\s\S]*?\.ob-html-toolbar,[\s\S]*?\.ob-html-source[\s\S]*?display:\s*none\s*!important/);
});

const realReadme = process.env.OBLET_README_CN || resolve("..", "ppt-master", "README_CN.md");
if (existsSync(realReadme)) {
  test("真实 README_CN.md HTML 区域原文与全文二轮稳定", async () => {
    const source = readFileSync(realReadme, "utf8").replace(/\r\n?/g, "\n");
    await withEditor(source, async ({ host, getMarkdown, editor }) => {
      const once = getMarkdown();
      const regions = [
        ...(source.match(/^<details\b[\s\S]*?^<\/details>$/gm) ?? []),
        ...(source.match(/^<p\b[\s\S]*?^<\/p>$/gm) ?? []),
        ...(source.match(/^<table\b[\s\S]*?^<\/table>$/gm) ?? []),
      ];
      assert.ok(regions.length >= 12, `应提取真实 HTML 区域，实际 ${regions.length}`);
      for (const region of regions) {
        assert.ok(once.includes(region), `HTML 区域被改写：\n${region.slice(0, 500)}`);
      }
      assert.ok(once.includes("<hr>"));
      assert.ok(host.querySelectorAll("details").length >= 5);
      assert.ok(host.querySelector("table"));
      assert.ok(host.querySelector("img"));
      await editor.action(replaceAll(once));
      const twice = getMarkdown();
      assert.equal(twice, once, "全文二轮必须稳定，允许首轮既有 Markdown 规范化");
      for (const region of regions) assert.ok(twice.includes(region));
    });
  });
} else {
  console.log(`SKIP 真实 README_CN.md（未找到 ${realReadme}，可用 OBLET_README_CN 指定）`);
}

let failed = 0;
try {
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${name}`);
      console.error(error?.stack || error);
    }
  }
} finally {
  await vite.close();
  window.close();
}

console.log(`\n${tests.length - failed}/${tests.length} 通过`);
if (failed) process.exitCode = 1;
