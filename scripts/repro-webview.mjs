// 真机复现（#49 终局）：CDP 直连真实 oblet.exe 的 WebView2。
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 注入远程调试端口（WebView2 官方支持），
// 打开带 ```python 代码块的测试 md，采集语言浮层 DOM 与页面错误。
// 用法：node scripts/repro-webview.mjs（会先杀已运行的 oblet 调试实例——不杀普通实例）
import { writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const reproDir = resolve("scripts/.repro");
mkdirSync(reproDir, { recursive: true });
const testMd = resolve(reproDir, "cdp-test.md");
writeFileSync(testMd, "# 标题\n\n```python\nprint(1)\n```\n\n```\n\n```\n\n正文段落。\n");

const DEBUG_PORT = 9333;

// 启动真实 exe（绿色包）
const exe = resolve("release/Oblet/oblet.exe");
const child = spawn(exe, [testMd], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}`,
  },
  detached: true,
  stdio: "ignore",
});
child.unref();

// 等 CDP 端口起来
const base = `http://127.0.0.1:${DEBUG_PORT}`;
let targets = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const list = await (await fetch(`${base}/json/list`)).json();
    const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
    if (page) { targets = page; break; }
  } catch { /* 端口未就绪 */ }
}
if (!targets) { console.error("CDP 端口未就绪"); process.exit(1); }

// 等编辑器装配
await new Promise((r) => setTimeout(r, 4000));

const ws = new WebSocket(targets.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result;

// 装错误收集器（后装只能收新错误；同时读已有状态）
await evaluate(`window.__errors = window.__errors || []; true`);

const report = await evaluate(`(() => {
  const btn = document.querySelector(".milkdown-code-block .language-button");
  if (!btn) return { stage: "no language button", hasEditor: !!document.querySelector(".ProseMirror"), body: document.body.innerHTML.slice(0, 400) };
  btn.click();
  return new Promise((res) => setTimeout(() => {
    const items = document.querySelectorAll(".language-list-item");
    const ul = document.querySelector(".language-list");
    res({
      stage: "done",
      liCount: items.length,
      firstLi: items[0]?.textContent ?? null,
      hasNoResult: !!document.querySelector(".language-list-item.no-result"),
      ulHeight: ul ? getComputedStyle(ul).height : null,
      ulDisplay: ul ? getComputedStyle(ul).display : null,
      pickerRect: document.querySelector(".language-picker")?.getBoundingClientRect()?.toJSON() ?? null,
      errors: window.__errors,
    });
  }, 1000));
})()`);

console.log(JSON.stringify(report?.result?.value ?? report, null, 1));

// 空代码块浮层可见性（八轮根因场景）：elementFromPoint 像素级判定——
// 布局尺寸量不出 overflow 裁剪，被裁时取样命中底层元素
const emptyBlock = await evaluate(`(() => {
  const blocks = document.querySelectorAll(".milkdown-code-block");
  if (blocks.length < 2) return { stage: "only " + blocks.length + " code block(s)" };
  const block = blocks[1];
  const btn = block.querySelector(".language-button");
  if (!btn) return { stage: "empty block not initialized", html: block.innerHTML.slice(0, 200) };
  btn.click();
  return new Promise((res) => setTimeout(() => {
    const ul = block.querySelector(".language-list");
    if (!ul) { res({ stage: "no ul" }); return; }
    const r = ul.getBoundingClientRect();
    const cy = Math.min(r.top + 120, r.bottom - 10);
    const hit = document.elementFromPoint(r.left + r.width / 2, cy);
    res({
      stage: "done",
      liCount: ul.querySelectorAll(".language-list-item").length,
      ulVisible: !!(hit && (hit === ul || ul.contains(hit))),
      hitTag: hit ? hit.tagName + "." + hit.className : null,
      blockOverflow: getComputedStyle(block).overflow,
      errors: window.__errors,
    });
  }, 1000));
})()`);
console.log("emptyBlock:", JSON.stringify(emptyBlock?.result?.value ?? emptyBlock, null, 1));

// 设置面板（十一轮收敛形态）：Acrylic 已删、窗口效果改 Mica 开关、十轮扩充项全撤
const settingsPanel = await evaluate(`(() => {
  const btn = document.querySelector(".settings-btn");
  if (!btn) return { stage: "no settings btn" };
  btn.click();
  return new Promise((res) => setTimeout(() => {
    const panel = document.querySelector(".settings-panel");
    res({
      stage: "done",
      hidden: document.querySelector(".settings-overlay")?.classList.contains("hidden") ?? null,
      textInputs: panel?.querySelectorAll("input[data-typo]").length ?? 0,
      checkboxes: panel?.querySelectorAll("input[data-check]").length ?? 0,
      micaToggle: !!panel?.querySelector("#mica-toggle"),
      noLeftovers: !panel?.querySelector("input[data-num], input[data-color], select"),
      keymapRows: panel?.querySelectorAll(".keymap-row").length ?? 0,
    });
  }, 800));
})()`);
console.log("settingsPanel:", JSON.stringify(settingsPanel?.result?.value ?? settingsPanel, null, 1));
await evaluate(`document.querySelector(".settings-close")?.click()`);

// 格式化快捷键（十轮 #4）：与 repro-dist 同款——选区走 __oblet 钩子，按键真实派发，
// 断言序列化结果（加粗/高亮/行内代码/标题 toggle 全链路）
const shortcut = await evaluate(`(() => {
  const ob = window.__oblet;
  if (!ob) return { stage: "no __oblet hook" };
  const press = (init) => window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  const step = (ms) => new Promise((r) => setTimeout(r, ms));
  return (async () => {
    ob.selectLastParagraph();
    await step(200);
    press({ code: "KeyB", ctrlKey: true });
    await step(300);
    const afterBold = ob.getMarkdown();
    press({ code: "KeyB", ctrlKey: true });
    await step(300);
    press({ code: "Digit3", altKey: true });  // Alt+3 → 三级标题
    await step(300);
    const afterH3 = ob.getMarkdown();
    press({ code: "Digit3", altKey: true });
    await step(300);
    const afterH3Off = ob.getMarkdown();
    press({ code: "KeyA", altKey: true });    // Alt+A → callout 包裹
    await step(300);
    const afterCallout = ob.getMarkdown();
    press({ code: "KeyA", altKey: true });    // 再 Alt+A → 回退
    await step(300);
    const afterCalloutOff = ob.getMarkdown();
    return { stage: "done", afterBold, afterH3, afterH3Off, afterCallout, afterCalloutOff, errors: window.__errors };
  })();
})()`);
console.log("shortcut:", JSON.stringify(shortcut?.result?.value ?? shortcut, null, 1));

await evaluate(`window.close()`).catch(() => {});
process.exit(0);
