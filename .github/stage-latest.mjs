// 版本发布后的本地 chore：把当前版本对应的正式 Release 资产整理到固定 latest 目录。
// 用法：npm run stage:latest（需要 gh 已登录，且该版本的 CI 资产已上传）。
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const releaseDir = join(root, "release");
const version = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")
).version;
const zipName = `Oblet-${version}-win-x64.zip`;
const apkName = `Oblet-${version}-android-arm64.apk`;
const desktopTarget = join(releaseDir, "Oblet-latest-win-x64");
const androidTarget = join(releaseDir, "Oblet-latest-android-arm64");
const work = mkdtempSync(join(releaseDir, ".stage-latest-"));

function run(command, args) {
  let lastStatus = "unknown";
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status === 0) return;
    lastStatus = result.status ?? "unknown";
    if (attempt < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  throw new Error(`${command} 执行失败（退出码 ${lastStatus}）`);
}

function psQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function syncDirectory(source, target, purge = false) {
  const result = spawnSync("robocopy", [
    source, target,
    purge ? "/MIR" : "/E",
    "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP",
  ], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  // robocopy 的 0～7 均表示成功；8 及以上才是失败。
  if (result.status == null || result.status > 7) {
    throw new Error(`robocopy 同步失败（退出码 ${result.status ?? "unknown"}）`);
  }
}

try {
  const download = join(work, "download");
  const desktopNext = join(work, "win-x64");
  const androidNext = join(work, "android-arm64");
  mkdirSync(download, { recursive: true });
  mkdirSync(desktopNext, { recursive: true });
  mkdirSync(androidNext, { recursive: true });

  run("gh", [
    "release", "download", `v${version}`,
    "--pattern", zipName,
    "--pattern", apkName,
    "--clobber",
    "--dir", download,
  ]);

  const zipPath = join(download, zipName);
  const apkPath = join(download, apkName);
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(desktopNext)} -Force`,
  ], { stdio: "inherit" });

  const stagedExe = join(desktopNext, "oblet.exe");
  if (!existsSync(stagedExe) || statSync(stagedExe).size === 0) {
    throw new Error("桌面 ZIP 中缺少有效的 oblet.exe");
  }
  copyFileSync(apkPath, join(androidNext, apkName));
  if (sha256(apkPath) !== sha256(join(androidNext, apkName))) {
    throw new Error("安卓 APK 拷贝哈希不一致");
  }

  syncDirectory(desktopNext, desktopTarget);
  syncDirectory(androidNext, androidTarget, true);
  console.log(`desktop -> ${desktopTarget}`);
  console.log(`android -> ${join(androidTarget, apkName)}`);
  console.log(`android sha256 -> ${sha256(join(androidTarget, apkName))}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
