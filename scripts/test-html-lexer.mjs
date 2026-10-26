// HTML 词法/安全策略直测：不启动 Milkdown，只验证标签边界与 URL 放行白名单。
// 运行：node scripts/test-html-lexer.mjs
import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  root: process.cwd(),
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

let lexer;
try {
  lexer = await vite.ssrLoadModule("/src/editor/html-lexer.ts");
} finally {
  await vite.close();
}

const {
  ALLOWED_ATTR,
  ALLOWED_TAGS,
  classifyImageSource,
  classifyLink,
  compactUrlForCheck,
  parseSingleTag,
  readTagAt,
} = lexer;

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("标签边界读取不修补引号与非法闭标签", () => {
  const open = readTagAt(`<p class="a>b">tail`, 0);
  assert.deepEqual(open, {
    raw: `<p class="a>b">`,
    name: "p",
    closing: false,
    selfClosing: false,
    end: 15,
  });
  assert.equal(readTagAt("x<p>", 1).end, 4);
  assert.equal(readTagAt("<3>", 0), null);
  assert.equal(readTagAt(`<a href="x>`, 0), null);
  assert.equal(readTagAt("</div class=x>", 0), null);
  assert.equal(parseSingleTag("</div >").closing, true);
  assert.equal(parseSingleTag("<br/>").selfClosing, true);
  assert.equal(parseSingleTag("<IMG src=x>").name, "img");
  assert.equal(parseSingleTag("<IMG src=x>").selfClosing, true);
  assert.equal(parseSingleTag("<a href='x'"), null);
});

test("URL 混淆字符统一剥离后再判定", () => {
  assert.equal(compactUrlForCheck("java\n\tscript:alert(1)"), "javascript:alert(1)");
  assert.equal(compactUrlForCheck(" https://a.test/x "), "https://a.test/x");
});

test("外链只放行 http/https 且有主机名", () => {
  assert.deepEqual(classifyLink("https://example.com/a?b=1"), {
    kind: "external",
    url: "https://example.com/a?b=1",
  });
  assert.equal(classifyLink("HTTPS://EXAMPLE.COM/a").kind, "external");
  assert.equal(classifyLink("//example.com/a"), null);
  assert.equal(classifyLink("\\\\example.com\\a"), null);
  assert.equal(classifyLink("javascript:alert(1)"), null);
  assert.equal(classifyLink("java\tscript:alert(1)"), null);
  assert.equal(classifyLink("file:///C:/a.md"), null);
  assert.equal(classifyLink("https://"), null);
  assert.equal(classifyLink(""), null);
});

test("本地链接只导航相对 .md", () => {
  assert.deepEqual(classifyLink("notes/a.md"), { kind: "path", path: "notes/a.md" });
  assert.deepEqual(classifyLink("notes/a.md#小节"), { kind: "path", path: "notes/a.md" });
  assert.deepEqual(classifyLink("notes/a.md?x=1"), { kind: "path", path: "notes/a.md" });
  assert.equal(classifyLink("C:/notes/a.md"), null);
  assert.equal(classifyLink("C:\\notes\\a.md"), null);
  assert.equal(classifyLink("/notes/a.md"), null);
  assert.equal(classifyLink("#小节"), null);
  assert.equal(classifyLink("notes/a.txt"), null);
  assert.equal(classifyLink("notes/%E0%A4%A.md"), null);
  assert.equal(classifyLink("notes/\na.md"), null);
});

test("图片源仅 http/https、本地路径和相对路径", () => {
  assert.equal(classifyImageSource("https://example.com/a.png"), "https://example.com/a.png");
  assert.equal(classifyImageSource("assets/a.png"), "assets/a.png");
  assert.equal(classifyImageSource("C:\\notes\\a.png"), "C:\\notes\\a.png");
  assert.equal(classifyImageSource("data:image/png;base64,AAAA"), null);
  assert.equal(classifyImageSource("java\nscript:alert(1)"), null);
  assert.equal(classifyImageSource("//example.com/a.png"), null);
  assert.equal(classifyImageSource("file:///C:/a.png"), null);
  assert.equal(classifyImageSource(""), null);
});

test("标签与属性白名单不含可执行面", () => {
  for (const tag of ["script", "style", "iframe", "object", "embed", "form", "svg", "math"]) {
    assert.equal(ALLOWED_TAGS.includes(tag), false, `${tag} 不应在标签白名单`);
  }
  for (const attr of ["onerror", "onclick", "style", "class", "id", "srcdoc", "srcset", "target"]) {
    assert.equal(ALLOWED_ATTR.includes(attr), false, `${attr} 不应在属性白名单`);
  }
  assert.equal(ALLOWED_TAGS.includes("details"), true);
  assert.equal(ALLOWED_ATTR.includes("open"), true);
});

let failed = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error?.stack ?? error}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} 通过`);
process.exitCode = failed ? 1 : 0;
