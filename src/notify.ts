// 统一通知系统（toast）：后续所有瞬态提示一律走这里，不再自造横幅/div
// 三级：info（一般信息）/ warn（需要注意，如外部变更）/ error（操作失败，如保存失败）
// 持久状态指示（只读横幅）不属于瞬态提示，仍用原有横幅
type Level = "info" | "warn" | "error";

const TIMEOUT: Record<Level, number> = {
  info: 4000,
  warn: 6000,
  error: 9000,
};

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

/** 弹一条通知；点击立即关闭，超时自动消失（滑出后移除节点） */
export function notify(text: string, level: Level = "info"): void {
  const el = document.createElement("div");
  el.className = `toast toast-${level}`;
  el.textContent = text;
  el.title = "点击关闭";

  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    el.classList.add("toast-out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  };
  el.addEventListener("click", dismiss);
  setTimeout(dismiss, TIMEOUT[level]);

  getContainer().appendChild(el);
}

/** 居中确认弹窗（批次 7 细节调整）：替代原生 window.confirm，与 toast 同一设计语言。
 *  Esc / 点遮罩 = 取消，Enter / 主按钮 = 确认 */
export function confirmDialog(
  message: string,
  confirmText = "确认",
  cancelText = "取消"
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ob-confirm-overlay";
    overlay.innerHTML = `
      <div class="ob-confirm" role="dialog" aria-modal="true">
        <p class="ob-confirm-msg"></p>
        <div class="ob-confirm-actions">
          <button class="ob-confirm-btn" data-act="cancel"></button>
          <button class="ob-confirm-btn ob-confirm-primary" data-act="ok"></button>
        </div>
      </div>`;
    overlay.querySelector(".ob-confirm-msg")!.textContent = message;
    const cancel = overlay.querySelector<HTMLButtonElement>('[data-act="cancel"]')!;
    const ok = overlay.querySelector<HTMLButtonElement>('[data-act="ok"]')!;
    cancel.textContent = cancelText;
    ok.textContent = confirmText;

    const done = (v: boolean) => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      } else if (e.key === "Enter") {
        e.stopPropagation();
        done(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
    });
    document.body.appendChild(overlay);
    ok.focus();
  });
}
