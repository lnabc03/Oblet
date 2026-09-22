// v0.7.0 块级图片交互：自绘 node view 替换上游 Vue viewer（$view 按节点 id 追加，
// 后注册者胜——本插件经 addFeature 在 Crepe 特性加载之后注册）。
// 三态：
//   空 src   → 占位框（Crepe .image-edit 视觉）+「设置图片」按钮 → 双参数面板
//   正常     → image-wrapper（operation 编辑按钮 + img + 缩放手柄，类名沿用上游
//              结构吃 Crepe 主题 CSS）+ caption 只读文本（title 槽位不丢，仅不编辑）
//   加载失败 → img 隐藏 + 错误占位框（原因经 Rust probe_image_path 分级），点击进面板
// 双参数面板：alt（[] 槽位）+ src（() 槽位）两个输入框，单事务提交（可撤销）；
// Enter 提交 / Esc 取消（Esc 由下方 guard 插件在 window 捕获阶段拦截全局关 tab）。
// 行内图片刻意不覆盖：误触风险高，可直接改文字。
import { $prose, $view } from "@milkdown/utils";
import type { NodeViewConstructor } from "@milkdown/prose/view";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { Node as PMNode } from "@milkdown/prose/model";
import { invoke } from "@tauri-apps/api/core";
import { imageBlockSchema, imageBlockConfig } from "@milkdown/components/image-block";
import { REMOTE_SRC_RE, resolveLocalAbs } from "./image-paths";

/** setup.ts 注入文档路径取值器（拖入换文件/重命名后 path 会变，必须实时取） */
let getDocPath: () => string = () => "";
export function setImageEditDocPath(getter: () => string) {
  getDocPath = getter;
}

/** 当前打开的双参数面板的取消回调（Esc guard 用；同一时刻至多一个面板） */
let activePanelCancel: (() => void) | null = null;

const WARN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const IMAGE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 5V19H5V5H19ZM19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM14.14 11.86L11.14 15.73L9 13.14L6 17H18L14.14 11.86Z"/></svg>`;

/** Esc 守卫：注册于插件 view 构造期（早于 setup.ts 的全局 Esc 关 tab 捕获监听），
 *  面板打开时拦截 Esc 取消编辑。注意捕获阶段 stopImmediatePropagation 会掐断整条
 *  传播链，Enter 不走这里（没有需要抢的窗口级监听），留在 input 自身 keydown 处理 */
export const imagePanelEscGuard = $prose(
  () =>
    new Plugin({
      key: new PluginKey("oblet-image-panel-esc-guard"),
      view() {
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Escape" && activePanelCancel) {
            e.stopImmediatePropagation();
            e.preventDefault();
            activePanelCancel();
          }
        };
        window.addEventListener("keydown", onKey, true);
        return {
          destroy() {
            window.removeEventListener("keydown", onKey, true);
          },
        };
      },
    })
);

export const imageBlockView = $view(
  imageBlockSchema.node,
  (ctx): NodeViewConstructor => {
    const config = ctx.get(imageBlockConfig.key);
    return (initialNode, view, getPos) => {
      const dom = document.createElement("div");
      dom.className = "milkdown-image-block";

      // 已渲染的 attrs 快照：update() 据此区分自身提交/缩放与外部变更（撤销、批量改写）
      let rendered = { ...initialNode.attrs } as {
        src: string;
        caption: string;
        alt: string;
        ratio: number;
      };
      let panelOpen = false;

      const setAttrs = (patch: Partial<typeof rendered>) => {
        if (!view.editable) return;
        const pos = getPos();
        if (pos == null) return;
        let tr = view.state.tr;
        for (const [k, v] of Object.entries(patch))
          tr = tr.setNodeAttribute(pos, k, v);
        view.dispatch(tr);
      };

      /** Windows 复制路径常带包裹引号（"C:\…"），提交时自动剥掉成对首尾引号 */
      const stripQuotes = (s: string) => {
        const t = s.trim();
        if (
          t.length >= 2 &&
          ((t.startsWith('"') && t.endsWith('"')) ||
            (t.startsWith("'") && t.endsWith("'")))
        )
          return t.slice(1, -1);
        return t;
      };

      // 面板两个输入框的当前引用（render 重建时刷新；提交/取消走它们读值）
      let altInputEl: HTMLInputElement | null = null;
      let srcInputEl: HTMLInputElement | null = null;

      const closePanel = () => {
        panelOpen = false;
        activePanelCancel = null;
        if (!rendered.src) syncContent(); // 空态：恢复占位框
        syncPanel();
      };

      const commitPanel = () => {
        if (!altInputEl || !srcInputEl) return closePanel();
        const src = stripQuotes(srcInputEl.value);
        const alt = altInputEl.value;
        closePanel();
        if (!src) return; // 空路径视为取消
        if (src === rendered.src && alt === rendered.alt) return;
        setAttrs({ src, alt });
      };

      /** 双参数面板：alt（[] 槽位）+ src（() 槽位），Crepe caption-input 风格
       *  （无边框居中输入条，不加确认/取消按钮——失焦自动提交、Esc 取消） */
      const buildPanelInputs = (): HTMLElement[] => {
        const altInput = document.createElement("input");
        altInput.className = "caption-input ob-img-alt";
        altInput.placeholder = "图注";
        altInput.spellcheck = false;
        altInput.value = rendered.alt;
        const srcInput = document.createElement("input");
        srcInput.className = "caption-input ob-img-src";
        srcInput.placeholder = "图片路径";
        srcInput.spellcheck = false;
        srcInput.value = rendered.src;
        altInputEl = altInput;
        srcInputEl = srcInput;
        for (const input of [altInput, srcInput]) {
          input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitPanel();
              view.focus();
            }
          });
          // 焦点离开两个输入框之外 = 提交（两框互跳不算离开）
          input.addEventListener("focusout", (e) => {
            const next = e.relatedTarget as globalThis.Node | null;
            if (next !== altInput && next !== srcInput) commitPanel();
          });
        }
        return [altInput, srcInput];
      };

      const openPanel = () => {
        if (!view.editable) return;
        panelOpen = true;
        if (!rendered.src) syncContent(); // 空态：撤占位框只留输入条（img 不动，无闪烁）
        syncPanel();
        activePanelCancel = closePanel;
        const src = srcInputEl;
        src?.focus();
        if (src && !src.value) src.select();
      };

      /** 错误占位框：图标 + 分级原因 + 原始路径；点击进面板（报错即修复入口）。
       *  src 必须由调用方按构建时快照传入——提交新 src 的中间渲染（旧 src 的 img）
       *  其 error 事件作为任务晚于 dispatch 触发，若读 rendered.src 实时值会拿
       *  新路径去 probe（结果 ok 却显示"图片加载失败"），实踩过 */
      const showError = async (img: HTMLImageElement, srcAtBuild: string) => {
        // 中间渲染的 img 已被 replaceChildren 摘除 / src 已变更 → 过期错误不处理
        if (!img.isConnected || rendered.src !== srcAtBuild) return;
        const src = srcAtBuild;
        let reason = "图片加载失败";
        if (src) {
          if (REMOTE_SRC_RE.test(src)) {
            reason = "网络图片加载失败";
          } else {
            const abs = resolveLocalAbs(src, getDocPath());
            if (abs) {
              try {
                const probe = await invoke<string>("probe_image_path", {
                  path: abs,
                });
                reason =
                  probe === "not_found"
                      ? "文件不存在"
                      : probe === "unreadable"
                        ? "无权限读取"
                        : probe === "not_image"
                          ? "文件不是有效图片"
                          : "图片加载失败";
              } catch {
                /* 保持通用文案 */
              }
            }
          }
        }
        // 异步期间 src 可能已被编辑（新 src 的 load/error 会另触发一轮）
        if (!dom.isConnected || !img.isConnected || rendered.src !== src) return;
        img.classList.add("ob-img-broken");
        let box = dom.querySelector<HTMLElement>(".ob-img-error");
        if (!box) {
          box = document.createElement("div");
          box.className = "ob-img-error";
          dom.querySelector(".image-wrapper")?.after(box);
        }
        box.replaceChildren();
        const icon = document.createElement("span");
        icon.className = "ob-img-error-icon";
        icon.innerHTML = WARN_ICON;
        const text = document.createElement("span");
        text.className = "ob-img-error-text";
        text.textContent = reason;
        const code = document.createElement("code");
        code.className = "ob-img-error-src";
        code.textContent = src;
        box.append(icon, text, code);
        if (view.editable) {
          const hint = document.createElement("span");
          hint.className = "ob-img-error-hint";
          hint.textContent = "编辑路径";
          // 点击入口收窄到 hint：盒体其余区域保持文本可选中（路径可复制）
          hint.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openPanel();
          });
          box.appendChild(hint);
        }
      };

      /** img onload：按上游算法定高（ratio 会话内存态）并摘除错误占位 */
      const onImageLoad = (img: HTMLImageElement) => {
        img.classList.remove("ob-img-broken");
        dom.querySelector(".ob-img-error")?.remove();
        let maxWidth = dom.getBoundingClientRect().width;
        if (!maxWidth) return;
        if (config.maxWidth && config.maxWidth < maxWidth)
          maxWidth = config.maxWidth;
        const { naturalHeight: height, naturalWidth: width } = img;
        if (!width) return;
        let transformedHeight =
          width < maxWidth ? height : maxWidth * (height / width);
        if (config.maxHeight && transformedHeight > config.maxHeight)
          transformedHeight = config.maxHeight;
        const h = (transformedHeight * (rendered.ratio || 1)).toFixed(2);
        img.dataset.origin = transformedHeight.toFixed(2);
        img.dataset.height = h;
        img.style.height = `${h}px`;
        if (config.maxWidth) img.style.maxWidth = `${config.maxWidth}px`;
      };

      const proxiedSrc = (): string => {
        const p = config.proxyDomURL?.(rendered.src);
        // proxyDomURL 允许返回 Promise；Oblet 的 toDomUrl 是同步实现，异步形态兜底原值
        if (typeof p === "string") return p;
        void p?.then((url) => {
          const img = dom.querySelector<HTMLImageElement>(".image-wrapper img");
          if (img) img.src = url;
        });
        return rendered.src;
      };

      const buildWrapper = (): HTMLElement => {
        const wrapper = document.createElement("div");
        wrapper.className = "image-wrapper";

        const operation = document.createElement("div");
        operation.className = "operation";
        const opBtn = document.createElement("div");
        opBtn.className = "operation-item";
        opBtn.title = "编辑 alt 与路径";
        // 必须套 span.milkdown-icon（inline-flex）——裸 svg 是 inline 元素，
        // 基线对齐会让 glyph 掉出圆形按钮底（实踩：圆圈与图标视觉分离成"两个按钮"）
        const opIcon = document.createElement("span");
        opIcon.className = "milkdown-icon";
        opIcon.innerHTML = (config.captionIcon ?? IMAGE_ICON).trim();
        opBtn.appendChild(opIcon);
        opBtn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (panelOpen) commitPanel(); // 再点按钮 = 关闭，走同一提交语义
          else openPanel();
        });
        operation.appendChild(opBtn);

        const img = document.createElement("img");
        img.dataset.type = "image-block";
        const srcAtBuild = rendered.src;
        img.src = proxiedSrc();
        img.alt = rendered.alt;
        img.addEventListener("load", () => onImageLoad(img));
        img.addEventListener("error", () => void showError(img, srcAtBuild));

        const handle = document.createElement("div");
        handle.className = "image-resize-handle";
        handle.addEventListener("pointerdown", (e) => {
          if (!view.editable) return;
          e.preventDefault();
          e.stopPropagation();
          const onMove = (ev: PointerEvent) => {
            ev.preventDefault();
            const top = img.getBoundingClientRect().top;
            let height = ev.clientY - top;
            if (height < 100) height = 100;
            if (config.maxHeight && height > config.maxHeight)
              height = config.maxHeight;
            const h = Number(height).toFixed(2);
            img.dataset.height = h;
            img.style.height = `${h}px`;
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            const origin = Number(img.dataset.origin);
            const current = Number(img.dataset.height);
            const ratio = Number.parseFloat(
              Number(current / origin).toFixed(2)
            );
            if (!Number.isNaN(ratio)) setAttrs({ ratio });
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        });

        wrapper.append(operation, img, handle);
        return wrapper;
      };

      /** 空 src 占位框（Crepe .image-edit 视觉）：点击按钮进双参数面板 */
      const buildEmpty = (): HTMLElement => {
        const box = document.createElement("div");
        box.className = "image-edit ob-img-empty";
        const icon = document.createElement("span");
        icon.className = "image-icon";
        icon.innerHTML = IMAGE_ICON;
        const text = document.createElement("span");
        text.className = "ob-img-empty-text";
        text.textContent = "未设置图片";
        const btn = document.createElement("button");
        btn.className = "confirm";
        btn.textContent = "设置图片";
        btn.disabled = !view.editable;
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openPanel();
        });
        box.append(icon, text, btn);
        return box;
      };

      // 内容层与面板层分开同步：面板开关只增删输入条，**不重建 img**——
      // 否则缩放过的图片在开关面板时被销毁重建，load 前闪回自然尺寸（实踩）
      const CONTENT_SELECTOR =
        ":scope > .image-wrapper, :scope > .ob-img-empty, :scope > .ob-img-caption, :scope > .ob-img-error";

      const syncContent = () => {
        dom
          .querySelectorAll(CONTENT_SELECTOR)
          .forEach((el) => el.remove());
        if (!rendered.src) {
          if (!panelOpen) dom.prepend(buildEmpty());
          return;
        }
        const wrapper = buildWrapper();
        dom.prepend(wrapper);
        // caption（markdown title 槽位）只读展示——不丢信息，编辑入口本期不给
        if (rendered.caption) {
          const cap = document.createElement("div");
          cap.className = "ob-img-caption";
          cap.textContent = rendered.caption;
          wrapper.after(cap);
        }
      };

      const syncPanel = () => {
        dom
          .querySelectorAll(":scope > .ob-img-alt, :scope > .ob-img-src")
          .forEach((el) => el.remove());
        altInputEl = null;
        srcInputEl = null;
        if (panelOpen) dom.append(...buildPanelInputs());
      };

      const render = () => {
        syncContent();
        syncPanel();
      };

      render();

      return {
        dom,
        update: (updatedNode: PMNode) => {
          if (updatedNode.type !== initialNode.type) return false;
          const a = updatedNode.attrs as typeof rendered;
          // ratio 是缩放 UI 高频自提交，src/alt/caption 未变就不重建（防 img 闪烁）
          if (
            a.src === rendered.src &&
            a.alt === rendered.alt &&
            a.caption === rendered.caption
          ) {
            rendered = { ...a };
            return true;
          }
          rendered = { ...a };
          if (panelOpen) {
            panelOpen = false;
            activePanelCancel = null;
          }
          render();
          return true;
        },
        stopEvent: (e) => {
          // 面板输入框与占位框/错误框内的交互不传给 PM；图片本体维持默认（点选节点）
          if (e.target instanceof HTMLInputElement) return true;
          return (
            e.target instanceof HTMLElement &&
            e.target.closest(".ob-img-empty, .ob-img-error") != null
          );
        },
        selectNode: () => dom.classList.add("selected"),
        deselectNode: () => dom.classList.remove("selected"),
        destroy: () => {
          if (activePanelCancel === closePanel) activePanelCancel = null;
          dom.remove();
        },
      };
    };
  }
);
