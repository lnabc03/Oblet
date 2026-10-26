// 共享路径工具的跨平台直测：Windows 反斜杠、POSIX 斜杠、UNC 与相对解析。
// 运行：node scripts/test-paths.mjs
import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  root: process.cwd(),
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

let paths;
try {
  paths = await vite.ssrLoadModule("/src/editor/image-paths.ts");
} finally {
  await vite.close();
}

const {
  baseNameOf,
  dirnameOf,
  isAbsoluteLocalSrc,
  joinResolve,
  pathKey,
  resolveLocalAbs,
} = paths;

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("basename 同时识别反斜杠与正斜杠", () => {
  for (const p of ["C:\\notes\\a.md", "C:/notes/a.md", "/notes/a.md", "notes\\a.md", "a.md"]) {
    assert.equal(baseNameOf(p), "a.md", p);
  }
  assert.equal(baseNameOf("C:\\notes\\"), "notes");
  assert.equal(baseNameOf("/"), "");
});

test("dirname 同时识别反斜杠与正斜杠", () => {
  assert.equal(dirnameOf("C:\\notes\\a.md"), "C:\\notes");
  assert.equal(dirnameOf("C:/notes/a.md"), "C:/notes");
  assert.equal(dirnameOf("/notes/a.md"), "/notes");
  assert.equal(dirnameOf("a.md"), "a.md");
});

test("joinResolve 归一化相对段且不弹出盘符/UNC 锚点", () => {
  assert.equal(joinResolve("C:\\notes", "assets/a.png"), "C:/notes/assets/a.png");
  assert.equal(joinResolve("C:\\notes", "../a.png"), "C:/a.png");
  assert.equal(joinResolve("C:\\notes", "../../../a.png"), "C:/a.png");
  assert.equal(joinResolve("\\\\host\\share\\docs", "../a.png"), "//host/share/a.png");
  assert.equal(joinResolve("/a/b", "../../x"), "/x");
});

test("resolveLocalAbs 区分远程、绝对与相对路径", () => {
  assert.equal(resolveLocalAbs("https://x.test/a.png", "C:\\notes\\a.md"), null);
  assert.equal(resolveLocalAbs("data:image/png;base64,AAAA", "C:\\notes\\a.md"), null);
  assert.equal(resolveLocalAbs("C:\\images\\a.png", "C:\\notes\\a.md"), "C:\\images\\a.png");
  assert.equal(resolveLocalAbs("assets/a.png", "C:\\notes\\a.md"), "C:/notes/assets/a.png");
  assert.equal(resolveLocalAbs("../assets/a.png", "C:/notes/a.md"), "C:/assets/a.png");
});

test("绝对路径判定兼容 URI 编码盘符", () => {
  assert.equal(isAbsoluteLocalSrc("C:\\images\\a.png"), true);
  assert.equal(isAbsoluteLocalSrc("C:/images/a.png"), true);
  assert.equal(isAbsoluteLocalSrc("/images/a.png"), true);
  assert.equal(isAbsoluteLocalSrc("\\\\host\\share\\a.png"), true);
  assert.equal(isAbsoluteLocalSrc("%43%3A%5Cimages%5Ca.png"), true);
  assert.equal(isAbsoluteLocalSrc("assets/a.png"), false);
  assert.equal(isAbsoluteLocalSrc("https://x.test/a.png"), false);
});

test("pathKey 只统一分隔符（大小写策略由平台决定）", () => {
  assert.equal(pathKey("A\\B\\c.md"), pathKey("A/B/c.md"));
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
