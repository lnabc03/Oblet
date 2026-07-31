// Oblet 编辑器装配（Crepe 底座）与文件生命周期
// 流程：取窗口文件 → 读文件 → 建 Crepe → 防抖自动保存 / Ctrl+S → 外部变更监听
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Crepe } from "@milkdown/crepe";
import { replaceAll, $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { initTypography } from "../settings/typography";
import { initSettingsUI } from "../settings/ui";
import { obletPlugins } from "./plugins";
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
      <p class="muted small">Ctrl+, 打开设置</p>
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

  // Ctrl+S 立即保存
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      window.clearTimeout(saveTimer);
      void flushSave();
    }
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
      },
      // 斜杠菜单删减（项配置为 null 即不列出，语法本身不受影响）：
      // 去掉 Quote/Divider/H4-H6/Image/Math，保留 Text、H1-H3、三种列表、Code、Table
      [Crepe.Feature.BlockEdit]: {
        textGroup: { h4: null, h5: null, h6: null, quote: null, divider: null },
        advancedGroup: { image: null, math: null },
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
      .use(disableEmptyLineBr)
  );

  // 序列化保真（必须在 create 前的 config 阶段生效）
  crepe.editor.config(tuneSerialization);

  await crepe.create();
  if (payload.readonly) crepe.setReadonly(true);
  await invoke("watch_file", { path });

  // ---- 外部变更：无脏内容自动重载，有则提示 ----
  const winLabel = getCurrentWindow().label;
  const showTip = (text: string) => {
    const tip = document.createElement("div");
    tip.className = "external-change-tip";
    tip.textContent = text;
    app.prepend(tip);
    setTimeout(() => tip.remove(), 6000);
  };
  await listen(`file-changed:${winLabel}`, async () => {
    if (!dirty && !saving) {
      let fresh: FilePayload;
      try {
        fresh = await invoke<FilePayload>("read_file", { path });
      } catch {
        showTip("文件已被外部删除或移动。");
        return;
      }
      payload.newline = fresh.newline;
      lastContent = fresh.content.replace(/\r\n/g, "\n");
      suppressSave = true;
      crepe.editor.action(replaceAll(fresh.content));
      suppressSave = false;
    } else {
      showTip("文件已被外部修改，当前有未保存内容，未自动重载。");
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
      showTip("当前文件保存失败，未切换新文件。");
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
