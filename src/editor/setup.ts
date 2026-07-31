// Oblet 编辑器装配（Crepe 底座）与文件生命周期
// 流程：取窗口文件 → 读文件 → 建 Crepe → 防抖自动保存 / Ctrl+S → 外部变更监听
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Crepe } from "@milkdown/crepe";
import { replaceAll, $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { languages } from "@codemirror/language-data";
import { initTypography } from "../settings/typography";
import { initSettingsUI } from "../settings/ui";
import { obletPlugins } from "./plugins";
import { searchPlugin } from "./search";
import { contextMenuPlugin } from "./contextmenu";
import { toolbarConfig } from "./toolbar";
import { notify } from "../notify";
import { registerCommand } from "../commands";
import logoUrl from "../assets/logo.png";
import {
  disableEmptyLineBr,
  frontmatterRemark,
  frontmatterSchema,
  frontmatterView,
  taskListSpaceTrim,
  tuneSerialization,
} from "./frontmatter";

interface FilePayload {
  content: string;
  newline: string;
  readonly: boolean;
  readonly_reason: string | null;
}

const AUTOSAVE_DELAY = 1000;

/** 路径归一化比较（拖放路径与登记路径可能一个规范化一个不曾） */
function samePath(a: string, b: string) {
  return a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
}

// ---- 图片 src 解析（3.7）：网络/data 图原样放行；本地路径经 asset 协议转换 ----
// 相对路径相对当前 md 文件所在目录解析（对齐 Ob/VSCode 惯例）；
// 渲染只影响 DOM src，文档里的 src 原文不动（保真原则的渲染侧体现）
const REMOTE_SRC_RE = /^(https?:|data:|blob:|asset:|tauri:)/i;
const ABS_PATH_RE = /^([a-zA-Z]:[\\/]|\\\\|\/)/;

function decodeMaybe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function dirnameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i < 0 ? p : p.slice(0, i);
}

/** 拼合 dir 与 rel 并归一化 . / .. 段（保留盘符与 UNC 前缀） */
function joinResolve(dir: string, rel: string): string {
  const combined = `${dir}\\${rel}`;
  const unc = combined.startsWith("\\\\");
  const parts = combined.split(/[\\/]+/).filter(Boolean);
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === ".") continue;
    if (seg === "..") {
      // 盘符（C:）与 UNC 主机\共享名不可弹出
      if (out.length > (unc ? 2 : 1)) out.pop();
      continue;
    }
    out.push(seg);
  }
  return (unc ? "\\\\" : "") + out.join("\\");
}

export async function boot() {
  const app = document.getElementById("app")!;
  await initTypography();
  void initSettingsUI(app);
  const initialPath = await invoke<string | null>("get_window_file");

  if (!initialPath) {
    // 不能用 app.innerHTML 赋值：会把 initSettingsUI 追加进 #app 的设置浮层一起抹掉
    // （按钮挂在 body 上幸存，点击时切换的已是脱离文档的节点 → 起始页设置打不开）
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <img class="empty-logo" src="${logoUrl}" alt="Oblet">
      <p class="empty-title">Oblet</p>
      <p class="muted">双击任意 .md 文件即可编辑，或将文件拖入窗口</p>
      <p class="empty-author">弋鹓 | lnabc03</p>`;
    app.appendChild(empty);
    // 空窗口：登记路径后重载，走正常启动流程
    await getCurrentWindow().onDragDropEvent(async (e) => {
      if (e.payload.type !== "drop") return;
      const md = e.payload.paths.find((p) => p.toLowerCase().endsWith(".md"));
      if (!md) return;
      await invoke("set_window_file", { path: md });
      location.reload();
    });
    return;
  }

  let path = initialPath;
  const payload = await invoke<FilePayload>("read_file", { path });

  /** 图片 DOM src 解析：远程原样；本地绝对/相对路径转 asset 协议。
   *  闭包读的是 let path，拖入换文件后 replaceAll 重渲染自动跟随新目录 */
  const toDomUrl = (src: string): string => {
    if (!src || REMOTE_SRC_RE.test(src)) return src;
    const decoded = decodeMaybe(src);
    const abs = ABS_PATH_RE.test(decoded)
      ? decoded
      : joinResolve(dirnameOf(path), decoded);
    return convertFileSrc(abs);
  };

  // 编辑器容器：对齐 Ob 阅读视图类名
  const host = document.createElement("div");
  host.className = "markdown-rendered";
  app.appendChild(host);

  // 只读横幅（拖入换文件时按新文件的只读状态增删）
  let banner: HTMLElement | null = null;
  const updateBanner = () => {
    if (payload.readonly_reason) {
      if (!banner) {
        banner = document.createElement("div");
        banner.className = "readonly-banner";
        app.prepend(banner);
      }
      banner.textContent = payload.readonly_reason;
    } else {
      banner?.remove();
      banner = null;
    }
  };
  updateBanner();

  // ---- 保存状态机 ----
  let dirty = false;
  let saving = false;
  let pendingSave = false;
  let suppressSave = false; // replaceAll 期间不触发自动保存
  let saveTimer: number | undefined;
  // 内容与磁盘一致的判定基准（getMarkdown 总是 LF，比较前归一化）
  let lastContent = payload.content.replace(/\r\n/g, "\n");

  /** 立即保存；返回是否成功（只读视为成功——无需保存） */
  const flushSave = async (): Promise<boolean> => {
    if (payload.readonly || !crepe) return true;
    if (saving) {
      pendingSave = true;
      return true;
    }
    const md = crepe.getMarkdown();
    // 内容与磁盘一致：不写回（未编辑不写回的最后防线）
    if (md === lastContent) {
      dirty = false;
      return true;
    }
    saving = true;
    try {
      await invoke("write_file", { path, content: md, newline: payload.newline });
      lastContent = md;
      dirty = false;
      return true;
    } catch (e) {
      console.error("保存失败:", e);
      notify(`保存失败：${e}`, "error");
      return false;
    } finally {
      saving = false;
      if (pendingSave) {
        pendingSave = false;
        void flushSave();
      }
    }
  };

  const scheduleSave = () => {
    dirty = true;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(), AUTOSAVE_DELAY);
  };

  // Ctrl+S 立即保存（4.4 起经命令注册表统一派发，键位可在设置中覆盖）
  registerCommand({
    id: "save",
    title: "保存",
    defaultCombo: "Ctrl+S",
    run: () => {
      window.clearTimeout(saveTimer);
      void flushSave();
    },
  });

  const crepe = new Crepe({
    root: host,
    defaultValue: payload.content,
    features: {
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.TopBar]: false,
      [Crepe.Feature.Placeholder]: false, // 关掉空行 "Please enter" 提示
    },
    featureConfigs: {
      [Crepe.Feature.CodeMirror]: {
        // 块级公式（$$ 在模型里是 language=LaTeX 的代码块）：
        // Crepe latex 特性自带 KaTeX 预览渲染，这里只需默认隐藏源码编辑栏，
        // 点工具栏 Edit 才展开
        previewOnlyByDefault: true,
        // 语言列表：Crepe 不传 languages 时会以空数组覆盖组件默认配置，
        // 导致语言选择弹出空白——显式传入 language-data 全量预设（高亮按需懒加载）
        languages,
      },
      // 斜杠菜单删减（项配置为 null 即不列出，语法本身不受影响）：
      // 去掉 Quote/Divider/H4-H6/Image/Math，保留 Text、H1-H3、三种列表、Code、Table
      [Crepe.Feature.BlockEdit]: {
        textGroup: { h4: null, h5: null, h6: null, quote: null, divider: null },
        advancedGroup: { image: null, math: null },
      },
      // 快捷操作栏追加：==高亮== 开关 + callout 包裹（见 toolbar.ts）
      [Crepe.Feature.Toolbar]: toolbarConfig,
      // 图片：本地路径（绝对/相对）经 asset 协议渲染（块级与行内共用此钩子）
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: toDomUrl,
        // 粘贴/拖入图片落盘：Crepe 默认 blob: 内存 URL 保存后重开即失效，
        // 复制到 md 同目录 assets/ 并返回相对引用（对齐 Obsidian 附件行为）
        onUpload: async (file: File) => {
          const data = Array.from(new Uint8Array(await file.arrayBuffer()));
          return await invoke<string>("save_image_asset", {
            name: file.name || "image.png",
            data,
          });
        },
      },
    },
  });

  // 只有真实用户编辑才标脏：插件自动修正（trailing 补尾段、列表重编号等）
  // 走 appendTransaction，其事务带 appendedTransaction 元数据，过滤掉；
  // 打字/粘贴/撤销/工具栏命令都是直接派发的事务，正常标脏
  const userEditTracker = $prose(
    () =>
      new Plugin({
        key: new PluginKey("oblet-user-edit-tracker"),
        appendTransaction(trs) {
          if (
            !suppressSave &&
            !payload.readonly &&
            trs.some(
              (tr) => tr.docChanged && tr.getMeta("appendedTransaction") == null
            )
          ) {
            scheduleSave();
          }
          return null;
        },
      })
  );

  crepe.addFeature((editor) =>
    editor
      .use(obletPlugins)
      .use(frontmatterSchema.node)
      .use(frontmatterSchema.ctx)
      .use(frontmatterView)
      .use(frontmatterRemark.options)
      .use(frontmatterRemark.plugin)
      .use(taskListSpaceTrim.options)
      .use(taskListSpaceTrim.plugin)
      .use(userEditTracker)
      .use(searchPlugin)
      .use(contextMenuPlugin)
      .use(disableEmptyLineBr)
  );

  // 序列化保真（必须在 create 前的 config 阶段生效）
  crepe.editor.config(tuneSerialization);

  await crepe.create();
  if (payload.readonly) crepe.setReadonly(true);
  await invoke("watch_file", { path });

  // 外链点击调系统默认浏览器：webview 对 target=_blank 不处理（悬浮窗网址点击无响应）。
  // 只劫持浮层里的链接（链接预览悬浮窗等）；正文 .ProseMirror 内的 a 是编辑态，
  // 点击是定位光标，不能拦。capture 阶段拦截，抢在浮层自身处理器之前
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      const a = el.closest("a[href]");
      if (!a || a.closest(".ProseMirror")) return;
      const href = a.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      invoke("open_url", { url: href }).catch((err) =>
        notify(`打开链接失败：${err}`, "error")
      );
    },
    true
  );

  // ---- 外部变更：无脏内容自动重载，有则提示 ----
  const winLabel = getCurrentWindow().label;
  await listen(`file-changed:${winLabel}`, async () => {
    if (!dirty && !saving) {
      let fresh: FilePayload;
      try {
        fresh = await invoke<FilePayload>("read_file", { path });
      } catch {
        notify("文件已被外部删除或移动。", "warn");
        return;
      }
      payload.newline = fresh.newline;
      lastContent = fresh.content.replace(/\r\n/g, "\n");
      suppressSave = true;
      crepe.editor.action(replaceAll(fresh.content));
      suppressSave = false;
    } else {
      notify("文件已被外部修改，当前有未保存内容，未自动重载。", "warn");
    }
  });

  // ---- 拖入 .md：原窗口就地渲染新文件 ----
  await getCurrentWindow().onDragDropEvent(async (e) => {
    if (e.payload.type !== "drop") return;
    const md = e.payload.paths.find((p) => p.toLowerCase().endsWith(".md"));
    if (!md || samePath(md, path)) return;

    // 先落盘当前文件；保存失败则不切换，避免丢内容
    window.clearTimeout(saveTimer);
    if (dirty && !(await flushSave())) {
      notify("当前文件保存失败，未切换新文件。", "error");
      return;
    }

    const fresh = await invoke<FilePayload>("read_file", { path: md });
    await invoke("set_window_file", { path: md }); // 换登记路径 + 更新窗口标题
    await invoke("watch_file", { path: md }); // 监听器换绑新文件
    path = md;
    payload.newline = fresh.newline;
    payload.readonly = fresh.readonly;
    payload.readonly_reason = fresh.readonly_reason;
    lastContent = fresh.content.replace(/\r\n/g, "\n");
    dirty = false;
    pendingSave = false;

    suppressSave = true;
    crepe.editor.action(replaceAll(fresh.content));
    suppressSave = false;
    crepe.setReadonly(fresh.readonly);
    updateBanner();
  });
}
