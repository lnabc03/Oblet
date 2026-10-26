// HTML 渲染岛 NodeView 与交互：块级源码面板、details 摘要、行内 atom 和链接点击。
import { $prose, $view } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { EditorView, NodeView } from "@milkdown/prose/view";
import { parseSingleTag } from "./html-lexer";
import { openRenderedLink, renderHtmlInto } from "./html-render";
import {
  hasOpenAttribute,
  htmlBlockSchema,
  htmlDetailsSchema,
  htmlInlineAtomSchema,
  stringAttr,
  updateHtmlBlockSource,
  updateHtmlDetailsSource,
} from "./html-schema";

let activeSourceCancel: (() => void) | null = null;

export const htmlSourceEscGuard = $prose(
  () =>
    new Plugin({
      key: new PluginKey("oblet-html-source-esc-guard"),
      view() {
        const onKey = (event: KeyboardEvent) => {
          if (event.key === "Escape" && activeSourceCancel) {
            event.stopImmediatePropagation();
            event.preventDefault();
            activeSourceCancel();
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

function sourceButton(label = "源码"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ob-html-source-button";
  button.textContent = label;
  button.title = "查看 / 编辑 HTML 源码";
  return button;
}

function sourceArea(value: string, label: string): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.className = "ob-html-source-input";
  textarea.value = value;
  textarea.spellcheck = false;
  textarea.setAttribute("aria-label", label);
  return textarea;
}

function wireSourceArea(
  area: HTMLTextAreaElement,
  panel: HTMLElement,
  commit: () => boolean,
  cancel: () => void
) {
  area.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (commit()) area.focus();
    }
  });
  area.addEventListener("focusout", (event) => {
    const next = event.relatedTarget as globalThis.Node | null;
    if (next && panel.contains(next)) return;
    commit();
  });
  area.addEventListener("input", () => area.removeAttribute("aria-invalid"));
}

export const htmlBlockView = $view(htmlBlockSchema.node, () => {
  return (initialNode, view, getPos): NodeView => {
    let node = initialNode;
    const dom = document.createElement("div");
    dom.className = "ob-html-node ob-html-block";
    dom.contentEditable = "false";
    const toolbar = document.createElement("div");
    toolbar.className = "ob-html-toolbar";
    const button = sourceButton();
    toolbar.appendChild(button);
    const render = document.createElement("div");
    render.className = "ob-html-render";
    const panel = document.createElement("div");
    panel.className = "ob-html-source";
    panel.hidden = true;
    const area = sourceArea(stringAttr(node.attrs.value), "HTML 块源码");
    panel.appendChild(area);
    dom.append(toolbar, render, panel);
    let panelOpen = false;

    const close = () => {
      panelOpen = false;
      panel.hidden = true;
      area.value = stringAttr(node.attrs.value);
      area.removeAttribute("aria-invalid");
      if (activeSourceCancel === close) activeSourceCancel = null;
    };
    const commit = (): boolean => {
      if (!panelOpen) return false;
      const pos = typeof getPos === "function" ? getPos() : undefined;
      const value = area.value;
      if (pos == null || value === stringAttr(node.attrs.value)) {
        close();
        return true;
      }
      if (!updateHtmlBlockSource(view, pos, value)) {
        area.setAttribute("aria-invalid", "true");
        return false;
      }
      close();
      return true;
    };
    const open = () => {
      if (!view.editable) return;
      activeSourceCancel?.();
      panelOpen = true;
      panel.hidden = false;
      area.value = stringAttr(node.attrs.value);
      activeSourceCancel = close;
      area.focus();
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (panelOpen) commit();
      else open();
    });
    wireSourceArea(area, panel, commit, close);
    renderHtmlInto(render, stringAttr(node.attrs.value));
    dom.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const a = target.closest<HTMLAnchorElement>("a[data-ob-html-link]");
      if (!a || !render.contains(a)) return;
      event.preventDefault();
      event.stopPropagation();
      openRenderedLink(a);
    });

    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        const changed = next.attrs.value !== node.attrs.value;
        node = next;
        if (changed) {
          close();
          renderHtmlInto(render, stringAttr(node.attrs.value));
        }
        return true;
      },
      stopEvent: (event) => event.target instanceof globalThis.Node && dom.contains(event.target),
      ignoreMutation: () => true,
      selectNode: () => dom.classList.add("selected"),
      deselectNode: () => dom.classList.remove("selected"),
      destroy() {
        if (activeSourceCancel === close) activeSourceCancel = null;
        dom.remove();
      },
    };
  };
});

export const htmlInlineAtomView = $view(htmlInlineAtomSchema.node, () => {
  return (initialNode, view, getPos): NodeView => {
    let node = initialNode;
    const dom = document.createElement("span");
    dom.className = "ob-html-node ob-html-inline-atom";
    dom.contentEditable = "false";
    const render = document.createElement("span");
    render.className = "ob-html-render ob-html-inline-render";
    dom.appendChild(render);
    renderHtmlInto(render, stringAttr(node.attrs.value));
    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        const changed = next.attrs.value !== node.attrs.value;
        node = next;
        if (changed) renderHtmlInto(render, stringAttr(node.attrs.value));
        return true;
      },
      stopEvent: (event) => event.target instanceof globalThis.Node && dom.contains(event.target),
      ignoreMutation: () => true,
      selectNode: () => dom.classList.add("selected"),
      deselectNode: () => dom.classList.remove("selected"),
      destroy: () => dom.remove(),
    };
  };
});

export const htmlDetailsView = $view(htmlDetailsSchema.node, () => {
  return (initialNode, view, getPos): NodeView => {
    let node = initialNode;
    const dom = document.createElement("div");
    dom.className = "ob-html-node ob-html-details";
    const toolbar = document.createElement("div");
    toolbar.className = "ob-html-toolbar";
    const button = sourceButton();
    toolbar.appendChild(button);
    const details = document.createElement("details");
    details.className = "ob-html-details-native";
    details.open = hasOpenAttribute(stringAttr(node.attrs.open));
    const summary = document.createElement("summary");
    summary.className = "ob-html-summary ob-html-render";
    const contentDOM = document.createElement("div");
    contentDOM.className = "ob-html-details-content";
    details.append(summary, contentDOM);
    const panel = document.createElement("div");
    panel.className = "ob-html-source ob-html-details-source";
    panel.hidden = true;
    const openArea = sourceArea(stringAttr(node.attrs.open), "details 开标签");
    const summaryArea = sourceArea(stringAttr(node.attrs.summary), "summary 源码");
    const closeArea = sourceArea(stringAttr(node.attrs.close), "details 闭标签");
    panel.append(openArea, summaryArea, closeArea);
    dom.append(toolbar, details, panel);
    let panelOpen = false;

    const renderSummary = () => {
      if (!stringAttr(node.attrs.summary)) {
        summary.textContent = "详情";
        return;
      }
      renderHtmlInto(summary, stringAttr(node.attrs.summary));
    };
    const syncAreas = () => {
      openArea.value = stringAttr(node.attrs.open);
      summaryArea.value = stringAttr(node.attrs.summary);
      closeArea.value = stringAttr(node.attrs.close);
      for (const area of [openArea, summaryArea, closeArea]) area.removeAttribute("aria-invalid");
    };
    const close = () => {
      panelOpen = false;
      panel.hidden = true;
      syncAreas();
      if (activeSourceCancel === close) activeSourceCancel = null;
    };
    const commit = (): boolean => {
      if (!panelOpen) return false;
      const pos = typeof getPos === "function" ? getPos() : undefined;
      const next = {
        open: openArea.value,
        summary: summaryArea.value,
        close: closeArea.value,
      };
      if (
        pos == null ||
        (next.open === node.attrs.open &&
          next.summary === node.attrs.summary &&
          next.close === node.attrs.close)
      ) {
        close();
        return true;
      }
      if (!updateHtmlDetailsSource(view, pos, next)) {
        for (const area of [openArea, summaryArea, closeArea]) area.setAttribute("aria-invalid", "true");
        return false;
      }
      close();
      return true;
    };
    const open = () => {
      if (!view.editable) return;
      activeSourceCancel?.();
      panelOpen = true;
      panel.hidden = false;
      syncAreas();
      activeSourceCancel = close;
      openArea.focus();
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (panelOpen) commit();
      else open();
    });
    for (const area of [openArea, summaryArea, closeArea]) wireSourceArea(area, panel, commit, close);
    renderSummary();
    dom.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const a = target.closest<HTMLAnchorElement>("a[data-ob-html-link]");
      if (!a || !summary.contains(a)) return;
      event.preventDefault();
      event.stopPropagation();
      openRenderedLink(a);
    });

    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== node.type) return false;
        const openChanged = next.attrs.open !== node.attrs.open;
        const summaryChanged = next.attrs.summary !== node.attrs.summary;
        const closeChanged = next.attrs.close !== node.attrs.close;
        node = next;
        if (openChanged) details.open = hasOpenAttribute(stringAttr(node.attrs.open));
        if (summaryChanged) renderSummary();
        if (openChanged || summaryChanged || closeChanged) close();
        return true;
      },
      stopEvent: (event) => {
        if (!(event.target instanceof globalThis.Node)) return false;
        return !contentDOM.contains(event.target);
      },
      ignoreMutation: (mutation) => !contentDOM.contains(mutation.target),
      destroy() {
        if (activeSourceCancel === close) activeSourceCancel = null;
        dom.remove();
      },
    };
  };
});

/** 正文 inline mark 仅在 Ctrl/Cmd+click 时导航，普通点击保留编辑光标行为。 */
export const htmlInteractionPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("oblet-html-interactions"),
      view(editorView) {
        const onClick = (event: MouseEvent) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const a = target.closest<HTMLAnchorElement>("a.ob-html-inline[data-ob-html-link]");
          if (!a || !editorView.dom.contains(a)) return;
          // 即使无修饰键也阻止浏览器默认导航，但不阻止 PM 的编辑事件链。
          event.preventDefault();
          if (!event.ctrlKey && !event.metaKey) return;
          event.stopPropagation();
          openRenderedLink(a);
        };
        editorView.dom.addEventListener("click", onClick, true);
        return {
          destroy() {
            editorView.dom.removeEventListener("click", onClick, true);
          },
        };
      },
    })
);
