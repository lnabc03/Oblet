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
  docHasLocalizableImages,
  isAbsoluteLocalSrc,
  isLocalizableImageSrc,
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

test("转换判定覆盖 assets/ 外的本地相对路径", () => {
  const doc = "C:/notes/sub/a.md";
  for (const src of [
    "../figure/a.jpg",
    "..\\figure\\a.jpg",
    "%2E%2E/figure/a.jpg",
    "figure/a.jpg",
    "./figure/a.jpg",
    "image.png",
    "assets2/a.jpg",
    "assets/../figure/a.jpg",
    "../assets/a.jpg",
  ]) {
    assert.equal(isLocalizableImageSrc(src, doc), true, src);
  }
  for (const src of [
    "assets/a.jpg",
    "./assets/a.jpg",
    "assets\\nested\\a.jpg",
    "%61ssets/a.jpg",
    "figure/../assets/a.jpg",
    "assets/../assets/a.jpg",
    "https://x.test/a.jpg",
    "data:image/png;base64,AAAA",
    "blob:https://x.test/id",
    "asset:localhost/C:/a.jpg",
  ]) {
    assert.equal(isLocalizableImageSrc(src, doc), false, src);
  }
  // 绝对引用即使在当前 assets/ 内，也仍需改成可移植的相对引用。
  assert.equal(isLocalizableImageSrc("C:/notes/sub/assets/a.jpg", doc), true);
  assert.equal(isLocalizableImageSrc("/sdcard/docs/assets/a.jpg", "/sdcard/docs/a.md"), true);
  assert.equal(isLocalizableImageSrc("assets/a.jpg", "/sdcard/docs/a.md"), false);
});

test("文档扫描让仅含上级相对路径的图片也能启用转换", () => {
  const fakeDoc = (nodes) => ({
    descendants(visit) {
      for (const [name, src] of nodes) {
        if (visit({ type: { name }, attrs: { src } }) === false) break;
      }
    },
  });
  const doc = "C:/notes/a.md";
  assert.equal(docHasLocalizableImages(fakeDoc([["image-block", "../figure/a.jpg"]]), doc), true);
  assert.equal(
    docHasLocalizableImages(fakeDoc([["image-block", "assets/a.jpg"], ["image", "../figure/a.jpg"]]), doc),
    true,
  );
  assert.equal(
    docHasLocalizableImages(fakeDoc([["image-block", "assets/a.jpg"], ["image", "https://x.test/a.jpg"]]), doc),
    false,
  );
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
