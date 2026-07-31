// 实机产物复现（#49）：dist 经本地 HTTP + Edge CDP 真实时间驱动。
// virtual-time-budget 与真实网络加载冲突（挂死/掐导航），改走远程调试协议：
// 起 Edge headless --remote-debugging-port=0 → CDP 开页 → 真实等待 → Runtime.evaluate 采集。
// 用法：npm run build 后 node scripts/repro-dist.mjs
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve, extname, join, normalize } from "node:path";

const distDir = resolve("dist");

const mock = `
window.__errors = [];
window.addEventListener("error", (e) => __errors.push(String(e.error?.stack ?? e.message).slice(0, 600)));
window.addEventListener("unhandledrejection", (e) => __errors.push("rejection: " + String(e.reason?.stack ?? e.reason).slice(0, 600)));
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  callbacks: new Map(),
  transformCallback(cb) { const id = Math.random(); this.callbacks.set(id, cb); return id; },
  unregisterCallback() {},
  invoke(cmd) {
    const routes = {
      get_window_file: () => "C:\\\\mock\\\\demo.md",
      read_file: () => ({ content: "# 标题\\n\\n\`\`\`python\\nprint(1)\\n\`\`\`\\n\\n\`\`\`\\n\`\`\`\\n\\n正文段落。", newline: "LF", readonly: false, readonly_reason: null }),
      get_settings: () => ({ version: 1, editor: {} }), // editor 必须非空（typography/commands 直接读 .editor.keymap）
      save_settings: () => null,
      watch_file: () => null,
      set_window_effect: () => null,
      set_window_file: () => null,
    };
    return Promise.resolve(routes[cmd] ? routes[cmd]() : null);
  },
};
`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = normalize(join(distDir, rel));
  if (!file.startsWith(distDir)) { res.writeHead(403); res.end(); return; }
  let body;
  try { body = readFileSync(file); } catch { res.writeHead(404); res.end(); return; }
  if (rel === "index.html") {
    const html = body.toString("utf8").replace("<head>", `<head><script>${mock}</script>`);
    res.writeHead(200, { "content-type": MIME[".html"] });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(body);
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// ---- 启动 Edge（CDP）----
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", [
  "--headless=new",
  "--disable-gpu",
  "--remote-debugging-port=0",
  "--user-data-dir=" + resolve("scripts/.repro/.edge-profile"),
  "about:blank",
]);
const wsUrl = await new Promise((resolveWs, reject) => {
  let buf = "";
  edge.stderr.on("data", (d) => {
    buf += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) resolveWs(m[1]);
  });
  edge.on("exit", () => reject(new Error("edge exited")));
  setTimeout(() => reject(new Error("ws url timeout")), 20000);
});

// ---- 极简 CDP 客户端（node 内置 WebSocket）----
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}, sessionId) => new Promise((resolveSend) => {
  const id = ++msgId;
  pending.set(id, resolveSend);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` }, sessionId);

// 真实时间等待装配（模块加载 + 编辑器 create + 代码块懒挂载）
await new Promise((r) => setTimeout(r, 9000));

const evaluate = async (expr) => {
  const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  return res.result?.result?.value;
};

// 点开语言浮层并采集
const report = await evaluate(`(() => {
  const btn = document.querySelector(".milkdown-code-block .language-button");
  if (!btn) return { stage: "no language button", body: document.body.innerHTML.slice(0, 300) };
  btn.click();
  return new Promise((res) => setTimeout(() => {
    const items = document.querySelectorAll(".language-list-item");
    const input = document.querySelector(".language-picker .search-input");
    res({
      stage: "done",
      liCount: items.length,
      firstLi: items[0]?.textContent ?? null,
      btnText: btn.textContent,
      searchValue: input?.value ?? null,
      hasNoResult: !!document.querySelector(".language-list-item.no-result"),
    });
  }, 800));
})()`);
// awaitPromise 需要单独标志——上面的 IIFE 返回 Promise，CDP 默认不 await，重新采集
await new Promise((r) => setTimeout(r, 1200));
const report2 = await evaluate(`({
  liCount: document.querySelectorAll(".language-list-item").length,
  firstLi: document.querySelector(".language-list-item")?.textContent ?? null,
  btnText: document.querySelector(".language-button")?.textContent ?? null,
  searchValue: document.querySelector(".language-picker .search-input")?.value ?? null,
  hasNoResult: !!document.querySelector(".language-list-item.no-result"),
  ulHtml: document.querySelector(".language-list")?.outerHTML?.slice(0, 300) ?? null,
  errors: window.__errors ?? [],
})`);

console.log("report(click 返回值):", JSON.stringify(report));
console.log("report2(1.2s 后):", JSON.stringify(report2, null, 1));

// 自由输入语言（1.4）：搜索框输入自定义语言名回车 → 按钮文本应变、浮层应收起
const freeInput = await evaluate(`(() => {
  const input = document.querySelector(".language-picker .search-input");
  if (!input) return { stage: "no search input" };
  input.value = "mylang";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return new Promise((res) => setTimeout(() => {
    res({
      btnText: document.querySelector(".language-button")?.textContent?.trim() ?? null,
      pickerGone: !document.querySelector(".language-picker .list-wrapper"),
    });
  }, 600));
})()`);
console.log("freeInput(自定义语言回车):", JSON.stringify(freeInput));

// 空代码块浮层可见性（八轮悬案核心场景）：布局尺寸量不出 overflow 裁剪，
// 必须用 elementFromPoint 在 ul 中部取样——被裁时命中的是底层元素
const emptyBlock = await evaluate(`(() => {
  const blocks = document.querySelectorAll(".milkdown-code-block");
  if (blocks.length < 2) return { stage: "only " + blocks.length + " code block(s)" };
  const block = blocks[1]; // 空代码块（无语言、无内容）
  const btn = block.querySelector(".language-button");
  if (!btn) return { stage: "empty block not initialized (no language button)", html: block.innerHTML.slice(0, 200) };
  btn.click();
  return new Promise((res) => setTimeout(() => {
    const ul = block.querySelector(".language-list");
    if (!ul) { res({ stage: "no ul" }); return; }
    const items = ul.querySelectorAll(".language-list-item");
    const r = ul.getBoundingClientRect();
    // ul 中部取样点（列表项区域，避开顶部搜索框）
    const cy = Math.min(r.top + 120, r.bottom - 10);
    const hit = document.elementFromPoint(r.left + r.width / 2, cy);
    res({
      stage: "done",
      liCount: items.length,
      firstLi: items[0]?.textContent ?? null,
      ulRect: { w: Math.round(r.width), h: Math.round(r.height) },
      ulVisible: !!(hit && (hit === ul || ul.contains(hit))),
      hitTag: hit ? hit.tagName + "." + hit.className : null,
      blockOverflow: getComputedStyle(block).overflow,
    });
  }, 800));
})()`);
console.log("emptyBlock(空代码块浮层可见性):", JSON.stringify(emptyBlock, null, 1));

edge.kill();
server.close();
process.exit(0);
