# Android 开发环境搭建指引（Windows）

> 面向零移动端经验的开发者。全程约 1.5~2.5 小时（大头是下载），需磁盘空间约 10 GB。
> 完成标准：最后一节的「验收」两条命令都能跑通。
> 日期：2026-09-28 · 配套《android-feasibility.md》实施顺序第 1 周

## 总览（先建立心智模型）

Oblet 安卓版 = **Rust 交叉编译成 `.so` 原生库** + **前端 dist** + **一个 Kotlin 空壳工程**（`tauri android init` 自动生成，把两者装在一起）。你需要装的只有三样：

1. **Android SDK**（编译/打包工具链，含 adb 调试工具）
2. **Android NDK**（把 Rust 编成 ARM 原生库的交叉编译器）
3. **Rust 的 Android target**（告诉 rustc 怎么面向 ARM 出码）

全部通过 Android Studio 和 rustup 安装，不需要手写任何 Kotlin。

## 第一步：装 Android Studio（约 30~60 分钟）

1. 下载：https://developer.android.com/studio （约 1.1 GB 安装包）。国内直连通常可用；慢的话用国内镜像（腾讯/阿里云镜像站均有）。
2. 安装时保持默认勾选（Android SDK、Android Virtual Device 等全部要）。
3. 首次启动会问是否导入设置，选不导入；走 Standard 安装类型，让它把 SDK 下载完。
4. 装完后打开 **More Actions → SDK Manager**（或欢迎页的 SDK Manager），确认以下组件已装（缺啥勾啥，Apply 下载）：
   - **SDK Platforms 标签页**：勾一个 Android 13（API 33）或以上版本
   - **SDK Tools 标签页**（右上角勾 Show Package Details）：
     - Android SDK Build-Tools
     - **NDK (Side by side)** ← Rust 交叉编译必需，最容易漏
     - Android SDK Command-line Tools (latest)
     - Android Emulator（要用模拟器才需要）
     - Android SDK Platform-Tools（含 adb）

> 装完后 NDK 落在 `Sdk\ndk\<版本号>\` 目录下，后面配环境变量要用到这个版本号目录名。

## 第二步：配环境变量（5 分钟）

按 `Win + S` 搜「编辑系统环境变量」→「环境变量」，在**用户变量**里新建/追加：

| 变量 | 值（按实际安装路径调整） |
| --- | --- |
| `ANDROID_HOME` | `C:\Users\wjs_R\AppData\Local\Android\Sdk` |
| `NDK_HOME` | `C:\Users\wjs_R\AppData\Local\Android\Sdk\ndk\<版本号>` |
| `JAVA_HOME` | `C:\Program Files\Android\Android Studio\jbr`（Android Studio 自带 JDK，不用另装 Java） |
| `Path` 追加 | `%ANDROID_HOME%\platform-tools` |

**改完必须重开终端才生效**（Claude Code 会话也要重启）。验证：

```bash
adb --version          # 能打印版本号
echo $ANDROID_HOME     # Git Bash 下这样看；cmd 用 echo %ANDROID_HOME%
```

## 第三步：Rust 安卓 target（2 分钟）

```bash
rustup target add aarch64-linux-android   # 真机/发布用这个（D3：仅 arm64）
rustup target add x86_64-linux-android    # 用模拟器调试才需要（Windows 模拟器是 x86_64）
```

> **国内网络必看**：rustup 下载 rust-std 组件极易卡死（实踩：卡 10+ 分钟无进度）。卡死就 Ctrl+C，挂中科大镜像重跑：
> ```bash
> export RUSTUP_DIST_SERVER="https://mirrors.ustc.edu.cn/rust-static"
> export RUSTUP_UPDATE_ROOT="https://mirrors.ustc.edu.cn/rust-static/rustup"
> ```
> 同理 crates.io 也建议配镜像（`~/.cargo/config.toml`）：
> ```toml
> [source.crates-io]
> replace-with = 'rsproxy-sparse'
> [source.rsproxy-sparse]
> registry = "sparse+https://rsproxy.cn/index/"
> ```
> 注意 `tauri android init` 会默认安装全部 4 个 target（armv7/arm64/x86/x86_64），嫌慢可以先按上面镜像手动 `rustup target add` 装齐再 init（init 会跳过已装的）。

> 模拟器说明：Windows 上的安卓模拟器是 x86_64 架构，arm64-only 的 APK 跑不了/极慢。所以**日常调试优先真机**（见第五步）；没真机才加第二个 target 用模拟器。发布包仍只出 arm64。

## 第四步：初始化安卓工程（1 分钟，在仓库根目录）

```bash
npm run tauri android init
```

在 `src-tauri/gen/android/` 生成 Kotlin 工程。**这个目录要提交 git**（`.gitignore` 若有排除要放行，init 后检查 `git status`）。

> **必须在真实路径下运行（重要，实踩）**：若仓库是通过符号链接/重解析点访问的（典型：桌面放了个指向 D 盘仓库的目录链接），`tauri android` 全系命令（init/dev/build）会在启动瞬间 panic：
> `AssetDirOutsideOfAppRoot { asset_dir: "assets", root_dir: "..." }`
> 原因：cargo-mobile2 校验 asset 目录时用 canonicalize 解析路径——它会穿透符号链接得到真实路径（如 `D:\个人文档\...`），而 root_dir 保持链接路径（如 `C:\Users\...\Desktop\...`），两侧字符串前缀比较失败。与 CWD 无关、换目录跑也没用。**解法：cd 到 canonicalize 之后的真实路径再跑**。查真实路径：Node `fs.realpathSync.native('<链接路径>')` 或 PowerShell `(Get-Item <链接>).Target` 逐跳解析。本机实例：桌面 `Oblet`、`PROJECTS` 全是重解析点，真实路径 `D:\个人文档\PROJECTS\Oblet`。

## 第五步：跑起来

**方式 A：真机调试（推荐）**

1. 手机开「开发者选项」（设置 → 关于手机 → 连点「版本号」7 次）→ 打开「USB 调试」
2. USB 连电脑，手机上弹出的 RSA 授权点允许
3. `adb devices` 能看到设备即就绪（要求 Android 11+，D2）

**方式 B：模拟器**

有 Android Studio 就走 GUI：Device Manager → Create Device → 选 API 30+ 的 x86_64 镜像。
纯命令行（实踩可行，无需 Android Studio GUI）：

```bash
sdkmanager "emulator" "system-images;android-34;google_apis;x86_64"   # 装模拟器+系统镜像（约 1~2 GB）
avdmanager create avd -n oblet_dev -k "system-images;android-34;google_apis;x86_64" -d pixel_6
emulator -avd oblet_dev                                                # 启动（保持窗口开着）
adb wait-for-device && adb shell getprop sys.boot_completed            # 等到输出 1
```

> 注意：sdkmanager/avdmanager 在 `%ANDROID_HOME%\cmdline-tools\latest\bin\`，且 avdmanager 不认 `--sdk_root` 全局位，直接配好 `ANDROID_HOME` 环境变量再跑即可。

然后：

```bash
npm run tauri android dev    # 开发模式：编译 Rust 全依赖（首次 10~30 分钟）+ 部署到设备 + 热更新前端
```

> **vite 必须监听局域网地址（实踩）**：`tauri android dev` 会让设备经局域网 IP 访问前端 dev server（日志：`Replacing devUrl host with 192.168.x.x`）。若 vite 只听 localhost，CLI 会一直卡 `Waiting for your frontend dev server to start on http://192.168.x.x:1420/`。解法：`vite.config.ts` 的 `server` 加 `host: process.env.TAURI_DEV_HOST || false`（CLI 运行 beforeDevCommand 时会注入该变量；桌面开发未注入则仍 localhost）。本仓库已配置。

> **路径含非 ASCII 字符必看（实踩）**：仓库在中文路径下（如 `D:\个人文档\...`）时，编译能过但**链接失败**：
> `ld.lld: error: cannot open D:\个人文档\...symbols.o: unspecified system_category error`（同批还有 `cannot find version script ...\list`）。原因是 NDK 的 ld.lld 按 ANSI 代码页处理路径，中文目录打不开。解法：把构建产物目录指到纯英文路径（源码目录不用动）：
> ```bash
> set CARGO_TARGET_DIR=C:\Users\wjs_R\oblet-android-target
> npm run tauri android dev
> ```
> 注意换目录等于放弃增量缓存，首次会全量重编。tauri CLI 经 `cargo metadata` 定位产物，能正确识别该变量。

**国内网络提示**：首次构建 Gradle 要下载大量依赖，如果卡在下载，配阿里云镜像：编辑 `src-tauri/gen/android/build.gradle.kts` 和 `settings.gradle.kts` 中的仓库声明，在 `google()` 前加 `maven("https://maven.aliyun.com/repository/google")` 和 `maven("https://maven.aliyun.com/repository/central")`。

## 验收（两条都过 = 环境就绪）

```bash
cd src-tauri && cargo check --target aarch64-linux-android   # Rust 交叉编译通过
npm run tauri android dev                                     # App 在设备/模拟器上起来，能看到起始页
```

## 出包（以后用到）

```bash
npm run tauri android build -- --apk    # 产出 APK（签名按 D11 另配）
```

## 常见问题速查

| 症状 | 原因 |
| --- | --- |
| `ANDROID_HOME is not set` / NDK 找不到 | 环境变量没配或没重开终端；NDK_HOME 必须指到 `ndk\<版本号>` 这一层 |
| gradle 下载超时 | 国内网络，配阿里云 maven 镜像（见第五步） |
| 模拟器装不上 APK | 模拟器是 x86_64，缺 `x86_64-linux-android` target |
| `adb devices` 看不到手机 | USB 调试没开 / RSA 授权没点 / 换数据线（有些线只能充电） |
| cargo 报 linker 错误 | NDK 没装或 NDK_HOME 指错版本目录 |
| 链接期 `ld.lld: cannot open D:\中文\...*.o` / `cannot find version script` | NDK 链接器不认非 ASCII 路径。设纯英文 `CARGO_TARGET_DIR` 再跑（见第五步） |
| CLI 卡 `Waiting for your frontend dev server to start on http://192.168...` | vite 只听 localhost，`server.host` 加 `process.env.TAURI_DEV_HOST \|\| false`（见第五步） |
| 启动即 panic：`AssetDirOutsideOfAppRoot { asset_dir: "assets" }` | 仓库路径上有符号链接/重解析点，canonicalize 穿透后路径对不上。cd 到真实路径再跑（见第四步警告） |
