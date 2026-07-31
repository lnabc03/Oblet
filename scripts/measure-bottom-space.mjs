// 底部留白实测（十轮 #2）：短文档 + 长文档，两种窗口尺寸，
// CDP 直连真机 exe，量"滚到底后末行距视口底的距离"与各项贡献值。
// 用法：node scripts/measure-bottom-space.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const reproDir = resolve("scripts/.repro");
mkdirSync(reproDir, { recursive: true });
const shortMd = resolve(reproDir, "measure-short.md");
const longMd = resolve(reproDir, "measure-long.md");
writeFileSync(shortMd, "# 短文档\n\n只有三行内容。\n\n末行。\n");
writeFileSync(
  longMd,
  Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段：这是一段会自动换行的中文正文，用来模拟真实笔记的段落密度与换行行为，窗口越宽换行越少。`).join("\n\n")
);

const DEBUG_PORT = 9335;
const exe = resolve("release/Oblet/oblet.exe");
const child = spawn(exe, [shortMd], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}` },
  detached: true,
  stdio: "ignore",
});
child.unref();

const base = `http://127.0.0.1:${DEBUG_PORT}`;
let target = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const list = await (await fetch(`${base}/json/list`)).json();
    const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
    if (page) { target = page; break; }
  } catch { /* 未就绪 */ }
}
if (!target) { console.error("CDP 端口未就绪"); process.exit(1); }
await new Promise((r) => setTimeout(r, 4000));

const ws = new WebSocket(target.webSocketDebuggerUrl);
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
  (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

async function setWindow(width, height) {
  // WebView2 不支持 Browser.setWindowBounds（实测无效），
  // 用设备指标覆盖模拟视口尺寸——布局回流行为与真窗口一致
  await send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await new Promise((r) => setTimeout(r, 800));
}

const MEASURE = `(() => {
  const host = document.querySelector(".markdown-rendered");
  if (!host) return { stage: "no host" };
  host.scrollTop = host.scrollHeight;
  const pm = host.querySelector(".ProseMirror");
  const last = pm ? pm.lastElementChild : null;
  const cs = getComputedStyle(host);
  const pmcs = pm ? getComputedStyle(pm) : null;
  const lastRect = last ? last.getBoundingClientRect() : null;
  const hostRect = host.getBoundingClientRect();
  return {
    viewport: { w: innerWidth, h: innerHeight },
    host: { clientH: host.clientHeight, scrollH: host.scrollHeight, padBottom: cs.paddingBottom },
    pm: pmcs ? { padBottom: pmcs.paddingBottom, marginBottom: pmcs.marginBottom, minH: pmcs.minHeight } : null,
    lastBottom: lastRect ? Math.round(lastRect.bottom) : null,
    lastTag: last ? last.tagName + "." + (last.className || "") : null,
    hostBottom: Math.round(hostRect.bottom),
    blankAfterLastLine: lastRect ? Math.round(hostRect.bottom - lastRect.bottom) : null,
    childrenCount: pm ? pm.children.length : 0,
  };
})()`;

for (const [w, h, label] of [[960, 720, "默认"], [1920, 1040, "最大化"]]) {
  await setWindow(w, h);
  const r = await evaluate(MEASURE);
  console.log(`[${label} ${w}x${h}]`, JSON.stringify(r, null, 1));
}

// 长文档：invoke 换文件不行，直接改开第二个窗口太麻烦——复用同一窗口测 scroll 行为即可，
// 长文档场景改为：把短文档内容在编辑器里撑长不现实，故另起进程测长文档
await evaluate(`window.close()`).catch(() => {});

const child2 = spawn(exe, [longMd], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}` },
  detached: true,
  stdio: "ignore",
});
child2.unref();
await new Promise((r) => setTimeout(r, 5000));
let target2 = null;
for (let i = 0; i < 20; i++) {
  try {
    const list = await (await fetch(`${base}/json/list`)).json();
    const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
    if (page) { target2 = page; break; }
  } catch { /* 未就绪 */ }
  await new Promise((r) => setTimeout(r, 500));
}
if (target2) {
  const ws2 = new WebSocket(target2.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws2.onopen = r; ws2.onerror = j; });
  const pending2 = new Map();
  ws2.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending2.has(m.id)) { pending2.get(m.id)(m); pending2.delete(m.id); }
  };
  const send2 = (method, params = {}) => new Promise((res) => {
    const id = ++msgId;
    pending2.set(id, res);
    ws2.send(JSON.stringify({ id, method, params }));
  });
  const evaluate2 = async (expr) =>
    (await send2("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const setWindow2 = async (width, height) => {
    await send2("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    await new Promise((r) => setTimeout(r, 800));
  };
  for (const [w, h, label] of [[960, 720, "默认"], [1920, 1040, "最大化"]]) {
    await setWindow2(w, h);
    const r = await evaluate2(MEASURE);
    console.log(`[长文档 ${label} ${w}x${h}]`, JSON.stringify(r, null, 1));
  }
  await evaluate2(`window.close()`).catch(() => {});
}
process.exit(0);
