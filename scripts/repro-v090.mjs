// v0.9.0 真实 WebView2 验收：TXT 原文/自动保存、混合 Tab、GitHub 风格 HTML 与 XSS。
// 跑前：无 oblet.exe 在运行，且 src-tauri/target/release/oblet.exe 为最新构建。
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn, execSync } from "node:child_process";
import { resolve } from "node:path";

const DEBUG_PORT = 9360;
const EXE = resolve("src-tauri/target/release/oblet.exe");
try {
  const out = execSync('tasklist /FI "IMAGENAME eq oblet.exe" /FO CSV', { encoding: "utf8" });
  if (/"oblet\.exe","(\d+)"/i.test(out)) {
    console.error("有 oblet.exe 在运行，先关闭");
    process.exit(1);
  }
} catch { /* 继续 */ }

const dir = resolve("scripts/.repro/v090");
mkdirSync(resolve(dir, "assets"), { recursive: true });
const plainPath = resolve(dir, "plain.txt");
const htmlPath = resolve(dir, "html.md");
const linkedPath = resolve(dir, "linked.md");
const readmePath = resolve(dir, "readme.md");
const utf16Path = resolve(dir, "utf16.txt");
const imagePath = resolve(dir, "assets/pixel.png");

const plainCrlf = "# 不是标题\r\n\r\n- 不是列表\r\n<b>不是 HTML</b>\r\n末尾两个空格  \r\n\tTab\r\n";
writeFileSync(plainPath, Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from(plainCrlf, "utf8"),
]));

const htmlSource = `# HTML 验收

<p align="center">居中 <strong>粗体</strong><br><img src="assets/pixel.png" width="32"></p>

<details open>
<summary>摘要 <a href="https://example.com">链接</a></summary>

## 内嵌 Markdown

| A | B |
|---|---|
| 1 | 2 |

</details>

### <a href="./linked.md">Research <img src="assets/pixel.png" height="16"></a>

<p><img src="assets/pixel.png" onerror="window.__xss=1"><a href="javascript:window.__xss=2">危险链接</a></p>

<script>window.__xss=3</script>

<iframe srcdoc="<script>window.__xss=4</script>"></iframe>
`;
writeFileSync(htmlPath, htmlSource);
writeFileSync(linkedPath, "# 链接目标\n");
copyFileSync(resolve("src-tauri/icons/32x32.png"), imagePath);
copyFileSync("D:/个人文档/PROJECTS/ppt-master/README_CN.md", readmePath);
writeFileSync(utf16Path, Buffer.concat([
  Buffer.from([0xff, 0xfe]),
  Buffer.from("# UTF-16 文本\r\n只读中文\r\n", "utf16le"),
]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EXE, [plainPath], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}` },
  detached: true,
  stdio: "ignore",
});
child.unref();
const cleanup = () => { try { execSync(`taskkill /PID ${child.pid} /T /F`); } catch { /* 已退出 */ } };
process.on("exit", cleanup);

const base = `http://127.0.0.1:${DEBUG_PORT}`;
let page = null;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`${base}/json/list`)).json();
    const p = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
    if (p) { page = p; break; }
  } catch { /* 未就绪 */ }
}
if (!page) { console.error("CDP 端口未就绪"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails));
  }
  return response.result?.result?.value;
};

let ready = false;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  if (await evaluate(`!!window.__oblet?.getContent`)) { ready = true; break; }
}
if (!ready) { console.error("编辑器未就绪"); process.exit(1); }
await evaluate(`window.__v090Errors=[];window.addEventListener('error',e=>window.__v090Errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__v090Errors.push(String(e.reason)));true`);

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
};
const openPath = async (path, kind) => {
  await evaluate(`window.__obletOpenFromIntent(${JSON.stringify(path)});true`);
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    if (await evaluate(`window.__oblet.documentKind() === ${JSON.stringify(kind)} && window.__oblet.tabs.activePath().toLowerCase() === ${JSON.stringify(path.toLowerCase())}`)) return;
  }
  throw new Error(`打开文档超时: ${path}`);
};

// TXT：BOM/CRLF、非 Markdown 语义、真实输入与自动保存。
const initialPlain = await evaluate(`window.__oblet.getContent()`);
check("TXT 活动类型与独立编辑器", await evaluate(`window.__oblet.documentKind() === "text" && !!document.querySelector(".ob-plaintext-editor") && document.body.classList.contains("ob-doc-text")`));
check("TXT 不解析 Markdown 且原文完整", initialPlain === plainCrlf.replace(/\r\n/g, "\n"), initialPlain);
await sleep(900);
check("TXT 未编辑不写回", readFileSync(plainPath).equals(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(plainCrlf)])));
await evaluate(`document.querySelector(".ob-plaintext-editor .cm-content").focus();true`);
await send("Input.insertText", { text: "新增一行\n" });
await sleep(1000);
const savedPlain = readFileSync(plainPath);
check("TXT 自动保存保留 UTF-8 BOM", savedPlain[0] === 0xef && savedPlain[1] === 0xbb && savedPlain[2] === 0xbf);
check("TXT 自动保存保留 CRLF 与 Markdown 字符", savedPlain.includes(Buffer.from("新增一行\r\n")) && savedPlain.includes(Buffer.from("<b>不是 HTML</b>")));
writeFileSync(plainPath, Buffer.concat([savedPlain, Buffer.from("外部修改\r\n")]));
await sleep(1300);
check("TXT 外部变更自动重载", await evaluate(`window.__oblet.getContent().includes('外部修改') && window.__oblet.documentKind() === 'text'`));
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',ctrlKey:true,bubbles:true,cancelable:true}));true`);
await sleep(200);
check("TXT Ctrl+F 打开 CM 搜索", await evaluate(`!!document.querySelector(".ob-plaintext-editor .cm-panel.cm-search")`));
const tabsBeforeEsc = await evaluate(`window.__oblet.tabs.count()`);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));true`);
await sleep(200);
check("Esc 只关闭搜索不关 Tab", await evaluate(`!document.querySelector(".ob-plaintext-editor .cm-panel.cm-search") && window.__oblet.tabs.count() === ${tabsBeforeEsc}`));

// 小型 HTML 全链路：结构、相对图片、XSS、未编辑保真。
const htmlBytesBefore = readFileSync(htmlPath);
await openPath(htmlPath, "markdown");
await sleep(700);
const htmlRoundtrip = await evaluate(`window.__oblet.getContent()`);
check("HTML 全文与 details 空白字节级往返", htmlRoundtrip === htmlSource, htmlRoundtrip);
check("HTML 块与 details 容器渲染", await evaluate(`document.querySelectorAll(".ob-html-block").length >= 3 && !!document.querySelector(".ob-html-details-native")`));
check("details 内 Markdown 正常渲染", await evaluate(`document.querySelector(".ob-html-details-content h2")?.textContent === "内嵌 Markdown" && !!document.querySelector(".ob-html-details-content table")`));
check("行内链接与图片组成真实标签", await evaluate(`!!document.querySelector("h3 a.ob-html-inline") && !!document.querySelector("h3 a.ob-html-inline img")`));
check("HTML 相对图片走 asset 解析", await evaluate(`Array.from(document.querySelectorAll(".ob-html-render img")).some(img => /asset|localhost/.test(img.src))`));
const xssSafe = await evaluate(
  `!window.__xss && !document.querySelector(".ProseMirror script, .ProseMirror iframe, .ProseMirror [onerror], .ProseMirror a[href^='javascript:']")`,
);
check("XSS 无脚本/iframe/事件属性/危险协议", xssSafe);
check("危险 HTML 只影响渲染，原文仍保留", await evaluate(`window.__oblet.getContent().includes('onerror="window.__xss=1"') && window.__oblet.getContent().includes('<script>window.__xss=3</script>')`));
await sleep(800);
check("HTML 打开与渲染不写回文件", readFileSync(htmlPath).equals(htmlBytesBefore));

// 块级源码编辑：单事务更新原文与渲染，自动保存只落到临时 fixture。
await evaluate(`(() => {
  const block = document.querySelector(".ob-html-block");
  const button = block.querySelector(".ob-html-source-button");
  button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));
  const area = block.querySelector('.ob-html-source-input');
  area.value = '<p align="center">已编辑<strong>源码</strong></p>';
  area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
  return true;
})()`);
await sleep(1000);
check("HTML 块源码编辑同步原文与渲染", await evaluate(`window.__oblet.getContent().includes('已编辑<strong>源码</strong>') && document.querySelector('.ob-html-block .ob-html-render')?.textContent.includes('已编辑源码')`));
check("HTML 源码编辑自动保存到临时文件", readFileSync(htmlPath, "utf8").includes('已编辑<strong>源码</strong>'));

// 混合 Tab：活动类型、内容和搜索路由不串。
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowLeft',altKey:true,bubbles:true,cancelable:true}));true`);
await sleep(400);
check("Markdown → TXT 混合 Tab", await evaluate(`window.__oblet.documentKind() === "text" && window.__oblet.getContent().includes('新增一行') && document.body.classList.contains('ob-doc-text')`));
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight',altKey:true,bubbles:true,cancelable:true}));true`);
await sleep(400);
check("TXT → Markdown 混合 Tab", await evaluate(`window.__oblet.documentKind() === "markdown" && window.__oblet.getContent().includes('已编辑<strong>源码</strong>')`));

// 用户实样副本：GitHub 常见块、行内与多组 details。
const readmeBytesBefore = readFileSync(readmePath);
await openPath(readmePath, "markdown");
await sleep(1200);
const readmeReport = await evaluate(`({
  blocks: document.querySelectorAll('.ob-html-block').length,
  tables: document.querySelectorAll('.ob-html-render table').length,
  details: document.querySelectorAll('.ob-html-details-native').length,
  summaries: document.querySelectorAll('.ob-html-summary').length,
  inlineLinks: document.querySelectorAll('a.ob-html-inline').length,
  detailMarkdown: document.querySelectorAll('.ob-html-details-content p, .ob-html-details-content table, .ob-html-details-content pre').length,
  hasRawTable: !!document.querySelector('.ob-html-render table'),
  errors: window.__v090Errors,
})`);
console.log("README 实样:", JSON.stringify(readmeReport));
check("README 块级表格渲染", readmeReport?.tables >= 3, readmeReport);
check("README 多组 details 与内嵌 Markdown", readmeReport?.details >= 4 && readmeReport?.detailMarkdown >= 4, readmeReport);
check("README 行内 HTML 渲染", readmeReport?.inlineLinks >= 1, readmeReport);
await sleep(800);
check("README 实样未编辑零写回", readFileSync(readmePath).equals(readmeBytesBefore));

const screenshot = await send("Page.captureScreenshot", { format: "png" });
const screenshotPath = resolve(dir, "readme.png");
writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, "base64"));
console.log("截图:", screenshotPath);
check("运行期无未捕获 JS 异常", (readmeReport?.errors ?? []).length === 0, readmeReport?.errors);

await openPath(plainPath, "text");
const renamed = await evaluate(`window.__oblet.testRename('renamed')`);
check("TXT 重命名保留 .txt 且同步 Tab", renamed?.path?.endsWith("renamed.txt") && renamed?.tabs?.includes(renamed.path), renamed);
check("TXT 重命名后文件与 BOM 仍在", existsSync(renamed?.path ?? "") && readFileSync(renamed.path)[0] === 0xef);

const utf16Before = readFileSync(utf16Path);
await openPath(utf16Path, "text");
check("UTF-16 TXT 正确解码且明确只读", await evaluate(`window.__oblet.getContent().includes('只读中文') && document.querySelector('.readonly-banner')?.textContent.includes('UTF-16') && document.querySelector('.ob-plaintext-editor .cm-content')?.getAttribute('contenteditable') === 'false'`));
await evaluate(`document.querySelector(".ob-plaintext-editor .cm-content").focus();true`);
await send("Input.insertText", { text: "不得写入" });
await sleep(700);
check("UTF-16 只读内容不被编辑或写回", readFileSync(utf16Path).equals(utf16Before) && await evaluate(`!window.__oblet.getContent().includes('不得写入')`));

ws.close();
console.log(failed ? `\n${failed} 项失败` : "\nv0.9.0 真实 WebView 验收全部通过");
process.exit(failed ? 1 : 0);
